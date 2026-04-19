/**
 * @fileoverview Require auth middleware in API routes
 * @description Prevents unauthenticated API endpoints
 */

"use strict";

const fs = require("fs");
const path = require("path");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require auth middleware in API routes",
      category: "Security",
      recommended: true,
    },
    messages: {
      missingAuth:
        "API route handler '{{name}}' is missing auth middleware. Wrap with withAuth() or add to publicRoutes in .defensive-patterns.json.",
    },
    schema: [
      {
        type: "object",
        properties: {
          authWrappers: {
            type: "array",
            items: { type: "string" },
            description: "Function names that provide auth middleware",
          },
          publicRoutes: {
            type: "array",
            items: { type: "string" },
            description: "Route patterns that don't require auth",
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    let authWrappers = options.authWrappers || [
      "withAuth",
      "withApiAuth",
      "withSession",
      "requireAuth",
      "authenticated",
    ];
    let publicRoutes = options.publicRoutes || [];

    // Try to load from .defensive-patterns.json
    try {
      const configPath = path.join(process.cwd(), ".defensive-patterns.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (config.authWrappers) {
          authWrappers = config.authWrappers;
        }
        if (config.publicRoutes) {
          publicRoutes = config.publicRoutes;
        }
      }
    } catch {
      // Config file doesn't exist or is invalid, use defaults
    }

    const filename = context.getFilename();

    // Check if this is an API route file
    const isApiRoute =
      filename.includes("/api/") ||
      filename.includes("\\api\\") ||
      filename.includes("/route.ts") ||
      filename.includes("/route.js");

    if (!isApiRoute) {
      return {};
    }

    // Check if this route is in publicRoutes using simple glob matching
    // Uses string operations instead of RegExp to avoid security lint issues
    const isPublicRoute = publicRoutes.some((pattern) => {
      // Convert glob pattern to segments for matching
      // Supports: **/path/**, */file, exact/path
      const segments = pattern.split("*").filter(Boolean);

      if (segments.length === 0) {
        // Pattern is all wildcards, matches everything
        return true;
      }

      // Check if all non-wildcard segments appear in the filename in order
      let lastIndex = -1;
      for (const segment of segments) {
        const index = filename.indexOf(segment, lastIndex + 1);
        if (index === -1) {
          return false;
        }
        lastIndex = index + segment.length - 1;
      }
      return true;
    });

    if (isPublicRoute) {
      return {};
    }

    const httpMethods = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ];

    function isWrappedWithAuth(node) {
      // Check if the export is wrapped: export const GET = withAuth(...)
      if (
        node.init &&
        node.init.type === "CallExpression" &&
        node.init.callee.type === "Identifier" &&
        authWrappers.includes(node.init.callee.name)
      ) {
        return true;
      }

      // Check for: export const GET = withAuth(async (req) => {...})
      if (
        node.init &&
        node.init.type === "CallExpression" &&
        node.init.callee.type === "Identifier"
      ) {
        return authWrappers.includes(node.init.callee.name);
      }

      return false;
    }

    return {
      ExportNamedDeclaration(node) {
        if (!node.declaration) return;

        // Handle: export const GET = ...
        if (node.declaration.type === "VariableDeclaration") {
          node.declaration.declarations.forEach((decl) => {
            if (
              decl.id.type === "Identifier" &&
              httpMethods.includes(decl.id.name)
            ) {
              if (!isWrappedWithAuth(decl)) {
                context.report({
                  node: decl,
                  messageId: "missingAuth",
                  data: { name: decl.id.name },
                });
              }
            }
          });
        }

        // Handle: export async function GET(...)
        if (
          node.declaration.type === "FunctionDeclaration" &&
          httpMethods.includes(node.declaration.id.name)
        ) {
          // Function exports need to be wrapped differently - check parent scope for auth
          // For now, flag all direct function exports
          context.report({
            node: node.declaration,
            messageId: "missingAuth",
            data: { name: node.declaration.id.name },
          });
        }
      },
    };
  },
};
