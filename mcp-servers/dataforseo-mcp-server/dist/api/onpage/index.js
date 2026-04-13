"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOnPageTools = registerOnPageTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
function registerOnPageTools(server, apiClient) {
    // OnPage Task Post
    (0, tools_js_1.registerTool)(server, "onpage_task_post", zod_1.z.object({
        target: zod_1.z.string().describe("Target URL to analyze"),
        max_crawl_pages: zod_1.z.number().optional().describe("Maximum number of pages to crawl"),
        load_resources: zod_1.z.boolean().optional().describe("Load page resources"),
        enable_javascript: zod_1.z.boolean().optional().describe("Enable JavaScript execution"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return")
    }), async (params, client) => {
        const response = await client.post("/on_page/task_post", [params]);
        return response;
    }, apiClient);
    // OnPage Tasks Ready
    (0, tools_js_1.registerTool)(server, "onpage_tasks_ready", {}, async (_params, client) => {
        const response = await client.get("/on_page/tasks_ready");
        return response;
    }, apiClient);
    // OnPage Task Result Summary
    (0, tools_js_1.registerTool)(server, "onpage_summary", zod_1.z.object({
        id: zod_1.z.string().describe("Task ID")
    }), async (params, client) => {
        const response = await client.get(`/on_page/summary/${params.id}`);
        return response;
    }, apiClient);
    // OnPage Task Result Pages
    (0, tools_js_1.registerTool)(server, "onpage_pages", zod_1.z.object({
        id: zod_1.z.string().describe("Task ID"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Array of filter objects")
    }), async (params, client) => {
        const { id, ...restParams } = params;
        const response = await client.post(`/on_page/pages/${id}`, [restParams]);
        return response;
    }, apiClient);
    // OnPage Task Result Resources
    (0, tools_js_1.registerTool)(server, "onpage_resources", zod_1.z.object({
        id: zod_1.z.string().describe("Task ID"),
        url: zod_1.z.string().describe("URL of the page to get resources for"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination"),
        filters: zod_1.z.array(zod_1.z.any()).optional().describe("Array of filter objects")
    }), async (params, client) => {
        const { id, ...restParams } = params;
        const response = await client.post(`/on_page/resources/${id}`, [restParams]);
        return response;
    }, apiClient);
    // OnPage Task Force Stop
    (0, tools_js_1.registerTool)(server, "onpage_task_force_stop", zod_1.z.object({
        id: zod_1.z.string().describe("Task ID")
    }), async (params, client) => {
        const response = await client.post("/on_page/task_force_stop", [{ id: params.id }]);
        return response;
    }, apiClient);
    // OnPage Duplicate Content
    (0, tools_js_1.registerTool)(server, "onpage_duplicate_content", zod_1.z.object({
        id: zod_1.z.string().describe("Task ID"),
        limit: zod_1.z.number().optional().describe("Maximum number of results to return"),
        offset: zod_1.z.number().optional().describe("Offset for pagination")
    }), async (params, client) => {
        const { id, ...restParams } = params;
        const response = await client.post(`/on_page/duplicate_content/${id}`, [restParams]);
        return response;
    }, apiClient);
}
//# sourceMappingURL=index.js.map