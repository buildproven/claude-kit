"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAiOptimizationTools = registerAiOptimizationTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
// Common schemas
const messageChainItemSchema = zod_1.z.object({
    role: zod_1.z.enum(["user", "ai"]).describe("Role in the conversation"),
    message: zod_1.z.string().max(500).describe("Message content")
});
const llmResponseBaseSchema = zod_1.z.object({
    user_prompt: zod_1.z.string().max(500).describe("Prompt for the AI model"),
    model_name: zod_1.z.string().describe("Name of the AI model"),
    max_output_tokens: zod_1.z.number().min(16).max(4096).optional().describe("Maximum number of tokens in the AI response"),
    temperature: zod_1.z.number().min(0).max(2).optional().describe("Randomness of the AI response (0-2, default: 0.94)"),
    top_p: zod_1.z.number().min(0).max(1).optional().describe("Diversity of the AI response (0-1, default: 0.92)"),
    web_search: zod_1.z.boolean().optional().describe("Enable web search"),
    force_web_search: zod_1.z.boolean().optional().describe("Force AI to use web search"),
    web_search_country_iso_code: zod_1.z.string().optional().describe("ISO country code for web search"),
    web_search_city: zod_1.z.string().optional().describe("City name for web search"),
    system_message: zod_1.z.string().max(500).optional().describe("Instructions for AI behavior"),
    message_chain: zod_1.z.array(messageChainItemSchema).max(10).optional().describe("Conversation history"),
    tag: zod_1.z.string().max(255).optional().describe("User-defined task identifier")
});
const llmResponseTaskSchema = llmResponseBaseSchema.extend({
    priority: zod_1.z.number().min(1).max(2).optional().describe("Task priority: 1 (normal) or 2 (high)"),
    postback_url: zod_1.z.string().optional().describe("URL to receive a callback when the task is completed"),
    postback_data: zod_1.z.string().optional().describe("Custom data to be passed in the callback")
});
const llmScraperTaskSchema = zod_1.z.object({
    keyword: zod_1.z.string().max(512).describe("Search query or keyword"),
    location_name: zod_1.z.string().optional().describe("Full name of location"),
    location_code: zod_1.z.number().optional().describe("Unique location identifier"),
    language_name: zod_1.z.string().optional().describe("Full name of language"),
    language_code: zod_1.z.string().optional().describe("Language code"),
    priority: zod_1.z.number().min(1).max(2).optional().describe("Task priority: 1 (normal) or 2 (high)"),
    tag: zod_1.z.string().max(255).optional().describe("User-defined task identifier"),
    postback_url: zod_1.z.string().optional().describe("URL to receive a callback when the task is completed"),
    postback_data: zod_1.z.string().optional().describe("Custom data to be passed in the callback")
});
function registerAiOptimizationTools(server, apiClient) {
    // ============================================
    // ChatGPT LLM Responses
    // ============================================
    // ChatGPT Models List
    (0, tools_js_1.registerTool)(server, "ai_chatgpt_models", {}, async (_params, client) => {
        const response = await client.get("/ai_optimization/chat_gpt/llm_responses/models");
        return response;
    }, apiClient);
    // ChatGPT LLM Responses Live
    (0, tools_js_1.registerTool)(server, "ai_chatgpt_llm_responses_live", llmResponseBaseSchema, async (params, client) => {
        const response = await client.post("/ai_optimization/chat_gpt/llm_responses/live", [params]);
        return response;
    }, apiClient);
    // ChatGPT LLM Responses Task-based (POST, READY, GET)
    (0, tools_js_1.registerTaskTool)(server, "ai_chatgpt_llm_responses_task", llmResponseTaskSchema, async (params, client) => {
        const response = await client.post("/ai_optimization/chat_gpt/llm_responses/task_post", [params]);
        return response;
    }, async (client) => {
        const response = await client.get("/ai_optimization/chat_gpt/llm_responses/tasks_ready");
        return response;
    }, async (id, client) => {
        const response = await client.get(`/ai_optimization/chat_gpt/llm_responses/task_get/${id}`);
        return response;
    }, apiClient);
    // ============================================
    // ChatGPT LLM Scraper
    // ============================================
    // ChatGPT Scraper Locations
    (0, tools_js_1.registerTool)(server, "ai_chatgpt_scraper_locations", {}, async (_params, client) => {
        const response = await client.get("/ai_optimization/chat_gpt/llm_scraper/locations");
        return response;
    }, apiClient);
    // ChatGPT Scraper Locations by Country
    (0, tools_js_1.registerTool)(server, "ai_chatgpt_scraper_locations_country", zod_1.z.object({
        country: zod_1.z.string().describe("Country code (e.g., 'us', 'uk', 'fr')")
    }), async (params, client) => {
        const response = await client.get(`/ai_optimization/chat_gpt/llm_scraper/locations/${params.country}`);
        return response;
    }, apiClient);
    // ChatGPT Scraper Languages
    (0, tools_js_1.registerTool)(server, "ai_chatgpt_scraper_languages", {}, async (_params, client) => {
        const response = await client.get("/ai_optimization/chat_gpt/llm_scraper/languages");
        return response;
    }, apiClient);
    // ChatGPT Scraper Task-based (POST, READY, GET Advanced, GET HTML)
    (0, tools_js_1.registerTaskTool)(server, "ai_chatgpt_scraper_task", llmScraperTaskSchema, async (params, client) => {
        const response = await client.post("/ai_optimization/chat_gpt/llm_scraper/task_post", [params]);
        return response;
    }, async (client) => {
        const response = await client.get("/ai_optimization/chat_gpt/llm_scraper/tasks_ready");
        return response;
    }, async (id, client) => {
        const response = await client.get(`/ai_optimization/chat_gpt/llm_scraper/task_get/advanced/${id}`);
        return response;
    }, apiClient);
    // ChatGPT Scraper Task Get HTML
    (0, tools_js_1.registerTool)(server, "ai_chatgpt_scraper_task_get_html", zod_1.z.object({
        id: zod_1.z.string().describe("Task identifier in UUID format")
    }), async (params, client) => {
        const response = await client.get(`/ai_optimization/chat_gpt/llm_scraper/task_get/html/${params.id}`);
        return response;
    }, apiClient);
    // ============================================
    // Claude LLM Responses
    // ============================================
    // Claude Models List
    (0, tools_js_1.registerTool)(server, "ai_claude_models", {}, async (_params, client) => {
        const response = await client.get("/ai_optimization/claude/llm_responses/models");
        return response;
    }, apiClient);
    // Claude LLM Responses Live
    (0, tools_js_1.registerTool)(server, "ai_claude_llm_responses_live", llmResponseBaseSchema, async (params, client) => {
        const response = await client.post("/ai_optimization/claude/llm_responses/live", [params]);
        return response;
    }, apiClient);
    // Claude LLM Responses Task-based (POST, READY, GET)
    (0, tools_js_1.registerTaskTool)(server, "ai_claude_llm_responses_task", llmResponseTaskSchema, async (params, client) => {
        const response = await client.post("/ai_optimization/claude/llm_responses/task_post", [params]);
        return response;
    }, async (client) => {
        const response = await client.get("/ai_optimization/claude/llm_responses/tasks_ready");
        return response;
    }, async (id, client) => {
        const response = await client.get(`/ai_optimization/claude/llm_responses/task_get/${id}`);
        return response;
    }, apiClient);
    // ============================================
    // Gemini LLM Responses
    // ============================================
    // Gemini Models List
    (0, tools_js_1.registerTool)(server, "ai_gemini_models", {}, async (_params, client) => {
        const response = await client.get("/ai_optimization/gemini/llm_responses/models");
        return response;
    }, apiClient);
    // Gemini LLM Responses Live
    (0, tools_js_1.registerTool)(server, "ai_gemini_llm_responses_live", llmResponseBaseSchema, async (params, client) => {
        const response = await client.post("/ai_optimization/gemini/llm_responses/live", [params]);
        return response;
    }, apiClient);
    // ============================================
    // Perplexity LLM Responses
    // ============================================
    // Perplexity Models List
    (0, tools_js_1.registerTool)(server, "ai_perplexity_models", {}, async (_params, client) => {
        const response = await client.get("/ai_optimization/perplexity/llm_responses/models");
        return response;
    }, apiClient);
    // Perplexity LLM Responses Live
    (0, tools_js_1.registerTool)(server, "ai_perplexity_llm_responses_live", llmResponseBaseSchema, async (params, client) => {
        const response = await client.post("/ai_optimization/perplexity/llm_responses/live", [params]);
        return response;
    }, apiClient);
    // ============================================
    // AI Keyword Data
    // ============================================
    // AI Keyword Data Available Filters
    (0, tools_js_1.registerTool)(server, "ai_keyword_data_available_filters", {}, async (_params, client) => {
        const response = await client.get("/ai_optimization/ai_keyword_data/available_filters");
        return response;
    }, apiClient);
    // AI Keyword Data Locations and Languages
    (0, tools_js_1.registerTool)(server, "ai_keyword_data_locations_and_languages", {}, async (_params, client) => {
        const response = await client.get("/ai_optimization/ai_keyword_data/locations_and_languages");
        return response;
    }, apiClient);
    // AI Keyword Data Keywords Search Volume Live
    (0, tools_js_1.registerTool)(server, "ai_keyword_data_search_volume_live", zod_1.z.object({
        keywords: zod_1.z.array(zod_1.z.string()).min(1).max(1000).describe("Keywords to get search volume for"),
        location_name: zod_1.z.string().optional().describe("Full name of location"),
        location_code: zod_1.z.number().optional().describe("Unique location identifier"),
        language_name: zod_1.z.string().optional().describe("Full name of language"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Array of filter objects"),
        tag: zod_1.z.string().max(255).optional().describe("User-defined task identifier")
    }), async (params, client) => {
        const response = await client.post("/ai_optimization/ai_keyword_data/keywords_search_volume/live", [params]);
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map