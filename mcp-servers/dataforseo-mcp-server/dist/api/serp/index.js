"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSerpTools = registerSerpTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
// SERP Google Organic API schemas
const googleOrganicLiveSchema = zod_1.z.object({
    keyword: zod_1.z.string().describe("The search query or keyword"),
    location_code: zod_1.z.number().describe("The location code for the search"),
    language_code: zod_1.z.string().describe("The language code for the search"),
    device: zod_1.z.enum(["desktop", "mobile", "tablet"]).optional().describe("The device type for the search"),
    os: zod_1.z.enum(["windows", "macos", "ios", "android"]).optional().describe("The operating system for the search"),
    depth: zod_1.z.number().optional().describe("Maximum number of results to return"),
    se_domain: zod_1.z.string().optional().describe("Search engine domain (e.g., google.com)")
});
const googleOrganicTaskSchema = googleOrganicLiveSchema.extend({
    priority: zod_1.z.number().min(1).max(2).optional().describe("Task priority: 1 (normal) or 2 (high)"),
    tag: zod_1.z.string().optional().describe("Custom identifier for the task"),
    postback_url: zod_1.z.string().optional().describe("URL to receive a callback when the task is completed"),
    postback_data: zod_1.z.string().optional().describe("Custom data to be passed in the callback")
});
function registerSerpTools(server, apiClient) {
    // Google Organic Live
    (0, tools_js_1.registerTool)(server, "serp_google_organic_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/google/organic/live", [params]);
        return response;
    }, apiClient);
    // Google Organic Task-based (POST, READY, GET)
    (0, tools_js_1.registerTaskTool)(server, "serp_google_organic_task", googleOrganicTaskSchema, async (params, client) => {
        const response = await client.post("/serp/google/organic/task_post", [params]);
        return response;
    }, async (client) => {
        const response = await client.get("/serp/google/organic/tasks_ready");
        return response;
    }, async (id, client) => {
        const response = await client.get(`/serp/google/organic/task_get/${id}`);
        return response;
    }, apiClient);
    // Google Maps Live
    (0, tools_js_1.registerTool)(server, "serp_google_maps_live", googleOrganicLiveSchema.extend({
        local_pack_type: zod_1.z.enum(["maps", "local_pack"]).optional().describe("Type of local pack results")
    }), async (params, client) => {
        const response = await client.post("/serp/google/maps/live/advanced", [params]);
        return response;
    }, apiClient);
    // Google Images Live
    (0, tools_js_1.registerTool)(server, "serp_google_images_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/google/images/live", [params]);
        return response;
    }, apiClient);
    // Google News Live
    (0, tools_js_1.registerTool)(server, "serp_google_news_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/google/news/live", [params]);
        return response;
    }, apiClient);
    // Google Jobs Live
    (0, tools_js_1.registerTool)(server, "serp_google_jobs_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/google/jobs/live", [params]);
        return response;
    }, apiClient);
    // Google Shopping Live
    (0, tools_js_1.registerTool)(server, "serp_google_shopping_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/google/shopping/live", [params]);
        return response;
    }, apiClient);
    // Bing Organic Live
    (0, tools_js_1.registerTool)(server, "serp_bing_organic_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/bing/organic/live", [params]);
        return response;
    }, apiClient);
    // Yahoo Organic Live
    (0, tools_js_1.registerTool)(server, "serp_yahoo_organic_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/yahoo/organic/live", [params]);
        return response;
    }, apiClient);
    // Baidu Organic Live
    (0, tools_js_1.registerTool)(server, "serp_baidu_organic_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/baidu/organic/live", [params]);
        return response;
    }, apiClient);
    // YouTube Organic Live
    (0, tools_js_1.registerTool)(server, "serp_youtube_organic_live", googleOrganicLiveSchema, async (params, client) => {
        const response = await client.post("/serp/youtube/organic/live", [params]);
        return response;
    }, apiClient);
    // SERP API Locations
    (0, tools_js_1.registerTool)(server, "serp_google_locations", {
        country: zod_1.z.string().optional().describe("Filter locations by country name")
    }, async (params, client) => {
        const url = params.country
            ? `/serp/google/locations?country=${encodeURIComponent(params.country)}`
            : "/serp/google/locations";
        const response = await client.get(url);
        return response;
    }, apiClient);
    // SERP API Languages
    (0, tools_js_1.registerTool)(server, "serp_google_languages", {}, async (_params, client) => {
        const response = await client.get("/serp/google/languages");
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map