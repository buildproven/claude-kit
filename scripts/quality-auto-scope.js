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
 * Returns the risk tier for a single file path.
 * @param {string} file
 * @returns {'critical'|'high'|'medium'|'low'}
 */
function classifyFile(file) {
  // critical
  if (
    /^scripts\//.test(file) ||
    /^config\//.test(file) ||
    /^\.github\/workflows\//.test(file) ||
    /^\.husky\//.test(file) ||
    file === "install.sh" ||
    file === ".qualityrc.json" ||
    file === "package.json"
  ) {
    return "critical";
  }

  // high
  if (
    file === "commands/bs/quality.md" ||
    file === "commands/bs/dev.md" ||
    file === "commands/bs/ralph.md" ||
    file === "commands/bs/new.md" ||
    /^skills\/quality\//.test(file) ||
    /^skills\/workflow\//.test(file) ||
    /^skills\/test-strategy\//.test(file) ||
    file === "agents/code-reviewer.md" ||
    file === "agents/security-auditor.md"
  ) {
    return "high";
  }

  // medium
  if (
    /^commands\/bs\//.test(file) ||
    /^skills\//.test(file) ||
    /^agents\//.test(file) ||
    /^eslint-plugin-defensive\//.test(file) ||
    /^schemas\//.test(file)
  ) {
    return "medium";
  }

  // low — docs, markdown, text, data, templates
  if (
    /^docs\//.test(file) ||
    /^templates\//.test(file) ||
    /^data\//.test(file) ||
    file === "README.md" ||
    /\.md$/.test(file) ||
    /\.txt$/.test(file)
  ) {
    return "low";
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
