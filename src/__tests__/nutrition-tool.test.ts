import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { AgentApiClient } from "../client.js";
import { TokenBucketManager } from "../rate-limit.js";
import { registerAnalyzeNutritionTool } from "../tools/analyze-nutrition.js";

describe("analyze_nutrition tool", () => {
  let client: AgentApiClient;
  let bucketManager: TokenBucketManager;
  const getClientId = () => "test-client";
  let capturedHandler: ((args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>) | null = null;

  // Mock server that captures the registered tool handler
  // Supports both 3-param (name, schema, handler) and 4-param (name, description, schema, handler) signatures
  const createMockServer = () => {
    return {
      tool: (name: string, arg2: unknown, arg3: unknown, arg4?: unknown) => {
        if (name === "analyze_nutrition") {
          // 4-param signature: (name, description, schema, handler)
          // 3-param signature: (name, schema, handler)
          const handler =
            arg4 !== undefined
              ? (arg4 as (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>)
              : (arg3 as (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>);
          capturedHandler = handler;
        }
      },
    };
  };

  const getHandler = () => {
    if (!capturedHandler) {
      throw new Error("Tool handler was not registered");
    }
    return capturedHandler;
  };

  beforeEach(() => {
    client = new AgentApiClient();
    bucketManager = new TokenBucketManager(100, 60000);
    capturedHandler = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns complete nutrition analysis", async () => {
    // Mock product with full nutrition data
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      id: "prod-123",
      name: "Premium Cat Food",
      form: "dry",
      nutrition: {
        protein: 40,
        fat: 20,
        fiber: 3,
        moisture: 10,
        ash: 8,
      },
      ingredientsFull: ["chicken", "salmon", "pea protein", "rice", "taurine", "vitamin E"],
    });

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      bucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "prod-123" });

    const content = JSON.parse(result.content[0].text);

    // Verify response structure
    expect(content.data).toBeDefined();
    expect(content.data.productId).toBe("prod-123");
    expect(content.data.productName).toBe("Premium Cat Food");

    // Verify as-fed values
    expect(content.data.asFed).toBeDefined();
    expect(content.data.asFed.protein).toBe(40);
    expect(content.data.asFed.fat).toBe(20);
    expect(content.data.asFed.fiber).toBe(3);
    expect(content.data.asFed.moisture).toBe(10);
    expect(content.data.asFed.ash).toBe(8);

    // Verify carbohydrates with isEstimated flag
    expect(content.data.carbohydrates).toBeDefined();
    expect(typeof content.data.carbohydrates.asFed).toBe("number");
    expect(content.data.carbohydrates.isEstimated).toBe(false); // All values provided
    expect(typeof content.data.carbohydrates.dmb).toBe("number");

    // Verify DMB values
    expect(content.data.dmb).toBeDefined();
    expect(typeof content.data.dmb.protein).toBe("number");
    expect(typeof content.data.dmb.fat).toBe("number");

    // Verify ingredients classification
    expect(content.data.ingredients).toBeDefined();
    expect(content.data.ingredients.totalCount).toBe(6);
    expect(content.data.ingredients.topIngredients).toBeDefined();
    expect(content.data.ingredients.topIngredients.length).toBeGreaterThan(0);

    // Verify disclaimer is present
    expect(content.data.disclaimer).toBeDefined();
    expect(content.data.disclaimer).toContain("not veterinary advice");

    // Verify assumptions and limitations arrays exist
    expect(Array.isArray(content.data.assumptions)).toBe(true);
    expect(Array.isArray(content.data.limitations)).toBe(true);
  });

  it("handles missing nutrition data", async () => {
    // Mock product with partial nutrition (no ash)
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      id: "prod-456",
      name: "Wet Cat Food",
      form: "wet",
      nutrition: {
        protein: 10,
        fat: 5,
        fiber: 1,
        moisture: 78,
        // ash is missing
      },
      ingredientsFull: ["chicken broth", "chicken", "liver"],
    });

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      bucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "prod-456" });

    const content = JSON.parse(result.content[0].text);

    expect(content.data).toBeDefined();

    // Verify carb isEstimated=true when ash is missing
    expect(content.data.carbohydrates.isEstimated).toBe(true);

    // Verify limitations includes explanation
    expect(content.data.limitations.length).toBeGreaterThan(0);
    expect(content.data.limitations.some((l: string) => l.includes("Ash"))).toBe(true);

    // Verify assumptions include default ash value
    expect(content.data.assumptions.length).toBeGreaterThan(0);
    expect(content.data.assumptions.some((a: string) => a.includes("ash"))).toBe(true);
  });

  it("returns error for non-existent product", async () => {
    // Mock client to return undefined (404)
    vi.spyOn(client, "getProductDetail").mockResolvedValue(undefined);

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      bucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "non-existent" });

    const content = JSON.parse(result.content[0].text);

    expect(content.error).toBeDefined();
    expect(content.error.type).toBe("NOT_FOUND");
    expect(content.error.message).toContain("not found");
  });

  it("correctly classifies ingredients", async () => {
    // Mock product with various ingredient types
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      id: "prod-789",
      name: "Mixed Ingredient Food",
      form: "dry",
      nutrition: {
        protein: 35,
        fat: 15,
        moisture: 10,
        ash: 8,
      },
      ingredientsFull: [
        "chicken", // animal protein
        "salmon", // animal protein
        "pea protein", // plant protein
        "rice", // grain/starch
        "potato", // grain/starch
        "taurine", // additive
        "vitamin E", // additive
        "unknown ingredient", // other
      ],
    });

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      bucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "prod-789" });

    const content = JSON.parse(result.content[0].text);

    expect(content.data).toBeDefined();
    expect(content.data.ingredients.topIngredients).toBeDefined();

    const classifications = content.data.ingredients.topIngredients;

    // Find chicken classification
    const chicken = classifications.find((c: { name: string }) => c.name === "chicken");
    expect(chicken).toBeDefined();
    expect(chicken.categories).toContain("animalProtein");

    // Find salmon classification
    const salmon = classifications.find((c: { name: string }) => c.name === "salmon");
    expect(salmon).toBeDefined();
    expect(salmon.categories).toContain("animalProtein");

    // Find pea protein classification
    const peaProtein = classifications.find((c: { name: string }) => c.name === "pea protein");
    expect(peaProtein).toBeDefined();
    expect(peaProtein.categories).toContain("plantProtein");

    // Find rice classification
    const rice = classifications.find((c: { name: string }) => c.name === "rice");
    expect(rice).toBeDefined();
    expect(rice.categories).toContain("grainStarch");

    // Find potato classification
    const potato = classifications.find((c: { name: string }) => c.name === "potato");
    expect(potato).toBeDefined();
    expect(potato.categories).toContain("grainStarch");

    // Find unknown ingredient classification (should be "other")
    const unknown = classifications.find((c: { name: string }) => c.name === "unknown ingredient");
    expect(unknown).toBeDefined();
    expect(unknown.categories).toContain("other");
  });

  it("includes rate limit info in response", async () => {
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      id: "prod-123",
      name: "Test Product",
      nutrition: { protein: 40 },
    });

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      bucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "prod-123" });

    const content = JSON.parse(result.content[0].text);

    // Verify rate limit info is present
    expect(content.rateLimit).toBeDefined();
    expect(content.rateLimit.limit).toBe(100);
    expect(typeof content.rateLimit.remaining).toBe("number");
    expect(typeof content.rateLimit.resetEpochMs).toBe("number");
  });

  it("handles rate limit exceeded", async () => {
    // Create a bucket manager with 0 tokens to simulate rate limit
    const limitedBucketManager = new TokenBucketManager(0, 60000);

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      limitedBucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "prod-123" });

    const content = JSON.parse(result.content[0].text);

    expect(content.error).toBeDefined();
    expect(content.error.type).toBe("RATE_LIMITED");
    expect(content.error.message).toContain("Rate limit exceeded");
    expect(content.retryAfterSeconds).toBeDefined();
    expect(typeof content.retryAfterSeconds).toBe("number");
  });

  it("should extract product from wrapped { product } response", async () => {
    // Mock API returning wrapped format { product: {...} }
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: {
        id: "prod-wrapped",
        name: "Wrapped Response Product",
        form: "dry",
        nutrition: {
          protein: 42,
          fat: 18,
          fiber: 4,
          moisture: 10,
          ash: 7,
        },
        ingredientsFull: ["chicken", "turkey", "rice"],
      },
    });

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      bucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "prod-wrapped" });

    const content = JSON.parse(result.content[0].text);

    // Verify the tool correctly extracted product from wrapped response
    expect(content.data).toBeDefined();
    expect(content.data.productId).toBe("prod-wrapped");
    expect(content.data.productName).toBe("Wrapped Response Product");
    expect(content.data.asFed.protein).toBe(42);
    expect(content.data.ingredients.totalCount).toBe(3);
  });

  it("should handle unwrapped response for backward compatibility", async () => {
    // Mock API returning unwrapped format (direct product object)
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      id: "prod-unwrapped",
      name: "Unwrapped Response Product",
      form: "wet",
      nutrition: {
        protein: 12,
        fat: 6,
        fiber: 1,
        moisture: 78,
        ash: 2,
      },
      ingredientsFull: ["salmon", "fish broth", "potato"],
    });

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      bucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "prod-unwrapped" });

    const content = JSON.parse(result.content[0].text);

    // Verify the tool works with unwrapped response
    expect(content.data).toBeDefined();
    expect(content.data.productId).toBe("prod-unwrapped");
    expect(content.data.productName).toBe("Unwrapped Response Product");
    expect(content.data.asFed.protein).toBe(12);
    expect(content.data.ingredients.totalCount).toBe(3);
  });

  it("should handle null/undefined product in wrapped response", async () => {
    // Mock API returning wrapped format with null product
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: null,
    });

    const mockServer = createMockServer();
    registerAnalyzeNutritionTool(
      mockServer as Parameters<typeof registerAnalyzeNutritionTool>[0],
      client,
      bucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ productId: "prod-null" });

    const content = JSON.parse(result.content[0].text);

    // Should return error for non-existent product
    expect(content.error).toBeDefined();
    expect(content.error.type).toBe("NOT_FOUND");
    expect(content.error.message).toContain("not found");
  });
});
