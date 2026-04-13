"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppDataTools = registerAppDataTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
function registerAppDataTools(server, apiClient) {
    // App Data Google Play Search
    (0, tools_js_1.registerTool)(server, "app_data_google_play_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("App name or related keyword"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/app_data/google_play/search/live", [params]);
        return response;
    }, apiClient);
    // App Data Google Play App Info
    (0, tools_js_1.registerTool)(server, "app_data_google_play_app_info", zod_1.z.object({
        app_id: zod_1.z.string().describe("Google Play App ID"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/app_data/google_play/app_info/live", [params]);
        return response;
    }, apiClient);
    // App Data Google Play Reviews
    (0, tools_js_1.registerTool)(server, "app_data_google_play_reviews", zod_1.z.object({
        app_id: zod_1.z.string().describe("Google Play App ID"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        depth: zod_1.z.number().optional().describe("Number of reviews to retrieve"),
        sort_by: zod_1.z.enum(["most_relevant", "newest"]).optional().describe("Sorting method"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/app_data/google_play/reviews/live", [params]);
        return response;
    }, apiClient);
    // App Data Google Play Locations
    (0, tools_js_1.registerTool)(server, "app_data_google_play_locations", zod_1.z.object({
        country: zod_1.z.string().optional().describe("Filter locations by country name")
    }), async (params, client) => {
        const url = params.country
            ? `/app_data/google_play/locations?country=${encodeURIComponent(params.country)}`
            : "/app_data/google_play/locations";
        const response = await client.get(url);
        return response;
    }, apiClient);
    // App Data Google Play Languages
    (0, tools_js_1.registerTool)(server, "app_data_google_play_languages", {}, async (_params, client) => {
        const response = await client.get("/app_data/google_play/languages");
        return response;
    }, apiClient);
    // App Data App Store Search
    (0, tools_js_1.registerTool)(server, "app_data_app_store_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("App name or related keyword"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/app_data/apple/search/live", [params]);
        return response;
    }, apiClient);
    // App Data App Store App Info
    (0, tools_js_1.registerTool)(server, "app_data_app_store_app_info", zod_1.z.object({
        app_id: zod_1.z.string().describe("App Store App ID"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/app_data/apple/app_info/live", [params]);
        return response;
    }, apiClient);
    // App Data App Store Reviews
    (0, tools_js_1.registerTool)(server, "app_data_app_store_reviews", zod_1.z.object({
        app_id: zod_1.z.string().describe("App Store App ID"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        depth: zod_1.z.number().optional().describe("Number of reviews to retrieve"),
        sort_by: zod_1.z.enum(["most_relevant", "most_recent"]).optional().describe("Sorting method"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/app_data/apple/reviews/live", [params]);
        return response;
    }, apiClient);
    // App Data App Store Locations
    (0, tools_js_1.registerTool)(server, "app_data_app_store_locations", zod_1.z.object({
        country: zod_1.z.string().optional().describe("Filter locations by country name")
    }), async (params, client) => {
        const url = params.country
            ? `/app_data/apple/locations?country=${encodeURIComponent(params.country)}`
            : "/app_data/apple/locations";
        const response = await client.get(url);
        return response;
    }, apiClient);
    // App Data App Store Languages
    (0, tools_js_1.registerTool)(server, "app_data_app_store_languages", {}, async (_params, client) => {
        const response = await client.get("/app_data/apple/languages");
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map