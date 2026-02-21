/**
 * get_product_detail MCP Tool
 *
 * Get complete information about a specific cat food product including
 * full ingredient list, nutrition facts, calorie density, and health condition tags.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AgentApiClient } from "../client.js";
import { NotFoundError } from "../errors.js";
import { withRateLimit, type TokenBucketManager } from "../rate-limit.js";
import { ToolResponseBuilder } from "../response-builder.js";
import { assertNoAffiliateLinks } from "../safeguard.js";
import { ApiProductSchema } from "../schemas/agent-api.js";
import type { ProductInfo, NutritionInfo, DerivedMetricsInfo } from "../types.js";
import { createSuccessResponse } from "../utils/response-helpers.js";

// ULID format validation regex (26 alphanumeric characters)
const PRODUCT_ID_REGEX = /^[A-Z0-9]{26}$/i;

export function registerDetailTool(
  server: McpServer,
  client: AgentApiClient,
  bucketManager: TokenBucketManager,
  getClientId: () => string
): void {
  server.tool(
    "get_product_detail",
    "Get complete information about a specific cat food product including full ingredient list, nutrition facts, calorie density, and health condition tags. Requires a product ID from search_products results.",
    {
      productId: z.string().min(1).max(128).describe("Product ID (from search_products results)"),
    },
    async (params) => {
      return withRateLimit(bucketManager, getClientId, async (_params, rateLimit) => {
        try {
          // Step 1: Validate product ID format (ULID)
          if (!PRODUCT_ID_REGEX.test(params.productId)) {
            return ToolResponseBuilder.validation(
              "Invalid product ID format. Product ID must be a valid ULID (26 alphanumeric characters)",
              rateLimit,
              { productId: params.productId }
            );
          }

          // Step 2: Call Agent API
          const raw = await client.getProductDetail(params.productId);

          // Step 3: Validate API response with Zod
          const validated = ApiProductSchema.safeParse(raw);
          if (!validated.success) {
            console.error("Invalid API response:", validated.error.message);
            return ToolResponseBuilder.internal("Invalid API response format", rateLimit, {
              validationError: validated.error.message,
            });
          }
          const apiProduct = validated.data.product;

          // Step 4: Map validated response to ProductInfo shape
          const nutrition: NutritionInfo | undefined = apiProduct.nutrition
            ? {
                protein: apiProduct.nutrition.protein,
                fat: apiProduct.nutrition.fat,
                fiber: apiProduct.nutrition.fiber,
                moisture: apiProduct.nutrition.moisture,
              }
            : undefined;

          const derivedMetrics: DerivedMetricsInfo | undefined = apiProduct.derivedMetrics
            ? {
                meatScore: apiProduct.derivedMetrics.meatScore,
                carbEstimated: apiProduct.derivedMetrics.carbEstimated,
              }
            : undefined;

          const productInfo: ProductInfo = {
            id: apiProduct.id,
            name: apiProduct.name,
            brand: apiProduct.brand,
            detailUrl: apiProduct.detailUrl,
            imageUrl: apiProduct.imageUrl,
            form: apiProduct.form,
            lifeStageTags: apiProduct.lifeStageTags,
            conditionTags: apiProduct.conditionTags,
            ingredientsPreview: apiProduct.ingredientsPreview,
            ingredientsFull: apiProduct.ingredientsFull,
            nutrition,
            derivedMetrics,
            energyKcalPerKg: apiProduct.energyKcalPerKg,
            hasOffer: apiProduct.hasOffer,
          };

          // Step 5: Run safeguard
          assertNoAffiliateLinks(productInfo);

          // Step 6: Return result
          return createSuccessResponse(productInfo, rateLimit);
        } catch (error) {
          // Log full error internally for debugging
          const message = error instanceof Error ? error.message : "Unknown error";
          console.error("get_product_detail error:", message, error);

          // NotFoundError is safe to pass through
          if (error instanceof NotFoundError) {
            return ToolResponseBuilder.notFound("Product", params.productId, rateLimit);
          }

          // Return safe generic message to user
          return ToolResponseBuilder.internal(
            "An error occurred while retrieving product details. Please try again later.",
            rateLimit,
            { tool: "get_product_detail", productId: params.productId }
          );
        }
      })(params);
    }
  );
}
