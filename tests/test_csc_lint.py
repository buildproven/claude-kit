"""Tests for scripts/csc_lint.py — the CSC-1 command/skill contract linter."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# Load scripts/csc_lint.py by path: scripts/ is excluded from mypy and is not
# an importable package, so a bare `import csc_lint` fails type-checking. This
# mirrors tests/test_generate_image.py's loader pattern.
_LINT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "csc_lint.py"
_spec = importlib.util.spec_from_file_location("csc_lint", _LINT_PATH)
assert _spec is not None and _spec.loader is not None, f"cannot load {_LINT_PATH}"
csc_lint = importlib.util.module_from_spec(_spec)
sys.modules["csc_lint"] = csc_lint
_spec.loader.exec_module(csc_lint)


def _mk(root: Path, rel: str, body: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body)


def _cmd(
    name: str, body: str = "Invoke the quality skill.", invokes: str = "quality"
) -> str:
    fm = f"---\nname: {name}\ndescription: x\n"
    if invokes is not None:
        fm += f"invokes: {invokes}\n"
    return fm + f"---\n{body}\n"


def _skill(name: str, body: str = "Do the thing.") -> str:
    return f"---\nname: {name}\ndescription: x\n---\n{body}\n"


def test_clean_pair_has_no_violations(tmp_path: Path) -> None:
    _mk(tmp_path, "commands/bs/quality.md", _cmd("bs:quality"))
    _mk(tmp_path, "skills/quality/SKILL.md", _skill("quality"))
    rep = csc_lint.lint(tmp_path)
    assert rep.commands == 1 and rep.skills == 1
    assert rep.violations == [], [v.detail for v in rep.violations]


def test_r1_delegation_prose_is_sufficient(tmp_path: Path) -> None:
    # R1 used to demand an `invokes:` frontmatter key. Claude Code DOES NOT PARSE
    # that field (verified against the 2.1.207 binary: `allowed-tools`,
    # `standalone`, `argument-hint`, `user-invocable` and
    # `disable-model-invocation` all appear as quoted frontmatter keys; `invokes`
    # and `auto_invoke` appear zero times). The delegation has always worked
    # purely because the BODY says "Invoke the `x` skill".
    #
    # So the prose alone must be enough. Demanding a field the runtime ignores is
    # worse than not linting — it manufactures busywork and lends false confidence.
    _mk(
        tmp_path,
        "commands/bs/quality.md",
        "---\nname: bs:quality\ndescription: x\n---\nInvoke the `quality` skill.\n",
    )
    _mk(tmp_path, "skills/quality/SKILL.md", _skill("quality"))
    rep = csc_lint.lint(tmp_path)
    assert not any(v.rule in ("R1", "R3") for v in rep.violations), [
        v.detail for v in rep.violations
    ]


def test_r1_flags_a_command_that_neither_delegates_nor_stands_alone(
    tmp_path: Path,
) -> None:
    # No delegation prose, no same-named skill, not standalone -> genuinely broken.
    _mk(
        tmp_path,
        "commands/bs/orphan.md",
        "---\nname: bs:orphan\ndescription: x\n---\nsome body with no delegation\n",
    )
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R1" for v in rep.violations)


def test_r2_namespace_must_match_parent_dir(tmp_path: Path) -> None:
    # name says cc: but file is under commands/bs/
    _mk(tmp_path, "commands/bs/optimize.md", _cmd("cc:optimize", invokes="optimize"))
    _mk(tmp_path, "skills/optimize/SKILL.md", _skill("optimize"))
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R2" and "commands/bs/" in v.detail for v in rep.violations)


def test_r4_ignores_command_mentions_in_headings_and_fences(tmp_path: Path) -> None:
    # A skill that only MENTIONS commands (heading + code fence) is not a reverse edge.
    body = (
        "# /bs:post examples\n\n"
        "See the related commands below.\n\n"
        "```sh\n/bs:quality --merge\n```\n\n"
        "This skill produces a report.\n"
    )
    _mk(tmp_path, "skills/status/SKILL.md", _skill("status", body))
    _mk(tmp_path, "commands/bs/status.md", _cmd("bs:status", invokes="status"))
    rep = csc_lint.lint(tmp_path)
    assert not any(v.rule == "R4" for v in rep.violations), [
        v.detail for v in rep.violations if v.rule == "R4"
    ]


def test_r4_still_catches_real_cross_invocation(tmp_path: Path) -> None:
    # CROSS edge: the `recover` skill telling Claude to run a DIFFERENT command.
    _mk(
        tmp_path,
        "skills/recover/SKILL.md",
        _skill("recover", "When triggered, run /bs:cleanup to free resources."),
    )
    _mk(tmp_path, "commands/bs/cleanup.md", _cmd("bs:cleanup", invokes="cleanup"))
    _mk(tmp_path, "skills/cleanup/SKILL.md", _skill("cleanup"))
    _mk(tmp_path, "commands/bs/recover.md", _cmd("bs:recover", invokes="recover"))
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R4" and "/bs:cleanup" in v.detail for v in rep.violations)


def test_r4_ignores_inline_code_command_mentions(tmp_path: Path) -> None:
    # Backtick-wrapped command tokens are NAME mentions in docs, not invocations.
    body = (
        "When done, run `/bs:quality --merge` afterward.\n"
        "For anything else, use `/bs:dev`.\n"
    )
    _mk(tmp_path, "skills/recover/SKILL.md", _skill("recover", body))
    _mk(tmp_path, "commands/bs/recover.md", _cmd("bs:recover", invokes="recover"))
    rep = csc_lint.lint(tmp_path)
    assert not any(v.rule == "R4" for v in rep.violations), [
        v.detail for v in rep.violations if v.rule == "R4"
    ]


def test_r4_still_catches_bare_prose_cross_edge(tmp_path: Path) -> None:
    # Same content WITHOUT backticks is a genuine bare-prose invocation -> R4.
    body = "When done, run /bs:quality to ship.\n"
    _mk(tmp_path, "skills/recover/SKILL.md", _skill("recover", body))
    _mk(tmp_path, "commands/bs/recover.md", _cmd("bs:recover", invokes="recover"))
    _mk(tmp_path, "commands/bs/quality.md", _cmd("bs:quality", invokes="quality"))
    _mk(tmp_path, "skills/quality/SKILL.md", _skill("quality"))
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R4" and "/bs:quality" in v.detail for v in rep.violations)


def test_deprecated_stub_is_exempt(tmp_path: Path) -> None:
    # A deprecated alias keeps the OLD bare name/path during the grace window;
    # it must not trip R2 (no namespace) or R5 (duplicate of the renamed cmd).
    _mk(
        tmp_path,
        "commands/update-claudemd.md",
        "---\nname: update-claudemd\ndescription: x\n"
        'deprecated: "use /cc:update-claudemd; removed after 2026-07-08"\n'
        "standalone: true\n---\nDeprecated.\n",
    )
    _mk(
        tmp_path,
        "commands/cc/update-claudemd.md",
        "---\nname: cc:update-claudemd\ndescription: x\nstandalone: true\n---\nbody\n",
    )
    rep = csc_lint.lint(tmp_path)
    assert rep.violations == [], [v.detail for v in rep.violations]


def test_r4_allows_self_reference(tmp_path: Path) -> None:
    # SELF edge: the `quality` skill mentioning its OWN /bs:quality command is
    # self-documentation, not a recursion loop — must NOT fire R4.
    _mk(
        tmp_path,
        "skills/quality/SKILL.md",
        _skill("quality", "You invoked me via /bs:quality. Now run the suite."),
    )
    _mk(tmp_path, "commands/bs/quality.md", _cmd("bs:quality", invokes="quality"))
    rep = csc_lint.lint(tmp_path)
    assert not any(v.rule == "R4" for v in rep.violations), [
        v.detail for v in rep.violations if v.rule == "R4"
    ]


def test_r4_catches_bare_imperative_invocations(tmp_path: Path) -> None:
    # Plan §5.4: ANY slash-command token in a skill body is a reverse edge,
    # even without a leading verb. These all previously slipped past the
    # verb-window regex (Codex finding 2026-06-05). Uses a CROSS reference
    # (the `workflow` skill pointing at OTHER commands) so the self-reference
    # allowance doesn't mask the bare-imperative detection being tested.
    for body in (
        "Then /bs:status to finish.",
        "Next: /bs:quality --merge",
        "Delegate to command /bs:cleanup here.",
        "Steps:\n/bs:dev",
    ):
        root = tmp_path / body[:6].replace("/", "_").replace(":", "_").replace(" ", "_")
        _mk(root, "skills/workflow/SKILL.md", _skill("workflow", body))
        _mk(root, "commands/bs/workflow.md", _cmd("bs:workflow", invokes="workflow"))
        rep = csc_lint.lint(root)
        assert any(v.rule == "R4" for v in rep.violations), f"missed R4 in: {body!r}"


def test_r4_ignores_inline_links_and_cross_refs(tmp_path: Path) -> None:
    # A markdown link to a command and a "see also" line are cross-references,
    # not invocations — they must not trip R4 (guards against re-introducing the
    # over-reporting Codex flagged earlier).
    body = (
        "This skill produces a report.\n\n"
        "See also /bs:status for the summary view.\n"
        "More detail in [the status command](/bs:status).\n"
        # Link label itself contains the command token — the WHOLE span must be
        # stripped, not just the destination (Codex finding 2026-06-05).
        "Even ``[`/bs:status`](/bs:status)`` and [/bs:dev](/bs:dev) are links.\n"
    )
    _mk(tmp_path, "skills/report/SKILL.md", _skill("report", body))
    _mk(tmp_path, "commands/bs/report.md", _cmd("bs:report", invokes="report"))
    rep = csc_lint.lint(tmp_path)
    assert not any(v.rule == "R4" for v in rep.violations), [
        v.detail for v in rep.violations if v.rule == "R4"
    ]


def test_r4_ignores_cross_reference_section_and_ref_link_defs(tmp_path: Path) -> None:
    # A "## Related commands" section with list items, and a reference-link
    # definition, are documentation — not invocations (Codex finding 2026-06-05).
    body = (
        "This skill produces a report.\n\n"
        "## Related commands\n\n"
        "- /bs:status — summary view\n"
        "- /bs:dev — start work\n\n"
        "[status]: /bs:status\n"
    )
    _mk(tmp_path, "skills/report/SKILL.md", _skill("report", body))
    _mk(tmp_path, "commands/bs/report.md", _cmd("bs:report", invokes="report"))
    rep = csc_lint.lint(tmp_path)
    assert not any(v.rule == "R4" for v in rep.violations), [
        v.detail for v in rep.violations if v.rule == "R4"
    ]


def test_r4_cross_ref_section_ends_at_next_heading(tmp_path: Path) -> None:
    # The cross-reference exclusion must NOT leak past the next heading: a real
    # invocation in a later section is still caught.
    body = (
        "## See also\n\n"
        "- /bs:status\n\n"
        "## Steps\n\n"
        "Then /bs:cleanup to finish.\n"
    )
    _mk(tmp_path, "skills/report/SKILL.md", _skill("report", body))
    _mk(tmp_path, "commands/bs/report.md", _cmd("bs:report", invokes="report"))
    rep = csc_lint.lint(tmp_path)
    r4 = [v.detail for v in rep.violations if v.rule == "R4"]
    assert any("/bs:cleanup" in d for d in r4), r4
    assert not any("/bs:status" in d for d in r4), r4


def test_r4_bare_commands_heading_still_catches_invocations(tmp_path: Path) -> None:
    # A heading without a cross-reference word ("## Commands this skill runs")
    # is NOT treated as documentation — the list under it is a real reverse edge.
    body = "## Commands this skill runs\n\n- /bs:status\n"
    _mk(tmp_path, "skills/report/SKILL.md", _skill("report", body))
    _mk(tmp_path, "commands/bs/report.md", _cmd("bs:report", invokes="report"))
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R4" and "/bs:status" in v.detail for v in rep.violations), [
        v.detail for v in rep.violations if v.rule == "R4"
    ]


def test_delegation_prose_to_a_differently_named_skill(tmp_path: Path) -> None:
    # A command may delegate to a skill whose name differs from its own basename.
    # The prose is the source of truth (there is no `invokes:` field to consult).
    _mk(
        tmp_path,
        "commands/bs/design.md",
        "---\nname: bs:design\ndescription: x\n---\nInvoke the `design-loop` skill.\n",
    )
    _mk(tmp_path, "skills/design-loop/SKILL.md", _skill("design-loop"))
    rep = csc_lint.lint(tmp_path)
    assert not any(v.rule == "R3" for v in rep.violations), [
        v.detail for v in rep.violations if v.rule == "R3"
    ]
    # And no false "missing invokes" R1 either.
    assert not any(v.rule == "R1" and "invokes" in v.detail for v in rep.violations), [
        v.detail for v in rep.violations if v.rule == "R1"
    ]


def test_frontmatter_list_form_with_dash() -> None:
    # YAML list with an explicit `- ` marker is the same single-valued key.
    fm = csc_lint._parse_frontmatter(
        "---\nname: bs:design\ninvokes:\n  - design-loop\n---\n"
    )
    assert fm.get("invokes") == "design-loop", fm
    assert fm.get("name") == "bs:design", fm


def test_r2_command_basename_must_match_filename(tmp_path: Path) -> None:
    _mk(
        tmp_path, "commands/bs/quality.md", _cmd("bs:qualidy", invokes="quality")
    )  # typo'd base
    _mk(tmp_path, "skills/quality/SKILL.md", _skill("quality"))
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R2" for v in rep.violations)


def test_r2_skill_name_must_match_dir(tmp_path: Path) -> None:
    _mk(tmp_path, "commands/bs/quality.md", _cmd("bs:quality"))
    _mk(tmp_path, "skills/quality/SKILL.md", _skill("Quality (Display Title)"))
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R2" and "dir" in v.detail for v in rep.violations)


def test_r3_invoke_must_resolve(tmp_path: Path) -> None:
    _mk(tmp_path, "commands/bs/ghost.md", _cmd("bs:ghost", invokes="ghost"))
    # no skills/ghost/ exists
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R3" for v in rep.violations)


def test_r5_duplicate_skill_dirs_flagged(tmp_path: Path) -> None:
    _mk(tmp_path, "skills/dev/SKILL.md", _skill("dev"))
    _mk(tmp_path, "core/skills/dev/SKILL.md", _skill("dev"))
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R5" for v in rep.violations)


def test_standalone_skill_needs_no_unsupported_auto_invoke_field(
    tmp_path: Path,
) -> None:
    _mk(tmp_path, "skills/error-handling/SKILL.md", _skill("error-handling"))
    rep = csc_lint.lint(tmp_path)
    assert not rep.violations


def test_standalone_command_skips_invoke_check(tmp_path: Path) -> None:
    _mk(
        tmp_path,
        "commands/bs/help.md",
        "---\nname: bs:help\ndescription: x\nstandalone: true\n---\nNo skill here.\n",
    )
    rep = csc_lint.lint(tmp_path)
    assert not any(v.rule == "R3" for v in rep.violations)


def test_r3_flags_delegation_to_a_skill_that_does_not_exist(tmp_path: Path) -> None:
    # The check that actually matters: a command must not delegate into the void.
    _mk(
        tmp_path,
        "commands/bs/design.md",
        "---\nname: bs:design\ndescription: x\n---\nInvoke the `design-loop` skill.\n",
    )
    # ...and design-loop is deliberately NOT created.
    rep = csc_lint.lint(tmp_path)
    assert any(v.rule == "R3" for v in rep.violations)
