const { RuleTester } = require("eslint");

const noEmptyCatch = require("../rules/no-empty-catch");
const noUnsafeJsonParse = require("../rules/no-unsafe-json-parse");
const requireAuthMiddleware = require("../rules/require-auth-middleware");
const requireGuardClause = require("../rules/require-guard-clause");
const requireUseCallback = require("../rules/require-useCallback");

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("eslint-plugin-defensive rules", () => {
  tester.run("no-empty-catch", noEmptyCatch, {
    valid: ["try { work(); } catch (error) { throw error; }"],
    invalid: [
      {
        code: "try { work(); } catch {}",
        errors: [{ messageId: "emptyCatch" }],
      },
      {
        code: "try { work(); } catch (error) { console.error(error); }",
        errors: [{ messageId: "consoleOnlyCatch" }],
      },
    ],
  });

  tester.run("no-unsafe-json-parse", noUnsafeJsonParse, {
    valid: ["try { JSON.parse(input); } catch (error) { throw error; }"],
    invalid: [
      {
        code: "const value = JSON.parse(input);",
        errors: [{ messageId: "unsafeJsonParse" }],
      },
    ],
  });

  tester.run("require-auth-middleware", requireAuthMiddleware, {
    valid: [
      {
        code: "export const GET = withAuth(async () => response);",
        filename: "/project/api/users/route.js",
      },
      {
        code: "export const GET = async () => response;",
        filename: "/project/lib/users.js",
      },
    ],
    invalid: [
      {
        code: "export const GET = async () => response;",
        filename: "/project/api/users/route.js",
        errors: [{ messageId: "missingAuth" }],
      },
    ],
  });

  tester.run("require-guard-clause", requireGuardClause, {
    valid: ["const average = count ? total / count : 0;"],
    invalid: [
      {
        code: "const average = total / count;",
        errors: [{ messageId: "unsafeDivision" }],
      },
      {
        code: "const invalid = total / 0;",
        errors: [{ messageId: "unsafeDivision" }],
      },
    ],
  });

  tester.run("require-useCallback", requireUseCallback, {
    valid: [
      "const view = <Button onClick={handleClick} />;",
      "const view = <Widget on={1} />;",
      "const view = <Widget ns:onClick={() => work()} />;",
    ],
    invalid: [
      {
        code: "const view = <Button onClick={() => work()} />;",
        errors: [{ messageId: "inlineHandler" }],
      },
      {
        code: "const view = <Button onClick={function () { work(); }} />;",
        errors: [{ messageId: "inlineHandler" }],
      },
    ],
  });
});
