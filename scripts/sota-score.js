#!/usr/bin/env node
/**
 * Automated SOTA scoring — runs without Claude CLI.
 * Checks files, counts, validates structure, produces a deterministic score.
 * Used by: .github/workflows/sota-assessment.yml (weekly cron)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function countFiles(dir, ext) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name), ext);
    } else if (!ext || entry.name.endsWith(ext)) {
      count++;
    }
  }
  return count;
}

function fileLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, "utf8").split("\n").length;
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function scoreCLAUDEmd() {
  const f = path.join(ROOT, "config", "CLAUDE.md");
  const lines = fileLines(f);
  if (lines === 0) return { score: 0, gap: "CLAUDE.md missing" };
  const content = fs.readFileSync(f, "utf8");
  let score = 5;
  if (lines <= 120) score += 2;
  else if (lines <= 200) score += 1;
  const sections = [
    "action default",
    "code quality",
    "communication",
    "tool",
    "git",
    "config",
  ];
  const found = sections.filter((s) =>
    content.toLowerCase().includes(s),
  ).length;
  score += Math.min(found, 3);
  return {
    score: Math.min(score, 10),
    gap: lines > 120 ? `${lines} lines (target <100)` : null,
  };
}

function scoreSettings() {
  const settings = readJSON(path.join(ROOT, "config", "settings.json"));
  if (!settings) return { score: 0, gap: "settings.json missing" };
  let score = 5;
  if (settings.permissions) {
    const allow = (settings.permissions.allow || []).length;
    const deny = (settings.permissions.deny || []).length;
    const ask = (settings.permissions.ask || []).length;
    const totalRules = allow + deny + ask;
    if (totalRules >= 20) score += 2;
    else if (totalRules >= 10) score += 1;
    // Bonus for having all three categories (allow + deny + ask)
    if (allow > 0 && deny > 0 && ask > 0) score += 1;
  }
  if (settings.hooks) {
    const hookCount = Object.keys(settings.hooks).length;
    if (hookCount >= 3) score += 2;
    else if (hookCount >= 1) score += 1;
  }
  if (settings.env) score += 1;
  return { score: Math.min(score, 10), gap: null };
}

function scoreHooks() {
  const settings = readJSON(path.join(ROOT, "config", "settings.json"));
  if (!settings || !settings.hooks)
    return { score: 2, gap: "No hooks configured" };
  const hookTypes = Object.keys(settings.hooks);
  let score = Math.min(hookTypes.length * 2, 8);
  if (fs.existsSync(path.join(ROOT, ".husky"))) score += 2;
  return {
    score: Math.min(score, 10),
    gap: hookTypes.length < 3 ? "Add more hook types" : null,
  };
}

function scoreSkills() {
  const dir = path.join(ROOT, "skills");
  const count = countFiles(dir, ".md");
  let score = Math.min(Math.floor(count / 2), 7);
  // Check for auto-invoke and context:fork
  let autoInvoke = 0;
  let contextFork = 0;
  if (fs.existsSync(dir)) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (e.name.endsWith(".md")) {
          const c = fs.readFileSync(path.join(d, e.name), "utf8");
          if (c.includes("auto-invoke") || c.includes("Auto-invoke"))
            autoInvoke++;
          if (c.includes("context: fork")) contextFork++;
        }
      }
    };
    walk(dir);
  }
  if (autoInvoke >= 3) score += 2;
  if (contextFork >= 1) score += 1;
  return {
    score: Math.min(score, 10),
    gap: count < 15 ? `${count} skills (target 15+)` : null,
  };
}

function scoreCommands() {
  const dir = path.join(ROOT, "commands");
  const count = countFiles(dir, ".md");
  let score = Math.min(Math.floor(count / 4), 7);
  // Check frontmatter completeness
  let withFrontmatter = 0;
  if (fs.existsSync(dir)) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (e.name.endsWith(".md")) {
          const c = fs.readFileSync(path.join(d, e.name), "utf8");
          if (c.startsWith("---") && c.includes("description:"))
            withFrontmatter++;
        }
      }
    };
    walk(dir);
  }
  const ratio = count > 0 ? withFrontmatter / count : 0;
  if (ratio >= 0.9) score += 3;
  else if (ratio >= 0.7) score += 2;
  else if (ratio >= 0.5) score += 1;
  return {
    score: Math.min(score, 10),
    gap: ratio < 0.9 ? `${Math.round(ratio * 100)}% have frontmatter` : null,
  };
}

function scoreMCP() {
  const settings = readJSON(path.join(ROOT, "config", "settings.json"));
  if (!settings) return { score: 2, gap: "No settings.json" };
  const plugins = settings.enabledPlugins || {};
  const enabled = Object.entries(plugins).filter(([, v]) => v === true).length;
  const mcpServers = Object.keys(settings.mcpServers || {}).length;
  const total = enabled + mcpServers;
  let score = Math.min(Math.floor(total / 2), 8);
  if (total >= 5) score += 2;
  return {
    score: Math.min(score, 10),
    gap: total < 5 ? `${total} MCP servers (target 5+)` : null,
  };
}

function scoreQuality() {
  let score = 3;
  if (
    fs.existsSync(path.join(ROOT, "skills", "quality")) ||
    fs.existsSync(path.join(ROOT, "skills", "quality", "SKILL.md"))
  )
    score += 3;
  if (fs.existsSync(path.join(ROOT, "scripts", "pattern-check.sh"))) score += 2;
  if (fs.existsSync(path.join(ROOT, ".defensive-patterns.json"))) score += 2;
  return { score: Math.min(score, 10), gap: null };
}

function scoreAutonomousDev() {
  let score = 3;
  if (fs.existsSync(path.join(ROOT, "commands", "bs", "ralph.md"))) score += 2;
  if (fs.existsSync(path.join(ROOT, "commands", "bs", "agent-run.md")))
    score += 2;
  if (fs.existsSync(path.join(ROOT, "skills", "workflow", "SKILL.md")))
    score += 2;
  if (fs.existsSync(path.join(ROOT, "docs", "ralph-patterns.md"))) score += 1;
  return { score: Math.min(score, 10), gap: null };
}

function scoreSecurity() {
  let score = 2;
  if (fs.existsSync(path.join(ROOT, ".semgrep"))) score += 2;
  if (fs.existsSync(path.join(ROOT, "scripts", "pattern-check.sh"))) score += 2;
  if (fs.existsSync(path.join(ROOT, ".husky", "pre-commit"))) score += 2;
  if (fs.existsSync(path.join(ROOT, ".defensive-patterns.json"))) score += 2;
  return { score: Math.min(score, 10), gap: null };
}

function scoreGitWorkflow() {
  let score = 3;
  if (fs.existsSync(path.join(ROOT, ".husky", "pre-commit"))) score += 2;
  if (fs.existsSync(path.join(ROOT, ".husky", "pre-push"))) score += 2;
  if (
    fs.existsSync(path.join(ROOT, "commitlint.config.cjs")) ||
    fs.existsSync(path.join(ROOT, "commitlint.config.js"))
  )
    score += 2;
  if (fs.existsSync(path.join(ROOT, ".husky", "commit-msg"))) score += 1;
  return { score: Math.min(score, 10), gap: null };
}

function scoreDocs() {
  let score = 3;
  const docsCount = countFiles(path.join(ROOT, "docs"), ".md");
  if (docsCount >= 10) score += 3;
  else if (docsCount >= 5) score += 2;
  if (fs.existsSync(path.join(ROOT, "BACKLOG.md"))) score += 1;
  if (fs.existsSync(path.join(ROOT, "docs", "WORKFLOW-CHEATSHEET.md")))
    score += 1;
  if (fs.existsSync(path.join(ROOT, "docs", "session-learnings.md")))
    score += 1;
  if (fs.existsSync(path.join(ROOT, "commands", "bs", "help.md"))) score += 1;
  return { score: Math.min(score, 10), gap: null };
}

function scorePortability() {
  let score = 3;
  if (fs.existsSync(path.join(ROOT, "install.sh"))) score += 3;
  if (fs.existsSync(path.join(ROOT, "commands", "bs", "sync.md"))) score += 2;
  if (fs.existsSync(path.join(ROOT, "commands", "bs", "help.md"))) score += 2;
  return { score: Math.min(score, 10), gap: null };
}

function hasDep(pkg, name) {
  return pkg && pkg.devDependencies && pkg.devDependencies[name];
}

function hasScript(pkg, name) {
  return pkg && pkg.scripts && pkg.scripts[name];
}

function fileContains(filePath, text) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, "utf8").includes(text);
}

function scoreAIQuality() {
  let score = 0;
  const gaps = [];
  const pkg = readJSON(path.join(ROOT, "package.json"));

  // Dead code detection (knip)
  if (hasScript(pkg, "dead-code")) score += 2;
  else gaps.push("No dead-code script (add knip)");

  // AI pattern checks in pattern-check.sh
  const patternScript = path.join(ROOT, "scripts", "pattern-check.sh");
  const aiPatterns = [
    "CONSOLE_ERROR_HANDLING",
    "UNUSED_ASYNC",
    "ESLINT_DISABLE",
    "ANY_TYPE",
  ];
  const found = aiPatterns.filter((p) => fileContains(patternScript, p)).length;
  score += Math.min(found, 3);
  if (found < 4) gaps.push(`${found}/4 AI patterns in pattern-check.sh`);

  // Complexity gate + import verification
  const eslintConfig = path.join(ROOT, "eslint.config.cjs");
  if (fileContains(eslintConfig, "complexity")) score += 1;
  else gaps.push("No ESLint complexity rule");
  if (fileContains(eslintConfig, "max-depth")) score += 1;
  else gaps.push("No ESLint max-depth rule");
  if (hasDep(pkg, "eslint-plugin-n")) score += 1;
  else gaps.push("No import verification (eslint-plugin-n)");

  // Knip config
  const hasKnipConfig = ["knip.config.js", "knip.config.ts", "knip.json"].some(
    (f) => fs.existsSync(path.join(ROOT, f)),
  );
  if (hasKnipConfig) score += 1;
  else gaps.push("No knip config");

  // Mutation testing (future)
  if (hasDep(pkg, "@stryker-mutator/core")) score += 1;

  return {
    score: Math.min(score, 10),
    gap: gaps.length > 0 ? gaps[0] : null,
  };
}

/**
 * Walks a directory recursively, collecting files matching given extensions.
 * Skips vendored/generated directories.
 */
function walkFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const skipDirs = [
    "node_modules",
    ".git",
    "__pycache__",
    ".claude",
    ".venv",
    "dist",
    "build",
  ];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      results.push(...walkFiles(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Scans for deprecated SDK imports, outdated model references, and stale API versions.
 * Returns score 0-10 and list of findings.
 */
function checkApiCurrency() {
  const findings = [];

  // 1. Deprecated Python imports
  const pyFiles = walkFiles(ROOT, [".py"]);
  for (const file of pyFiles) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // google.generativeai replaced by google.genai
      if (/(?:import|from)\s+google\.generativeai/.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          issue: "Deprecated import: google.generativeai (use google.genai)",
          severity: "high",
        });
      }
      // dall-e-3 model usage with OpenAI
      if (/model\s*=\s*["']dall-e-3["']/.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          issue: "Deprecated model: dall-e-3 (use gpt-image-1.5)",
          severity: "high",
        });
      }
    }
  }

  // 2. Hardcoded API versions older than 12 months (YYYYMM or YYYY-MM patterns in strings)
  const codeFiles = walkFiles(ROOT, [".py", ".js"]);
  const now = new Date();

  for (const file of codeFiles) {
    if (
      file.includes("uv.lock") ||
      file.includes("package-lock") ||
      file.includes("node_modules")
    )
      continue;
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match YYYY-MM or YYYY-MM-DD API version patterns in quoted strings
      const versionMatches = line.matchAll(/["'](\d{4})[_-](\d{2})["'_-]/g);
      for (const match of versionMatches) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]);
        if (year < 2020 || year > 2030 || month < 1 || month > 12) continue;
        const ageMonths =
          (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month);
        if (ageMonths > 12) {
          findings.push({
            file: rel,
            line: i + 1,
            issue: `Possibly stale API version: ${match[0]} (${ageMonths} months old)`,
            severity: "medium",
          });
        }
      }
    }
  }

  // 3. Known outdated model references in any file
  const allFiles = walkFiles(ROOT, [
    ".py",
    ".js",
    ".ts",
    ".json",
    ".md",
    ".yaml",
    ".yml",
    ".sh",
  ]);
  const outdatedModels = [
    {
      pattern: /["']imagen-3["']/g,
      replacement: "imagen-4",
      label: "imagen-3",
    },
    {
      pattern: /model\s*=\s*["']dall-e-3["']/g,
      replacement: "gpt-image-1.5",
      label: "dall-e-3",
    },
    {
      pattern: /["']gemini-2\.0-flash-exp["']/g,
      replacement: "gemini-2.0-flash (stable)",
      label: "gemini-2.0-flash-exp",
    },
  ];

  for (const file of allFiles) {
    if (
      file.includes("uv.lock") ||
      file.includes("package-lock") ||
      file.includes("node_modules")
    )
      continue;
    if (
      file.includes("sota-score.js") ||
      file.includes("check-deprecated-apis.sh")
    )
      continue;
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const model of outdatedModels) {
        if (model.pattern.test(line)) {
          // Avoid duplicate with section 1 for dall-e-3 in .py files
          if (model.label === "dall-e-3" && file.endsWith(".py")) continue;
          findings.push({
            file: rel,
            line: i + 1,
            issue: `Outdated model reference: ${model.label} (replaced by ${model.replacement})`,
            severity: "medium",
          });
        }
        model.pattern.lastIndex = 0;
      }
    }
  }

  // Score: start at 10, deduct per finding
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const deduction = highCount * 3 + mediumCount * 1;
  const score = Math.max(0, 10 - deduction);

  return {
    score: Math.min(score, 10),
    gap:
      findings.length > 0
        ? `${findings.length} deprecated API/model references found`
        : null,
    findings,
  };
}

// Run all categories
const categories = {
  claude_md: scoreCLAUDEmd(),
  settings: scoreSettings(),
  hooks: scoreHooks(),
  skills: scoreSkills(),
  commands: scoreCommands(),
  mcp: scoreMCP(),
  quality: scoreQuality(),
  ai_quality: scoreAIQuality(),
  autonomous_dev: scoreAutonomousDev(),
  security: scoreSecurity(),
  git_workflow: scoreGitWorkflow(),
  docs: scoreDocs(),
  portability: scorePortability(),
  api_currency: checkApiCurrency(),
};

const scores = {};
const topGaps = [];
for (const [key, result] of Object.entries(categories)) {
  scores[key] = result.score;
  if (result.gap) topGaps.push(result.gap);
}

const values = Object.values(scores);
const overall =
  Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

const output = {
  date: new Date().toISOString().split("T")[0],
  overall,
  scores,
  topGaps: topGaps.slice(0, 3),
};

console.log(JSON.stringify(output, null, 2));
