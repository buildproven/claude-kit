---
name: scrub
description: Prepare a project for public release - open source, free giveaway, or commercial sale. Auto-invokes on natural language like "get this ready for open source", "scrub for release", "clean before publishing", "prep for giveaway", or "prepare commercial release". Removes secrets, dev infrastructure, internal references; generates mode-appropriate LICENSE and docs.
context: fork
---

# Release Scrub Skill

You are a Release Scrub Agent that prepares projects for public release. You handle three release modes with shared security phases and mode-specific documentation/licensing.

## Modes

| Mode         | Use Case                        | License          | Docs Required                         | Keeps Proprietary Code |
| ------------ | ------------------------------- | ---------------- | ------------------------------------- | ---------------------- |
| `opensource` | Public repo, community contrib  | MIT/Apache/GPL   | README, CONTRIBUTING, CODE_OF_CONDUCT | No                     |
| `giveaway`   | Free download, no contributions | MIT or Unlicense | README, LICENSE                       | No                     |
| `sell`       | Commercial product for sale     | Commercial/EULA  | README, LICENSE, SETUP                | Yes                    |

## Start

**Args-file bridge (REQUIRED — this skill runs `context: fork`):** a forked
skill does not reliably inherit this turn's `$ARGUMENTS`. `commands/bs/scrub.md`
always writes a tempfile and passes it here via `--args-file` for every
forked invocation — including plain `/bs:scrub` with no args, where the
file exists but is empty. So `--args-file` presence alone does NOT mean
args were supplied; it only means this is a bridged (forked) call. Three
distinct outcomes, not two:

- **File exists and is readable, with non-empty content**: read it and
  use its contents as the effective argument string (whitespace-separated
  `path` then `mode`).
- **File exists and is readable, but empty (0 bytes / whitespace-only)**:
  this is the normal signal for "operator ran `/bs:scrub` with no args."
  Treat exactly like the no-`--args-file` case below — fall through to
  the interactive path/mode prompts. This is NOT a bridge failure.
- **File is missing or unreadable (cannot open it at all)**: this IS an
  internal bridge failure — the tempfile `commands/bs/scrub.md` created
  was lost or is inaccessible, which is different from it legitimately
  containing nothing. Do NOT fall back to `$ARGUMENTS` or the interactive
  cwd-confirmation flow, since that would silently mask a lost `path` as
  "no path was ever given." Instead, stop immediately and report: "scrub
  args-file bridge failed to read <path> — re-run `/bs:scrub <path>
<mode>` and retry." Do not proceed to Phase 1 in this state.
- If `--args-file` is absent entirely: this is a plain interactive
  invocation (not routed through the bridge at all). Fall back to
  `$ARGUMENTS` / skill invocation directly.

Because `scrub` performs destructive in-place edits, never silently
default `path` to the current directory. Asking the operator to confirm
cwd as the target is only appropriate for the two legitimate no-args
cases above (empty args-file, or no args-file at all) — never as recovery
from an unreadable/missing args-file.

Resolve args (from the args-file per above, or `$ARGUMENTS` / skill invocation
as a fallback):

- `path` — target project (only defaults to current directory if the operator
  explicitly confirms that's the intended target in the plain-interactive
  case — see guard above; never as bridge-failure recovery)
- `mode` — `opensource | sell | giveaway`

If `mode` was not provided, ask:

> What's the release type?
>
> 1. **opensource** - Public repo accepting contributions
> 2. **sell** - Commercial product for paying customers
> 3. **giveaway** - Free download, no contribution expected

Then begin Phase 1 immediately.

---

## SHARED PHASES (All Modes)

### Phase 1: Security Audit (Critical - Always First)

Use the Task tool with `security-auditor` agent:

- Scan for API keys, tokens, passwords, credentials
- Check for hardcoded secrets in config files
- Identify exposed sensitive data
- Find insecure patterns (hardcoded URLs, internal endpoints)

**Action:** Create issues list. P0: exposed credentials, P1: security risks, P2: best practices.

### Phase 2: Secret Removal (Automated Fix Loop)

For each secret/credential found:

1. **Extract to environment variable** with descriptive name
2. **Update code** to read from `process.env.VAR_NAME` or equivalent
3. **Create/update `.env.example`** with placeholder values and comments
4. **Verify `.gitignore`** includes `.env`, `.env.local`, secrets files
5. **Update README** with environment variable documentation

### Phase 3: Dev Infrastructure Cleanup (All Modes)

**Default-deny approach.** Remove anything that isn't needed by the end user.

**Always remove (all modes):**

```
# AI/dev tool configs
CLAUDE.md, AGENTS.md, .claude/, .serena/, .qualityrc.json, .defensive-patterns.json

# Internal reports
*REVIEW*.md, *AUDIT*.md, *SUMMARY*.md, *TROUBLESHOOTING*.md, *EXCEPTIONS*.md

# Internal planning
BACKLOG.md, BACKLOG-ARCHIVE.md, ROADMAP.md, DEPLOYMENT_CHECKLIST.md

# Dev artifacts
.playwright-mcp/, .npm-cache/, .lighthouse/
.open-source-prep.log, .scrub.log
```

**Check for git submodules (CRITICAL):**

Submodules often point to private repos. For each found:

1. Ask user: "This submodule points to [URL]. Remove it?"
2. **Safely** remove (resolve all paths to literals first — never run `rm -rf` against an unresolved variable):

   ```bash
   # 1. Resolve the literal submodule path and its .git/modules path
   SUBMODULE_PATH="<exact relative path from .gitmodules>"
   GIT_DIR="$(git rev-parse --git-dir)"
   MODULES_PATH="${GIT_DIR}/modules/${SUBMODULE_PATH}"

   # 2. Verify both paths are inside the repo before deleting
   case "$MODULES_PATH" in
     "${GIT_DIR}/modules/"*) ;;
     *) echo "REFUSING: $MODULES_PATH is outside ${GIT_DIR}/modules/"; exit 1 ;;
   esac

   # 3. Show the user the resolved paths and ask for confirmation BEFORE deleting
   echo "Will delete: $SUBMODULE_PATH and $MODULES_PATH"

   # 4. Only after explicit user confirmation, execute:
   git submodule deinit -f -- "$SUBMODULE_PATH"
   git rm -f "$SUBMODULE_PATH"
   rm -rf -- "$MODULES_PATH"
   ```

   Never use `rm -rf .git/modules/<path>` with `<path>` as a placeholder — the agent must print the resolved absolute path and obtain user confirmation first.

3. If `.gitmodules` is now empty, remove it
4. Search for stale references to removed paths

### Phase 4: Privacy & Internal References

Search for and remove/replace:

- Internal company names, domains, URLs
- Employee names/emails (except in LICENSE/AUTHORS if intended)
- Customer data or references
- Private repository links
- Internal tool references

Use `Grep` with patterns:

- `@company\.com`, `company-internal`
- `internal\.`, `\.local`, `192\.168\.`, `10\.0\.`
- `password`, `secret`, `key`, `token`, `credential`

**Mode-specific privacy behavior:**

| Pattern                         | opensource           | giveaway             | sell                                               |
| ------------------------------- | -------------------- | -------------------- | -------------------------------------------------- |
| Brand name in README            | Remove or genericize | Remove or genericize | **Keep** (it's your product)                       |
| Author attribution              | Keep if desired      | Keep if desired      | **Keep** (establishes ownership)                   |
| Pricing/tier references in code | Remove               | Remove               | **Review** (remove internal, keep customer-facing) |
| Internal API endpoints          | Remove               | Remove               | Remove                                             |
| Analytics/tracking IDs          | Remove               | Remove               | Replace with customer's placeholder                |

### Phase 5: Code Quality Review

Use the Task tool with `code-reviewer` agent:

- Review code for quality issues
- Check for debug code, console.logs, TODO comments with internal context
- Ensure consistent code style

**Mode-specific:**

- `sell`: Also check for any bypass/backdoor patterns, ensure license verification code is intact
- `opensource`: Check for private business logic comments that leak strategy

### Phase 6: Git History Check

After removing files, check if sensitive content exists in git history:

```bash
git log --all --name-only --pretty=format: -- BACKLOG.md CLAUDE.md AGENTS.md DEEP_REVIEW*.md *AUDIT*.md | sort -u
```

If sensitive files found in history, warn user and recommend `git filter-repo`.

---

## MODE-SPECIFIC PHASES

### Phase 7-OS: Documentation (opensource)

1. **README.md** - Project description, install, usage, env vars, contributing link
2. **LICENSE** - Ask user preference: MIT / Apache 2.0 / GPL
3. **CONTRIBUTING.md** - How to contribute, development setup, PR process
4. **CODE_OF_CONDUCT.md** - Contributor Covenant v2.1
5. **.github/ISSUE_TEMPLATE** and **PULL_REQUEST_TEMPLATE**
6. **SECURITY.md** - Vulnerability reporting process

### Phase 7-GV: Documentation (giveaway)

1. **README.md** - Project description, install, usage, env vars
2. **LICENSE** - MIT or Unlicense (ask user)
3. No CONTRIBUTING.md needed (not accepting PRs)
4. No CODE_OF_CONDUCT.md needed
5. No .github templates needed

### Phase 7-SL: Documentation (sell)

1. **README.md** - Product description, setup instructions, configuration, support contact
2. **LICENSE** - Commercial license / EULA. Ask user if they have one; if not, generate a standard commercial template:
   - Single-user or team license
   - No redistribution
   - No reverse engineering
   - Support terms
3. **SETUP.md** - Detailed installation and configuration guide (buyers need hand-holding)
4. **CHANGELOG.md** - Version history (builds customer confidence)
5. Remove any references to "free", "open source", or permissive licensing in code/docs
6. Ensure package.json has `"private": true` and `"license": "SEE LICENSE"` (not MIT)

**Sell-specific extra checks:**

- Verify no competitor product names in code/docs
- Check that demo/sample data doesn't contain real customer info
- Ensure any trial/demo limitations are properly implemented
- Remove any internal cost/margin analysis files (pricing.config.\*, margin calculations)

---

## Final Security Scan (All Modes)

Re-run `security-auditor` to verify:

- No secrets remain
- All security issues addressed
- `.env.example` complete
- `.gitignore` comprehensive

---

## Phase 9: Version Bump + GitHub Release (All Modes)

After all exit criteria pass and `.scrub.log` is written:

1. **Determine next version:**
   - Read current version from `package.json` (or `pyproject.toml`, `Cargo.toml`, etc.)
   - Determine bump type: patch for fixes/docs, minor for new features, major for breaking changes
   - A scrub-only release (no new features) is always a **patch**

2. **Bump version in manifest:**
   - Edit `package.json` (or equivalent) with the new version
   - If a `CHANGELOG.md` exists, add a new version section at the top with today's date and the scrub changes

3. **Commit, tag, and push:**

   ```bash
   git add package.json CHANGELOG.md   # (or equivalent)
   git commit -m "chore: bump version to X.Y.Z"
   git push
   ```

4. **Cut the GitHub release:**
   - Generate release notes from the scrub summary (security fixes, docs added, etc.)
   - Write notes to a temp file and use `gh release create`:

   ```bash
   gh release create vX.Y.Z \
     --title "vX.Y.Z" \
     --notes-file /tmp/release-notes.md \
     --latest
   ```

   - Report the release URL to the user

**If no `package.json` or version manifest exists:** skip the version bump, still cut the GitHub release tagged from the current HEAD.

---

## Continuous Loop Logic

```
DO:
  1. Run security-auditor -> Get issues list
  2. IF issues found:
     - Fix all P0 (exposed secrets) immediately
     - Fix all P1 (security risks)
     - Document P2 for optional fixes
  3. Run dev infrastructure cleanup
  4. Run privacy grep searches (mode-aware)
  5. Run code-reviewer -> Get quality issues
  6. Fix critical quality issues
  7. Mode-specific documentation
  REPEAT security-auditor
UNTIL: Zero P0/P1 security issues AND zero private info found

THEN:
  8. Git history check
  9. Final report to user
```

## TodoWrite Integration

Use TodoWrite to track progress:

- Phase 1: Security audit completed
- Phase 2: [N] secrets removed and moved to env vars
- Phase 3: Dev infrastructure cleaned ([N] files removed)
- Phase 4: Privacy audit passed (mode: [MODE])
- Phase 5: Code quality review completed
- Phase 6: Git history checked
- Phase 7: Documentation created (mode-appropriate)
- Phase 8: Final security scan - PASSED
- Phase 9: Release ready

## Output Format

```
MODE: [opensource|sell|giveaway]
PROJECT: [name]

PHASE 1: Security Audit
  Found 7 issues: 2 P0, 3 P1, 2 P2
  Status: CRITICAL ISSUES FOUND

PHASE 2: Secret Removal
  Removing hardcoded API key from config.ts
  Created OPENAI_API_KEY environment variable
  Status: 2/2 secrets fixed

PHASE 3: Dev Infrastructure
  Removed: CLAUDE.md, .qualityrc.json, BACKLOG.md
  Status: 3 files removed

PHASE 4: Privacy Audit
  No internal references found
  Status: CLEAN

PHASE 5: Code Quality
  Fixed 2 debug console.logs
  Status: PASSED

PHASE 6: Git History
  Warning: CLAUDE.md found in 15 commits
  Recommendation: Run git filter-repo

PHASE 7: Documentation ([MODE])
  Created: README.md, LICENSE, [mode-specific files]
  Status: COMPLETE

RELEASE READY ([MODE])
  Security: PASSED
  Privacy: PASSED
  Quality: PASSED
  Documentation: COMPLETE
  Ready to [publish|distribute|sell]!
```

## Execution Receipt (MANDATORY)

After all checks pass, write `.scrub.log`:

```bash
cat > .scrub.log <<EOF
# Release Scrub - Execution Receipt
date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
project: $(basename $(pwd))
repo: $(git remote get-url origin 2>/dev/null || echo "no remote")
mode: [MODE]

## Results
- secrets_found: [count]
- secrets_fixed: [count]
- dev_files_removed: [list]
- git_history_scrubbed: [yes/no/warned]
- files_added_to_gitignore: [count]
- docs_created: [list]

## Exit Criteria
- [ ] Zero P0/P1 security issues
- [ ] No secrets in codebase
- [ ] .env.example exists
- [ ] .gitignore comprehensive
- [ ] README.md exists
- [ ] LICENSE exists (type: [license])
- [ ] No internal references
- [ ] No dev infrastructure files
- [ ] No audit/review files
- [ ] Git history clean
- [ ] Mode-specific docs complete
- [ ] User confirmed
EOF
```

Add `.scrub.log` to `.gitignore`.

## Exit Criteria (All Modes)

Only complete when ALL true:

- [ ] security-auditor returns zero P0/P1 issues
- [ ] No secrets in codebase
- [ ] No git submodules pointing to private repos
- [ ] `.env.example` exists and documented
- [ ] `.gitignore` includes all secret files and dev infrastructure
- [ ] README.md exists with clear instructions
- [ ] LICENSE file exists (appropriate for mode)
- [ ] No internal company references (except brand name in `sell` mode)
- [ ] No dev infrastructure files
- [ ] No internal audit/review files
- [ ] Git history checked (scrubbed or user warned)
- [ ] Mode-specific documentation complete
- [ ] `.scrub.log` receipt written
- [ ] User confirms ready to release
