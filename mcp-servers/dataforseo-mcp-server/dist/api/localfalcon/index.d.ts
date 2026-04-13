import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
interface LocalFalconClientConfig {
    apiKey: string;
    baseUrl?: string;
}
export declare function registerLocalFalconTools(server: McpServer, config: LocalFalconClientConfig): void;
export {};
