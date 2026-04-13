"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBusinessDataTools = registerBusinessDataTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
function registerBusinessDataTools(server, apiClient) {
    // Business Data Google My Business Info
    (0, tools_js_1.registerTool)(server, "business_data_google_my_business_info", zod_1.z.object({
        keyword: zod_1.z.string().describe("Business name or related keyword"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/google/my_business_info/live", [params]);
        return response;
    }, apiClient);
    // Business Data Google Reviews
    (0, tools_js_1.registerTool)(server, "business_data_google_reviews", zod_1.z.object({
        keyword: zod_1.z.string().optional().describe("Business name or related keyword"),
        place_id: zod_1.z.string().optional().describe("Google Place ID"),
        depth: zod_1.z.number().optional().describe("Number of reviews to retrieve"),
        sort_by: zod_1.z.enum(["relevance", "newest"]).optional().describe("Sorting method"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/google/reviews/live", [params]);
        return response;
    }, apiClient);
    // Business Data Google Locations
    (0, tools_js_1.registerTool)(server, "business_data_google_locations", zod_1.z.object({
        country: zod_1.z.string().optional().describe("Filter locations by country name")
    }), async (params, client) => {
        const url = params.country
            ? `/business_data/google/locations?country=${encodeURIComponent(params.country)}`
            : "/business_data/google/locations";
        const response = await client.get(url);
        return response;
    }, apiClient);
    // Business Data Google Languages
    (0, tools_js_1.registerTool)(server, "business_data_google_languages", {}, async (_params, client) => {
        const response = await client.get("/business_data/google/languages");
        return response;
    }, apiClient);
    // Business Data TripAdvisor Search
    (0, tools_js_1.registerTool)(server, "business_data_tripadvisor_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("Business name or related keyword"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        priority: zod_1.z.number().min(1).max(2).optional().describe("Priority: 1 (normal) or 2 (high)"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/business_data/tripadvisor/search/live", [params]);
        return response;
    }, apiClient);
    // Business Data TripAdvisor Reviews
    (0, tools_js_1.registerTool)(server, "business_data_tripadvisor_reviews", zod_1.z.object({
        location_id: zod_1.z.string().describe("TripAdvisor location ID"),
        depth: zod_1.z.number().optional().describe("Number of reviews to retrieve"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        sort_by: zod_1.z.enum(["relevance", "date_of_visit"]).optional().describe("Sorting method"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/tripadvisor/reviews/live", [params]);
        return response;
    }, apiClient);
    // Business Data Trustpilot Search
    (0, tools_js_1.registerTool)(server, "business_data_trustpilot_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("Business name or related keyword"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/trustpilot/search/live", [params]);
        return response;
    }, apiClient);
    // Business Data Trustpilot Reviews
    (0, tools_js_1.registerTool)(server, "business_data_trustpilot_reviews", zod_1.z.object({
        domain: zod_1.z.string().describe("Business domain"),
        depth: zod_1.z.number().optional().describe("Number of reviews to retrieve"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        sort_by: zod_1.z.enum(["recency", "relevance"]).optional().describe("Sorting method"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/trustpilot/reviews/live", [params]);
        return response;
    }, apiClient);
    // === ADDED SOCIAL MEDIA ENDPOINTS ===
    // Business Data Facebook Search
    (0, tools_js_1.registerTool)(server, "business_data_facebook_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("Business name or related keyword"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/business_data/facebook/search/live", [params]);
        return response;
    }, apiClient);
    // Business Data Facebook Overview
    (0, tools_js_1.registerTool)(server, "business_data_facebook_overview", zod_1.z.object({
        id: zod_1.z.string().describe("Facebook business ID"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/facebook/overview/live", [params]);
        return response;
    }, apiClient);
    // Business Data Pinterest Search
    (0, tools_js_1.registerTool)(server, "business_data_pinterest_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("Business name or related keyword"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/business_data/pinterest/search/live", [params]);
        return response;
    }, apiClient);
    // Business Data Pinterest Info
    (0, tools_js_1.registerTool)(server, "business_data_pinterest_info", zod_1.z.object({
        url: zod_1.z.string().describe("Pinterest business URL"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/pinterest/info/live", [params]);
        return response;
    }, apiClient);
    // Business Data Reddit Search
    (0, tools_js_1.registerTool)(server, "business_data_reddit_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("Keyword to search on Reddit"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        sort_by: zod_1.z.enum(["relevance", "hot", "top", "new"]).optional().describe("Sorting method"),
        search_type: zod_1.z.enum(["communities", "posts"]).optional().describe("Type of search to perform")
    }), async (params, client) => {
        const response = await client.post("/business_data/reddit/search/live", [params]);
        return response;
    }, apiClient);
    // Business Data Reddit Info
    (0, tools_js_1.registerTool)(server, "business_data_reddit_info", zod_1.z.object({
        url: zod_1.z.string().describe("Reddit URL (subreddit, post, etc.)"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/reddit/info/live", [params]);
        return response;
    }, apiClient);
    // === GOOGLE HOTELS ENDPOINTS ===
    // Business Data Google Hotels Search
    (0, tools_js_1.registerTool)(server, "business_data_google_hotels_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("Hotel name or related keyword"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        check_in: zod_1.z.string().optional().describe("Check-in date in YYYY-MM-DD format"),
        check_out: zod_1.z.string().optional().describe("Check-out date in YYYY-MM-DD format"),
        guests: zod_1.z.number().optional().describe("Number of guests"),
        currency: zod_1.z.string().optional().describe("Currency code"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/google/hotels/search/live", [params]);
        return response;
    }, apiClient);
    // Business Data Google Hotels Info
    (0, tools_js_1.registerTool)(server, "business_data_google_hotels_info", zod_1.z.object({
        hotel_id: zod_1.z.string().describe("Google hotel ID"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        check_in: zod_1.z.string().optional().describe("Check-in date in YYYY-MM-DD format"),
        check_out: zod_1.z.string().optional().describe("Check-out date in YYYY-MM-DD format"),
        guests: zod_1.z.number().optional().describe("Number of guests"),
        currency: zod_1.z.string().optional().describe("Currency code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/google/hotels/info/live", [params]);
        return response;
    }, apiClient);
    // Business Data Google Hotels Reviews
    (0, tools_js_1.registerTool)(server, "business_data_google_hotels_reviews", zod_1.z.object({
        hotel_id: zod_1.z.string().describe("Google hotel ID"),
        depth: zod_1.z.number().optional().describe("Number of reviews to retrieve"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        sort_by: zod_1.z.enum(["relevance", "newest"]).optional().describe("Sorting method"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/google/hotels/reviews/live", [params]);
        return response;
    }, apiClient);
    // === BUSINESS LISTINGS ENDPOINTS ===
    // Business Data Business Listings Search
    (0, tools_js_1.registerTool)(server, "business_data_business_listings_search", zod_1.z.object({
        keyword: zod_1.z.string().describe("Business name or related keyword"),
        location_name: zod_1.z.string().optional().describe("Location name"),
        location_code: zod_1.z.number().optional().describe("Location code"),
        depth: zod_1.z.number().optional().describe("Number of results to return"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return per page"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/business_data/business_listings/search/live", [params]);
        return response;
    }, apiClient);
    // Business Data Business Listings Categories
    (0, tools_js_1.registerTool)(server, "business_data_business_listings_categories", zod_1.z.object({
        country: zod_1.z.string().optional().describe("Filter categories by country")
    }), async (params, client) => {
        const url = params.country
            ? `/business_data/business_listings/categories?country=${encodeURIComponent(params.country)}`
            : "/business_data/business_listings/categories";
        const response = await client.get(url);
        return response;
    }, apiClient);
    // Business Data Business Listings Locations
    (0, tools_js_1.registerTool)(server, "business_data_business_listings_locations", zod_1.z.object({
        country: zod_1.z.string().optional().describe("Filter locations by country name")
    }), async (params, client) => {
        const url = params.country
            ? `/business_data/business_listings/locations?country=${encodeURIComponent(params.country)}`
            : "/business_data/business_listings/locations";
        const response = await client.get(url);
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map