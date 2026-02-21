/**
 * MCP Server Factory
 *
 * Creates an McpServer instance with Bowlly identity,
 * rate limiting, and safeguard middleware.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AgentApiClient } from "./client.js";
import { config } from "./config.js";
import { TokenBucketManager } from "./rate-limit.js";
import { ToolResponseBuilder } from "./response-builder.js";
import { assertNoAffiliateLinks } from "./safeguard.js";
import { registerAnalyzeNutritionTool } from "./tools/analyze-nutrition.js";
import { registerCompareTool } from "./tools/compare-products.js";
import { registerCurationTool } from "./tools/get-curation-list.js";
import { registerDetailTool } from "./tools/get-product-detail.js";
import { registerSearchTool } from "./tools/search-products.js";
import type { RateLimitInfo } from "./types.js";
import { createSuccessResponse } from "./utils/response-helpers.js";

/**
 * Server context containing the MCP server and its dependencies
 */
export interface ServerContext {
  server: McpServer;
  apiClient: AgentApiClient;
}

export function createServer(): ServerContext {
  // Create MCP server with Bowlly identity
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  // Create rate limiter and API client
  const bucketManager = new TokenBucketManager(config.rateLimitPerMin, 60_000);
  const apiClient = new AgentApiClient();

  // Get client identifier for per-client rate limiting
  // Uses session ID if available, falls back to a default for single-client scenarios
  const getClientId = (): string => config.sessionId || "default-client";

  // Register health tool (stub for Phase 25 expansion)
  server.tool(
    "get_health",
    "Check MCP server connectivity and rate limit status. Use this when experiencing connection issues or before batch operations. Returns server status, version, session ID, and rate limit information.",
    async () => {
      const rateCheck = bucketManager.consume(getClientId());

      if (!rateCheck.allowed) {
        return ToolResponseBuilder.rateLimitExceeded(rateCheck);
      }

      const result = {
        status: "ok",
        serverName: config.serverName,
        version: config.serverVersion,
        sessionId: config.sessionId,
      };

      // Safeguard: scan result for affiliate links before returning
      assertNoAffiliateLinks(result);

      const rateLimit: RateLimitInfo = {
        limit: rateCheck.limit,
        remaining: rateCheck.remaining,
        resetEpochMs: rateCheck.resetEpochMs,
      };

      return createSuccessResponse(result, rateLimit);
    }
  );

  // Register MCP tools with per-client rate limiting
  registerSearchTool(server, apiClient, bucketManager, getClientId);
  registerDetailTool(server, apiClient, bucketManager, getClientId);
  registerCompareTool(server, apiClient, bucketManager, getClientId);

  // Register nutrition analysis tool
  registerAnalyzeNutritionTool(server, apiClient, bucketManager, getClientId);

  // Register curation list tool
  registerCurationTool(server, apiClient, bucketManager, getClientId);

  return { server, apiClient };
}

export async function startServer(): Promise<void> {
  const { server, apiClient } = createServer();
  const transport = new StdioServerTransport();

  // Setup cleanup on process exit
  const cleanup = () => {
    console.error("[Server] Cleaning up resources...");
    apiClient.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);

  await server.connect(transport);
  console.error("Bowlly MCP Server running on stdio");
}
