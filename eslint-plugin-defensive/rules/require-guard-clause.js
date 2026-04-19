/**
 * @fileoverview Require guard clauses before division operations
 * @description Prevents division by zero errors
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require guard clause before division to prevent division by zero",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      unsafeDivision:
        "Division by '{{divisor}}' without zero check. Use guard clause: {{divisor}} > 0 ? {{expression}} : 0",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowLiterals: {
            type: "boolean",
            description:
              "Allow division by literal numbers (they can't be zero at runtime)",
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const allowLiterals = options.allowLiterals !== false; // Default true

    function isDivisorGuarded(node, divisorName) {
      // Walk up the AST to find if there's a guard
      let parent = node.parent;
      let depth = 0;
      const maxDepth = 10;

      while (parent && depth < maxDepth) {
        // Check for ternary: divisor > 0 ? ... : ...
        // or: divisor !== 0 ? ... : ...
        // or: divisor ? ... : ...
        if (parent.type === "ConditionalExpression") {
          const test = parent.test;

          // Check: divisor > 0
          if (
            test.type === "BinaryExpression" &&
            (test.operator === ">" ||
              test.operator === "!==" ||
              test.operator === "!=") &&
            test.left.type === "Identifier" &&
            test.left.name === divisorName
          ) {
            return true;
          }

          // Check: divisor (truthy check)
          if (test.type === "Identifier" && test.name === divisorName) {
            return true;
          }
        }

        // Check for if statement guard
        if (parent.type === "IfStatement") {
          const test = parent.test;

          // Check: if (divisor > 0)
          if (
            test.type === "BinaryExpression" &&
            (test.operator === ">" ||
              test.operator === "!==" ||
              test.operator === "!=") &&
            test.left.type === "Identifier" &&
            test.left.name === divisorName
          ) {
            return true;
          }

          // Check: if (divisor)
          if (test.type === "Identifier" && test.name === divisorName) {
            return true;
          }

          // Check: if (!divisor) return; (early return pattern)
          if (
            test.type === "UnaryExpression" &&
            test.operator === "!" &&
            test.argument.type === "Identifier" &&
            test.argument.name === divisorName
          ) {
            // This is a guard if we're NOT in the consequent (the if block)
            // We're safe if we're in code after the if
            return true;
          }
        }

        // Check for logical AND: divisor && (value / divisor)
        if (parent.type === "LogicalExpression" && parent.operator === "&&") {
          if (
            parent.left.type === "Identifier" &&
            parent.left.name === divisorName
          ) {
            return true;
          }
        }

        parent = parent.parent;
        depth++;
      }

      return false;
    }

    return {
      BinaryExpression(node) {
        if (node.operator !== "/") {
          return;
        }

        const divisor = node.right;

        // Allow literal numbers (can't be zero at runtime if non-zero in code)
        if (
          allowLiterals &&
          divisor.type === "Literal" &&
          typeof divisor.value === "number"
        ) {
          if (divisor.value === 0) {
            // Literal zero is always an error
            context.report({
              node,
              messageId: "unsafeDivision",
              data: {
                divisor: "0",
                expression: context.getSourceCode().getText(node),
              },
            });
          }
          return;
        }

        // Get divisor name for variable checks
        let divisorName = null;
        if (divisor.type === "Identifier") {
          divisorName = divisor.name;
        } else if (divisor.type === "MemberExpression" && !divisor.computed) {
          divisorName = divisor.property.name;
        }

        // If we can't determine the divisor name, skip (complex expression)
        if (!divisorName) {
          return;
        }

        // Check if divisor is guarded
        if (!isDivisorGuarded(node, divisorName)) {
          context.report({
            node,
            messageId: "unsafeDivision",
            data: {
              divisor: divisorName,
              expression: context.getSourceCode().getText(node),
            },
          });
        }
      },
    };
  },
};
