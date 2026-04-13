"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerContentGenerationTools = registerContentGenerationTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
function registerContentGenerationTools(server, apiClient) {
    // Content Generation Generate Text
    (0, tools_js_1.registerTool)(server, "content_generation_text", zod_1.z.object({
        topic: zod_1.z.string().describe("Topic for the generated content"),
        creative_level: zod_1.z.number().min(0).max(1).optional().describe("Creative level (0-1)"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        target_audience: zod_1.z.array(zod_1.z.string()).optional().describe("Target audience"),
        text_style: zod_1.z.string().optional().describe("Text style"),
        writer_experience_level: zod_1.z.enum(["expert", "beginner", "intermediate"]).optional().describe("Writer experience level"),
        subject_experience_level: zod_1.z.enum(["expert", "beginner", "intermediate"]).optional().describe("Subject experience level"),
        text_format: zod_1.z.enum(["plain", "html"]).optional().describe("Text format")
    }), async (params, client) => {
        const response = await client.post("/content_generation/text/live", [params]);
        return response;
    }, apiClient);
    // Content Generation Generate Paraphrase
    (0, tools_js_1.registerTool)(server, "content_generation_paraphrase", zod_1.z.object({
        text: zod_1.z.string().describe("Text to paraphrase"),
        paraphrase_level: zod_1.z.number().min(1).max(3).optional().describe("Paraphrase level (1-3)"),
        creative_level: zod_1.z.number().min(0).max(1).optional().describe("Creative level (0-1)"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        language_name: zod_1.z.string().optional().describe("Language name")
    }), async (params, client) => {
        const response = await client.post("/content_generation/paraphrase/live", [params]);
        return response;
    }, apiClient);
    // Content Generation Generate Meta Tags
    (0, tools_js_1.registerTool)(server, "content_generation_meta_tags", zod_1.z.object({
        text: zod_1.z.string().optional().describe("Text to generate meta tags from"),
        url: zod_1.z.string().optional().describe("URL to extract text from"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        creative_level: zod_1.z.number().min(0).max(1).optional().describe("Creative level (0-1)")
    }), async (params, client) => {
        const response = await client.post("/content_generation/meta_tags/live", [params]);
        return response;
    }, apiClient);
    // Content Generation Generate Summarize
    (0, tools_js_1.registerTool)(server, "content_generation_summarize", zod_1.z.object({
        text: zod_1.z.string().optional().describe("Text to summarize"),
        url: zod_1.z.string().optional().describe("URL to extract text from"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        summary_size: zod_1.z.enum(["small", "medium", "large"]).optional().describe("Summary size")
    }), async (params, client) => {
        const response = await client.post("/content_generation/summarize/live", [params]);
        return response;
    }, apiClient);
    // Content Generation Generate Title
    (0, tools_js_1.registerTool)(server, "content_generation_title", zod_1.z.object({
        text: zod_1.z.string().optional().describe("Text to generate title from"),
        url: zod_1.z.string().optional().describe("URL to extract text from"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        creative_level: zod_1.z.number().min(0).max(1).optional().describe("Creative level (0-1)")
    }), async (params, client) => {
        const response = await client.post("/content_generation/title/live", [params]);
        return response;
    }, apiClient);
    // Content Generation Explain Code
    (0, tools_js_1.registerTool)(server, "content_generation_explain_code", zod_1.z.object({
        code: zod_1.z.string().describe("Code to explain"),
        language_code: zod_1.z.string().optional().describe("Language code"),
        language_name: zod_1.z.string().optional().describe("Language name"),
        code_language: zod_1.z.string().optional().describe("Programming language of the code"),
        explanation_type: zod_1.z.enum(["line_by_line", "function", "block"]).optional().describe("Type of explanation")
    }), async (params, client) => {
        const response = await client.post("/content_generation/explain_code/live", [params]);
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map