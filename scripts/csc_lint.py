#!/usr/bin/env python3
"""csc_lint.py — Command/Skill Contract (CSC-1) linter.

Enforces the naming/identity contract defined in docs/CSC-1-RESTRUCTURE-PLAN.md
so command<->skill drift can never silently break invocation again (the
bs:quality wrapper-recursion incident, 2026-06-04).

Phase 0 ships this in WARN-ONLY mode: it reports every violation and the totals
but exits 0, so it can land in all three repos without breaking CI while the
migration happens. Flip to fail-mode by passing --strict (or setting
CSC_LINT_STRICT=1) once a repo is clean.

Rules (see plan §5):
  R1 delegation declared       — a non-standalone command must carry the prose
                                 "Invoke the `<skill>` skill", or share a name
                                 with a skill. (It used to require an `invokes:`
                                 frontmatter key — REMOVED 2026-07-10: Claude Code
                                 does not parse that field. Verified against the
                                 2.1.207 binary, where `allowed-tools`,
                                 `standalone`, `argument-hint`, `user-invocable`
                                 and `disable-model-invocation` all appear as
                                 quoted frontmatter keys and `invokes`/
                                 `auto_invoke` appear ZERO times. Linting for a
                                 field the runtime ignores is worse than not
                                 linting: it manufactures busywork and lends false
                                 confidence.)
  R2 name identity             — command name == "{ns}:{stem}" (ns in bs/cc/gh);
                                 skill name == dir name (lowercase-kebab)
  R3 invoke resolves           — the skill a command delegates to must exist
  R4 no reverse edges          — a SKILL.md must not invoke another /command
  R5 no cross-dir duplicates   — same base name defined in >1 command (or skill) dir
  R6 orphan policy             — a command that invokes nothing needs standalone: true

This linter is dependency-free (hand-parses YAML frontmatter) so it runs
identically across the kit and any overlay repo without a pip step.

Usage:
    python3 scripts/csc_lint.py [--root <repo>] [--strict] [--json]
Exit code: 0 in warn mode (default) or when clean; 1 in --strict with violations.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

NAMESPACES = ("bs", "cc", "gh")
KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
# Reverse-edge recursion guard: a skill body that INVOKES a slash command.
# Per plan §5.4, ANY `/bs:`, `/cc:`, `/gh:` slash-command token in a skill body
# is a reverse edge — skills must never invoke commands (recursion risk). We do
# NOT gate on a preceding verb: imperative forms like "Then /bs:status",
# "Next: /bs:quality", or "Delegate to command /bs:cleanup" are real edges and a
# verb-window misses them. False-positive contexts (headings, fenced code,
# inline links, declared cross-references) are removed by _strip_for_edge_scan
# BEFORE this runs, so a bare token match here is a genuine invocation.
REVERSE_EDGE = re.compile(r"/((?:bs|cc|gh):[a-z0-9-]+)")
# How a command declares the skill it runs. This is the ONLY mechanism — Claude
# Code does not parse an `invokes:` frontmatter field (verified against 2.1.207).
INVOKE_PROSE = re.compile(r"[Ii]nvoke the `?([a-z0-9-]+)`? skill")
# Fenced code blocks (``` ... ``` or ~~~ ... ~~~) — stripped before reverse-edge
# scan so usage examples inside fences aren't counted as real invocations.
CODE_FENCE = re.compile(
    r"^[ \t]*(```|~~~).*?^[ \t]*\1[ \t]*$", re.DOTALL | re.MULTILINE
)
# Inline code spans — `` `/bs:x` `` (one or more backticks). Backticks mark text
# as a literal NAME, not an executed directive; a doc that says "run `/bs:quality`
# afterward" is referencing the command, not invoking it mid-skill. Stripped
# before the scan for the same reason as fences and links. A BARE token in prose
# (no backticks) is still treated as a genuine invocation (plan §5.4).
INLINE_CODE = re.compile(r"(`+)[^`]*?\1")
# Markdown inline links to a command — `[text](/bs:x)`, `[/bs:x](/bs:x)`, or
# ``[`/bs:x`](/bs:x ...)``. A link is a cross-reference (documentation), not an
# invocation. We strip the ENTIRE span (label + destination): stripping only the
# `](/bs:x)` destination would leave a label like `[/bs:status]` that still
# contains a command token and re-fires R4 (Codex finding 2026-06-05).
MD_LINK_TO_CMD = re.compile(r"\[[^\]]*\]\(\s*/(?:bs|cc|gh):[a-z0-9-]+[^)]*\)")
# Words that mark a line/heading as a cross-reference, not an invocation.
CROSS_REF_WORDS = (
    r"see also|see|related|cf\.?|compare|aka|alias(?:es)?|references?|links?"
)
# Explicit "see also" / "related" cross-reference lines that name a command.
# These document a sibling, they don't invoke it; stripped before the scan.
CROSS_REF_LINE = re.compile(rf"^[ \t>*-]*(?:{CROSS_REF_WORDS})\b.*$", re.IGNORECASE)
# A markdown HEADING that opens a cross-reference SECTION, e.g.
# "## Related commands" or "### See also". Everything under it (until the next
# heading) is documentation, so list items like "- /bs:status" there are not
# invocations. We require an explicit cross-reference word — a bare "Commands"
# heading is NOT treated as cross-reference, because "## Commands this skill
# runs: - /bs:status" is exactly the recursion R4 must still catch.
CROSS_REF_HEADING = re.compile(
    rf"^[ \t]*#{{1,6}}\s+.*\b(?:{CROSS_REF_WORDS})\b.*$", re.IGNORECASE
)
HEADING_LINE = re.compile(r"^[ \t]*#{1,6}\s")
# Markdown reference-link definition — `[label]: /bs:status`. A definition, not
# a call. Stripped before the scan.
REF_LINK_DEF = re.compile(r"^[ \t]*\[[^\]]+\]:\s*/(?:bs|cc|gh):[a-z0-9-]+")


def _strip_for_edge_scan(body: str) -> str:
    """Remove non-invocation contexts before the reverse-edge scan.

    Strips, in this order:
      - fenced code blocks (usage examples),
      - inline links `[t](/bs:x)` and reference-link defs `[t]: /bs:x`,
      - markdown headings (mentions, not calls),
      - "see also"/"related" cross-reference *lines*, and
      - any line inside a cross-reference *section* (a "Related commands" /
        "See also" heading block, until the next heading).

    What remains is prose where a bare slash-command token is a genuine
    invocation (plan §5.4).
    """
    body = CODE_FENCE.sub("", body)
    body = MD_LINK_TO_CMD.sub("", body)
    body = INLINE_CODE.sub("", body)
    kept = []
    in_cross_ref_section = False
    for line in body.splitlines():
        if HEADING_LINE.match(line):
            # A heading both ends any prior section and may open a new one.
            in_cross_ref_section = bool(CROSS_REF_HEADING.match(line))
            continue  # the heading text itself is a mention, never a call
        if in_cross_ref_section:
            continue  # documentation under a cross-reference heading
        if REF_LINK_DEF.match(line):  # `[label]: /bs:x` definition, not a call
            continue
        if CROSS_REF_LINE.match(line):  # inline "see also …" cross-reference
            continue
        kept.append(line)
    return "\n".join(kept)


@dataclass
class Violation:
    rule: str
    severity: str  # high | medium | low
    name: str
    detail: str


@dataclass
class Report:
    violations: list[Violation] = field(default_factory=list)
    commands: int = 0
    skills: int = 0

    def add(self, *a, **k) -> None:
        self.violations.append(Violation(*a, **k))


def _parse_frontmatter(text: str) -> dict[str, str]:
    """Minimal YAML-frontmatter parser for CSC-1 keys.

    Handles top-level `key: value` scalars AND the single-item list/blank-scalar
    form, where the value sits on the next indented line:

        allowed-tools:
          Read

    For that form the value (with a leading `-` list marker stripped, if present)
    is folded onto the key. Multi-item lists are out of scope — CSC-1 keys are
    all single-valued — so only the first indented value line is taken.
    """
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    fm: dict[str, str] = {}
    lines = text[3:end].splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        i += 1
        if not line or line.lstrip().startswith("#"):
            continue
        if line[0] in " \t":  # stray indented line with no parent key — skip
            continue
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip().strip("\"'")
        if val:
            fm[key] = val
            continue
        # Blank scalar — value may be on the next indented (optionally `-`) line.
        if i < len(lines):
            nxt = lines[i]
            if nxt and nxt[0] in " \t":
                child = nxt.strip()
                if child.startswith("- "):
                    child = child[2:].strip()
                elif child == "-":
                    child = ""
                # Ignore comment-only continuation lines.
                if child and not child.startswith("#"):
                    fm[key] = child.split("#", 1)[0].strip().strip("\"'")
                    i += 1
                    continue
        fm[key] = ""  # genuinely empty value
    return fm


def _truthy(val: str | None) -> bool:
    return str(val).strip().lower() in ("true", "yes", "1")


def _find_command_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for d in root.rglob("commands"):
        if "node_modules" in d.parts or not d.is_dir():
            continue
        out += [p for p in d.rglob("*.md") if p.name not in ("README.md",)]
    return out


def _find_skill_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for d in root.rglob("skills"):
        if "node_modules" in d.parts or not d.is_dir():
            continue
        out += list(d.rglob("SKILL.md"))
    return out


def lint(root: Path) -> Report:
    rep = Report()
    cmd_files = _find_command_files(root)
    skill_files = _find_skill_files(root)
    rep.commands = len(cmd_files)
    rep.skills = len(skill_files)

    # Build skill set: dir name -> list of paths (for dup detection)
    skill_dirs: dict[str, list[Path]] = {}
    skill_meta: dict[str, dict] = {}
    for sf in skill_files:
        name = sf.parent.name
        skill_dirs.setdefault(name, []).append(sf)
        fm = _parse_frontmatter(sf.read_text(errors="replace"))
        skill_meta[name] = fm
        # R1 skill completeness
        if not fm.get("name"):
            rep.add(
                "R1",
                "high",
                str(sf.relative_to(root)),
                "skill missing frontmatter 'name'",
            )
        if not fm.get("description"):
            rep.add(
                "R1", "medium", str(sf.relative_to(root)), "skill missing 'description'"
            )
        # R2 skill name identity
        if fm.get("name") and fm["name"] != name:
            rep.add(
                "R2",
                "high",
                name,
                f"skill name '{fm['name']}' != dir '{name}' "
                "(move display text to 'title:')",
            )
        if not KEBAB.match(name):
            rep.add("R2", "low", name, "skill dir not lowercase-kebab")
        # R4 reverse-edge recursion guard (mentions in headings/code fences excluded).
        # A skill referencing its OWN paired command (skill `x` -> `/ns:x`) is
        # self-documentation ("you invoked me via /bs:quality"), not a recursion
        # edge — a skill cannot infinitely bounce into itself. R4 fires only on
        # CROSS edges (skill x -> /ns:y, y != x), the real A->B->A loop risk.
        body = sf.read_text(errors="replace")
        body = body[body.find("\n---", 3) + 4 :] if body.startswith("---") else body
        scan = _strip_for_edge_scan(body)
        all_edges = {"/" + m.group(1) for m in REVERSE_EDGE.finditer(scan)}
        cross_edges = sorted(e for e in all_edges if e.split(":", 1)[-1] != name)
        if cross_edges:
            rep.add(
                "R4",
                "high",
                name,
                f"skill body invokes command(s) {cross_edges} — skills must never "
                "call other /commands (recursion risk)",
            )

    # R5 skill cross-dir duplicates
    for name, paths in skill_dirs.items():
        if len(paths) > 1:
            rep.add(
                "R5",
                "medium",
                name,
                "skill defined in multiple dirs: "
                + ", ".join(str(p.relative_to(root)) for p in paths),
            )

    invoked_skills: set[str] = set()
    cmd_basenames: dict[str, list[Path]] = {}
    for cf in cmd_files:
        fm = _parse_frontmatter(cf.read_text(errors="replace"))
        stem = cf.stem
        rel = str(cf.relative_to(root))
        # Deprecated alias stubs (plan §2.6) intentionally keep the OLD name/path
        # during the grace window, so they're exempt from R2 identity + R5 dup
        # checks. The deprecation-expiry rule (future) handles their removal date.
        if fm.get("deprecated"):
            continue
        cmd_basenames.setdefault(stem, []).append(cf)
        # R1 command completeness
        if not fm.get("name"):
            rep.add("R1", "high", rel, "command missing frontmatter 'name'")
        if not fm.get("description"):
            rep.add("R1", "medium", rel, "command missing 'description'")
        # R2 command name identity
        nm = fm.get("name", "")
        if nm:
            if ":" not in nm:
                rep.add(
                    "R2",
                    "high",
                    nm,
                    f"command name '{nm}' has no namespace (expect bs:/cc:/gh:)",
                )
            else:
                ns, _, base = nm.partition(":")
                if ns not in NAMESPACES:
                    rep.add(
                        "R2",
                        "medium",
                        nm,
                        f"unknown namespace '{ns}' (allowed: {NAMESPACES})",
                    )
                if base != stem:
                    rep.add(
                        "R2",
                        "high",
                        nm,
                        f"command base '{base}' != filename stem '{stem}'",
                    )
                # R2: namespace must match the commands/<ns>/ parent dir, when present.
                parent = cf.parent.name
                if ns in NAMESPACES and parent != ns and parent != "commands":
                    rep.add(
                        "R2",
                        "medium",
                        nm,
                        f"namespace '{ns}:' but file is under commands/{parent}/ "
                        f"(move to commands/{ns}/ or fix the name)",
                    )
        # Determine the invoked skill from the delegation prose, else the basename.
        #
        # R1 USED TO REQUIRE an `invokes:` frontmatter field. It was removed
        # 2026-07-10 because CLAUDE CODE DOES NOT PARSE THAT FIELD. Verified
        # against the 2.1.207 binary: as quoted frontmatter keys, `allowed-tools`
        # (11), `standalone` (9), `argument-hint` (8), `user-invocable` (5) and
        # `disable-model-invocation` (4) all appear — `invokes` and `auto_invoke`
        # appear ZERO times. The delegation has always worked purely because the
        # BODY says "Invoke the `x` skill"; `invokes:` was decoration a linter
        # demanded and the runtime ignored.
        #
        # Enforcing a field the runtime doesn't read is worse than not linting:
        # it manufactures busywork and lends false confidence. So R1 now checks
        # the thing that actually matters — that a delegating command resolves to
        # a skill that EXISTS.
        body = cf.read_text(errors="replace")
        standalone = _truthy(fm.get("standalone"))
        if standalone:
            continue

        m = INVOKE_PROSE.search(body)
        target = m.group(1) if m else stem

        if not m and target not in skill_dirs:
            # No delegation prose AND no same-named skill: the command neither
            # delegates nor stands alone. That is a real contract break.
            rep.add(
                "R1",
                "medium",
                nm or stem,
                "command has no 'Invoke the `<skill>` skill' delegation and no "
                f"skill named '{stem}' exists — add the delegation line, add the "
                "skill, or mark the command 'standalone: true'",
            )

        if target:
            invoked_skills.add(target)
            # R3: the skill it delegates to must exist.
            if target not in skill_dirs:
                rep.add(
                    "R3",
                    "high",
                    nm or stem,
                    f"delegates to skill '{target}' which does not exist "
                    "(add the skill, or mark the command 'standalone: true')",
                )

    # R5 command cross-dir duplicates
    for base, paths in cmd_basenames.items():
        if len(paths) > 1:
            rep.add(
                "R5",
                "low",
                base,
                "command defined in multiple dirs: "
                + ", ".join(str(p.relative_to(root)) for p in paths),
            )

    # R6 orphan policy — skill with no command and not auto_invoke
    for name, fm in skill_meta.items():
        if name not in invoked_skills and not _truthy(fm.get("auto_invoke")):
            rep.add(
                "R6",
                "low",
                name,
                "skill has no command and no 'auto_invoke: true' — declare intent",
            )

    return rep


def main() -> int:
    ap = argparse.ArgumentParser(description="CSC-1 command/skill contract linter")
    ap.add_argument("--root", default=".", help="repo root to lint (default: cwd)")
    ap.add_argument(
        "--strict",
        action="store_true",
        help="exit 1 on any violation (default: warn-only, exit 0)",
    )
    ap.add_argument("--json", action="store_true", help="emit JSON report")
    args = ap.parse_args()

    strict = args.strict or _truthy(os.environ.get("CSC_LINT_STRICT"))
    root = Path(args.root).resolve()
    rep = lint(root)

    by_rule: dict[str, int] = {}
    for v in rep.violations:
        by_rule[v.rule] = by_rule.get(v.rule, 0) + 1

    if args.json:
        print(
            json.dumps(
                {
                    "root": str(root),
                    "commands": rep.commands,
                    "skills": rep.skills,
                    "total_violations": len(rep.violations),
                    "by_rule": by_rule,
                    "violations": [v.__dict__ for v in rep.violations],
                },
                indent=2,
            )
        )
        # JSON mode emits pure JSON only — no human footer (keeps output parseable).
        return 1 if (rep.violations and strict) else 0
    print(f"CSC-1 lint: {root}")
    print(
        f"  commands={rep.commands} skills={rep.skills} "
        f"violations={len(rep.violations)}"
    )
    for rule in sorted(by_rule):
        print(f"  {rule}: {by_rule[rule]}")
    for v in rep.violations:
        print(f"  [{v.severity:6}] {v.rule} {v.name}: {v.detail}")

    if rep.violations and strict:
        print(
            f"\n❌ {len(rep.violations)} CSC-1 violation(s) (strict mode).",
            file=sys.stderr,
        )
        return 1
    if rep.violations:
        print(
            f"\n⚠️  {len(rep.violations)} CSC-1 violation(s) (warn-only — not failing)."
        )
    else:
        print("\n✅ CSC-1 clean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
