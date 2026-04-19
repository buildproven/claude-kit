#!/usr/bin/env node
/**
 * agent-browser-bridge — HTTP bridge so Docker agents can use agent-browser on the Mac mini
 * Port: 18792  Auth: AGENT_BROWSER_BRIDGE_TOKEN env var
 *
 * Endpoints:
 *   GET /fetch?url=<url>  — Open URL, return page text
 *     Auth: Authorization: Bearer <token>
 *   GET /health           — Returns {"ok":true}
 */

const http = require("http");
const { execFileSync } = require("child_process");
const { timingSafeEqual, createHash } = require("crypto");

const PORT = 18792;
const TOKEN = process.env.AGENT_BROWSER_BRIDGE_TOKEN;

if (!TOKEN) {
  console.error("AGENT_BROWSER_BRIDGE_TOKEN not set — exiting");
  process.exit(1);
}

const AGENT_BROWSER = process.env.AGENT_BROWSER_BIN || "agent-browser";
if (!process.env.HOME) {
  console.error("[agent-browser-bridge] HOME env var is not set");
  process.exit(1);
}

const X_AUTH_STATE =
  process.env.X_AUTH_STATE_PATH ||
  `${process.env.HOME}/.agent-browser/sessions/x-auth.json`;

function tokenValid(candidate) {
  // Constant-time comparison to prevent timing attacks
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(TOKEN).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

function fetchUrl(targetUrl) {
  const session = `bridge-${Date.now()}`;
  try {
    if (require("fs").existsSync(X_AUTH_STATE)) {
      execFileSync(
        AGENT_BROWSER,
        ["--session-name", session, "state", "load", X_AUTH_STATE],
        { timeout: 5000 },
      );
    }
    execFileSync(
      AGENT_BROWSER,
      ["--session-name", session, "open", targetUrl],
      { timeout: 15000 },
    );
    try {
      execFileSync(
        AGENT_BROWSER,
        ["--session-name", session, "wait", "--load", "networkidle"],
        { timeout: 20000 },
      );
    } catch {
      /* networkidle timeout is normal for X — proceed anyway */
    }
    const text = execFileSync(
      AGENT_BROWSER,
      [
        "--session-name",
        session,
        "eval",
        '(document.getElementById("react-root")||document.body).innerText',
      ],
      { timeout: 10000 },
    );
    return text.toString();
  } finally {
    try {
      execFileSync(AGENT_BROWSER, ["--session-name", session, "close"], {
        timeout: 5000,
      });
    } catch {
      /* ignore close errors */
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname !== "/fetch") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const authHeader = req.headers["authorization"] || "";
  const candidate = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!tokenValid(candidate)) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    res.writeHead(400);
    res.end("Missing url parameter");
    return;
  }

  try {
    console.log(`[bridge] fetching: ${targetUrl}`);
    const text = fetchUrl(targetUrl);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(text);
  } catch (err) {
    console.error(`[bridge] error: ${err.message}`);
    res.writeHead(500);
    res.end(`Error: ${err.message}`);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`agent-browser-bridge listening on :${PORT}`);
});
