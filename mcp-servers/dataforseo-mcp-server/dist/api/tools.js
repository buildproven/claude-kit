"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolRegistry = void 0;
exports.registerTool = registerTool;
exports.registerTaskTool = registerTaskTool;
const zod_1 = require("zod");
// Global tool registry - stores both metadata and handler functions
exports.toolRegistry = new Map();
// Parse ENABLED_TOOLS from environment once at startup
// Format: ENABLED_TOOLS="serp_google_maps_live,business_data_google_my_business_info"
const enabledToolsEnv = process.env.ENABLED_TOOLS;
const enabledTools = enabledToolsEnv
    ? new Set(enabledToolsEnv.split(',').map(t => t.trim().toLowerCase()))
    : null; // null means all enabled
function isToolEnabled(name) {
    if (!enabledTools)
        return true; // No filter = all enabled
    return enabledTools.has(name.toLowerCase());
}
/**
 * Base helper function to register an MCP tool for DataForSEO API
 */
function registerTool(server, name, schema, handler, client) {
    // Skip if tool not in ENABLED_TOOLS list
    if (!isToolEnabled(name)) {
        return;
    }
    // Extract the shape from ZodObject if needed
    const shape = schema instanceof zod_1.z.ZodObject ? schema.shape : schema;
    // Create the tool handler wrapper
    const toolHandler = async (params, _context) => {
        try {
            // We get the apiClient from the closure
            const result = await handler(params, client);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2)
                    }
                ]
            };
        }
        catch (error) {
            console.error(`Error in ${name} tool:`, error);
            if (error instanceof Error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                error: error.message,
                                stack: error.stack
                            }, null, 2)
                        }
                    ]
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            error: "Unknown error occurred",
                            details: error
                        }, null, 2)
                    }
                ]
            };
        }
    };
    // Store in registry for tools/list AND HTTP bridge calls
    exports.toolRegistry.set(name, {
        name,
        description: '', // Will be set by individual registrations
        inputSchema: schema instanceof zod_1.z.ZodObject ? schema : zod_1.z.object(schema),
        handler: toolHandler // Store the handler for HTTP bridge
    });
    // Register the handler with the MCP server
    server.tool(name, shape, toolHandler);
}
/**
 * Helper for registering a task-based tool (POST, READY, GET pattern)
 */
function registerTaskTool(server, baseName, postSchema, postHandler, readyHandler, getHandler, client) {
    // Register POST tool
    registerTool(server, `${baseName}_post`, postSchema, postHandler, client);
    // Register READY tool
    registerTool(server, `${baseName}_ready`, {}, (_params, client) => readyHandler(client), client);
    // Register GET tool
    registerTool(server, `${baseName}_get`, { id: zod_1.z.string() }, (params, client) => getHandler(params.id, client), client);
}
//# sourceMappingURL=tools.js.map