/**
 * @fileoverview Require try/catch or Zod wrapper around JSON.parse
 * @description Prevents uncaught JSON parse errors and type coercion attacks
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require try/catch or Zod wrapper around JSON.parse",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      unsafeJsonParse:
        "JSON.parse without try/catch or Zod validation. Wrap in try/catch or use schema.safeParse().",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check for JSON.parse()
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.name === "JSON" &&
          node.callee.property.name === "parse"
        ) {
          // Check if inside a try block
          let parent = node.parent;
          let isInTry = false;
          let isInZodSafeParse = false;

          while (parent) {
            // Check if inside try block
            if (parent.type === "TryStatement") {
              isInTry = true;
              break;
            }

            // Check if result is passed to .safeParse() or schema validation
            // Pattern: schema.safeParse(JSON.parse(...))
            if (
              parent.type === "CallExpression" &&
              parent.callee.type === "MemberExpression" &&
              parent.callee.property.name === "safeParse"
            ) {
              isInZodSafeParse = true;
              break;
            }

            // Check if inside a function that's a catch handler argument
            if (
              parent.type === "CallExpression" &&
              parent.callee.type === "MemberExpression" &&
              parent.callee.property.name === "catch"
            ) {
              isInTry = true;
              break;
            }

            parent = parent.parent;
          }

          if (!isInTry && !isInZodSafeParse) {
            context.report({
              node,
              messageId: "unsafeJsonParse",
            });
          }
        }
      },
    };
  },
};
