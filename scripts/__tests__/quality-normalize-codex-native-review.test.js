const {
  parseNativeReview,
} = require("../quality-normalize-codex-native-review");

describe("native Codex review normalization", () => {
  it("normalizes native priority findings into the review schema", () => {
    const result = parseNativeReview(
      `Review summary.

Full review comments:

- [P1] Preserve the whole range — /repo/scripts/review.sh:12-18
  Intermediate commits are otherwise omitted from evidence.

- [P2] Reject unsupported scope — /repo/scripts/state.js:40
  Persisting an ignored option is misleading.
`,
      "/repo",
    );
    expect(result).toMatchObject({
      verdict: "needs-attention",
      findings: [
        {
          severity: "high",
          title: "Preserve the whole range",
          file: "scripts/review.sh",
          line_start: 12,
        },
        {
          severity: "medium",
          file: "scripts/state.js",
          line_start: 40,
        },
      ],
    });
  });

  it("approves native output without priority findings", () => {
    expect(parseNativeReview("No findings.").verdict).toBe("approve");
  });

  // BUI-359: Codex's real clean verdict is multi-sentence prose, not the literal
  // string "no findings". The old whole-string anchor rejected these as
  // INCONCLUSIVE and falsely blocked merges.
  it.each([
    "The patch validly raises Vitest's global test and hook timeouts without affecting production behavior or test selection. No actionable correctness issue was found in the changed configuration.",
    "I reviewed the diff end to end. No issues found.",
    "Change is straightforward. LGTM.",
    "Reviewed the timeout config change; it looks good.",
    "No security concerns in the modified handler.",
    "The package and CLI rename is applied consistently. No actionable regressions were identified.",
    "No regressions were found.",
    "The authorization gate now waits until repository protectability is classified, checks all registered CI for explicitly unprotectable repositories, and preserves required-only checks for protectable repositories.",
    "The preflight and billing-waiver paths retain their existing behavior.",
    "The refactor is not risky. No concerns found.",
    "LGTM. The rename is applied consistently, however I noted it reads cleanly.",
    "No issues found. The behavior is not affected.",
    "No regressions were found. The reviewed diff does not alter unrelated paths.",
  ])("approves clean prose verdicts: %s", (prose) => {
    expect(parseNativeReview(prose).verdict).toBe("approve");
  });

  // BUI-629: Codex can describe a safe change in one sentence and report
  // successful verification in another without emitting a stock approval
  // phrase. These are captured native outputs, not synthetic parser tokens.
  it.each([
    "The setup-node version bump is applied consistently across all workflow references without altering existing inputs. The changed files also pass `./scripts/verify-fast`.",
    "The dependency upgrades and lockfile changes are consistent, resolve cleanly, and introduce no evident compatibility regressions. Type checking, linting, dependency resolution, and the affected runtime APIs succeeded.",
  ])("approves verified descriptive prose: %s", (prose) => {
    expect(parseNativeReview(prose).verdict).toBe("approve");
  });

  it("rejects unrecognized prose instead of inventing approval", () => {
    expect(() => parseNativeReview("Review ended unexpectedly.")).toThrow(
      /no recognizable verdict/,
    );
  });

  it.each([
    "No findings could be determined because the review ended unexpectedly.",
    "This path looks good, but another path could not be reviewed.",
    "No regressions were found in the reviewed file, but another file was truncated.",
    "No regression analysis was completed.",
    "The implementation does not correctly preserve required checks.",
    "The implementation preserves the fast path, but fails on protected repositories.",
    "The patch retains existing behavior; however, the new path is unsafe.",
    "The patch safely preserves the old path. However, the new path is vulnerable.",
    "The function correctly handles the happy path. A security issue remains.",
    "No issues were found, but a bug remains in the fallback.",
    "The function correctly handles the happy path.",
    "The change safely handles input. It dereferences a null pointer.",
    "The refactor preserves existing behavior, but leaks a file descriptor on the error path.",
    "The change retains compatibility, however it introduces a race condition.",
    "The patch preserves all checks but silently swallows exceptions.",
    "The change no longer preserves required checks.",
    "The patch cannot preserve existing behavior.",
    "The fallback never retains compatibility.",
    "The implementation fails to preserve required checks.",
    "The implementation does not fully preserve required checks.",
    "The bump is applied consistently without altering existing inputs. Tests pass, but a regression remains in the fallback path.",
    "The bump is applied consistently without altering existing inputs. Tests pass, but another path could not be reviewed.",
    "The bump is applied consistently without altering existing inputs. Tests pass. It silently corrupts cached state.",
    "The bump is applied consistently without altering existing inputs. Tests pass `./verify. It silently corrupts cached state.",
    "The bump was not applied consistently. Tests pass.",
    "The bump was applied consistently, but omits the fallback. Tests pass.",
    "The bump is applied consistently without altering existing inputs. Installing `foo` succeeded.",
    "The bump is applied consistently without altering existing inputs. Tests pass, but integration coverage was skipped.",
    "The bump is applied consistently without altering existing inputs. No tests pass.",
    "The bump is applied consistently without altering existing inputs. Tests should pass.",
    "The bump is applied consistently while silently corrupting cached state. Tests pass.",
    "The bump is applied consistently without altering existing inputs.",
    "Tests pass.",
    "The bump is applied consistently without altering existing inputs. Tests were not run.",
  ])("rejects qualified no-finding prose: %s", (prose) => {
    expect(() => parseNativeReview(prose)).toThrow(/no recognizable verdict/);
  });

  it("rejects malformed structured output even when its text says no findings", () => {
    expect(() =>
      parseNativeReview(
        JSON.stringify({
          verdict: "needs-attention",
          summary: "No findings were normalized",
          findings: [{ severity: "high" }],
        }),
      ),
    ).toThrow(/malformed structured Codex review/);
  });
});
