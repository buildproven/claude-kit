#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const rootArg = process.argv.find((arg) => arg.startsWith("--root="));
const budgetArg = process.argv.find((arg) =>
  arg.startsWith("--command-budget="),
);
const descriptionBudgetArg = process.argv.find((arg) =>
  arg.startsWith("--description-budget="),
);
const instructionBudgetArg = process.argv.find((arg) =>
  arg.startsWith("--instruction-budget="),
);
const instructionFileArg = process.argv.find((arg) =>
  arg.startsWith("--instruction-file="),
);
const skillSourceArgs = process.argv
  .filter((arg) => arg.startsWith("--skill-source="))
  .map((arg) => path.resolve(arg.slice(15)));
const skillAllowlistArgs = process.argv
  .filter((arg) => arg.startsWith("--skill-allowlist="))
  .map((arg) => path.resolve(arg.slice(18)));
const json = process.argv.includes("--json");
const root = path.resolve(rootArg ? rootArg.slice(7) : process.cwd());
const budget = Number(budgetArg ? budgetArg.slice(17) : 24);
const descriptionBudget = Number(
  descriptionBudgetArg ? descriptionBudgetArg.slice(21) : 8000,
);
const instructionBudget = Number(
  instructionBudgetArg ? instructionBudgetArg.slice(21) : 4096,
);
const instructionFile = path.resolve(
  instructionFileArg
    ? instructionFileArg.slice(19)
    : path.join(root, "config", "CLAUDE.md"),
);

function dirsWith(file, parent) {
  const base = path.join(root, parent);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(base, entry.name, file)),
    )
    .map((entry) => entry.name)
    .sort();
}

function commandNames() {
  const base = path.join(root, "commands", "bs");
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
}

function frontmatterDescription(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  if (lines[0] !== "---") return "";
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "---") return "";
    const match = line.match(/^description:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (value !== ">" && value !== "|") {
      return value.replace(/^(['"])(.*)\1$/, "$2");
    }
    const folded = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (!/^\s+/.test(lines[next])) break;
      folded.push(lines[next].trim());
    }
    return folded.join(" ");
  }
  return "";
}

function allowedSkills() {
  if (skillAllowlistArgs.length === 0) return null;
  const allowed = new Set();
  for (const allowlist of skillAllowlistArgs) {
    if (!fs.existsSync(allowlist)) continue;
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(allowlist, "utf8"));
    } catch (error) {
      throw new Error(`Invalid skill allowlist JSON: ${allowlist}`, {
        cause: error,
      });
    }
    for (const name of payload.skills || []) allowed.add(name);
  }
  return allowed;
}

function skillMetadata() {
  const sources =
    skillSourceArgs.length > 0 ? skillSourceArgs : [path.join(root, "skills")];
  const allowed = allowedSkills();
  const byName = new Map();
  for (const source of sources) {
    if (!fs.existsSync(source)) continue;
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (allowed && !allowed.has(entry.name)) continue;
      const file = path.join(source, entry.name, "SKILL.md");
      if (!fs.existsSync(file)) continue;
      byName.set(entry.name, {
        name: entry.name,
        description: frontmatterDescription(file),
        file,
      });
    }
  }
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

const commands = commandNames();
const skills = dirsWith("SKILL.md", "skills");
const discoveredSkills = skillMetadata();
const descriptionChars = discoveredSkills.reduce(
  (total, skill) => total + skill.name.length + skill.description.length + 2,
  0,
);
const instructionBytes = fs.existsSync(instructionFile)
  ? fs.statSync(instructionFile).size
  : 0;
const commandWithoutSkill = commands.filter((name) => !skills.includes(name));
const thinCommands = commands.filter((name) => {
  const body = fs.readFileSync(
    path.join(root, "commands", "bs", `${name}.md`),
    "utf8",
  );
  return body.split(/\r?\n/).length <= 25;
});
const providerHardcoding = [];
for (const parent of ["commands", "skills"]) {
  const base = path.join(root, parent);
  if (!fs.existsSync(base)) continue;
  for (const file of fs.readdirSync(base, { recursive: true })) {
    if (!/\.(md|sh|js)$/.test(file)) continue;
    const full = path.join(base, file);
    if (!fs.statSync(full).isFile()) continue;
    const text = fs.readFileSync(full, "utf8");
    if (/\bclaude -p\b|\bcodex exec\b/.test(text))
      providerHardcoding.push(path.relative(root, full));
  }
}

const report = {
  root,
  commandBudget: budget,
  commandCount: commands.length,
  skillCount: skills.length,
  overBudget: commands.length > budget,
  discoverySkillCount: discoveredSkills.length,
  descriptionChars,
  descriptionBudget,
  descriptionsOverBudget: descriptionChars > descriptionBudget,
  instructionFile,
  instructionBytes,
  instructionBudget,
  instructionsOverBudget: instructionBytes > instructionBudget,
  commands,
  commandWithoutSkill,
  thinCommands,
  providerHardcoding: [...new Set(providerHardcoding)].sort(),
};

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(
    `Surface audit: ${commands.length} commands, ${skills.length} skills (budget ${budget})`,
  );
  console.log(`Command budget: ${report.overBudget ? "FAIL" : "PASS"}`);
  console.log(
    `Skill discovery: ${descriptionChars}/${descriptionBudget} chars across ${discoveredSkills.length} skills (${report.descriptionsOverBudget ? "FAIL" : "PASS"})`,
  );
  console.log(
    `Instructions: ${instructionBytes}/${instructionBudget} bytes (${report.instructionsOverBudget ? "FAIL" : "PASS"})`,
  );
  console.log(`Thin wrappers: ${thinCommands.length}`);
  console.log(
    `Commands without same-name skills: ${commandWithoutSkill.join(", ") || "none"}`,
  );
  console.log(
    `Provider-specific executable references: ${report.providerHardcoding.length}`,
  );
  for (const file of report.providerHardcoding) console.log(`  ${file}`);
}

process.exitCode =
  report.overBudget ||
  report.descriptionsOverBudget ||
  report.instructionsOverBudget
    ? 1
    : 0;
