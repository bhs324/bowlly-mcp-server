/**
 * Analyze Nutrition MCP Tool
 *
 * Provides ingredient breakdown and nutritional context for cat food products.
 * Features: DMB conversion, carb estimation, ingredient classification.
 */

import { z } from "zod";

import { AgentApiClient } from "../client.js";
import { NotFoundError } from "../errors.js";
import { TokenBucketManager } from "../rate-limit.js";
import { ToolResponseBuilder } from "../response-builder.js";
import { assertNoAffiliateLinks } from "../safeguard.js";
import type { NutritionAnalysisResult, IngredientClassification, RateLimitInfo } from "../types.js";
import { NUTRITION_DISCLAIMER } from "../types.js";
import { calculateCarbEstimated } from "../utils/nutrition.js";
import { createSuccessResponse } from "../utils/response-helpers.js";

// ============================================
// Ingredient Classification Patterns
// ============================================

// Fast exact-match keywords (no regex needed)
const ANIMAL_PROTEIN_KEYWORDS = new Set([
  "chicken",
  "turkey",
  "beef",
  "fish",
  "salmon",
  "tuna",
  "lamb",
  "duck",
  "meat",
  "liver",
  "heart",
  "kidney",
  "gizzard",
]);

const PLANT_PROTEIN_KEYWORDS = new Set([
  "pea protein",
  "potato protein",
  "corn gluten",
  "wheat gluten",
  "soy",
  "plant protein",
  "soybean",
]);

const GRAIN_STARCH_KEYWORDS = new Set([
  "rice",
  "corn",
  "wheat",
  "barley",
  "oats",
  "potato",
  "tapioca",
  "pea",
  "lentil",
  "chickpea",
  "sweet potato",
  "cassava",
]);

const ADDITIVES_KEYWORDS = new Set([
  "taurine",
  "vitamin",
  "mineral",
  "supplement",
  "preservative",
  "color",
  "flavor",
  "choline",
  "methionine",
  "lysine",
]);

// Regex patterns for partial matches (fallback when exact match fails)
const INGREDIENT_PATTERNS: Record<string, RegExp[]> = {
  animalProtein: [
    /chicken/i,
    /turkey/i,
    /beef/i,
    /fish/i,
    /salmon/i,
    /tuna/i,
    /lamb/i,
    /duck/i,
    /meat/i,
    /liver/i,
    /heart/i,
    /kidney/i,
    /gizzard/i,
  ],
  plantProtein: [/pea protein/i, /potato protein/i, /corn gluten/i, /wheat gluten/i, /soy/i, /plant protein/i],
  grainStarch: [
    /rice/i,
    /corn/i,
    /wheat/i,
    /barley/i,
    /oats/i,
    /potato/i,
    /tapioca/i,
    /pea/i,
    /lentil/i,
    /chickpea/i,
    /sweet potato/i,
    /cassava/i,
  ],
  additives: [
    /taurine/i,
    /vitamin/i,
    /mineral/i,
    /supplement/i,
    /preservative/i,
    /color/i,
    /flavor/i,
    /choline/i,
    /methionine/i,
    /lysine/i,
  ],
};

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate Dry Matter Basis (DMB) percentages
 * Formula: DMB% = (AsFed% / (100 - Moisture%)) * 100
 */
function calculateDMB(
  nutrition: {
    protein?: number;
    fat?: number;
    fiber?: number;
    moisture?: number;
    ash?: number;
  },
  carbAsFed?: number
): {
  protein?: number;
  fat?: number;
  fiber?: number;
  ash?: number;
  carbEstimated?: number;
} {
  const { protein, fat, fiber, moisture, ash } = nutrition;

  if (moisture === undefined || moisture >= 100) {
    return {
      protein,
      fat,
      fiber,
      ash,
      carbEstimated: carbAsFed,
    };
  }

  const factor = 100 / (100 - moisture);

  return {
    protein: protein !== undefined ? Math.round(protein * factor * 10) / 10 : undefined,
    fat: fat !== undefined ? Math.round(fat * factor * 10) / 10 : undefined,
    fiber: fiber !== undefined ? Math.round(fiber * factor * 10) / 10 : undefined,
    ash: ash !== undefined ? Math.round(ash * factor * 10) / 10 : undefined,
    carbEstimated: carbAsFed !== undefined ? Math.round(carbAsFed * factor * 10) / 10 : undefined,
  };
}

/**
 * Fast keyword check using Set lookup
 */
function hasKeyword(ingredient: string, keywords: Set<string>): boolean {
  const lower = ingredient.toLowerCase();
  for (const keyword of keywords) {
    if (lower.includes(keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * Classify an ingredient into nutritional categories
 * Optimized: Uses Set-based keyword lookup first, falls back to regex for complex patterns
 */
function classifyIngredient(ingredient: string): IngredientClassification {
  const categories: ("animalProtein" | "plantProtein" | "grainStarch" | "additives" | "other")[] = [];
  const lowerIngredient = ingredient.toLowerCase();

  // Fast path: Set-based keyword matching (O(1) lookup per keyword)
  if (hasKeyword(lowerIngredient, ANIMAL_PROTEIN_KEYWORDS)) {
    categories.push("animalProtein");
  }
  if (hasKeyword(lowerIngredient, PLANT_PROTEIN_KEYWORDS)) {
    categories.push("plantProtein");
  }
  if (hasKeyword(lowerIngredient, GRAIN_STARCH_KEYWORDS)) {
    categories.push("grainStarch");
  }
  if (hasKeyword(lowerIngredient, ADDITIVES_KEYWORDS)) {
    categories.push("additives");
  }

  // Fallback: Regex patterns for any missed cases (e.g., word boundaries)
  // This ensures we don't miss edge cases while optimizing the common path
  if (categories.length === 0) {
    for (const [category, patterns] of Object.entries(INGREDIENT_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(lowerIngredient))) {
        categories.push(category as "animalProtein" | "plantProtein" | "grainStarch" | "additives");
      }
    }
  }

  if (categories.length === 0) {
    categories.push("other");
  }

  return {
    name: ingredient,
    categories,
  };
}

// ============================================
// Tool Registration
// ============================================

const inputSchema = z.object({
  productId: z
    .string()
    .min(1, "Product ID is required")
    .max(128, "Product ID too long")
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid product ID format")
    .describe("The product ID to analyze"),
});

type Input = z.infer<typeof inputSchema>;

export function registerAnalyzeNutritionTool(
  server: {
    tool: (
      name: string,
      description: string,
      paramsSchema: z.ZodRawShape,
      handler: (args: unknown) => Promise<{
        content: Array<{ type: "text"; text: string }>;
      }>
    ) => void;
  },
  client: AgentApiClient,
  bucketManager: TokenBucketManager,
  getClientId: () => string
): void {
  server.tool(
    "analyze_nutrition",
    "Analyzes the nutritional content of a cat food product by productId. Returns ingredient breakdown, DMB conversion, carb estimation, and nutritional context. Use when user asks about nutrition, ingredients, or carb content of a specific product.",
    inputSchema.shape,
    async (args: unknown) => {
      const input = args as Input;

      // Rate limit check
      const rateCheck = bucketManager.consume(getClientId());
      if (!rateCheck.allowed) {
        return ToolResponseBuilder.rateLimitExceeded(rateCheck);
      }

      try {
        // Fetch product details
        const raw = await client.getProductDetail(input.productId);

        // Handle both wrapped { product: {...} } and unwrapped {...} response formats
        // Also handle null/undefined raw responses
        // When wrapped, extract product; when product is null, treat as not found
        let product: unknown;
        if (raw && typeof raw === "object" && "product" in raw) {
          product = (raw as { product: unknown }).product;
        } else {
          product = raw;
        }

        if (!product) {
          const rateLimit: RateLimitInfo = {
            limit: rateCheck.limit,
            remaining: rateCheck.remaining,
            resetEpochMs: rateCheck.resetEpochMs,
          };
          return ToolResponseBuilder.notFound("Product", input.productId, rateLimit);
        }

        // Type the extracted product data
        const productData = product as {
          id?: string;
          name?: string;
          form?: "dry" | "wet";
          nutrition?: {
            protein?: number;
            fat?: number;
            fiber?: number;
            moisture?: number;
            ash?: number;
          };
          ingredientsFull?: string[];
          ingredientsPreview?: string[];
        };

        // Extract nutrition data
        const nutrition = productData.nutrition || {};
        const form = productData.form || "dry";

        // Calculate carb estimate
        const carbResult = calculateCarbEstimated(nutrition, { form });

        // Calculate DMB values
        const dmbValues = calculateDMB(nutrition, carbResult.value);

        // Classify top ingredients (first 5-10)
        const allIngredients = productData.ingredientsFull || productData.ingredientsPreview || [];
        const topIngredients = allIngredients.slice(0, 10).map(classifyIngredient);

        // Build assumptions based on defaults used
        const assumptions: string[] = [];
        if (nutrition.ash === undefined) {
          const defaultAsh = form === "wet" ? 2.5 : 8;
          assumptions.push(`Default ash value of ${defaultAsh}% used for ${form} food`);
        }
        if (nutrition.fiber === undefined) {
          assumptions.push("Fiber value not provided; assumed 0% for carb calculation");
        }

        // Build limitations based on missing data
        const limitations: string[] = [];
        if (nutrition.ash === undefined) {
          limitations.push("Ash value not provided by manufacturer; carb estimate uses default");
        }
        if (nutrition.protein === undefined) {
          limitations.push("Protein value unavailable");
        }
        if (nutrition.fat === undefined) {
          limitations.push("Fat value unavailable");
        }
        if (nutrition.moisture === undefined) {
          limitations.push("Moisture value unavailable; DMB calculation not possible");
        }
        if (nutrition.fiber === undefined) {
          limitations.push("Fiber value not provided by manufacturer");
        }

        // Construct the result
        const result: NutritionAnalysisResult = {
          productId: productData.id ?? input.productId,
          productName: productData.name ?? "Unknown",
          asFed: {
            protein: nutrition.protein,
            fat: nutrition.fat,
            fiber: nutrition.fiber,
            moisture: nutrition.moisture,
            ash: nutrition.ash,
          },
          carbohydrates: {
            asFed: carbResult.value,
            isEstimated: carbResult.isEstimated,
            dmb: dmbValues.carbEstimated,
          },
          dmb: {
            protein: dmbValues.protein,
            fat: dmbValues.fat,
            fiber: dmbValues.fiber,
            ash: dmbValues.ash,
            carbEstimated: dmbValues.carbEstimated,
          },
          ingredients: {
            totalCount: allIngredients.length,
            topIngredients,
          },
          assumptions,
          limitations,
          disclaimer: NUTRITION_DISCLAIMER,
        };

        // Safeguard: scan for affiliate links
        assertNoAffiliateLinks(result);

        const rateLimit: RateLimitInfo = {
          limit: rateCheck.limit,
          remaining: rateCheck.remaining,
          resetEpochMs: rateCheck.resetEpochMs,
        };

        return createSuccessResponse(result, rateLimit);
      } catch (error) {
        const rateLimit: RateLimitInfo = {
          limit: rateCheck.limit,
          remaining: rateCheck.remaining,
          resetEpochMs: rateCheck.resetEpochMs,
        };

        // Log full error internally for debugging
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("analyze_nutrition error:", message, error);

        // NotFoundError is safe to pass through
        if (error instanceof NotFoundError) {
          return ToolResponseBuilder.notFound("Product", input.productId, rateLimit);
        }

        // Return safe generic message to user
        return ToolResponseBuilder.internal(
          "An error occurred while analyzing nutrition. Please try again later.",
          rateLimit,
          { tool: "analyze_nutrition", productId: input.productId }
        );
      }
    }
  );
}
