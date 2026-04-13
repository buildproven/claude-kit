"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const client_js_1 = require("./api/client.js");
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
async function main() {
    // Get authentication credentials from environment variables
    const dataForSeoLogin = process.env.DATAFORSEO_LOGIN;
    const dataForSeoPassword = process.env.DATAFORSEO_PASSWORD;
    if (!dataForSeoLogin || !dataForSeoPassword) {
        console.error("Error: DataForSEO API credentials not provided");
        console.error("Please set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables");
        process.exit(1);
    }
    // Setup API client
    const apiClient = (0, client_js_1.setupApiClient)(dataForSeoLogin, dataForSeoPassword);
    // Create an MCP server
    const server = new mcp_js_1.McpServer({
        name: "SEO Tools MCP Server",
        version: "1.0.0",
    });
    // Parse enabled modules from environment variable
    // Format: ENABLED_MODULES="SERP,BUSINESS_DATA,LABS" (comma-separated)
    // If not set, all modules are enabled
    const enabledModulesEnv = process.env.ENABLED_MODULES;
    const enabledModules = enabledModulesEnv
        ? new Set(enabledModulesEnv.split(',').map(m => m.trim().toUpperCase()))
        : null; // null means all enabled
    const isEnabled = (module) => !enabledModules || enabledModules.has(module);
    // Register tools for each DataForSEO API category (conditionally)
    if (isEnabled('SERP'))
        (0, index_js_1.registerSerpTools)(server, apiClient);
    if (isEnabled('KEYWORDS_DATA'))
        (0, index_js_2.registerKeywordsTools)(server, apiClient);
    if (isEnabled('LABS') || isEnabled('DATAFORSEO_LABS'))
        (0, index_js_3.registerLabsTools)(server, apiClient);
    if (isEnabled('BACKLINKS'))
        (0, index_js_4.registerBacklinksTools)(server, apiClient);
    if (isEnabled('ONPAGE'))
        (0, index_js_5.registerOnPageTools)(server, apiClient);
    if (isEnabled('DOMAIN_ANALYTICS'))
        (0, index_js_6.registerDomainAnalyticsTools)(server, apiClient);
    if (isEnabled('CONTENT_ANALYSIS'))
        (0, index_js_7.registerContentAnalysisTools)(server, apiClient);
    if (isEnabled('CONTENT_GENERATION'))
        (0, index_js_8.registerContentGenerationTools)(server, apiClient);
    if (isEnabled('MERCHANT'))
        (0, index_js_9.registerMerchantTools)(server, apiClient);
    if (isEnabled('APP_DATA'))
        (0, index_js_10.registerAppDataTools)(server, apiClient);
    if (isEnabled('BUSINESS_DATA'))
        (0, index_js_11.registerBusinessDataTools)(server, apiClient);
    if (isEnabled('AI_OPTIMIZATION'))
        (0, index_js_13.registerAiOptimizationTools)(server, apiClient);
    console.error(`Enabled modules: ${enabledModules ? Array.from(enabledModules).join(', ') : 'ALL'}`);
    // Register third-party API tools
    // Local Falcon API (optional integration)
    const localFalconApiKey = process.env.LOCALFALCON_API_KEY;
    if (localFalconApiKey) {
        console.error("Local Falcon API key found - registering Local Falcon tools");
        (0, index_js_12.registerLocalFalconTools)(server, {
            apiKey: localFalconApiKey,
            baseUrl: process.env.LOCALFALCON_API_URL // Optional, uses default if not provided
        });
    }
    else {
        console.error("Local Falcon API key not found - skipping Local Falcon integration");
        console.error("To enable, set the LOCALFALCON_API_KEY environment variable");
    }
    // Add more third-party API integrations here
    // Example:
    // if (process.env.ANOTHER_SEO_TOOL_API_KEY) {
    //   registerAnotherSeoToolTools(server, { apiKey: process.env.ANOTHER_SEO_TOOL_API_KEY });
    // }
    // Start receiving messages on stdin and sending messages on stdout
    const transport = new stdio_js_1.StdioServerTransport();
    console.error("SEO Tools MCP Server starting...");
    await server.connect(transport);
    console.error("SEO Tools MCP Server connected");
}
main().catch((error) => {
    console.error("Error in SEO Tools MCP Server:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map