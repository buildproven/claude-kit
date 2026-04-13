"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDomainAnalyticsTools = registerDomainAnalyticsTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
function registerDomainAnalyticsTools(server, apiClient) {
    // Technologies Summary
    (0, tools_js_1.registerTool)(server, "domain_analytics_technologies_summary", zod_1.z.object({
        technology_name: zod_1.z.string().optional().describe("Filter results by technology name"),
        technology_group: zod_1.z.string().optional().describe("Filter results by technology group"),
        category: zod_1.z.string().optional().describe("Filter results by category")
    }), async (params, client) => {
        const response = await client.post("/domain_analytics/technologies/summary/live", [params]);
        return response;
    }, apiClient);
    // Technologies Technologies
    (0, tools_js_1.registerTool)(server, "domain_analytics_technologies_technologies", zod_1.z.object({
        technology_name: zod_1.z.string().optional().describe("Filter results by technology name"),
        technology_group: zod_1.z.string().optional().describe("Filter results by technology group"),
        category: zod_1.z.string().optional().describe("Filter results by category")
    }), async (params, client) => {
        const response = await client.post("/domain_analytics/technologies/technologies/live", [params]);
        return response;
    }, apiClient);
    // Technologies Domains by Technology
    (0, tools_js_1.registerTool)(server, "domain_analytics_technologies_domains_by_technology", zod_1.z.object({
        technology_name: zod_1.z.string().describe("Technology name to search for"),
        technology_group: zod_1.z.string().optional().describe("Filter results by technology group"),
        category: zod_1.z.string().optional().describe("Filter results by category"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/domain_analytics/technologies/domains_by_technology/live", [params]);
        return response;
    }, apiClient);
    // Technologies Domain Technologies
    (0, tools_js_1.registerTool)(server, "domain_analytics_technologies_domain_technologies", zod_1.z.object({
        target: zod_1.z.string().describe("Target domain to analyze"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/domain_analytics/technologies/domain_technologies/live", [params]);
        return response;
    }, apiClient);
    // Technologies Technology Stats
    (0, tools_js_1.registerTool)(server, "domain_analytics_technologies_technology_stats", zod_1.z.object({
        technology_name: zod_1.z.string().describe("Technology name to get stats for"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/domain_analytics/technologies/technology_stats/live", [params]);
        return response;
    }, apiClient);
    // Technologies Domains by HTML Terms
    (0, tools_js_1.registerTool)(server, "domain_analytics_technologies_domains_by_html_terms", zod_1.z.object({
        terms: zod_1.z.array(zod_1.z.string()).describe("HTML terms to search for"),
        intersection_mode: zod_1.z.enum(["and", "or"]).optional().describe("Intersection mode"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/domain_analytics/technologies/domains_by_html_terms/live", [params]);
        return response;
    }, apiClient);
    // Whois Overview
    (0, tools_js_1.registerTool)(server, "domain_analytics_whois_overview", zod_1.z.object({
        domain: zod_1.z.string().describe("Domain to get WHOIS information for")
    }), async (params, client) => {
        const response = await client.post("/domain_analytics/whois/overview/live", [params]);
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map