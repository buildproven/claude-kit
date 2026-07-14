/**
 * Tests for eslint-plugin-defensive.
 *
 * These exercise the rules through ESLint's own RuleTester, so they fail if a
 * rule stops firing, starts over-firing, or breaks against the ESLint version
 * this repo actually runs.
 */

"use strict";

const { RuleTester } = require("eslint");
const plugin = require("../index.js");

// vitest runs with globals:true, so describe/it are already in scope.
// Wire RuleTester to them so rule failures surface as ordinary test failures.
RuleTester.describe = describe;
RuleTester.it = it;

const js = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const jsx = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("plugin surface", () => {
  it("exports all five rules and the recommended config", () => {
    const expected = [
      "no-unsafe-json-parse",
      "no-empty-catch",
      "require-auth-middleware",
      "require-useCallback",
      "require-guard-clause",
    ];
    for (const name of expected) {
      if (typeof plugin.rules[name]?.create !== "function") {
        throw new Error(`rule ${name} is missing or has no create()`);
      }
    }
    if (Object.keys(plugin.rules).length !== expected.length) {
      throw new Error("rule count changed — update this test deliberately");
    }
    // Every rule in recommended must actually exist, or consumers get a crash
    // ("Definition for rule ... was not found") rather than a lint error.
    for (const key of Object.keys(plugin.configs.recommended.rules)) {
      const bare = key.replace(/^defensive\//, "");
      if (!plugin.rules[bare]) {
        throw new Error(`recommended config references unknown rule: ${key}`);
      }
    }
  });
});

js.run("no-empty-catch", plugin.rules["no-empty-catch"], {
  valid: [
    // Re-throwing is valid handling.
    "try { risky(); } catch (e) { throw e; }",
    // A recognised user-feedback call is valid handling.
    "try { risky(); } catch (e) { setError(e.message); }",
    "try { risky(); } catch (e) { toast('failed'); }",
    // Sentry.
    "try { risky(); } catch (e) { captureException(e); }",
    // A caller-supplied allow-list entry counts.
    {
      code: "try { risky(); } catch (e) { myCustomLogger(e); }",
      options: [{ allowedPatterns: ["myCustomLogger"] }],
    },
  ],
  invalid: [
    // The headline case: swallow the error entirely.
    {
      code: "try { risky(); } catch (e) {}",
      errors: [{ messageId: "emptyCatch" }],
    },
    // console-only is a silent failure to a user: it logs, but nobody is told.
    {
      code: "try { risky(); } catch (e) { console.error(e); }",
      errors: [{ messageId: "consoleOnlyCatch" }],
    },
    {
      code: "try { risky(); } catch (e) { console.log(e); }",
      errors: [{ messageId: "consoleOnlyCatch" }],
    },
  ],
});

js.run("no-unsafe-json-parse", plugin.rules["no-unsafe-json-parse"], {
  valid: [
    // Guarded by try/catch.
    "try { JSON.parse(raw); } catch (e) { throw e; }",
    // Guarded by a schema validator.
    "schema.safeParse(JSON.parse(raw));",
    // Promise .catch() counts as handled.
    "fetch(u).then((r) => JSON.parse(r)).catch((e) => report(e));",
    // Unrelated calls must not trip it.
    "JSON.stringify(value);",
    "other.parse(raw);",
  ],
  invalid: [
    {
      code: "const data = JSON.parse(raw);",
      errors: [{ messageId: "unsafeJsonParse" }],
    },
    {
      code: "function load(s) { return JSON.parse(s); }",
      errors: [{ messageId: "unsafeJsonParse" }],
    },
  ],
});

jsx.run("require-useCallback", plugin.rules["require-useCallback"], {
  valid: [
    // A hoisted, memoised handler is the pattern the rule wants.
    "const C = () => { const h = useCallback(() => {}, []); return <button onClick={h} />; };",
    // A plain identifier reference is fine.
    "const C = () => <button onClick={handleClick} />;",
    // Ignored props are exempt by default (render props take inline fns legitimately).
    "const C = () => <List renderItem={() => <Row />} />;",
    // Non-handler props are untouched.
    "const C = () => <div className={'x'} />;",
  ],
  invalid: [
    // Inline arrow in a handler prop allocates a new fn every render.
    {
      code: "const C = () => <button onClick={() => doThing()} />;",
      errors: 1,
    },
    {
      code: "const C = () => <form onSubmit={function () {}} />;",
      errors: 1,
    },
  ],
});

js.run("require-guard-clause", plugin.rules["require-guard-clause"], {
  valid: [
    // Guarded by an explicit comparison.
    "function f(a, b) { if (b !== 0) { return a / b; } return 0; }",
    "function f(a, b) { if (b > 0) { return a / b; } return 0; }",
    // Guarded by truthiness.
    "function f(a, b) { return b ? a / b : 0; }",
    "function f(a, b) { return b && a / b; }",
    // Dividing by a literal can't be zero-division by a variable.
    "const half = x / 2;",
  ],
  invalid: [
    // Unguarded division by a variable.
    {
      code: "function f(a, b) { return a / b; }",
      errors: 1,
    },
  ],
});

// require-auth-middleware only activates for API-route filenames, so the
// filename is load-bearing and must be asserted both ways.
js.run("require-auth-middleware", plugin.rules["require-auth-middleware"], {
  valid: [
    // Not an API route → rule must not fire at all.
    {
      code: "export async function GET() { return Response.json({}); }",
      filename: "/app/components/thing.ts",
    },
    // API route wrapped in a recognised auth wrapper.
    {
      code: "export const GET = withAuth(async () => Response.json({}));",
      filename: "/app/api/users/route.ts",
    },
    // Caller-supplied wrapper name.
    {
      code: "export const GET = myGuard(async () => Response.json({}));",
      filename: "/app/api/users/route.ts",
      options: [{ authWrappers: ["myGuard"] }],
    },
    // Explicitly declared public route.
    {
      code: "export async function GET() { return Response.json({}); }",
      filename: "/app/api/health/route.ts",
      options: [{ publicRoutes: ["**/health/**"] }],
    },
  ],
  invalid: [
    // Unauthenticated API route handler.
    {
      code: "export async function GET() { return Response.json({ secret: 1 }); }",
      filename: "/app/api/users/route.ts",
      errors: 1,
    },
  ],
});
