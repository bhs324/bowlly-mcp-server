/**
 * search_products MCP Tool
 *
 * Search FitPick's cat food database by ingredients, health conditions, or food form.
 * Supports filtering, sorting, and cursor-based pagination.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AgentApiClient } from "../client.js";
import { NotFoundError } from "../errors.js";
import type { TokenBucketManager } from "../rate-limit.js";
import { ToolResponseBuilder } from "../response-builder.js";
import { assertNoAffiliateLinks } from "../safeguard.js";
import { AgentProductsResponseSchema } from "../schemas/agent-api.js";
import type { AgentProductItem, SearchableProduct, AgentProductsResponse } from "../types/agent-api.js";
import type { SearchResultItem, SearchResult, RateLimitInfo } from "../types.js";
import { createSuccessResponse } from "../utils/response-helpers.js";

// Constants for dynamic batch sizing
const DEFAULT_BATCH_SIZE = 50;
const CLIENT_SIDE_PROCESSING_BATCH_SIZE = 200;

export function registerSearchTool(
  server: McpServer,
  client: AgentApiClient,
  bucketManager: TokenBucketManager,
  getClientId: () => string
): void {
  server.tool(
    "search_products",
    "Search FitPick's cat food database by ingredients, health conditions, or food form. Use this when the user asks to find, filter, or recommend cat foods. Returns a summary list — use get_product_detail for full information about specific products.",
    {
      query: z.string().max(256).optional().describe("Search by product name, brand, or ingredient"),
      form: z.enum(["dry", "wet"]).optional().describe("Food form: dry kibble or wet canned food"),
      conditions: z
        .string()
        .optional()
        .describe("Comma-separated health conditions: sensitive, urinary, hairball, diet, indoor"),
      includeIngredients: z
        .string()
        .optional()
        .describe(
          "Comma-separated ingredients that MUST be present (e.g., 'chicken,tuna'). Note: searches ingredients preview (top 5), may miss ingredients beyond 5th position"
        ),
      excludeIngredients: z
        .string()
        .optional()
        .describe(
          "Comma-separated ingredients to EXCLUDE (e.g., 'corn,wheat'). Note: searches ingredients preview (top 5), may miss ingredients beyond 5th position"
        ),
      minProtein: z.number().optional().describe("Minimum crude protein percentage (e.g., 35)"),
      maxCarbs: z.number().optional().describe("Maximum estimated carbs percentage (e.g., 10)"),
      sortBy: z
        .enum(["protein_desc", "carbs_asc", "fat_desc", "moisture_desc"])
        .optional()
        .describe("Sort by nutritional metric"),
      limit: z.number().min(1).max(20).default(10).describe("Results per page (default 10, max 20)"),
      cursor: z.number().min(0).default(0).describe("Pagination offset (0 for first page)"),
    },
    async (params) => {
      // Step 1: Rate limit check (outside try block for error handling access)
      const rateCheck = bucketManager.consume(getClientId());
      if (!rateCheck.allowed) {
        return ToolResponseBuilder.rateLimitExceeded(rateCheck);
      }

      const rateLimit: RateLimitInfo = {
        limit: rateCheck.limit,
        remaining: rateCheck.remaining,
        resetEpochMs: rateCheck.resetEpochMs,
      };

      try {
        // Step 2: Build Agent API query params
        const apiParams: Record<string, string> = {};
        if (params.query) apiParams.search = params.query;
        if (params.form) apiParams.form = params.form;
        if (params.conditions) apiParams.conditions = params.conditions;
        if (params.minProtein !== undefined) apiParams.minProtein = String(params.minProtein);
        if (params.maxCarbs !== undefined) apiParams.maxCarbs = String(params.maxCarbs);

        // Determine if we need a larger batch for client-side sorting/filtering
        const needsClientSideProcessing =
          Boolean(params.sortBy) || Boolean(params.includeIngredients) || Boolean(params.excludeIngredients);
        const userLimit = params.limit ?? 10;
        const userCursor = params.cursor ?? 0;

        // P1-022: Dynamic batch size
        const batchSize = Math.min(
          params.limit ? params.limit * 2 : DEFAULT_BATCH_SIZE,
          CLIENT_SIDE_PROCESSING_BATCH_SIZE
        );

        if (needsClientSideProcessing) {
          // Fetch larger batch for accurate sorting/filtering
          apiParams.limit = String(batchSize);
          apiParams.offset = "0";
        } else {
          apiParams.limit = String(userLimit);
          apiParams.offset = String(userCursor);
        }

        // Step 3: Call Agent API
        const raw = await client.getProducts(apiParams);
        // P1-020,055: Zod validation
        const validated = AgentProductsResponseSchema.safeParse(raw);
        if (!validated.success) {
          throw new Error(`Invalid API response: ${validated.error.message}`);
        }
        const response: AgentProductsResponse = {
          items: validated.data.items,
          meta: {
            total: validated.data.meta.total,
            limit: validated.data.meta.limit,
            offset: validated.data.meta.offset,
          },
        };
        // P1-028: Pre-compute search text for each product to optimize filtering
        const searchableItems: SearchableProduct[] = response.items.map((item) => ({
          ...item,
          _searchText: [item.name, item.brand, ...(item.conditionTags || []), ...(item.ingredientsPreview || [])]
            .join(" ")
            .toLowerCase(),
        }));

        let items: SearchableProduct[] = searchableItems;

        // Step 4: Client-side ingredient filtering with ingredientsPreview support
        let filterNote: string | undefined;
        let suggestions: string[] | undefined;
        const originalItems = [...items]; // Keep copy for suggestion logic

        if (params.includeIngredients || params.excludeIngredients) {
          const hasIngredientData = items.some(
            (item) => (item.ingredientsPreview?.length ?? 0) > 0 || (item.ingredientsFull?.length ?? 0) > 0
          );
          if (!hasIngredientData) {
            return ToolResponseBuilder.validation(
              "Ingredient include/exclude filtering is not available for this environment (list results do not include ingredient previews). Use query/conditions filters instead.",
              rateLimit,
              { includeIngredients: params.includeIngredients, excludeIngredients: params.excludeIngredients }
            );
          }

          const includeTerms = params.includeIngredients
            ? params.includeIngredients.split(",").map((s) => s.trim())
            : [];
          const excludeTerms = params.excludeIngredients
            ? params.excludeIngredients.split(",").map((s) => s.trim())
            : [];

          // P1-053: Pre-compile regexes
          const parsedIncludeTerms = includeTerms.map((term) => {
            const { type, value } = parseMatchType(term);
            return {
              type,
              value,
              regex: type === "exact" ? new RegExp(`\\b${escapeRegex(value)}\\b`, "i") : undefined,
            };
          });
          const parsedExcludeTerms = excludeTerms.map((term) => {
            const { type, value } = parseMatchType(term);
            return {
              type,
              value,
              regex: type === "exact" ? new RegExp(`\\b${escapeRegex(value)}\\b`, "i") : undefined,
            };
          });

          items = items.filter((item) => {
            // Include filter: product must match ALL include terms
            const matchesInclude =
              parsedIncludeTerms.length === 0 ||
              parsedIncludeTerms.every(({ type, value, regex }) => matchIngredient(value, item, type, regex));

            // Exclude filter: product must NOT match ANY exclude term
            const matchesExclude =
              parsedExcludeTerms.length === 0 ||
              !parsedExcludeTerms.some(({ type, value, regex }) => matchIngredient(value, item, type, regex));

            return matchesInclude && matchesExclude;
          });

          filterNote =
            'Ingredient filtering uses ingredients preview with partial matching by default. Use quotes for exact matching (e.g., "chicken meal").';

          // Step 4b: Generate suggestions for empty results
          if (items.length === 0) {
            // Try with relaxed filters (partial matching only, ignore exact requirements)
            const relaxedItems = originalItems.filter((item) => {
              const relaxedIncludeTerms = includeTerms.map((term) => term.toLowerCase().replace(/^"(.+)"$/, "$1"));
              const relaxedExcludeTerms = excludeTerms.map((term) => term.toLowerCase().replace(/^"(.+)"$/, "$1"));

              const matchesInclude =
                relaxedIncludeTerms.length === 0 || relaxedIncludeTerms.some((term) => item._searchText.includes(term));
              const matchesExclude =
                relaxedExcludeTerms.length === 0 ||
                !relaxedExcludeTerms.some((term) => item._searchText.includes(term));

              return matchesInclude && matchesExclude;
            });

            if (relaxedItems.length > 0) {
              suggestions = [
                `No exact matches found. Try broadening your search or check ingredient spelling.`,
                `Found ${relaxedItems.length} products with relaxed matching.`,
              ];
            }
          }
        }

        // Step 5: Client-side sorting
        if (params.sortBy) {
          items = sortProducts(items, params.sortBy);
        }

        // Step 6: Client-side pagination (if we fetched a larger batch)
        const total = items.length;
        const slicedItems = needsClientSideProcessing ? items.slice(userCursor, userCursor + userLimit) : items;
        const apiHasMore = validated.data.meta.hasMore;
        const hasMore = needsClientSideProcessing
          ? userCursor + userLimit < total
          : (apiHasMore ?? response.meta.total > userCursor + userLimit);
        const nextCursor = hasMore ? userCursor + slicedItems.length : userCursor;

        // Step 7: Map to SearchResultItem shape
        const searchItems: SearchResultItem[] = slicedItems.map((item) => ({
          id: item.id,
          name: item.name,
          brand: item.brand,
          form: item.form,
          ingredientsPreview: item.ingredientsPreview || [],
          detailUrl: item.detailUrl,
        }));

        const searchResult: SearchResult = {
          items: searchItems,
          total: needsClientSideProcessing ? total : response.meta.total,
          hasMore,
          cursor: nextCursor,
          rateLimit,
        };

        // Add filter note and suggestions if applicable
        const resultWithMeta: SearchResult & { filterNote?: string; suggestions?: string[] } = { ...searchResult };
        if (filterNote) resultWithMeta.filterNote = filterNote;
        if (suggestions) resultWithMeta.suggestions = suggestions;

        // Step 8: Run safeguard
        assertNoAffiliateLinks(resultWithMeta);

        // Step 9: Return result
        return createSuccessResponse(resultWithMeta, rateLimit);
      } catch (error) {
        // Log full error internally for debugging
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("search_products error:", message, error);

        // NotFoundError is safe to pass through
        if (error instanceof NotFoundError) {
          return ToolResponseBuilder.notFound("Product", "search query", rateLimit);
        }

        // Return safe generic message to user
        return ToolResponseBuilder.internal(
          "An error occurred while searching products. Please try again later.",
          rateLimit,
          { tool: "search_products" }
        );
      }
    }
  );
}

// Helper function to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Validate ingredient contains only safe characters for regex word boundary
// P1-056: Word boundary \b doesn't work correctly with spaces
function isSafeIngredient(ingredient: string): boolean {
  // Allow letters, numbers, spaces, and common separators
  return /^[\w\s\-'.()]+$/i.test(ingredient);
}

// Parse match type from ingredient term
// Quoted terms use exact matching, others use partial matching
function parseMatchType(term: string): { type: "exact" | "partial"; value: string } {
  const quoted = term.match(/^"(.+)"$/);
  if (quoted) {
    return { type: "exact", value: quoted[1].toLowerCase() };
  }
  return { type: "partial", value: term.toLowerCase() };
}

// Match ingredient against product fields
// P1-053: Pre-compiled regex support for performance
// P1-056: Added validation for safe ingredients with word boundary
function matchIngredient(
  ingredient: string,
  product: AgentProductItem,
  matchType: "exact" | "partial",
  precompiledRegex?: RegExp
): boolean {
  const searchFields = [
    product.name,
    product.brand,
    ...(product.conditionTags || []),
    ...(product.ingredientsPreview || []),
  ].map((f) => f.toLowerCase());

  if (matchType === "exact") {
    // P1-056: Validate ingredient before using word boundary regex
    if (!isSafeIngredient(ingredient)) {
      console.warn(
        `[search-products] Ingredient contains unsafe characters, falling back to partial matching: ${ingredient}`
      );
      return searchFields.some((field) => field.includes(ingredient.toLowerCase()));
    }

    return searchFields.some((field) => {
      // Use pre-compiled regex if available, otherwise create new one
      const regex = precompiledRegex ?? new RegExp(`\\b${escapeRegex(ingredient)}\\b`, "i");
      return regex.test(field);
    });
  }
  // Partial matching
  return searchFields.some((field) => field.includes(ingredient));
}

function sortProducts<T extends AgentProductItem>(items: T[], sortBy: string): T[] {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case "protein_desc":
        return (b.nutrition?.protein ?? 0) - (a.nutrition?.protein ?? 0);
      case "carbs_asc":
        return (a.derivedMetrics?.carbEstimated ?? 999) - (b.derivedMetrics?.carbEstimated ?? 999);
      case "fat_desc":
        return (b.nutrition?.fat ?? 0) - (a.nutrition?.fat ?? 0);
      case "moisture_desc":
        return (b.nutrition?.moisture ?? 0) - (a.nutrition?.moisture ?? 0);
      default:
        return 0;
    }
  });
}
