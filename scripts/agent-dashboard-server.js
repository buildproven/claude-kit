#!/usr/bin/env node
// Agent Dashboard Server — lightweight status API for parallel agent monitoring
// Usage: node scripts/agent-dashboard-server.js
// Serves dashboard UI + JSON status API on port 3847

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PORT = 3847;
const DASHBOARD_HTML = path.join(__dirname, "agent-dashboard.html");

function safeRead(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getWorktrees() {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: process.env.HOME,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const trees = [];
    let current = {};
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        current = { path: line.slice(9) };
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "") {
        if (current.path) trees.push(current);
        current = {};
      }
    }
    if (current.path) trees.push(current);
    return trees;
  } catch {
    return [];
  }
}

function getAgentTaskFiles() {
  const tasks = [];
  try {
    const tmpDirs = fs
      .readdirSync("/tmp")
      .filter((d) => d.startsWith("claude-"));
    for (const dir of tmpDirs.slice(-10)) {
      const taskDir = path.join("/tmp", dir, "tasks");
      if (!fs.existsSync(taskDir)) continue;
      const files = fs.readdirSync(taskDir).slice(-20);
      for (const file of files) {
        const fp = path.join(taskDir, file);
        const stat = fs.statSync(fp);
        tasks.push({
          file,
          dir,
          modified: stat.mtime.toISOString(),
          size: stat.size,
        });
      }
    }
  } catch {
    // /tmp dirs may not exist
  }
  return tasks
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, 20);
}

function buildStatus() {
  const home = process.env.HOME;
  const claudeDir = path.join(home, "Projects", "claude-setup", ".claude");

  const devState = safeRead(path.join(claudeDir, "ralph-dev-state.json"));

  let evidence = [];
  const evidenceDir = path.join(claudeDir, "ralph-next");
  try {
    if (fs.existsSync(evidenceDir)) {
      evidence = fs
        .readdirSync(evidenceDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const data = safeRead(path.join(evidenceDir, f));
          return { file: f, ...data };
        })
        .filter(Boolean);
    }
  } catch {
    // dir may not exist
  }

  return {
    timestamp: new Date().toISOString(),
    devState,
    evidence: evidence.slice(-20),
    worktrees: getWorktrees(),
    recentTasks: getAgentTaskFiles(),
  };
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/status") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(buildStatus()));
  } else if (req.url === "/" || req.url === "/index.html") {
    try {
      const html = fs.readFileSync(DASHBOARD_HTML, "utf8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end("Dashboard HTML not found — expected at " + DASHBOARD_HTML);
    }
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Agent Dashboard running at http://localhost:${PORT}`);
});
