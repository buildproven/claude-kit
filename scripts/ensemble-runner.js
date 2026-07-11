#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const DEFAULT_PROVIDERS = ["claude", "codex", "gemini"];
const DEFAULT_MODE = "parallel";
const DEFAULT_OUTPUT = "memo";
const DEFAULT_TIMEOUT_MS = 120000;

function splitCsv(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createDefaultOptions() {
  return {
    question: "",
    providers: [...DEFAULT_PROVIDERS],
    mode: DEFAULT_MODE,
    output: DEFAULT_OUTPUT,
    contexts: [],
    artifacts: [],
    rubric: [],
    decision: "",
    persist: "",
    rounds: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    cwd: process.cwd(),
  };
}

function readFlagValue(args, fallback = "") {
  const value = args.shift();
  return value || fallback;
}

function applyFlag(token, args, options) {
  const handlers = {
    "--question": () => {
      options.question = readFlagValue(args);
    },
    "--providers": () => {
      options.providers = splitCsv(readFlagValue(args));
    },
    "--mode": () => {
      options.mode = readFlagValue(args, DEFAULT_MODE);
    },
    "--output": () => {
      options.output = readFlagValue(args, DEFAULT_OUTPUT);
    },
    "--context": () => {
      options.contexts.push(...splitCsv(readFlagValue(args)));
    },
    "--contexts": () => {
      options.contexts.push(...splitCsv(readFlagValue(args)));
    },
    "--artifact": () => {
      options.artifacts.push(...splitCsv(readFlagValue(args)));
    },
    "--artifacts": () => {
      options.artifacts.push(...splitCsv(readFlagValue(args)));
    },
    "--rubric": () => {
      options.rubric.push(...splitCsv(readFlagValue(args)));
    },
    "--decision": () => {
      options.decision = readFlagValue(args);
    },
    "--persist": () => {
      options.persist = readFlagValue(args);
    },
    "--rounds": () => {
      options.rounds = Number.parseInt(readFlagValue(args, "1"), 10);
    },
    "--timeout-ms": () => {
      options.timeoutMs = Number.parseInt(
        readFlagValue(args, String(DEFAULT_TIMEOUT_MS)),
        10,
      );
    },
    "--cwd": () => {
      options.cwd = readFlagValue(args, process.cwd());
    },
    "--dry-run": () => {
      options.dryRun = true;
    },
  };

  const handler = handlers[token];
  if (!handler) {
    throw new Error(`Unknown flag: ${token}`);
  }

  handler();
}

function normalizeOptions(options) {
  if (!options.question) {
    throw new Error(
      'Missing question. Usage: ensemble-runner.js "Question?" [--providers claude,codex,gemini]',
    );
  }

  if (!["parallel", "debate"].includes(options.mode)) {
    throw new Error(`Invalid mode: ${options.mode}`);
  }

  if (!["memo", "scorecard", "tasks"].includes(options.output)) {
    throw new Error(`Invalid output: ${options.output}`);
  }

  if (!Number.isFinite(options.rounds) || options.rounds < 1) {
    throw new Error(`Invalid rounds value: ${options.rounds}`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error(`Invalid timeout-ms value: ${options.timeoutMs}`);
  }

  if (options.providers.length === 0) {
    options.providers = [...DEFAULT_PROVIDERS];
  }

  options.providers = [
    ...new Set(options.providers.map((p) => p.toLowerCase())),
  ];
  options.contexts = [...new Set(options.contexts)];
  options.artifacts = [...new Set(options.artifacts)];
  options.rubric = [...new Set(options.rubric)];

  return options;
}

function parseArgs(argv) {
  const args = [...argv];
  const options = createDefaultOptions();

  while (args.length > 0) {
    const token = args.shift();

    if (!token) continue;

    if (!token.startsWith("--") && options.question.length === 0) {
      options.question = token;
      continue;
    }

    if (token.startsWith("--")) {
      applyFlag(token, args, options);
    }
  }

  return normalizeOptions(options);
}

function readInputFile(filepath, cwd) {
  const resolvedPath = path.resolve(cwd, filepath);
  const content = fs.readFileSync(resolvedPath, "utf8");
  return {
    label: filepath,
    resolvedPath,
    content,
  };
}

function readInputs(filepaths, cwd) {
  return filepaths.map((filepath) => readInputFile(filepath, cwd));
}

function buildContextPacket(options) {
  const contextSections = readInputs(options.contexts, options.cwd);
  const artifactSections = readInputs(options.artifacts, options.cwd);

  const sections = [];

  if (options.decision) {
    sections.push(`DECISION TARGET:\n${options.decision}`);
  }

  sections.push(`QUESTION:\n${options.question}`);

  if (options.rubric.length > 0) {
    sections.push(`RUBRIC:\n- ${options.rubric.join("\n- ")}`);
  }

  if (contextSections.length > 0) {
    const blocks = contextSections.map(
      (section) =>
        `### Context: ${section.label}\n` +
        `Path: ${section.resolvedPath}\n\n${section.content.trim()}`,
    );
    sections.push(blocks.join("\n\n"));
  }

  if (artifactSections.length > 0) {
    const blocks = artifactSections.map(
      (section) =>
        `### Artifact: ${section.label}\n` +
        `Path: ${section.resolvedPath}\n\n${section.content.trim()}`,
    );
    sections.push(blocks.join("\n\n"));
  }

  return sections.join("\n\n").trim();
}

function buildOutputInstructions(output, rubric) {
  if (output === "scorecard") {
    const scoreLines =
      rubric.length > 0
        ? rubric
            .map((item) => `- ${item}: <1-10> | <brief rationale>`)
            .join("\n")
        : "- overall fit: <1-10> | <brief rationale>";

    return [
      "Return exactly these sections:",
      "RECOMMENDATION: <one sentence>",
      "CONFIDENCE: <1-10>",
      "SCORES:",
      scoreLines,
      "KEY POINTS:",
      "- <bullet>",
      "TASKS:",
      "- <bullet>",
    ].join("\n");
  }

  if (output === "tasks") {
    return [
      "Return exactly these sections:",
      "RECOMMENDATION: <one sentence>",
      "CONFIDENCE: <1-10>",
      "TASKS:",
      "- <priority action>",
      "- <priority action>",
      "RISKS:",
      "- <risk>",
    ].join("\n");
  }

  return [
    "Return exactly these sections:",
    "RECOMMENDATION: <one sentence>",
    "CONFIDENCE: <1-10>",
    "ANALYSIS:",
    "- <bullet>",
    "RISKS:",
    "- <bullet>",
    "TASKS:",
    "- <bullet>",
  ].join("\n");
}

function buildProviderPrompt(provider, options, packet, priorResponses = []) {
  const personaMap = {
    claude:
      "You are Claude. Focus on synthesis, tradeoffs, and practical decisions.",
    codex:
      "You are Codex. Focus on technical rigor, implementation constraints, and weak assumptions.",
    gemini:
      "You are Gemini. Focus on market framing, buyer clarity, and alternative angles.",
    openai:
      "You are OpenAI GPT. Focus on crisp strategic analysis and execution tradeoffs.",
    perplexity:
      "You are Perplexity. Focus on externally grounded claims and cite sources when used.",
  };

  const debateBlock =
    priorResponses.length > 0
      ? `Prior panel responses:\n${priorResponses
          .map(
            (response) =>
              `### ${response.provider}\n${response.stdout.trim().slice(0, 4000)}`,
          )
          .join("\n\n")}`
      : "";

  return [
    personaMap[provider] || "You are an expert reviewer on this panel.",
    "",
    `Mode: ${options.mode}`,
    `Output: ${options.output}`,
    "",
    buildOutputInstructions(options.output, options.rubric),
    "",
    debateBlock,
    packet,
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function execAcpx(provider, prompt, options) {
  return new Promise((resolve) => {
    // Pass prompt via stdin (-f -) to avoid OS arg length limits on large prompts
    const child = execFile(
      "acpx",
      [provider, "exec", "-f", "-"],
      {
        cwd: options.cwd,
        encoding: "utf8",
        timeout: options.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            provider,
            ok: false,
            stdout: stdout || "",
            stderr: stderr || error.message,
          });
          return;
        }

        resolve({
          provider,
          ok: true,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      },
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runEnsemble(options) {
  const packet = buildContextPacket(options);

  if (options.dryRun) {
    return {
      packet,
      results: options.providers.map((provider) => ({
        provider,
        ok: true,
        stdout: [
          `RECOMMENDATION: Dry-run response from ${provider}`,
          "CONFIDENCE: 7",
          options.output === "scorecard"
            ? `SCORES:\n${(options.rubric.length > 0
                ? options.rubric
                : ["overall fit"]
              )
                .map((item) => `- ${item}: 7 | Dry-run placeholder`)
                .join("\n")}`
            : "ANALYSIS:\n- Dry-run placeholder",
          "TASKS:\n- Replace dry-run with real execution",
        ].join("\n"),
        stderr: "",
      })),
    };
  }

  if (options.mode === "parallel") {
    // Stagger starts by 500ms to avoid ACP session init races
    const results = await Promise.all(
      options.providers.map((provider, i) =>
        new Promise((resolve) => setTimeout(resolve, i * 500)).then(() =>
          execAcpx(
            provider,
            buildProviderPrompt(provider, options, packet),
            options,
          ),
        ),
      ),
    );

    return { packet, results };
  }

  const results = [];
  const rounds = Math.max(1, options.rounds);
  for (let round = 0; round < rounds; round += 1) {
    for (const provider of options.providers) {
      const priorResponses = results.filter((result) => result.ok);
      const prompt = buildProviderPrompt(
        provider,
        options,
        packet,
        priorResponses,
      );
      const result = await execAcpx(provider, prompt, options);
      results.push({
        ...result,
        round: round + 1,
      });
    }
  }

  return { packet, results };
}

function extractLineValue(text, label) {
  const regex = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function extractBulletSection(text, label) {
  const lines = text.split("\n");
  const header = `${label.toUpperCase()}:`;
  const bullets = [];
  let isInSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.toUpperCase() === header) {
      isInSection = true;
      continue;
    }

    if (!isInSection) continue;

    if (line.length === 0) {
      continue;
    }

    if (/^[A-Z][A-Z\s-]+:$/.test(line)) {
      break;
    }

    if (line.startsWith("- ")) {
      bullets.push(line.slice(2).trim());
    }
  }

  return bullets;
}

function parseScores(text) {
  const scores = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- ") || !line.includes("|")) {
      continue;
    }

    const withoutBullet = line.slice(2);
    const [left, rationale] = withoutBullet.split("|");
    if (!left || !rationale) {
      continue;
    }

    const separatorIndex = left.lastIndexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const criterion = left.slice(0, separatorIndex).trim();
    const valueText = left.slice(separatorIndex + 1).trim();
    const value = Number.parseFloat(valueText);

    if (!criterion || !Number.isFinite(value)) {
      continue;
    }

    scores.push({
      criterion,
      value,
      rationale: rationale.trim(),
    });
  }

  return scores;
}

function aggregateScores(results) {
  const scoreMap = new Map();

  results
    .filter((result) => result.ok)
    .forEach((result) => {
      parseScores(result.stdout).forEach((score) => {
        const key = score.criterion.toLowerCase();
        if (!scoreMap.has(key)) {
          scoreMap.set(key, {
            criterion: score.criterion,
            values: [],
            rationales: [],
          });
        }
        const entry = scoreMap.get(key);
        entry.values.push(score.value);
        entry.rationales.push(`${result.provider}: ${score.rationale}`);
      });
    });

  return [...scoreMap.values()].map((entry) => {
    const sum = entry.values.reduce((total, value) => total + value, 0);
    return {
      criterion: entry.criterion,
      average: Number((sum / entry.values.length).toFixed(2)),
      count: entry.values.length,
      rationales: entry.rationales,
    };
  });
}

function synthesizeResponses(results, options) {
  const successful = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const recommendations = successful
    .map((result) => ({
      provider: result.provider,
      value: extractLineValue(result.stdout, "RECOMMENDATION"),
      confidence: extractLineValue(result.stdout, "CONFIDENCE"),
    }))
    .filter((item) => item.value);
  const tasks = successful.flatMap((result) =>
    extractBulletSection(result.stdout, "TASKS").map((task) => ({
      provider: result.provider,
      value: task,
    })),
  );
  const risks = successful.flatMap((result) =>
    extractBulletSection(result.stdout, "RISKS").map((risk) => ({
      provider: result.provider,
      value: risk,
    })),
  );
  const scoreRows =
    options.output === "scorecard" ? aggregateScores(results) : [];

  const sections = [
    "# Ensemble Runner Report",
    "",
    "## Run Metadata",
    `- Question: ${options.question}`,
    `- Decision: ${options.decision || "n/a"}`,
    `- Mode: ${options.mode}`,
    `- Output: ${options.output}`,
    `- Providers: ${options.providers.join(", ")}`,
    `- Successes: ${successful.length}`,
    `- Failures: ${failed.length}`,
  ];

  if (options.rubric.length > 0) {
    sections.push(`- Rubric: ${options.rubric.join(", ")}`);
  }

  if (recommendations.length > 0) {
    sections.push("", "## Recommendations");
    recommendations.forEach((item) => {
      sections.push(
        `- ${item.provider}: ${item.value} (confidence ${item.confidence || "n/a"})`,
      );
    });
  }

  if (scoreRows.length > 0) {
    sections.push(
      "",
      "## Aggregated Scorecard",
      "",
      "| Criterion | Avg | Count |",
    );
    sections.push("| --- | ---: | ---: |");
    scoreRows.forEach((row) => {
      sections.push(`| ${row.criterion} | ${row.average} | ${row.count} |`);
    });
  }

  if (tasks.length > 0) {
    sections.push("", "## Task Candidates");
    tasks.forEach((task) => {
      sections.push(`- ${task.provider}: ${task.value}`);
    });
  }

  if (risks.length > 0) {
    sections.push("", "## Risks");
    risks.forEach((risk) => {
      sections.push(`- ${risk.provider}: ${risk.value}`);
    });
  }

  if (failed.length > 0) {
    sections.push("", "## Provider Failures");
    failed.forEach((result) => {
      sections.push(
        `- ${result.provider}: ${result.stderr || "unknown error"}`,
      );
    });
  }

  sections.push("", "## Raw Responses");
  results.forEach((result) => {
    sections.push(
      "",
      `### ${result.provider}${result.round ? ` (round ${result.round})` : ""}`,
      "",
      result.ok ? result.stdout.trim() : `ERROR: ${result.stderr || "unknown"}`,
    );
  });

  return sections.join("\n").trim() + "\n";
}

function persistReport(report, persistPath, cwd) {
  if (!persistPath) return "";

  const resolvedPath = path.resolve(cwd, persistPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, report, "utf8");
  return resolvedPath;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { results } = await runEnsemble(options);
    const report = synthesizeResponses(results, options);
    const persistedPath = persistReport(report, options.persist, options.cwd);

    process.stdout.write(report);
    if (persistedPath) {
      process.stderr.write(`Saved report to ${persistedPath}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  aggregateScores,
  buildContextPacket,
  buildOutputInstructions,
  buildProviderPrompt,
  parseArgs,
  parseScores,
  runEnsemble,
  splitCsv,
  synthesizeResponses,
};
