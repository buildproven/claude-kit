"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLocalFalconTools = registerLocalFalconTools;
const zod_1 = require("zod");
const tools_js_1 = require("../tools.js");
class LocalFalconClient {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || "https://www.localfalcon.com/api";
    }
    async get(path, params) {
        const url = new URL(`${this.baseUrl}${path}`);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined) {
                    url.searchParams.append(key, String(value));
                }
            });
        }
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.apiKey}`
            }
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Local Falcon API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        return response.json();
    }
    async post(path, data) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Local Falcon API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        return response.json();
    }
}
function registerLocalFalconTools(server, config) {
    const client = new LocalFalconClient(config);
    // Local Falcon - Calculate Grid Points from Base Coordinate
    (0, tools_js_1.registerTool)(server, "localfalcon_calculate_grid_points", zod_1.z.object({
        lat: zod_1.z.number().describe("Base latitude coordinate"),
        lng: zod_1.z.number().describe("Base longitude coordinate"),
        distance: zod_1.z.number().describe("Distance between grid points (in miles or kilometers)"),
        units: zod_1.z.enum(["miles", "kilometers"]).default("miles").describe("Distance unit"),
        points: zod_1.z.number().min(1).max(100).default(20).describe("Number of grid points to calculate")
    }), async (params) => {
        const response = await client.post("/v1/grid/", params);
        return response;
    }, client);
    // Local Falcon - Search for Google My Business Locations
    (0, tools_js_1.registerTool)(server, "localfalcon_search_gmb_locations", zod_1.z.object({
        query: zod_1.z.string().describe("Search query for finding Google My Business locations"),
        lat: zod_1.z.number().optional().describe("Optional latitude to center search around"),
        lng: zod_1.z.number().optional().describe("Optional longitude to center search around"),
        include_sabs: zod_1.z.boolean().default(true).describe("Include Service Area Businesses in results")
    }), async (params) => {
        const response = await client.post("/v1/places/", params);
        return response;
    }, client);
    // Local Falcon - Get Business Ranking at Specific Coordinate Point
    (0, tools_js_1.registerTool)(server, "localfalcon_get_ranking_at_coordinate", zod_1.z.object({
        lat: zod_1.z.number().describe("Latitude for the search point"),
        lng: zod_1.z.number().describe("Longitude for the search point"),
        keyword: zod_1.z.string().describe("Search term to use"),
        place_id: zod_1.z.string().describe("Google place ID to get ranking for"),
        language: zod_1.z.string().optional().describe("Language code (e.g., 'en')"),
        country: zod_1.z.string().optional().describe("Country code (e.g., 'us')")
    }), async (params) => {
        const response = await client.post("/v1/result/", params);
        return response;
    }, client);
    // Local Falcon - Keyword Search at a Specific Coordinate Point
    (0, tools_js_1.registerTool)(server, "localfalcon_keyword_search_at_coordinate", zod_1.z.object({
        lat: zod_1.z.number().describe("Latitude for the search point"),
        lng: zod_1.z.number().describe("Longitude for the search point"),
        keyword: zod_1.z.string().describe("Search term to use"),
        language: zod_1.z.string().optional().describe("Language code (e.g., 'en')"),
        country: zod_1.z.string().optional().describe("Country code (e.g., 'us')"),
        limit: zod_1.z.number().min(1).max(20).default(20).optional().describe("Number of results to return")
    }), async (params) => {
        const response = await client.post("/v1/search/", params);
        return response;
    }, client);
    // Local Falcon - Run a Full Grid Search
    (0, tools_js_1.registerTool)(server, "localfalcon_run_grid_search", zod_1.z.object({
        lat: zod_1.z.number().describe("Base latitude coordinate"),
        lng: zod_1.z.number().describe("Base longitude coordinate"),
        keyword: zod_1.z.string().describe("Search term to use"),
        place_id: zod_1.z.string().describe("Google place ID to get ranking for"),
        distance: zod_1.z.number().describe("Distance between grid points (in miles or kilometers)"),
        units: zod_1.z.enum(["miles", "kilometers"]).default("miles").describe("Distance unit"),
        points: zod_1.z.number().min(1).max(100).default(20).describe("Number of grid points to use"),
        language: zod_1.z.string().optional().describe("Language code (e.g., 'en')"),
        country: zod_1.z.string().optional().describe("Country code (e.g., 'us')")
    }), async (params) => {
        const response = await client.post("/v1/scan/", params);
        return response;
    }, client);
}
//# sourceMappingURL=index.js.map