import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { AgentApiClient } from "../client.js";
import { TokenBucketManager } from "../rate-limit.js";
import { registerSearchTool } from "../tools/search-products.js";

describe("search_products tool", () => {
  let client: AgentApiClient;
  let bucketManager: TokenBucketManager;
  const getClientId = () => "test-client";
  let capturedHandler:
    | ((args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>)
    | null = null;

  // Mock server that captures the registered tool handler
  // Supports both 3-param (name, schema, handler) and 4-param (name, description, schema, handler) signatures
  const createMockServer = () => {
    return {
      tool: (name: string, arg2: unknown, arg3: unknown, arg4?: unknown) => {
        if (name === "search_products") {
          // 4-param signature: (name, description, schema, handler)
          // 3-param signature: (name, schema, handler)
          const handler =
            arg4 !== undefined
              ? (arg4 as (
                  args: unknown
                ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>)
              : (arg3 as (
                  args: unknown
                ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>);
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

  // Helper to create mock products with ingredientsPreview
  const createMockProducts = () => [
    {
      id: "prod-1",
      name: "Chicken Delight",
      brand: "Premium Pet",
      form: "dry" as const,
      detailUrl: "https://fitpick.com/products/prod-1",
      imageUrl: "https://fitpick.com/images/prod-1.jpg",
      ingredientsPreview: ["chicken meal", "rice", "pea protein"],
      ingredientsFull: ["chicken meal", "rice", "pea protein", "chicken fat", "taurine"],
      conditionTags: ["sensitive"],
      lifeStageTags: ["adult"],
      hasOffer: true,
    },
    {
      id: "prod-2",
      name: "Salmon Feast",
      brand: "Ocean Catch",
      form: "wet" as const,
      detailUrl: "https://fitpick.com/products/prod-2",
      imageUrl: "https://fitpick.com/images/prod-2.jpg",
      ingredientsPreview: ["salmon", "chicken", "fish broth"],
      ingredientsFull: ["salmon", "chicken", "fish broth", "vitamin E", "taurine"],
      conditionTags: ["urinary"],
      lifeStageTags: ["adult", "senior"],
      hasOffer: true,
    },
    {
      id: "prod-3",
      name: "Grain Free Formula",
      brand: "Healthy Cat",
      form: "dry" as const,
      detailUrl: "https://fitpick.com/products/prod-3",
      imageUrl: "https://fitpick.com/images/prod-3.jpg",
      ingredientsPreview: ["turkey", "chicken meal", "potato"],
      ingredientsFull: ["turkey", "chicken meal", "potato", "pea protein", "flaxseed"],
      conditionTags: ["diet"],
      lifeStageTags: ["kitten", "adult"],
      hasOffer: false,
    },
    {
      id: "prod-4",
      name: "Grain Mix",
      brand: "Budget Pet",
      form: "dry" as const,
      detailUrl: "https://fitpick.com/products/prod-4",
      imageUrl: "https://fitpick.com/images/prod-4.jpg",
      ingredientsPreview: ["corn", "wheat", "chicken by-product"],
      ingredientsFull: ["corn", "wheat", "chicken by-product", "soybean meal", "vitamins"],
      conditionTags: ["indoor"],
      lifeStageTags: ["adult"],
      hasOffer: true,
    },
  ];

  beforeEach(() => {
    client = new AgentApiClient();
    bucketManager = new TokenBucketManager(100, 60000);
    capturedHandler = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should filter by ingredientsPreview with partial matching", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ includeIngredients: "chicken" });

    const content = JSON.parse(result.content[0].text);

    // Should match prod-1 ("chicken meal"), prod-2 ("chicken"), prod-3 ("chicken meal")
    // Should NOT match prod-4 ("chicken by-product" contains "chicken")
    expect(content.data.items).toHaveLength(4); // All have "chicken" in ingredientsPreview

    // Verify partial matching works - "chicken" matches "chicken meal"
    const productNames = content.data.items.map((item: { name: string }) => item.name);
    expect(productNames).toContain("Chicken Delight");
    expect(productNames).toContain("Salmon Feast");
    expect(productNames).toContain("Grain Free Formula");
    expect(productNames).toContain("Grain Mix");
  });

  it("should use exact matching for quoted ingredients", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    // Exact match for "chicken meal" - should NOT match "chicken" alone
    const result = await getHandler()({ includeIngredients: '"chicken meal"' });

    const content = JSON.parse(result.content[0].text);

    // Should match prod-1 and prod-3 (have "chicken meal")
    // Should NOT match prod-2 (only has "chicken", not "chicken meal")
    expect(content.data.items).toHaveLength(2);

    const productNames = content.data.items.map((item: { name: string }) => item.name);
    expect(productNames).toContain("Chicken Delight");
    expect(productNames).toContain("Grain Free Formula");
    expect(productNames).not.toContain("Salmon Feast");
  });

  it("should exclude products with excluded ingredients in ingredientsPreview", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ excludeIngredients: "corn" });

    const content = JSON.parse(result.content[0].text);

    // Should exclude prod-4 (has "corn")
    expect(content.data.items).toHaveLength(3);

    const productNames = content.data.items.map((item: { name: string }) => item.name);
    expect(productNames).toContain("Chicken Delight");
    expect(productNames).toContain("Salmon Feast");
    expect(productNames).toContain("Grain Free Formula");
    expect(productNames).not.toContain("Grain Mix");
  });

  it("should require ALL include terms to match (AND logic)", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    // Must have BOTH chicken AND rice
    const result = await getHandler()({ includeIngredients: "chicken,rice" });

    const content = JSON.parse(result.content[0].text);

    // Only prod-1 has both "chicken" (in "chicken meal") and "rice"
    expect(content.data.items).toHaveLength(1);
    expect(content.data.items[0].name).toBe("Chicken Delight");
  });

  it("should provide suggestions when no exact matches found", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    // Exact match for "chick" - no product has "chick" as a whole word
    // But "chicken" contains "chick" so relaxed matching would find matches
    const result = await getHandler()({ includeIngredients: '"chick"' });

    const content = JSON.parse(result.content[0].text);

    // Should return empty items (no exact match for "chick" as whole word)
    expect(content.data.items).toHaveLength(0);

    // Should provide suggestions (relaxed matching finds "chicken")
    expect(content.data.suggestions).toBeDefined();
    expect(content.data.suggestions.length).toBeGreaterThan(0);
    expect(content.data.suggestions[0]).toContain("No exact matches found");
  });

  it("should handle case-insensitive matching", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    // Uppercase search term
    const result = await getHandler()({ includeIngredients: "CHICKEN" });

    const content = JSON.parse(result.content[0].text);

    // Should match all products with "chicken" (case insensitive)
    expect(content.data.items.length).toBeGreaterThan(0);

    const productNames = content.data.items.map((item: { name: string }) => item.name);
    expect(productNames).toContain("Chicken Delight");
  });

  it("should include filterNote in response when ingredient filtering is used", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ includeIngredients: "chicken" });

    const content = JSON.parse(result.content[0].text);

    expect(content.data.filterNote).toBeDefined();
    expect(content.data.filterNote).toContain("partial matching");
    expect(content.data.filterNote).toContain("quotes");
  });

  it("should handle combined include and exclude filters", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    // Include chicken, exclude corn
    const result = await getHandler()({
      includeIngredients: "chicken",
      excludeIngredients: "corn",
    });

    const content = JSON.parse(result.content[0].text);

    // Should have chicken but not corn
    const productNames = content.data.items.map((item: { name: string }) => item.name);
    expect(productNames).toContain("Chicken Delight");
    expect(productNames).toContain("Salmon Feast");
    expect(productNames).toContain("Grain Free Formula");
    expect(productNames).not.toContain("Grain Mix"); // Has corn
  });

  it("should include rate limit info in response", async () => {
    vi.spyOn(client, "getProducts").mockResolvedValue({
      items: createMockProducts(),
      meta: { total: 4, limit: 200, offset: 0, hasMore: false },
    });

    const mockServer = createMockServer();
    registerSearchTool(mockServer as Parameters<typeof registerSearchTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({});

    const content = JSON.parse(result.content[0].text);

    expect(content.rateLimit).toBeDefined();
    expect(content.rateLimit.limit).toBe(100);
    expect(typeof content.rateLimit.remaining).toBe("number");
    expect(typeof content.rateLimit.resetEpochMs).toBe("number");
  });

  it("should handle rate limit exceeded", async () => {
    // Create a bucket manager with 0 tokens to simulate rate limit
    const limitedBucketManager = new TokenBucketManager(0, 60000);

    const mockServer = createMockServer();
    registerSearchTool(
      mockServer as Parameters<typeof registerSearchTool>[0],
      client,
      limitedBucketManager,
      getClientId
    );

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({});

    const content = JSON.parse(result.content[0].text);

    expect(content.error).toBeDefined();
    expect(content.error.type).toBe("RATE_LIMITED");
    expect(content.error.message).toContain("Rate limit exceeded");
    expect(content.retryAfterSeconds).toBeDefined();
    expect(typeof content.retryAfterSeconds).toBe("number");
  });
});
