import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DataForSeoClient } from "./client.js";
export declare const toolRegistry: Map<string, any>;
/**
 * Base helper function to register an MCP tool for DataForSEO API
 */
export declare function registerTool<T extends z.ZodRawShape>(server: McpServer, name: string, schema: z.ZodObject<T> | T, handler: (params: z.infer<z.ZodObject<T>>, client: DataForSeoClient) => Promise<any>, client: DataForSeoClient): void;
/**
 * Helper for registering a task-based tool (POST, READY, GET pattern)
 */
export declare function registerTaskTool<PostT extends z.ZodRawShape>(server: McpServer, baseName: string, postSchema: z.ZodObject<PostT> | PostT, postHandler: (params: z.infer<z.ZodObject<PostT>>, client: DataForSeoClient) => Promise<any>, readyHandler: (client: DataForSeoClient) => Promise<any>, getHandler: (id: string, client: DataForSeoClient) => Promise<any>, client: DataForSeoClient): void;
