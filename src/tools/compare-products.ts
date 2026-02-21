/**
 * compare_products MCP Tool
 *
 * Compare 2-3 cat food products side-by-side on nutrition and ingredients.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AgentApiClient } from "../client.js";
import { NotFoundError } from "../errors.js";
import { withRateLimit, type TokenBucketManager } from "../rate-limit.js";
import { ToolResponseBuilder } from "../response-builder.js";
import { assertNoAffiliateLinks } from "../safeguard.js";
import { AgentCompareResponseSchema } from "../schemas/agent-api.js";
import type { ProductInfo, NutritionInfo, DerivedMetricsInfo, CompareResult } from "../types.js";
import { createSuccessResponse } from "../utils/response-helpers.js";

// ULID format validation regex (26 alphanumeric characters)
const PRODUCT_ID_REGEX = /^[A-Z0-9]{26}$/i;

export function registerCompareTool(
  server: McpServer,
  client: AgentApiClient,
  bucketManager: TokenBucketManager,
  getClientId: () => string
): void {
  server.tool(
    "compare_products",
    "Compare 2-3 cat food products side-by-side on nutrition and ingredients. Pass product IDs from search_products results. Returns raw comparison data — interpret and explain the differences to the user.",
    {
      productIds: z.array(z.string().min(1).max(128)).min(2).max(3).describe("2-3 product IDs to compare"),
    },
    async (params) => {
      return withRateLimit(bucketManager, getClientId, async (_params, rateLimit) => {
        try {
          // Step 1: Validate array explicitly (Zod handles min/max but add friendly error message)
          if (params.productIds.length < 2) {
            return ToolResponseBuilder.validation("Need at least 2 product IDs to compare", rateLimit);
          }

          if (params.productIds.length > 3) {
            return ToolResponseBuilder.validation("Maximum 3 products can be compared", rateLimit);
          }

          // Step 2: Validate each product ID format (ULID)
          const invalidIds = params.productIds.filter((id) => !PRODUCT_ID_REGEX.test(id));
          if (invalidIds.length > 0) {
            return ToolResponseBuilder.validation(
              "Invalid product ID format. All product IDs must be valid ULIDs (26 alphanumeric characters)",
              rateLimit,
              { invalidIds }
            );
          }

          // Step 3: Call Agent API
          const raw = await client.compareProducts(params.productIds);

          // Step 4: Validate API response with Zod
          const validated = AgentCompareResponseSchema.safeParse(raw);
          if (!validated.success) {
            console.error("Invalid API response:", validated.error.message);
            return ToolResponseBuilder.internal("Invalid API response format", rateLimit, {
              validationError: validated.error.message,
            });
          }
          const response = validated.data;

          // Step 5: Map each product to ProductInfo shape
          const productInfos: ProductInfo[] = (response.products || []).map((item) => {
            const nutrition: NutritionInfo | undefined = item.nutrition
              ? {
                  protein: item.nutrition.protein,
                  fat: item.nutrition.fat,
                  fiber: item.nutrition.fiber,
                  moisture: item.nutrition.moisture,
                }
              : undefined;

            const derivedMetrics: DerivedMetricsInfo | undefined = item.derivedMetrics
              ? {
                  meatScore: item.derivedMetrics.meatScore,
                  carbEstimated: item.derivedMetrics.carbEstimated,
                }
              : undefined;

            return {
              id: item.id,
              name: item.name,
              brand: item.brand,
              detailUrl: item.detailUrl,
              imageUrl: item.imageUrl,
              form: item.form,
              lifeStageTags: item.lifeStageTags,
              conditionTags: item.conditionTags,
              nutrition,
              derivedMetrics,
              hasOffer: false, // Compare endpoint doesn't include offer data
            };
          });

          // Step 6: Run safeguard on full response
          const result: CompareResult = {
            products: productInfos,
            requested: response.requested || params.productIds.length,
            compared: response.compared || productInfos.length,
            rateLimit,
          };

          assertNoAffiliateLinks(result);

          // Step 7: Return result
          return createSuccessResponse(result, rateLimit);
        } catch (error) {
          // Log full error internally for debugging
          const message = error instanceof Error ? error.message : "Unknown error";
          console.error("compare_products error:", message, error);

          // NotFoundError is safe to pass through
          if (error instanceof NotFoundError) {
            return ToolResponseBuilder.notFound("Product", "requested product", rateLimit);
          }

          // Return safe generic message to user
          return ToolResponseBuilder.internal(
            "An error occurred while comparing products. Please try again later.",
            rateLimit,
            { tool: "compare_products" }
          );
        }
      })(params);
    }
  );
}
