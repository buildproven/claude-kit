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

    function isComparisonGuard(test, divisorName) {
      return (
        test.type === "BinaryExpression" &&
        (test.operator === ">" ||
          test.operator === "!==" ||
          test.operator === "!=") &&
        test.left.type === "Identifier" &&
        test.left.name === divisorName
      );
    }

    function isNodeGuardedByParent(parent, divisorName) {
      if (parent.type === "ConditionalExpression") {
        const { test } = parent;
        return (
          isComparisonGuard(test, divisorName) ||
          (test.type === "Identifier" && test.name === divisorName)
        );
      }

      if (parent.type === "IfStatement") {
        const { test } = parent;
        return (
          isComparisonGuard(test, divisorName) ||
          (test.type === "Identifier" && test.name === divisorName) ||
          (test.type === "UnaryExpression" &&
            test.operator === "!" &&
            test.argument.type === "Identifier" &&
            test.argument.name === divisorName)
        );
      }

      if (parent.type === "LogicalExpression" && parent.operator === "&&") {
        return (
          parent.left.type === "Identifier" &&
          parent.left.name === divisorName
        );
      }

      return false;
    }

    function isDivisorGuarded(node, divisorName) {
      let parent = node.parent;
      let depth = 0;
      const maxDepth = 10;

      while (parent && depth < maxDepth) {
        if (isNodeGuardedByParent(parent, divisorName)) return true;
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
