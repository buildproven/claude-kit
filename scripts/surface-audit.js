#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const rootArg = process.argv.find((arg) => arg.startsWith("--root="));
const budgetArg = process.argv.find((arg) =>
  arg.startsWith("--command-budget="),
);
const json = process.argv.includes("--json");
const root = path.resolve(rootArg ? rootArg.slice(7) : process.cwd());
const budget = Number(budgetArg ? budgetArg.slice(17) : 24);

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

const commands = commandNames();
const skills = dirsWith("SKILL.md", "skills");
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
  console.log(`Thin wrappers: ${thinCommands.length}`);
  console.log(
    `Commands without same-name skills: ${commandWithoutSkill.join(", ") || "none"}`,
  );
  console.log(
    `Provider-specific executable references: ${report.providerHardcoding.length}`,
  );
  for (const file of report.providerHardcoding) console.log(`  ${file}`);
}

process.exitCode = report.overBudget ? 1 : 0;
