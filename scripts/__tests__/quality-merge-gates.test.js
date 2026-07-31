import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SKILL = readFileSync(path.join(ROOT, "skills/quality/SKILL.md"), "utf8");
const VALIDATOR = readFileSync(
  path.join(ROOT, "scripts/quality-validate-review-trailers.sh"),
  "utf8",
);
const RUN_REVIEW = readFileSync(
  path.join(ROOT, "scripts/quality-run-review.sh"),
  "utf8",
);
const PRESERVE_PRIMARY = path.join(
  ROOT,
  "scripts/quality-preserve-primary-evidence.sh",
);
const AUTHORIZE = readFileSync(
  path.join(ROOT, "scripts/quality-authorize-merge.sh"),
  "utf8",
);
const STAMP_AND_MERGE = readFileSync(
  path.join(ROOT, "scripts/quality-stamp-and-merge.sh"),
  "utf8",
);

/**
 * On 2026-07-12 a review panel returned FAIL with 2 blocking findings; the skill
 * stamped `findings=2` into the Reviewed-By trailer and merged anyway, shipping
 * an install-bricking bug to a public repo.
 *
 * Root cause: BLOCKING_COUNT was only ever interpolated into the trailer string —
 * never compared to zero. Every gate verified the review RAN; none verified it
 * PASSED. These tests pin the gate that closes that hole.
 */
describe("quality merge gates", () => {
  it("blocks the merge when BLOCKING_COUNT is non-zero", () => {
    expect(SKILL).toMatch(/Any BLOCKING finding must be fixed/);
    expect(SKILL).toMatch(/BLOCKING findings remain/);
  });

  it("the blocking-findings gate runs BEFORE the trailer gate", () => {
    const findingsGate = SKILL.indexOf("Any BLOCKING finding must be fixed");
    const trailerGate = SKILL.indexOf("Reviewed-By: quality");
    expect(findingsGate).toBeGreaterThan(-1);
    expect(trailerGate).toBeGreaterThan(-1);
    // A merge must not be authorized by a trailer while findings are outstanding.
    expect(findingsGate).toBeLessThan(trailerGate);
  });

  it("authorizes either reviewer through a provider-neutral quality trailer", () => {
    expect(SKILL).toMatch(/Reviewed-By: quality/);
    expect(SKILL).toMatch(/reviewer=<provider>/);
    expect(SKILL).not.toMatch(/requires a 'Reviewed-By: codex'/);
  });

  it("binds neutral evidence to HEAD/HEAD~1 and merge-base", () => {
    expect(SKILL).toMatch(/head=<reviewed-head>, base=<base-sha>/);
    expect(SKILL).toMatch(/quality-stamp-and-merge\.sh/);
    expect(STAMP_AND_MERGE).toMatch(/review-authorization/);
    expect(STAMP_AND_MERGE).toMatch(/quality-authorize-merge\.sh/);
    expect(VALIDATOR).toMatch(/STAMP_HEAD.*CURRENT_PARENT/s);
    expect(VALIDATOR).toMatch(/STAMP_BASE.*CURRENT_BASE/s);
    expect(VALIDATOR).toMatch(/grep -Fxq "\$EXPECTED"/);
  });

  it("makes the reusable trailer validator verify signed provider evidence", () => {
    expect(VALIDATOR).toMatch(/quality-review-evidence\.js" verify/);
    expect(VALIDATOR).toContain("Quality-Evidence-Signature");
    expect(VALIDATOR).toContain("QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY");
    expect(VALIDATOR).toContain("--require-signature");
    expect(VALIDATOR).toContain(
      "high/critical evidence requires --require-signature",
    );
    expect(VALIDATOR).toContain(
      "high/critical evidence requires a configured primary reviewer",
    );
    expect(VALIDATOR).toContain("--required-tier");
    expect(VALIDATOR).toContain("operator-quality-override");
    expect(VALIDATOR).toContain(
      "high/critical evidence requires the configured primary reviewer",
    );
  });

  it("requires signed evidence at the merge authorization boundary", () => {
    expect(AUTHORIZE).toMatch(
      /quality-validate-review-trailers\.sh"[\s\S]*--required-tier "\$TIER" --require-signature/,
    );
  });

  it("derives a local verifier key only from the configured operator signer", () => {
    expect(STAMP_AND_MERGE).toMatch(/quality-review-evidence\.js" public-key/);
  });

  it("head-binds the merge and verifies terminal merged state", () => {
    expect(AUTHORIZE).toMatch(/--match-head-commit "\$ACTUAL_HEAD"/);
    expect(AUTHORIZE).toMatch(/MERGE_RC=0/);
    expect(AUTHORIZE).toMatch(/gh pr merge[\s\S]*MERGE_RC=\$\?/);
    expect(AUTHORIZE).toMatch(/gh pr view[\s\S]*state,mergedAt,mergeCommit/);
    expect(AUTHORIZE).toMatch(/\.state.*MERGED/s);
    expect(AUTHORIZE).toMatch(/\.mergeCommit\.oid/);
  });

  it("preflights without mutation and pushes one exact persisted remote ref", () => {
    expect(STAMP_AND_MERGE).toMatch(/--manifest "\$MANIFEST" --preflight/);
    expect(STAMP_AND_MERGE.indexOf("--preflight")).toBeLessThan(
      STAMP_AND_MERGE.indexOf("git commit"),
    );
    expect(STAMP_AND_MERGE).toMatch(
      /--force-with-lease="refs\/heads\/\$EXPECTED_HEAD_REF:\$PREFLIGHT_PR_HEAD"/,
    );
    expect(STAMP_AND_MERGE).toMatch(
      /"\$HEAD_REMOTE" "\$STAMP_HEAD:refs\/heads\/\$EXPECTED_HEAD_REF"/,
    );
    expect(STAMP_AND_MERGE).not.toMatch(/^git push\s*$/m);
    expect(AUTHORIZE).toMatch(/repo\.githubRepository/);
    expect(AUTHORIZE).toMatch(/repo\.headRefName/);
    expect(AUTHORIZE).toMatch(/--repo "\$EXPECTED_REPOSITORY"/);
  });

  it("delegates concrete ruleset applicability to GitHub", () => {
    expect(AUTHORIZE).toMatch(/rules\/branches\/\$ENCODED_BASE_NAME/);
    expect(AUTHORIZE).not.toMatch(/rulesets\?includes_parents/);
    expect(AUTHORIZE).not.toMatch(/conditions\.ref_name/);
    expect(AUTHORIZE).toMatch(/strict_required_status_checks_policy == true/);
  });

  it("requires approval only for an explicit human-required policy during preflight", () => {
    const authority = AUTHORIZE.indexOf('MERGE_AUTHORITY="$(node');
    const approval = AUTHORIZE.indexOf(
      '[ "$MERGE_AUTHORITY" = human-required ]',
    );
    const preflight = AUTHORIZE.lastIndexOf('[ "$PREFLIGHT" = false ]');
    expect(authority).toBeGreaterThan(-1);
    expect(approval).toBeGreaterThan(-1);
    expect(preflight).toBeGreaterThan(approval);
    expect(AUTHORIZE).toMatch(
      /\[ -n "\$MERGE_AUTHORITY" \] \|\| MERGE_AUTHORITY=human-required/,
    );
    expect(AUTHORIZE).toMatch(
      /autonomous campaigns merge once their revision-bound review, CI, base, and/,
    );
  });

  it("documents only persisted-policy gate invocations", () => {
    expect(SKILL).toMatch(/--manifest "<exact-manifest-path>" --name lint/);
    expect(SKILL).not.toMatch(/--name (?:lint|test|security) -- </);
  });

  it("persists one exact empty stamp and waits boundedly for its CI", () => {
    expect(STAMP_AND_MERGE).toMatch(/merge\.stampHead/);
    expect(STAMP_AND_MERGE).toMatch(/record-stamp/);
    expect(STAMP_AND_MERGE).toMatch(/quality-run-bounded\.sh/);
    expect(STAMP_AND_MERGE).toMatch(
      /quality-wait-required-checks\.sh" --pr "\$PR"/,
    );
    expect(
      STAMP_AND_MERGE.indexOf("quality-wait-required-checks.sh"),
    ).toBeLessThan(STAMP_AND_MERGE.lastIndexOf("quality-authorize-merge.sh"));
    expect(AUTHORIZE).toMatch(/persisted empty stamp/);
    expect(STAMP_AND_MERGE).toMatch(
      /quality-wait-required-checks\.sh" --pr "\$PR" \|\| RC=\$\?/,
    );
    expect(AUTHORIZE).toMatch(
      /quality-ci-billing-waiver\.js[\s\S]*MERGE_ARGS\+=\(--admin\)/,
    );
  });

  it("validates an exact-head billing waiver before bypassing the green-CI guard", () => {
    const firstWaiverValidation = AUTHORIZE.indexOf(
      'node "$SCRIPT_DIR/quality-ci-billing-waiver.js"',
    );
    const requiredChecks = AUTHORIZE.indexOf(
      'gh pr checks "$PR" --repo "$EXPECTED_REPOSITORY" --required',
    );
    const finalWaiverValidation = AUTHORIZE.lastIndexOf(
      'node "$SCRIPT_DIR/quality-ci-billing-waiver.js"',
    );
    const adminMerge = AUTHORIZE.indexOf("MERGE_ARGS+=(--admin)");
    expect(firstWaiverValidation).toBeGreaterThan(-1);
    expect(requiredChecks).toBeGreaterThan(firstWaiverValidation);
    expect(finalWaiverValidation).toBeGreaterThan(requiredChecks);
    expect(adminMerge).toBeGreaterThan(finalWaiverValidation);
    expect(AUTHORIZE).toMatch(
      /if \[ "\$PREFLIGHT" = false \] && \[ "\$\{CI_BILLING_WAIVED:-false\}" = false \]; then[\s\S]*gh pr checks/,
    );
    expect(AUTHORIZE).toMatch(
      /if \[ "\$\{CI_BILLING_WAIVED:-false\}" = true \]; then[\s\S]*MERGE_ARGS\+=\(--admin\)/,
    );
    expect(AUTHORIZE).toMatch(
      /\[ "\$ATOMIC_BASE_FRESHNESS" = unprotectable \][\s\S]*quality-ci-billing-waiver\.js[\s\S]*MERGE_ARGS\+=\(--admin\)/,
    );
  });

  it("never uses a billing admin merge on a protectable repository", () => {
    const restriction = AUTHORIZE.indexOf(
      '[ "$ATOMIC_BASE_FRESHNESS" != unprotectable ]',
    );
    const adminMerge = AUTHORIZE.indexOf("MERGE_ARGS+=(--admin)");
    expect(restriction).toBeGreaterThan(-1);
    expect(adminMerge).toBeGreaterThan(restriction);
    expect(AUTHORIZE).toMatch(
      /CI billing waivers are limited to plan-proven unprotectable private repositories/,
    );
    expect(SKILL).toMatch(
      /except on a plan-proven unprotectable private repository/,
    );
  });

  it("requires explicit opt-in to merge on an unprotectable base", () => {
    // Private repos without GitHub Pro get HTTP 403 on the protection API, so
    // ATOMIC_BASE_FRESHNESS can never become true and --merge is unsatisfiable
    // there, pushing operators to --admin (which skips EVERY gate, not just
    // this one). The escape hatch must be opt-in and off by default.
    expect(AUTHORIZE).toMatch(/BS_QUALITY_ALLOW_UNPROTECTABLE_BASE:-false/);
    expect(AUTHORIZE).toMatch(/ATOMIC_BASE_FRESHNESS=unprotectable/);
    expect(AUTHORIZE).toMatch(
      /case "\$ATOMIC_BASE_FRESHNESS" in\s*\n\s*true \| unprotectable\)/,
    );
    expect(AUTHORIZE).toMatch(
      /\[ "\$ATOMIC_BASE_FRESHNESS" = unprotectable \]; then[\s\S]*gh pr checks "\$PR" --repo "\$EXPECTED_REPOSITORY" >\/dev\/null/,
    );
    expect(AUTHORIZE).toMatch(
      /else\s*\n\s*gh pr checks "\$PR" --repo "\$EXPECTED_REPOSITORY" --required/,
    );
    expect(
      AUTHORIZE.indexOf(
        'if [ "$ATOMIC_BASE_FRESHNESS" = unprotectable ]; then',
      ),
    ).toBeGreaterThan(AUTHORIZE.indexOf('case "$ATOMIC_BASE_FRESHNESS" in'));
  });

  describe("unprotectable-base classification", () => {
    const PLAN_LIMIT =
      "Upgrade to GitHub Pro or make this repository public to enable this feature.";
    const classify = (args) => {
      // The body travels as a FILE, never argv: command substitution and shell
      // arguments strip NUL bytes, which would normalize a malformed response
      // into a well-formed authorized one before the classifier sees it.
      const bodyFile = path.join(
        mkdtempSync(path.join(tmpdir(), "protectability-")),
        "body.json",
      );
      writeFileSync(bodyFile, args.body ?? "");
      try {
        execFileSync(
          "bash",
          [
            path.join(ROOT, "scripts/quality-base-protectability.sh"),
            "--private",
            args.private,
            "--rc",
            String(args.rc),
            "--body-file",
            bodyFile,
          ],
          { stdio: "pipe" },
        );
        return "unprotectable";
      } catch {
        return "blocked";
      }
    };

    it("accepts only a proven plan limit on a private repo", () => {
      expect(
        classify({
          private: "true",
          rc: 1,
          body: `{"message":"${PLAN_LIMIT}","status":"403"}`,
        }),
      ).toBe("unprotectable");
    });

    it("rejects a SUCCESSFUL response that merely quotes the upgrade text", () => {
      // A substring search over the body would authorize here. The request has
      // to have failed for a plan limit to be the explanation.
      expect(
        classify({
          private: "true",
          rc: 0,
          body: `{"required_status_checks":{"contexts":["${PLAN_LIMIT}"]}}`,
        }),
      ).toBe("blocked");
    });

    it("rejects a rate-limit 403 that embeds the plan-limit sentence", () => {
      // Throttling also returns 403, so comparing .message in full — not as a
      // substring — is what keeps a retryable failure from becoming an approval.
      expect(
        classify({
          private: "true",
          rc: 1,
          body: `{"message":"API rate limit exceeded. ${PLAN_LIMIT}","status":"403"}`,
        }),
      ).toBe("blocked");
    });

    it("rejects 404, unparseable output, and unknown privacy", () => {
      expect(
        classify({
          private: "true",
          rc: 1,
          body: '{"message":"Not Found","status":"404"}',
        }),
      ).toBe("blocked");
      expect(
        classify({ private: "true", rc: 1, body: "gh: connection refused" }),
      ).toBe("blocked");
      expect(
        classify({
          private: "unknown",
          rc: 1,
          body: `{"message":"${PLAN_LIMIT}","status":"403"}`,
        }),
      ).toBe("blocked");
    });

    it("rejects public repos, which can always be protected", () => {
      expect(
        classify({
          private: "false",
          rc: 1,
          body: `{"message":"${PLAN_LIMIT}","status":"403"}`,
        }),
      ).toBe("blocked");
    });

    it("rejects duplicate keys hidden behind JSON unicode escapes", () => {
      // Counting raw `"message":` occurrences in the text cannot see this: the
      // escaped key reads as zero occurrences, while any parser resolves it to
      // a second `message` that overwrites the rate-limit value with the
      // plan-limit one.
      const escaped =
        `{"message":"rate limited",` +
        `"m\\u0065ssage":"${PLAN_LIMIT}",` +
        `"status":"429","s\\u0074atus":"403"}`;
      expect(classify({ private: "true", rc: 1, body: escaped })).toBe(
        "blocked",
      );
    });

    it("rejects duplicate keys whose first value is a non-empty container", () => {
      // `jq --stream` emits paths for LEAVES, so a duplicate whose first value
      // is a non-empty object or array never produces a depth-1 key path and
      // slipped through the stream-based counter entirely. Only walking the
      // tokens and counting member names as they appear catches these.
      const cases = [
        `{"message":{"x":1},"message":"${PLAN_LIMIT}","status":403}`,
        `{"status":{"x":1},"status":403,"message":"${PLAN_LIMIT}"}`,
        `{"message":[1,2],"message":"${PLAN_LIMIT}","status":403}`,
        `{"message":{"a":{"b":[1,{"c":2}]}},"message":"${PLAN_LIMIT}","status":403}`,
        `{"m\\u0065ssage":{"a":[1]},"message":"${PLAN_LIMIT}","status":403}`,
      ];
      for (const body of cases) {
        expect(classify({ private: "true", rc: 1, body })).toBe("blocked");
      }
    });

    it("rejects duplicate keys at any depth, not just the top level", () => {
      // These do not change how message/status resolve, but "exactly one
      // unambiguous JSON object" has to hold for the whole document — an
      // ambiguous body is not the response GitHub sends.
      const nested = [
        `{"message":"${PLAN_LIMIT}","status":403,"details":{"reason":"a","reason":"b"}}`,
        `{"message":"${PLAN_LIMIT}","status":403,"metadata":[{"status":429,"status":403}]}`,
        `{"message":"${PLAN_LIMIT}","status":403,"d":{"reason":"a","r\\u0065ason":"b"}}`,
      ];
      for (const body of nested) {
        expect(classify({ private: "true", rc: 1, body })).toBe("blocked");
      }
    });

    it("compares the status value, not its string coercion", () => {
      // `String([403])` is "403", so a coercing check accepted {"status":[403]}
      // as a genuine 403 response.
      const wrapped = [
        `{"message":"${PLAN_LIMIT}","status":[403]}`,
        `{"message":"${PLAN_LIMIT}","status":[403,403]}`,
        `{"message":"${PLAN_LIMIT}","status":{}}`,
        `{"message":"${PLAN_LIMIT}","status":"403 "}`,
        `{"message":["${PLAN_LIMIT}"],"status":403}`,
      ];
      for (const body of wrapped) {
        expect(classify({ private: "true", rc: 1, body })).toBe("blocked");
      }
    });

    it("rejects bodies that are not valid UTF-8", () => {
      // Buffer.toString("utf8") rewrites invalid sequences to U+FFFD, which
      // would launder a body that is not valid UTF-8 JSON into one that parses.
      const bodyFile = path.join(
        mkdtempSync(path.join(tmpdir(), "protectability-")),
        "body.json",
      );
      writeFileSync(
        bodyFile,
        Buffer.concat([
          Buffer.from(`{"message":"${PLAN_LIMIT}","status":403,"x":"`, "utf8"),
          Buffer.from([0xff]),
          Buffer.from('"}', "utf8"),
        ]),
      );
      let verdict = "unprotectable";
      try {
        execFileSync(
          "bash",
          [
            path.join(ROOT, "scripts/quality-base-protectability.sh"),
            "--private",
            "true",
            "--rc",
            "1",
            "--body-file",
            bodyFile,
          ],
          { stdio: "pipe" },
        );
      } catch {
        verdict = "blocked";
      }
      expect(verdict).toBe("blocked");
    });

    it("fails closed on deeply nested input without crashing", () => {
      // Unbounded recursion raised an uncaught RangeError at ~5k nested
      // arrays. A depth limit turns that into an ordinary rejection.
      const body = "[".repeat(6000) + "]".repeat(6000);
      expect(classify({ private: "true", rc: 1, body })).toBe("blocked");
    });

    it("accepts GitHub's real response shape and formatting variants", () => {
      // The genuine body carries documentation_url alongside message/status,
      // and the status may be numeric. Extra non-conflicting fields are not
      // ambiguity, so tightening must not reject the real thing.
      expect(
        classify({
          private: "true",
          rc: 1,
          body: `{"message":"${PLAN_LIMIT}","documentation_url":"https://docs.github.com/rest/branches/branch-protection#get-branch-protection","status":"403"}`,
        }),
      ).toBe("unprotectable");
      expect(
        classify({
          private: "true",
          rc: 1,
          body: `{\n  "message" : "${PLAN_LIMIT}" ,\n  "status" : 403\n}`,
        }),
      ).toBe("unprotectable");
    });

    it("rejects a plan-limit object smuggled into a larger response", () => {
      // Recovering a JSON fragment with sed/grep would accept every one of
      // these. The whole body has to be exactly one JSON object, so noise
      // around a genuine-looking object is unobserved, not unprotectable.
      const valid = `{"message":"${PLAN_LIMIT}","status":"403"}`;
      const smuggled = [
        `prefix ${valid}`,
        `${valid} suffix`,
        `gh: transport failure\n${valid}`,
        `{"message":"rate limited","status":"403"}\nnoise ${valid}`,
        `${valid}${valid}`,
      ];
      for (const body of smuggled) {
        expect(classify({ private: "true", rc: 1, body })).toBe("blocked");
      }
    });

    it("rejects a concatenated object that contributes no competing fields", () => {
      // jq streams multiple JSON values, so validating shape, status, and
      // message as separate invocations accepted `{}` + a valid object: the
      // empty object satisfied a per-value `type == "object"` test and emitted
      // nothing for .status/.message, letting the second object answer for the
      // whole body. Only a slurped `length == 1` check catches this, and the
      // two-valid-objects case above passed for an unrelated reason.
      const valid = `{"message":"${PLAN_LIMIT}","status":"403"}`;
      expect(classify({ private: "true", rc: 1, body: `{}${valid}` })).toBe(
        "blocked",
      );
      expect(classify({ private: "true", rc: 1, body: `${valid}{}` })).toBe(
        "blocked",
      );
    });

    it("rejects a body containing NUL bytes", () => {
      // Passing the body through a shell variable would silently strip NULs,
      // normalizing a malformed raw response into a well-formed authorized one.
      // The classifier reads a file and rejects NULs outright.
      const valid = `{"message":"${PLAN_LIMIT}","status":"403"}`;
      expect(classify({ private: "true", rc: 1, body: `\0${valid}` })).toBe(
        "blocked",
      );
      expect(classify({ private: "true", rc: 1, body: `${valid}\0` })).toBe(
        "blocked",
      );
    });

    it("rejects duplicate message/status keys", () => {
      // jq keeps the LAST occurrence, so a body that leads with a rate-limit
      // message and repeats the key with the plan-limit text would otherwise
      // parse as a genuine plan limit.
      expect(
        classify({
          private: "true",
          rc: 1,
          body: `{"message":"rate limited","message":"${PLAN_LIMIT}","status":429,"status":403}`,
        }),
      ).toBe("blocked");
    });

    it("requires the observed status to be 403", () => {
      // A body carrying the plan-limit message under any other status is not a
      // plan limit; bind the classification to the status GitHub reported.
      expect(
        classify({
          private: "true",
          rc: 1,
          body: `{"message":"${PLAN_LIMIT}","status":"500"}`,
        }),
      ).toBe("blocked");
      expect(
        classify({
          private: "true",
          rc: 1,
          body: `{"message":"${PLAN_LIMIT}"}`,
        }),
      ).toBe("blocked");
    });
  });

  it("states the unprotectable path is weaker, not an equivalent guarantee", () => {
    // GitHub exposes no base-SHA precondition on merge, so no client-side check
    // reconstructs atomic base freshness. The code must not claim it does.
    expect(AUTHORIZE).toMatch(/NON-ATOMIC base freshness/);
    expect(AUTHORIZE).toMatch(/base may advance before the merge lands/);
    expect(AUTHORIZE).toMatch(/not a reproduction of the strong one/);
  });

  it("fails closed if the pre-merge base re-read cannot be completed", () => {
    // `git ls-remote | awk` reports awk's status, not git's, and this script
    // does not set pipefail — a failed lookup with partial parseable output
    // would have read as a successful re-read. Capture before piping.
    expect(AUTHORIZE).toMatch(/FINAL_BASE_LS="\$\(git ls-remote/);
    expect(AUTHORIZE).toMatch(/could not re-read the base ref/);
    expect(AUTHORIZE).toMatch(/base ref lookup returned no OID/);
    expect(AUTHORIZE).toMatch(/-n "\$FINAL_BASE_OID"/);
  });

  it("falls back to the secondary provider on a bounded-budget timeout (rc 76)", () => {
    // A primary that merely ran slow used to block the merge outright: the
    // fallback branch gated on rc 75 (quota) and rc 2 (CLI missing) only, so
    // rc 76 fell through to "MERGE BLOCKED ... no usable fallback is
    // configured" even with fallback=claude set. The fallback exists for
    // precisely this case, so 76 must be inside the branch condition.
    const branch = RUN_REVIEW.slice(
      RUN_REVIEW.indexOf('if { [ "$PROVIDER_RC" -eq 75 ]'),
      RUN_REVIEW.indexOf('[ "$QUALITY_FALLBACK" != none ]; then'),
    );
    expect(branch).toMatch(/PROVIDER_RC" -eq 76/);

    // The blocked message must not assert a missing fallback without checking,
    // or a failed fallback run reads as a configuration error.
    expect(RUN_REVIEW).toMatch(/if \[ "\$QUALITY_FALLBACK" = none \]/);
    expect(RUN_REVIEW).not.toMatch(
      /bounded review budget and no usable fallback is configured/,
    );
  });

  it("falls back once when native Codex or Gemini parsing is inconclusive (rc 4)", () => {
    // Codex and Gemini both report parser-inconclusive output the same way
    // (rc=4) from their normalized-output parsers, so both must fail over.
    // Claude's rc=4 combines parser/timeout/unresolved-agent failures and
    // must stay fail-closed, so it is deliberately excluded here.
    expect(RUN_REVIEW).toMatch(
      /PRIMARY_HAS_STRUCTURED_RC4=false[\s\S]{0,80}case "\$QUALITY_PRIMARY" in[\s\S]{0,40}codex \| gemini\)/,
    );
    const branch = RUN_REVIEW.slice(
      RUN_REVIEW.indexOf('if { [ "$PROVIDER_RC" -eq 75 ]'),
      RUN_REVIEW.indexOf('[ "$QUALITY_FALLBACK" != none ]; then'),
    );
    expect(branch).toMatch(
      /PROVIDER_RC" -eq 4 \] && \[ "\$PRIMARY_HAS_STRUCTURED_RC4" = true/,
    );
    expect(branch).not.toMatch(/\[ "\$PROVIDER_RC" -eq 4 \] \|\|/);
    expect(RUN_REVIEW).toMatch(
      /review was inconclusive; switching once to \$QUALITY_FALLBACK/,
    );
    expect(RUN_REVIEW).toMatch(
      /4\)\s+echo "❌ MERGE BLOCKED: \$REVIEW_PROVIDER review was inconclusive \$FALLBACK_NOTE\."/,
    );
  });

  it("permits CI-only coverage only for typed low-risk provider unavailability", () => {
    expect(RUN_REVIEW).toMatch(/if \[ "\$TIER" = low \]; then/);
    expect(RUN_REVIEW).toMatch(
      /2\) ADVISORY_FAILURE_CATEGORY=provider-unavailable/,
    );
    expect(RUN_REVIEW).toMatch(
      /75\) ADVISORY_FAILURE_CATEGORY=provider-exhaustion/,
    );
    expect(RUN_REVIEW).toMatch(
      /79\) ADVISORY_FAILURE_CATEGORY=provider-billing/,
    );
    expect(RUN_REVIEW).toMatch(
      /76\) ADVISORY_FAILURE_CATEGORY=provider-timeout/,
    );
    expect(RUN_REVIEW).toMatch(/record-advisory-review/);
    expect(RUN_REVIEW).not.toMatch(/4\) ADVISORY_FAILURE_CATEGORY=/);
    expect(RUN_REVIEW).not.toMatch(/77\) ADVISORY_FAILURE_CATEGORY=/);
    expect(RUN_REVIEW.indexOf('if [ "$TIER" = low ]; then')).toBeLessThan(
      RUN_REVIEW.indexOf("❌ MERGE BLOCKED"),
    );
  });

  it("preserves conclusive findings when a later primary pass is inconclusive", () => {
    const reviewOut = mkdtempSync(path.join(tmpdir(), "quality-evidence-"));
    writeFileSync(
      path.join(reviewOut, "codex.findings.txt"),
      "BLOCKING: src/example.js:12 — real finding\nFix it.\nINCONCLUSIVE: pass 2 parser failed\n",
    );
    writeFileSync(
      path.join(reviewOut, "codex-1.normalized.json"),
      JSON.stringify({
        verdict: "needs-attention",
        summary: "completed pass",
        findings: [{ severity: "high", title: "real finding" }],
      }),
    );
    writeFileSync(path.join(reviewOut, "codex-2.json"), "{}\n");
    writeFileSync(path.join(reviewOut, "codex-2.stderr"), "parse failure\n");

    execFileSync("bash", [
      PRESERVE_PRIMARY,
      "--review-out",
      reviewOut,
      "--mode",
      "parser-inconclusive",
    ]);

    expect(existsSync(path.join(reviewOut, "codex.findings.txt"))).toBe(false);
    expect(
      JSON.parse(
        readFileSync(
          path.join(reviewOut, "primary-codex-1.result.json"),
          "utf8",
        ),
      ).findings,
    ).toEqual([
      expect.objectContaining({ severity: "high", title: "real finding" }),
    ]);
    expect(
      readFileSync(
        path.join(reviewOut, "failed-primary", "codex.findings.txt"),
        "utf8",
      ),
    ).toContain("INCONCLUSIVE: pass 2 parser failed");
    expect(
      existsSync(path.join(reviewOut, "failed-primary", "codex-2.json")),
    ).toBe(true);
    expect(
      existsSync(path.join(reviewOut, "failed-primary", "codex-2.stderr")),
    ).toBe(true);
  });

  it("quarantines repeated primary evidence without replacing the authoritative result", () => {
    const reviewOut = mkdtempSync(path.join(tmpdir(), "quality-collision-"));
    writeFileSync(
      path.join(reviewOut, "primary-codex-1.result.json"),
      JSON.stringify({ findings: [{ title: "earlier evidence" }] }),
    );
    writeFileSync(
      path.join(reviewOut, "codex-1.normalized.json"),
      JSON.stringify({ findings: [{ title: "new evidence" }] }),
    );
    writeFileSync(
      path.join(reviewOut, "codex.findings.txt"),
      "INCONCLUSIVE:\n",
    );

    expect(() =>
      execFileSync("bash", [
        PRESERVE_PRIMARY,
        "--review-out",
        reviewOut,
        "--mode",
        "parser-inconclusive",
      ]),
    ).not.toThrow();
    expect(
      JSON.parse(
        readFileSync(
          path.join(reviewOut, "primary-codex-1.result.json"),
          "utf8",
        ),
      ).findings[0].title,
    ).toBe("earlier evidence");
    expect(
      JSON.parse(
        readFileSync(
          path.join(reviewOut, "failed-primary", "codex-1.normalized.json"),
          "utf8",
        ),
      ).findings[0].title,
    ).toBe("new evidence");
  });

  it("does not promote a marker-only inconclusive review to evidence", () => {
    const reviewOut = mkdtempSync(path.join(tmpdir(), "quality-evidence-"));
    mkdirSync(path.join(reviewOut, "unrelated"));
    writeFileSync(
      path.join(reviewOut, "codex.findings.txt"),
      "INCONCLUSIVE: parser failed\n\n",
    );

    execFileSync("bash", [
      PRESERVE_PRIMARY,
      "--review-out",
      reviewOut,
      "--mode",
      "parser-inconclusive",
    ]);

    expect(existsSync(path.join(reviewOut, "codex.findings.txt"))).toBe(false);
    expect(
      readFileSync(
        path.join(reviewOut, "failed-primary", "codex.findings.txt"),
        "utf8",
      ),
    ).toBe("INCONCLUSIVE: parser failed\n\n");
  });

  it("quarantines partial findings when the primary produced no evidence", () => {
    const reviewOut = mkdtempSync(path.join(tmpdir(), "quality-evidence-"));
    writeFileSync(
      path.join(reviewOut, "codex.findings.txt"),
      "BLOCKING: partial pass before timeout\n",
    );

    execFileSync("bash", [
      PRESERVE_PRIMARY,
      "--review-out",
      reviewOut,
      "--mode",
      "evidence-absent",
    ]);

    expect(existsSync(path.join(reviewOut, "codex.findings.txt"))).toBe(false);
    expect(
      readFileSync(
        path.join(reviewOut, "failed-primary", "codex.findings.txt"),
        "utf8",
      ),
    ).toContain("partial pass before timeout");
  });

  it("persists and reloads the exact reviewed base across fenced shells", () => {
    expect(RUN_REVIEW).toMatch(/quality-invocation\.js" record-review/);
    expect(RUN_REVIEW).toMatch(/--from "\$REVIEW_DIFF_BASE"/);
    expect(RUN_REVIEW).toMatch(/--to "\$REVIEWED_HEAD"/);
    expect(SKILL).toMatch(/contiguous review checkpoints/);
  });

  it("BLOCKING_COUNT is not merely decorative in the trailer", () => {
    // It must be COMPARED, not just interpolated. Guard against a regression
    // that drops the check but keeps `findings=${BLOCKING_COUNT}` in the stamp.
    const compared =
      /Any BLOCKING finding must be fixed/.test(SKILL) &&
      /BLOCKING findings remain/.test(SKILL);
    expect(compared).toBe(true);
  });

  /** The gate is worthless if the model never sees it — see check-skill-size.sh. */
  it("SKILL.md stays inside the compaction re-attach budget", () => {
    // Exits non-zero if any SKILL.md exceeds ~5000 tokens, at which point
    // everything past the cutoff (including these merge gates) is silently
    // dropped after any compaction. That is how the gates vanished in the first
    // place — the file was 17,394 tokens and the gates lived at the tail.
    const out = execFileSync(
      "bash",
      [path.join(ROOT, "scripts/check-skill-size.sh")],
      {
        encoding: "utf8",
      },
    );
    expect(out).toMatch(/within the .* budget/i);
  });
});
