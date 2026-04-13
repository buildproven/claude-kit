"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLabsTools = registerLabsTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
// DataForSEO Labs API schemas
const keywordResearchBaseSchema = zod_1.z.object({
    keyword: zod_1.z.string().describe("Keyword(s) to research"),
    location_code: zod_1.z.number().optional().describe("The location code for the search"),
    language_code: zod_1.z.string().optional().describe("The language code for the search"),
    limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
    offset: zod_1.z.number().optional().describe("Offset for pagination"),
    include_seed_keyword: zod_1.z.boolean().optional().describe("Include the seed keyword in the results")
});
const domainResearchBaseSchema = zod_1.z.object({
    target: zod_1.z.string().describe("Target domain name"),
    location_code: zod_1.z.number().optional().describe("The location code for the search"),
    language_code: zod_1.z.string().optional().describe("The language code for the search"),
    limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
    offset: zod_1.z.number().optional().describe("Offset for pagination")
});
function registerLabsTools(server, apiClient) {
    // Keywords for Site
    (0, tools_js_1.registerTool)(server, "labs_google_keywords_for_site", domainResearchBaseSchema.extend({
        include_serp_info: zod_1.z.boolean().optional().describe("Include SERP information")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/keywords_for_site/live", [params]);
        return response;
    }, apiClient);
    // Related Keywords
    (0, tools_js_1.registerTool)(server, "labs_google_related_keywords", keywordResearchBaseSchema, async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/related_keywords/live", [params]);
        return response;
    }, apiClient);
    // Keyword Suggestions
    (0, tools_js_1.registerTool)(server, "labs_google_keyword_suggestions", keywordResearchBaseSchema, async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/keyword_suggestions/live", [params]);
        return response;
    }, apiClient);
    // Keyword Ideas
    (0, tools_js_1.registerTool)(server, "labs_google_keyword_ideas", keywordResearchBaseSchema, async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/keyword_ideas/live", [params]);
        return response;
    }, apiClient);
    // Historical Search Volume
    (0, tools_js_1.registerTool)(server, "labs_google_historical_search_volume", zod_1.z.object({
        keywords: zod_1.z.array(zod_1.z.string()).describe("Keywords to get historical search volume for"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search"),
        include_serp_info: zod_1.z.boolean().optional().describe("Include SERP information")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/historical_search_volume/live", [params]);
        return response;
    }, apiClient);
    // Bulk Keyword Difficulty
    (0, tools_js_1.registerTool)(server, "labs_google_bulk_keyword_difficulty", zod_1.z.object({
        keywords: zod_1.z.array(zod_1.z.string()).describe("Keywords to calculate difficulty for"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/bulk_keyword_difficulty/live", [params]);
        return response;
    }, apiClient);
    // Search Intent
    (0, tools_js_1.registerTool)(server, "labs_google_search_intent", zod_1.z.object({
        keywords: zod_1.z.array(zod_1.z.string()).describe("Keywords to determine search intent"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/search_intent/live", [params]);
        return response;
    }, apiClient);
    // Categories for Domain
    (0, tools_js_1.registerTool)(server, "labs_google_categories_for_domain", domainResearchBaseSchema, async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/categories_for_domain/live", [params]);
        return response;
    }, apiClient);
    // Domain Rank Overview
    (0, tools_js_1.registerTool)(server, "labs_google_domain_rank_overview", domainResearchBaseSchema, async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/domain_rank_overview/live", [params]);
        return response;
    }, apiClient);
    // Ranked Keywords
    (0, tools_js_1.registerTool)(server, "labs_google_ranked_keywords", domainResearchBaseSchema.extend({
        include_serp_info: zod_1.z.boolean().optional().describe("Include SERP information"),
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/ranked_keywords/live", [params]);
        return response;
    }, apiClient);
    // Competitors Domain
    (0, tools_js_1.registerTool)(server, "labs_google_competitors_domain", domainResearchBaseSchema.extend({
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/competitors_domain/live", [params]);
        return response;
    }, apiClient);
    // Domain Intersection
    (0, tools_js_1.registerTool)(server, "labs_google_domain_intersection", zod_1.z.object({
        domains: zod_1.z.array(zod_1.z.string()).min(2).max(20).describe("Domains to compare"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/domain_intersection/live", [params]);
        return response;
    }, apiClient);
    // Subdomains
    (0, tools_js_1.registerTool)(server, "labs_google_subdomains", domainResearchBaseSchema.extend({
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/subdomains/live", [params]);
        return response;
    }, apiClient);
    // Relevant Pages
    (0, tools_js_1.registerTool)(server, "labs_google_relevant_pages", domainResearchBaseSchema.extend({
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/relevant_pages/live", [params]);
        return response;
    }, apiClient);
    // Bulk Traffic Estimation
    (0, tools_js_1.registerTool)(server, "labs_google_bulk_traffic_estimation", zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.string()).describe("Domains to estimate traffic for"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google/bulk_traffic_estimation/live", [params]);
        return response;
    }, apiClient);
    // === AMAZON LABS API ===
    // Amazon Bulk Search Volume
    (0, tools_js_1.registerTool)(server, "labs_amazon_bulk_search_volume", zod_1.z.object({
        keywords: zod_1.z.array(zod_1.z.string()).describe("Keywords to get search volume for"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/amazon/bulk_search_volume/live", [params]);
        return response;
    }, apiClient);
    // Amazon Related Keywords
    (0, tools_js_1.registerTool)(server, "labs_amazon_related_keywords", keywordResearchBaseSchema.extend({
        marketplace: zod_1.z.string().optional().describe("Amazon marketplace (e.g., amazon.com)")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/amazon/related_keywords/live", [params]);
        return response;
    }, apiClient);
    // Amazon Ranked Keywords
    (0, tools_js_1.registerTool)(server, "labs_amazon_ranked_keywords", zod_1.z.object({
        target: zod_1.z.string().describe("Target ASIN or Amazon domain"),
        marketplace: zod_1.z.string().optional().describe("Amazon marketplace (e.g., amazon.com)"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/amazon/ranked_keywords/live", [params]);
        return response;
    }, apiClient);
    // Amazon Product Competitors
    (0, tools_js_1.registerTool)(server, "labs_amazon_product_competitors", zod_1.z.object({
        asin: zod_1.z.string().describe("Target Amazon ASIN"),
        marketplace: zod_1.z.string().optional().describe("Amazon marketplace (e.g., amazon.com)"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/amazon/product_competitors/live", [params]);
        return response;
    }, apiClient);
    // === BING LABS API ===
    // Bing Keywords for Site
    (0, tools_js_1.registerTool)(server, "labs_bing_keywords_for_site", domainResearchBaseSchema.extend({
        include_serp_info: zod_1.z.boolean().optional().describe("Include SERP information")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/bing/keywords_for_site/live", [params]);
        return response;
    }, apiClient);
    // Bing Related Keywords
    (0, tools_js_1.registerTool)(server, "labs_bing_related_keywords", keywordResearchBaseSchema, async (params, client) => {
        const response = await client.post("/dataforseo_labs/bing/related_keywords/live", [params]);
        return response;
    }, apiClient);
    // Bing Domain Rank Overview
    (0, tools_js_1.registerTool)(server, "labs_bing_domain_rank_overview", domainResearchBaseSchema, async (params, client) => {
        const response = await client.post("/dataforseo_labs/bing/domain_rank_overview/live", [params]);
        return response;
    }, apiClient);
    // Bing Ranked Keywords
    (0, tools_js_1.registerTool)(server, "labs_bing_ranked_keywords", domainResearchBaseSchema.extend({
        include_serp_info: zod_1.z.boolean().optional().describe("Include SERP information"),
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/bing/ranked_keywords/live", [params]);
        return response;
    }, apiClient);
    // Bing Competitors Domain
    (0, tools_js_1.registerTool)(server, "labs_bing_competitors_domain", domainResearchBaseSchema.extend({
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/bing/competitors_domain/live", [params]);
        return response;
    }, apiClient);
    // === GOOGLE PLAY AND APP STORE LABS API ===
    // Google Play Keywords for App
    (0, tools_js_1.registerTool)(server, "labs_google_play_keywords_for_app", zod_1.z.object({
        app_id: zod_1.z.string().describe("Google Play app ID"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google_play/keywords_for_app/live", [params]);
        return response;
    }, apiClient);
    // Google Play Ranked Apps
    (0, tools_js_1.registerTool)(server, "labs_google_play_ranked_apps", keywordResearchBaseSchema.extend({
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google_play/ranked_apps/live", [params]);
        return response;
    }, apiClient);
    // Google Play App Competitors
    (0, tools_js_1.registerTool)(server, "labs_google_play_app_competitors", zod_1.z.object({
        app_id: zod_1.z.string().describe("Google Play app ID"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/google_play/app_competitors/live", [params]);
        return response;
    }, apiClient);
    // App Store Keywords for App
    (0, tools_js_1.registerTool)(server, "labs_app_store_keywords_for_app", zod_1.z.object({
        app_id: zod_1.z.string().describe("App Store app ID"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/app_store/keywords_for_app/live", [params]);
        return response;
    }, apiClient);
    // App Store Ranked Apps
    (0, tools_js_1.registerTool)(server, "labs_app_store_ranked_apps", keywordResearchBaseSchema.extend({
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Filters to apply to the results")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/app_store/ranked_apps/live", [params]);
        return response;
    }, apiClient);
    // App Store App Competitors
    (0, tools_js_1.registerTool)(server, "labs_app_store_app_competitors", zod_1.z.object({
        app_id: zod_1.z.string().describe("App Store app ID"),
        location_code: zod_1.z.number().optional().describe("The location code for the search"),
        language_code: zod_1.z.string().optional().describe("The language code for the search"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/dataforseo_labs/app_store/app_competitors/live", [params]);
        return response;
    }, apiClient);
    // === META ENDPOINTS FOR LABS API ===
    // Categories
    (0, tools_js_1.registerTool)(server, "labs_categories", zod_1.z.object({
        engine: zod_1.z.enum(["google", "amazon", "bing", "google_play", "app_store"]).describe("Engine to get categories for"),
        category_code: zod_1.z.number().optional().describe("Parent category code"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const url = `/dataforseo_labs/${params.engine}/categories`;
        const queryParams = [];
        if (params.category_code) {
            queryParams.push(`category_code=${params.category_code}`);
        }
        if (params.language_code) {
            queryParams.push(`language_code=${params.language_code}`);
        }
        const fullUrl = queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url;
        const response = await client.get(fullUrl);
        return response;
    }, apiClient);
    // Locations
    (0, tools_js_1.registerTool)(server, "labs_locations", zod_1.z.object({
        engine: zod_1.z.enum(["google", "amazon", "bing", "google_play", "app_store"]).describe("Engine to get locations for"),
        country: zod_1.z.string().optional().describe("Filter locations by country name")
    }), async (params, client) => {
        const url = `/dataforseo_labs/${params.engine}/locations`;
        const queryParams = [];
        if (params.country) {
            queryParams.push(`country=${encodeURIComponent(params.country)}`);
        }
        const fullUrl = queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url;
        const response = await client.get(fullUrl);
        return response;
    }, apiClient);
    // Languages
    (0, tools_js_1.registerTool)(server, "labs_languages", zod_1.z.object({
        engine: zod_1.z.enum(["google", "amazon", "bing", "google_play", "app_store"]).describe("Engine to get languages for")
    }), async (params, client) => {
        const url = `/dataforseo_labs/${params.engine}/languages`;
        const response = await client.get(url);
        return response;
    }, apiClient);
    // Available History
    (0, tools_js_1.registerTool)(server, "labs_available_history", zod_1.z.object({
        engine: zod_1.z.enum(["google", "amazon", "bing", "google_play", "app_store"]).describe("Engine to get available history for"),
        function: zod_1.z.string().describe("Function name (e.g., keywords_for_site, serp)")
    }), async (params, client) => {
        const url = `/dataforseo_labs/${params.engine}/available_history/${params.function}`;
        const response = await client.get(url);
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map