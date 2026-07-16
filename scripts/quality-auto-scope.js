/**
 * Auto-scope classification for /bs:quality.
 *
 * Classifies a list of changed files into a risk tier using the same glob
 * patterns as harness-config.json, then returns the lightest scope+level that
 * adequately covers the change.
 *
 * Used by skills/quality/SKILL.md Step 0.5 (shell calls this via node --print).
 * Can also be required directly in tests.
 */

const TIER_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Ordered tier classification rules: each entry is [tier, matchFn].
 * Rules are evaluated top-to-bottom; first match wins.
 * @type {Array<[string, (f: string) => boolean]>}
 */
const TIER_RULES = [
  // critical
  [
    "critical",
    (f) =>
      /^scripts\//.test(f) ||
      /^config\//.test(f) ||
      /^\.github\/workflows\//.test(f) ||
      /^\.husky\//.test(f) ||
      f === "install.sh" ||
      f === ".qualityrc.json",
  ],
  // high
  [
    "high",
    (f) =>
      f === "commands/bs/quality.md" ||
      f === "commands/bs/dev.md" ||
      f === "commands/bs/ralph.md" ||
      f === "commands/bs/new.md" ||
      f === "package.json" ||
      /^skills\/quality\//.test(f) ||
      /^skills\/workflow\//.test(f) ||
      /^skills\/test-strategy\//.test(f) ||
      f === "agents/code-reviewer.md" ||
      f === "agents/security-auditor.md",
  ],
  // medium
  [
    "medium",
    (f) =>
      /^commands\/bs\//.test(f) ||
      /^skills\//.test(f) ||
      /^agents\//.test(f) ||
      /^eslint-plugin-defensive\//.test(f) ||
      /^schemas\//.test(f),
  ],
  // low — docs, markdown, text, data, templates
  [
    "low",
    (f) =>
      /^docs\//.test(f) ||
      /^templates\//.test(f) ||
      /^data\//.test(f) ||
      f === "README.md" ||
      /\.md$/.test(f) ||
      /\.txt$/.test(f),
  ],
];

/**
 * Returns the risk tier for a single file path.
 * @param {string} file
 * @returns {'critical'|'high'|'medium'|'low'}
 */
function classifyFile(file) {
  for (const [tier, matches] of TIER_RULES) {
    if (matches(file)) return tier;
  }
  // Unknown files are treated as medium (safe default).
  return "medium";
}

/**
 * Given a list of changed files and total lines changed, returns the
 * recommended scope and level.
 *
 * @param {string[]} files
 * @param {number} totalLines
 * @returns {{ scope: 'changed'|'branch'|'all', level: 95|98, tier: string, reason: string }}
 */
function autoScope(files, totalLines) {
  let highestTier = "low";
  for (const f of files) {
    const tier = classifyFile(f);
    if (TIER_RANK[tier] > TIER_RANK[highestTier]) {
      highestTier = tier;
    }
  }

  if (highestTier === "low" && totalLines <= 200) {
    return {
      scope: "changed",
      level: 95,
      tier: highestTier,
      reason: `all low-tier files, ${totalLines} lines — lint+tests only`,
    };
  }

  const reason =
    highestTier === "critical" || highestTier === "high"
      ? `${highestTier}-tier files touched — full agent loop`
      : `${highestTier}-tier, ${totalLines} lines — full agent loop`;

  return { scope: "branch", level: 95, tier: highestTier, reason };
}

module.exports = { classifyFile, autoScope, TIER_RANK };
