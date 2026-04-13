"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerContentAnalysisTools = registerContentAnalysisTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
function registerContentAnalysisTools(server, apiClient) {
    // Content Analysis Summary
    (0, tools_js_1.registerTool)(server, "content_analysis_summary", zod_1.z.object({
        url: zod_1.z.string().describe("URL to analyze"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        calculate_sentiment: zod_1.z.boolean().optional().describe("Calculate sentiment"),
        calculate_toxicity: zod_1.z.boolean().optional().describe("Calculate toxicity"),
        calculate_readability: zod_1.z.boolean().optional().describe("Calculate readability"),
        calculate_keyword_density: zod_1.z.boolean().optional().describe("Calculate keyword density"),
        calculate_information_score: zod_1.z.boolean().optional().describe("Calculate information score"),
        calculate_adult_score: zod_1.z.boolean().optional().describe("Calculate adult score")
    }), async (params, client) => {
        const response = await client.post("/content_analysis/summary/live", [params]);
        return response;
    }, apiClient);
    // Content Analysis Search
    (0, tools_js_1.registerTool)(server, "content_analysis_search", zod_1.z.object({
        query: zod_1.z.string().describe("Search query"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        search_mode: zod_1.z.enum(["web", "news"]).optional().describe("Search mode"),
        calculate_sentiment: zod_1.z.boolean().optional().describe("Calculate sentiment"),
        calculate_toxicity: zod_1.z.boolean().optional().describe("Calculate toxicity"),
        calculate_readability: zod_1.z.boolean().optional().describe("Calculate readability"),
        calculate_information_score: zod_1.z.boolean().optional().describe("Calculate information score"),
        calculate_keyword_density: zod_1.z.boolean().optional().describe("Calculate keyword density"),
        calculate_adult_score: zod_1.z.boolean().optional().describe("Calculate adult score"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const response = await client.post("/content_analysis/search/live", [params]);
        return response;
    }, apiClient);
    // Content Analysis Category
    (0, tools_js_1.registerTool)(server, "content_analysis_category", zod_1.z.object({
        url: zod_1.z.string().describe("URL to categorize"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/content_analysis/category/live", [params]);
        return response;
    }, apiClient);
    // Content Analysis Sentiment Analysis
    (0, tools_js_1.registerTool)(server, "content_analysis_sentiment_analysis", zod_1.z.object({
        text: zod_1.z.string().describe("Text to analyze"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        language_code: zod_1.z.string().optional().describe("Language code")
    }), async (params, client) => {
        const response = await client.post("/content_analysis/sentiment_analysis/live", [params]);
        return response;
    }, apiClient);
    // Content Analysis Rating Distribution
    (0, tools_js_1.registerTool)(server, "content_analysis_rating_distribution", zod_1.z.object({
        rating_values: zod_1.z.array(zod_1.z.number()).describe("Array of rating values"),
        algo: zod_1.z.enum(["percentile", "linear", "exponential"]).optional().describe("Algorithm for distribution calculation")
    }), async (params, client) => {
        const response = await client.post("/content_analysis/rating_distribution/live", [params]);
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map