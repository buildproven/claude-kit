# Shared execution policy and task verification

## Requirements

- Native resolve/explain uses the existing approved compute policy without
  replacing the coordinator model or claiming that advice launched a worker.
- Tools and local work need no additional model; unknown worker capabilities
  retain an explicit reason and safe local work can continue.
- Task-completion hooks use repository-owned affected-test selection, including
  staged, unstaged, deleted and untracked paths, with a bounded process lifetime.
- Legacy repositories keep their own test command without injected runner flags.
- Quality instructions use the existing graph and risk floors, not obsolete
  panels, duplicate retry loops, direct merge commands or numerical ship scores.
- Existing launch isolation, protected admission, exact-head gates and merge
  authority remain unchanged.

## Acceptance

Native CLI/API behavior, hook behavior and legacy governor tests pass. The full
selector regression audit passes. Required lint, security, independent review
and exact-head CI remain mandatory. Installation is a separate verified step,
not implied by a passing local test or open pull request.

The accepted ADR is `docs/decisions/ADR-shared-execution-graph.md`. Further
readiness/admission and private setup delivery are tracked under BUI-857 and
BUI-836. This slice does not claim they are already operational.
