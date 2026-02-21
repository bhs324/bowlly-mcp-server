/**
 * get_curation_list MCP Tool
 *
 * Retrieves curated best-of category data by slug.
 * Returns summary by default with opt-in extended content.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AgentApiClient, type AgentProductDetail, type AgentCurationResponse } from "../client.js";
import { NotFoundError } from "../errors.js";
import { TokenBucketManager } from "../rate-limit.js";
import { ToolResponseBuilder } from "../response-builder.js";
import { assertNoAffiliateLinks } from "../safeguard.js";
import type { CurationResult, RecommendedProductSummary, RateLimitInfo } from "../types.js";
import { createSuccessResponse } from "../utils/response-helpers.js";

// ============================================
// Simple In-Memory Cache for Product Details
// ============================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class ProductCache {
  private cache = new Map<string, CacheEntry<AgentProductDetail>>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60000) {
    // Default 1 minute TTL
    this.ttlMs = ttlMs;
  }

  get(key: string): AgentProductDetail | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  set(key: string, data: AgentProductDetail): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Shared cache instance (module-level)
const productCache = new ProductCache(60000); // 1 minute TTL

/** Clear the product cache - useful for testing */
export function clearProductCache(): void {
  productCache.clear();
}

const inputSchema = z.object({
  slug: z.string().min(1).max(128).describe("The curation page slug (e.g., 'low-carb-cat-food')"),
  includeSections: z.boolean().optional().describe("Include extended content sections (opt-in)"),
  includeFaq: z.boolean().optional().describe("Include FAQ section (opt-in)"),
});

type Input = z.infer<typeof inputSchema>;

async function enrichTopProducts(
  client: AgentApiClient,
  productIds: string[]
): Promise<(RecommendedProductSummary | { id: string; error: string })[]> {
  const top3Ids = productIds.slice(0, 3);

  const enriched = await Promise.all(
    top3Ids.map(async (id): Promise<RecommendedProductSummary | { id: string; error: string }> => {
      try {
        // Check cache first
        const cacheKey = `product:${id}`;
        const cached = productCache.get(cacheKey);

        if (cached) {
          return {
            id,
            name: cached.name ?? "Unknown",
            brand: cached.brand ?? "Unknown",
            form: cached.form,
            keyNutrition: {
              protein: cached.nutrition?.protein,
              carbEstimated: cached.derivedMetrics?.carbEstimated,
            },
            detailToolLink: `Use get_product_detail with productId '${id}'`,
          };
        }

        // Fetch product detail from API
        // Response is already validated by Zod schema in client.ts
        const response = await client.getProductDetail(id);
        const product = response.product;

        if (!product) {
          return { id, error: "Product not found" };
        }

        // Cache the product data
        productCache.set(cacheKey, product);

        return {
          id,
          name: product.name ?? "Unknown",
          brand: product.brand ?? "Unknown",
          form: product.form,
          keyNutrition: {
            protein: product.nutrition?.protein,
            carbEstimated: product.derivedMetrics?.carbEstimated,
          },
          detailToolLink: `Use get_product_detail with productId '${id}'`,
        };
      } catch (error) {
        // Log internal error for debugging but return safe message
        console.error(`[enrichTopProducts] Error fetching product ${id}:`, error);
        return { id, error: "Product not found" };
      }
    })
  );

  return enriched;
}

function buildCurationResult(
  page: AgentCurationResponse,
  enrichedProducts: (RecommendedProductSummary | { id: string; error: string })[],
  includeSections: boolean,
  includeFaq: boolean
): CurationResult {
  const result: CurationResult = {
    slug: page.slug,
    title: page.title,
    description: page.description,
    tldr: page.tldr,
    criteria: page.criteria,
    methodology: page.methodology,
    recommendedProductIds: page.recommendedProductIds,
    recommendedProducts: enrichedProducts,
    updatedAt: page.updatedAt,
    canonicalUrl: page.canonicalUrl,
  };

  if (includeSections && page.sections) {
    result.sections = page.sections;
  }

  if (includeFaq && page.faq) {
    result.faq = page.faq;
  }

  return result;
}

export function registerCurationTool(
  server: McpServer,
  client: AgentApiClient,
  bucketManager: TokenBucketManager,
  getClientId: () => string
): void {
  server.tool(
    "get_curation_list",
    "Retrieve curated best-of category data by slug. Returns summary by default with opt-in extended content.",
    inputSchema.shape,
    async (input: Input) => {
      // Rate limit check
      const rateCheck = bucketManager.consume(getClientId());

      if (!rateCheck.allowed) {
        return ToolResponseBuilder.rateLimitExceeded(rateCheck);
      }

      // Fetch curation from API
      let page: AgentCurationResponse;
      try {
        page = await client.getCuration(input.slug);
      } catch (error) {
        const rateLimit: RateLimitInfo = {
          limit: rateCheck.limit,
          remaining: rateCheck.remaining,
          resetEpochMs: rateCheck.resetEpochMs,
        };

        if (error instanceof NotFoundError) {
          return ToolResponseBuilder.notFound("Curation page", input.slug, rateLimit);
        }

        throw error;
      }

      // Enrich top 3 recommended products
      const enrichedProducts = await enrichTopProducts(client, page.recommendedProductIds);

      // Build curation result
      const result = buildCurationResult(
        page,
        enrichedProducts,
        input.includeSections ?? false,
        input.includeFaq ?? false
      );

      // Safeguard: scan for affiliate links
      assertNoAffiliateLinks(result);

      const rateLimit: RateLimitInfo = {
        limit: rateCheck.limit,
        remaining: rateCheck.remaining,
        resetEpochMs: rateCheck.resetEpochMs,
      };

      return createSuccessResponse(result, rateLimit);
    }
  );
}
