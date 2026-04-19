/**
 * @fileoverview Require meaningful error handling in catch blocks
 * @description Prevents silent failures by requiring user feedback or re-throw
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require meaningful error handling in catch blocks",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      emptyCatch:
        "Empty catch block. Add user feedback (setError, toast) or re-throw the error.",
      consoleOnlyCatch:
        "Catch block only has console.log/error. Add user feedback (setError, toast) or re-throw.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedPatterns: {
            type: "array",
            items: { type: "string" },
            description: "Function names that count as valid error handling",
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedPatterns = options.allowedPatterns || [
      "setError",
      "toast",
      "notify",
      "showError",
      "handleError",
      "reportError",
      "captureException", // Sentry
      "throw",
    ];

    function hasValidErrorHandling(node) {
      if (!node.body || node.body.length === 0) {
        return false;
      }

      const sourceCode = context.getSourceCode();
      const text = sourceCode.getText(node);

      // Check for throw statement
      const hasThrow = node.body.some(
        (stmt) =>
          stmt.type === "ThrowStatement" ||
          (stmt.type === "ExpressionStatement" &&
            stmt.expression.type === "ThrowStatement"),
      );

      if (hasThrow) {
        return true;
      }

      // Check for allowed function calls
      const hasAllowedCall = allowedPatterns.some((pattern) => {
        // Handle "throw" specially
        if (pattern === "throw") {
          return text.includes("throw ");
        }
        return text.includes(pattern);
      });

      if (hasAllowedCall) {
        return true;
      }

      // Check if it's ONLY console.log/error/warn
      const hasOnlyConsole = node.body.every((stmt) => {
        if (stmt.type !== "ExpressionStatement") return false;
        const expr = stmt.expression;
        if (expr.type !== "CallExpression") return false;
        if (expr.callee.type !== "MemberExpression") return false;
        return expr.callee.object.name === "console";
      });

      if (hasOnlyConsole) {
        return "consoleOnly";
      }

      // Has some statements but none are valid error handling
      return node.body.length > 0;
    }

    return {
      CatchClause(node) {
        const result = hasValidErrorHandling(node.body);

        if (result === false) {
          context.report({
            node,
            messageId: "emptyCatch",
          });
        } else if (result === "consoleOnly") {
          context.report({
            node,
            messageId: "consoleOnlyCatch",
          });
        }
      },
    };
  },
};
