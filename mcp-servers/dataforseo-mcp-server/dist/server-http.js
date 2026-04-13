"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const client_js_1 = require("./api/client.js");
const tools_js_1 = require("./api/tools.js");
const index_js_1 = require("./api/serp/index.js");
const index_js_2 = require("./api/keywords/index.js");
const index_js_3 = require("./api/labs/index.js");
const index_js_4 = require("./api/backlinks/index.js");
const index_js_5 = require("./api/onpage/index.js");
const index_js_6 = require("./api/domain-analytics/index.js");
const index_js_7 = require("./api/content-analysis/index.js");
const index_js_8 = require("./api/content-generation/index.js");
const index_js_9 = require("./api/merchant/index.js");
const index_js_10 = require("./api/app-data/index.js");
const index_js_11 = require("./api/business-data/index.js");
const index_js_12 = require("./api/localfalcon/index.js");
const index_js_13 = require("./api/ai-optimization/index.js");
const zod_to_json_schema_1 = __importDefault(require("zod-to-json-schema"));
const app = (0, express_1.default)();
const port = process.env.PORT || 8080;
app.use(express_1.default.json({ limit: '10mb' }));
// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
// Initialize MCP server once at startup
let mcpServer = null;
let registeredTools = [];
function getMcpServer() {
    if (mcpServer)
        return mcpServer;
    console.log('Initializing MCP server...');
    const dataForSeoLogin = process.env.DATAFORSEO_LOGIN;
    const dataForSeoPassword = process.env.DATAFORSEO_PASSWORD;
    if (!dataForSeoLogin || !dataForSeoPassword) {
        throw new Error("DataForSEO credentials not provided");
    }
    const apiClient = (0, client_js_1.setupApiClient)(dataForSeoLogin, dataForSeoPassword);
    mcpServer = new mcp_js_1.McpServer({
        name: "DataForSEO MCP Server",
        version: "1.0.0",
    });
    // Register all DataForSEO tools
    (0, index_js_1.registerSerpTools)(mcpServer, apiClient);
    (0, index_js_2.registerKeywordsTools)(mcpServer, apiClient);
    (0, index_js_3.registerLabsTools)(mcpServer, apiClient);
    (0, index_js_4.registerBacklinksTools)(mcpServer, apiClient);
    (0, index_js_5.registerOnPageTools)(mcpServer, apiClient);
    (0, index_js_6.registerDomainAnalyticsTools)(mcpServer, apiClient);
    (0, index_js_7.registerContentAnalysisTools)(mcpServer, apiClient);
    (0, index_js_8.registerContentGenerationTools)(mcpServer, apiClient);
    (0, index_js_9.registerMerchantTools)(mcpServer, apiClient);
    (0, index_js_10.registerAppDataTools)(mcpServer, apiClient);
    (0, index_js_11.registerBusinessDataTools)(mcpServer, apiClient);
    (0, index_js_13.registerAiOptimizationTools)(mcpServer, apiClient);
    const localFalconApiKey = process.env.LOCALFALCON_API_KEY;
    if (localFalconApiKey) {
        console.log("Registering Local Falcon tools");
        (0, index_js_12.registerLocalFalconTools)(mcpServer, {
            apiKey: localFalconApiKey,
            baseUrl: process.env.LOCALFALCON_API_URL
        });
    }
    else {
        console.log("Local Falcon not configured (optional)");
    }
    // Store tools list by intercepting the tool registration
    // We'll call tools/list on the actual MCP server to get the real list
    console.log('MCP server initialized');
    return mcpServer;
}
// Helper to get tools list from tool registry
function getToolsList() {
    const tools = Array.from(tools_js_1.toolRegistry.values()).map(tool => {
        // Convert Zod schema to JSON Schema
        const fullSchema = (0, zod_to_json_schema_1.default)(tool.inputSchema, tool.name);
        // Extract the actual schema from definitions if using $ref
        let inputSchema = fullSchema;
        if (fullSchema.$ref && fullSchema.definitions) {
            const refParts = fullSchema.$ref.split('/');
            const refKey = refParts[refParts.length - 1];
            if (refKey && fullSchema.definitions[refKey]) {
                inputSchema = { ...fullSchema.definitions[refKey] };
            }
        }
        // Clean up - remove $ref and definitions
        if (inputSchema.$ref)
            delete inputSchema.$ref;
        if (inputSchema.definitions)
            delete inputSchema.definitions;
        // Fix arrays without items (OpenAI requires items for all arrays)
        if (inputSchema.properties) {
            for (const [propName, propSchema] of Object.entries(inputSchema.properties)) {
                const prop = propSchema;
                if (prop.type === 'array' && !prop.items) {
                    // Add default items schema
                    prop.items = { type: 'string' };
                }
            }
        }
        return {
            name: tool.name,
            description: tool.description || `DataForSEO API tool: ${tool.name}`,
            inputSchema
        };
    });
    console.log(`Returning ${tools.length} tools`);
    return tools;
}
// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'dataforseo-mcp-server',
        version: '1.0.0'
    });
});
// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'DataForSEO MCP Server',
        version: '1.0.0',
        description: 'MCP server for DataForSEO API - OpenAI compatible',
        endpoints: {
            health: '/health',
            mcp: '/mcp (POST) - For OpenAI and other MCP clients',
            tools: '/tools (GET)'
        }
    });
});
// Main MCP endpoint - handles JSON-RPC 2.0
app.post('/mcp', async (req, res) => {
    try {
        const server = getMcpServer();
        const { jsonrpc, method, params, id } = req.body;
        if (jsonrpc !== '2.0') {
            return res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32600, message: 'Invalid Request' },
                id: id || null
            });
        }
        // Handle MCP methods
        switch (method) {
            case 'initialize':
                return res.json({
                    jsonrpc: '2.0',
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: {
                            name: 'DataForSEO MCP Server',
                            version: '1.0.0'
                        }
                    },
                    id
                });
            case 'tools/list':
                // Get tools list from registry
                const toolsList = getToolsList();
                return res.json({
                    jsonrpc: '2.0',
                    result: { tools: toolsList },
                    id
                });
            case 'tools/call':
                if (!params?.name) {
                    return res.status(400).json({
                        jsonrpc: '2.0',
                        error: { code: -32602, message: 'Missing tool name' },
                        id
                    });
                }
                try {
                    // Get the tool from registry
                    const tool = tools_js_1.toolRegistry.get(params.name);
                    if (!tool || !tool.handler) {
                        return res.status(404).json({
                            jsonrpc: '2.0',
                            error: { code: -32601, message: `Tool not found: ${params.name}` },
                            id
                        });
                    }
                    // Call the tool handler directly
                    const result = await tool.handler(params.arguments || {}, {});
                    return res.json({
                        jsonrpc: '2.0',
                        result,
                        id
                    });
                }
                catch (error) {
                    return res.status(500).json({
                        jsonrpc: '2.0',
                        error: { code: -32603, message: error.message },
                        id
                    });
                }
            default:
                return res.status(404).json({
                    jsonrpc: '2.0',
                    error: { code: -32601, message: `Method not found: ${method}` },
                    id
                });
        }
    }
    catch (error) {
        console.error('MCP error:', error);
        return res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error', data: error.message },
            id: req.body?.id || null
        });
    }
});
// List tools endpoint
app.get('/tools', (req, res) => {
    try {
        getMcpServer(); // Ensure server is initialized
        const toolsList = getToolsList();
        res.json({
            jsonrpc: '2.0',
            result: { tools: toolsList }
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to list tools',
            message: error.message
        });
    }
});
// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});
// Start server and pre-initialize MCP
const server = app.listen(port, () => {
    console.log(`DataForSEO MCP HTTP Server listening on port ${port}`);
    console.log(`Health: http://localhost:${port}/health`);
    console.log(`MCP: http://localhost:${port}/mcp`);
    // Pre-initialize MCP server
    try {
        getMcpServer();
        console.log('MCP server ready for requests');
    }
    catch (error) {
        console.error('Failed to initialize MCP server:', error);
    }
});
// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
//# sourceMappingURL=server-http.js.map