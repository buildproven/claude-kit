"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBacklinksTools = registerBacklinksTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
// Backlinks API schemas
const targetSchema = zod_1.z.object({
    target: zod_1.z.string().describe("Target domain, subdomain or URL to analyze"),
    limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
    offset: zod_1.z.number().optional().describe("Offset for pagination"),
    filters: zod_1.z.array(zod_1.z.any()).optional().describe("Array of filter objects")
});
function registerBacklinksTools(server, apiClient) {
    // Backlinks Summary
    (0, tools_js_1.registerTool)(server, "backlinks_summary", targetSchema, async (params, client) => {
        const response = await client.post("/backlinks/summary/live", [params]);
        return response;
    }, apiClient);
    // Backlinks List
    (0, tools_js_1.registerTool)(server, "backlinks_backlinks", targetSchema.extend({
        mode: zod_1.z.enum(["as_is", "as_csv"]).optional().describe("Data presentation mode"),
    }), async (params, client) => {
        const response = await client.post("/backlinks/backlinks/live", [params]);
        return response;
    }, apiClient);
    // Anchors
    (0, tools_js_1.registerTool)(server, "backlinks_anchors", targetSchema, async (params, client) => {
        const response = await client.post("/backlinks/anchors/live", [params]);
        return response;
    }, apiClient);
    // Backlinks Domain Pages
    (0, tools_js_1.registerTool)(server, "backlinks_domain_pages", targetSchema, async (params, client) => {
        const response = await client.post("/backlinks/domain_pages/live", [params]);
        return response;
    }, apiClient);
    // Domain Pages Summary
    (0, tools_js_1.registerTool)(server, "backlinks_domain_pages_summary", targetSchema, async (params, client) => {
        const response = await client.post("/backlinks/domain_pages_summary/live", [params]);
        return response;
    }, apiClient);
    // Referring Domains
    (0, tools_js_1.registerTool)(server, "backlinks_referring_domains", targetSchema, async (params, client) => {
        const response = await client.post("/backlinks/referring_domains/live", [params]);
        return response;
    }, apiClient);
    // Referring Networks
    (0, tools_js_1.registerTool)(server, "backlinks_referring_networks", targetSchema, async (params, client) => {
        const response = await client.post("/backlinks/referring_networks/live", [params]);
        return response;
    }, apiClient);
    // Bulk Backlinks
    (0, tools_js_1.registerTool)(server, "backlinks_bulk_backlinks", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).describe("List of targets to analyze (domains, subdomains, URLs)"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per target"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        internal_list_limit: zod_1.z.number().optional().describe("Maximum number of items in internal lists per target")
    }), async (params, client) => {
        const response = await client.post("/backlinks/bulk_backlinks/live", [params]);
        return response;
    }, apiClient);
    // Bulk Referring Domains
    (0, tools_js_1.registerTool)(server, "backlinks_bulk_referring_domains", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).describe("List of targets to analyze (domains, subdomains, URLs)"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per target"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        internal_list_limit: zod_1.z.number().optional().describe("Maximum number of items in internal lists per target")
    }), async (params, client) => {
        const response = await client.post("/backlinks/bulk_referring_domains/live", [params]);
        return response;
    }, apiClient);
    // Bulk Spam Score
    (0, tools_js_1.registerTool)(server, "backlinks_bulk_spam_score", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).describe("List of targets to analyze (domains, subdomains, URLs)")
    }), async (params, client) => {
        const response = await client.post("/backlinks/bulk_spam_score/live", [params]);
        return response;
    }, apiClient);
    // Bulk Rank Overview
    (0, tools_js_1.registerTool)(server, "backlinks_bulk_ranks", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).describe("List of targets to analyze (domains, subdomains, URLs)")
    }), async (params, client) => {
        const response = await client.post("/backlinks/bulk_ranks/live", [params]);
        return response;
    }, apiClient);
    // Domain Competitors
    (0, tools_js_1.registerTool)(server, "backlinks_competitors", targetSchema, async (params, client) => {
        const response = await client.post("/backlinks/competitors/live", [params]);
        return response;
    }, apiClient);
    // Domain Intersection
    (0, tools_js_1.registerTool)(server, "backlinks_domain_intersection", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).min(2).max(20).describe("List of domains to compare"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        exclude_targets: zod_1.z.boolean().optional().describe("Whether to exclude the target domains from the results")
    }), async (params, client) => {
        const response = await client.post("/backlinks/domain_intersection/live", [params]);
        return response;
    }, apiClient);
    // Page Intersection
    (0, tools_js_1.registerTool)(server, "backlinks_page_intersection", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).min(2).max(20).describe("List of URLs to compare"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        exclude_targets: zod_1.z.boolean().optional().describe("Whether to exclude the target URLs from the results")
    }), async (params, client) => {
        const response = await client.post("/backlinks/page_intersection/live", [params]);
        return response;
    }, apiClient);
    // Timeseries New Lost Summary
    (0, tools_js_1.registerTool)(server, "backlinks_timeseries_new_lost_summary", targetSchema.extend({
        date_from: zod_1.z.string().describe("Start date in YYYY-MM-DD format"),
        date_to: zod_1.z.string().describe("End date in YYYY-MM-DD format")
    }), async (params, client) => {
        const response = await client.post("/backlinks/timeseries_new_lost_summary/live", [params]);
        return response;
    }, apiClient);
    // Backlinks Index
    (0, tools_js_1.registerTool)(server, "backlinks_index", {}, async (_params, client) => {
        const response = await client.get("/backlinks/index");
        return response;
    }, apiClient);
    // Backlinks Status
    (0, tools_js_1.registerTool)(server, "backlinks_errors", {}, async (_params, client) => {
        const response = await client.get("/backlinks/errors");
        return response;
    }, apiClient);
    // Available Filters
    (0, tools_js_1.registerTool)(server, "backlinks_available_filters", {}, async (_params, client) => {
        const response = await client.get("/backlinks/available_filters");
        return response;
    }, apiClient);
    // ID List
    (0, tools_js_1.registerTool)(server, "backlinks_id_list", {}, async (_params, client) => {
        const response = await client.get("/backlinks/id_list");
        return response;
    }, apiClient);
    // Backlinks History
    (0, tools_js_1.registerTool)(server, "backlinks_history", targetSchema.extend({
        date_from: zod_1.z.string().optional().describe("Start date in YYYY-MM-DD format"),
        date_to: zod_1.z.string().optional().describe("End date in YYYY-MM-DD format")
    }), async (params, client) => {
        const response = await client.post("/backlinks/history/live", [params]);
        return response;
    }, apiClient);
    // Timeseries Summary
    (0, tools_js_1.registerTool)(server, "backlinks_timeseries_summary", targetSchema.extend({
        date_from: zod_1.z.string().describe("Start date in YYYY-MM-DD format"),
        date_to: zod_1.z.string().describe("End date in YYYY-MM-DD format")
    }), async (params, client) => {
        const response = await client.post("/backlinks/timeseries_summary/live", [params]);
        return response;
    }, apiClient);
    // Bulk New Lost Backlinks
    (0, tools_js_1.registerTool)(server, "backlinks_bulk_new_lost_backlinks", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).describe("List of targets to analyze (domains, subdomains, URLs)"),
        date_from: zod_1.z.string().describe("Start date in YYYY-MM-DD format"),
        date_to: zod_1.z.string().describe("End date in YYYY-MM-DD format"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per target"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        internal_list_limit: zod_1.z.number().optional().describe("Maximum number of items in internal lists per target")
    }), async (params, client) => {
        const response = await client.post("/backlinks/bulk_new_lost_backlinks/live", [params]);
        return response;
    }, apiClient);
    // Bulk New Lost Referring Domains
    (0, tools_js_1.registerTool)(server, "backlinks_bulk_new_lost_referring_domains", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).describe("List of targets to analyze (domains, subdomains, URLs)"),
        date_from: zod_1.z.string().describe("Start date in YYYY-MM-DD format"),
        date_to: zod_1.z.string().describe("End date in YYYY-MM-DD format"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per target"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        internal_list_limit: zod_1.z.number().optional().describe("Maximum number of items in internal lists per target")
    }), async (params, client) => {
        const response = await client.post("/backlinks/bulk_new_lost_referring_domains/live", [params]);
        return response;
    }, apiClient);
    // Bulk Pages Summary
    (0, tools_js_1.registerTool)(server, "backlinks_bulk_pages_summary", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).describe("List of targets to analyze (domains, subdomains, URLs)"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per target"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        internal_list_limit: zod_1.z.number().optional().describe("Maximum number of items in internal lists per target")
    }), async (params, client) => {
        const response = await client.post("/backlinks/bulk_pages_summary/live", [params]);
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map