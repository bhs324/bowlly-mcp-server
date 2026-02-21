import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { AgentApiClient } from "../client.js";
import { NotFoundError } from "../errors.js";
import { TokenBucketManager } from "../rate-limit.js";
// Import after mocking
import { registerCurationTool, clearProductCache } from "../tools/get-curation-list.js";

const mockCurationPage = {
  slug: "low-carb-cat-food",
  title: "Best Low Carb Cat Food (2026)",
  description: "Top rated low carbohydrate cat foods for diabetic cats",
  tldr: ["Low carb diets are essential for diabetic cats", "Wet food is generally lower in carbs"],
  criteria: ["Carbohydrates < 10%", "High quality animal protein"],
  methodology: "Our product selection process follows these principles: ...",
  recommendedProductIds: ["prod-123", "prod-456", "prod-789"],
  updatedAt: "2026-01-15",
  canonicalUrl: "/best/low-carb-cat-food",
  sections: [
    {
      heading: "Why Low Carb Matters",
      capsule: "Low carbohydrate cat food contains less than 10% carbs",
      content: "Cats evolved as obligate carnivores...",
    },
  ],
  faq: [{ question: "Why low carb?", answer: "Cats are obligate carnivores" }],
  meta: { apiVersion: "1.0.0", timestamp: "2026-02-21T00:00:00.000Z" },
};

describe("get_curation_list tool", () => {
  let client: AgentApiClient;
  let bucketManager: TokenBucketManager;
  const getClientId = () => "test-client";
  let capturedHandler: ((args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>) | null = null;

  // Mock server that captures the registered tool handler
  // McpServer.tool(name, description, paramsSchema, handler)
  const createMockServer = () => {
    return {
      tool: (
        name: string,
        _description: string,
        _schema: unknown,
        handler: (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>
      ) => {
        if (name === "get_curation_list") {
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
    clearProductCache();

    // Default: curation lookup succeeds (individual tests may override)
    vi.spyOn(client, "getCuration").mockResolvedValue(mockCurationPage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns curation data for valid slug", async () => {
    // Mock client.getProductDetail to return wrapped product response
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: {
        id: "prod-123",
        name: "Premium Low Carb Cat Food",
        brand: "Test Brand",
        detailUrl: "https://fitpick.example.com/products/prod-123",
        form: "wet",
        nutrition: { protein: 45 },
      },
    });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ slug: "low-carb-cat-food" });

    const content = JSON.parse(result.content[0].text);

    // Verify response structure
    expect(content.data).toBeDefined();
    expect(content.data.title).toBe("Best Low Carb Cat Food (2026)");
    expect(content.data.description).toBe("Top rated low carbohydrate cat foods for diabetic cats");
    expect(content.data.tldr).toHaveLength(2);
    expect(content.data.criteria).toContain("Carbohydrates < 10%");
    expect(content.data.methodology).toContain("selection process");
    expect(content.data.recommendedProductIds).toEqual(["prod-123", "prod-456", "prod-789"]);
    expect(content.data.updatedAt).toBe("2026-01-15");

    // Verify recommended products are enriched
    expect(content.data.recommendedProducts).toBeDefined();
    expect(content.data.recommendedProducts.length).toBeGreaterThan(0);
  });

  it("returns 404-like error for invalid slug", async () => {
    vi.spyOn(client, "getCuration").mockRejectedValueOnce(new NotFoundError("Curation", "non-existent-slug"));

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ slug: "non-existent-slug" });

    const content = JSON.parse(result.content[0].text);

    expect(content.error).toBeDefined();
    expect(content.error.type).toBe("NOT_FOUND");
    expect(content.error.message).toContain("not found");
  });

  it("handles missing products gracefully", async () => {
    // Mock to return wrapped product for first call, throw for second, return for third
    vi.spyOn(client, "getProductDetail")
      .mockResolvedValueOnce({
        product: {
          id: "prod-123",
          name: "Product 1",
          brand: "Brand A",
          detailUrl: "https://fitpick.example.com/products/prod-123",
          form: "dry",
          nutrition: { protein: 40 },
        },
      })
      .mockRejectedValueOnce(new Error("Product not found"))
      .mockResolvedValueOnce({
        product: {
          id: "prod-789",
          name: "Product 3",
          brand: "Brand C",
          detailUrl: "https://fitpick.example.com/products/prod-789",
          form: "wet",
          nutrition: { protein: 42 },
        },
      });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ slug: "low-carb-cat-food" });

    const content = JSON.parse(result.content[0].text);

    // Verify we have products array with mixed results
    expect(content.data.recommendedProducts).toBeDefined();
    const products = content.data.recommendedProducts;

    // Should have 3 products (top 3 from the list)
    expect(products.length).toBe(3);

    // First product should be successful
    expect(products[0]).toHaveProperty("name");

    // Second product should have error
    expect(products[1]).toHaveProperty("error");
    expect(products[1].id).toBe("prod-456");

    // Third product should be successful
    expect(products[2]).toHaveProperty("name");
  });

  it("includes extended content when requested", async () => {
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: {
        id: "prod-123",
        name: "Test Product",
        brand: "Test Brand",
        detailUrl: "https://fitpick.example.com/products/prod-123",
      },
    });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({
      slug: "low-carb-cat-food",
      includeSections: true,
      includeFaq: true,
    });

    const content = JSON.parse(result.content[0].text);

    // Verify sections are included
    expect(content.data.sections).toBeDefined();
    expect(content.data.sections.length).toBeGreaterThan(0);
    expect(content.data.sections[0]).toHaveProperty("heading");
    expect(content.data.sections[0]).toHaveProperty("capsule");
    expect(content.data.sections[0]).toHaveProperty("content");

    // Verify FAQ is included
    expect(content.data.faq).toBeDefined();
    expect(content.data.faq.length).toBeGreaterThan(0);
    expect(content.data.faq[0]).toHaveProperty("question");
    expect(content.data.faq[0]).toHaveProperty("answer");
  });

  it("excludes extended content by default", async () => {
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: {
        id: "prod-123",
        name: "Test Product",
        brand: "Test Brand",
        detailUrl: "https://fitpick.example.com/products/prod-123",
      },
    });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({
      slug: "low-carb-cat-food",
    });

    const content = JSON.parse(result.content[0].text);

    // Verify sections and FAQ are NOT included by default
    expect(content.data.sections).toBeUndefined();
    expect(content.data.faq).toBeUndefined();
  });

  it("includes rate limit info in response", async () => {
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: {
        id: "prod-123",
        name: "Test Product",
        brand: "Test Brand",
        detailUrl: "https://fitpick.example.com/products/prod-123",
      },
    });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ slug: "low-carb-cat-food" });

    const content = JSON.parse(result.content[0].text);

    // Verify rate limit info is present
    expect(content.rateLimit).toBeDefined();
    expect(content.rateLimit.limit).toBe(100);
    expect(typeof content.rateLimit.remaining).toBe("number");
    expect(typeof content.rateLimit.resetEpochMs).toBe("number");
  });

  it("should extract products from wrapped { product } responses in enrichTopProducts", async () => {
    // Mock API returning wrapped format { product: {...} }
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: {
        id: "prod-wrapped-123",
        name: "Wrapped Product",
        brand: "Test Brand",
        form: "dry" as const,
        nutrition: { protein: 40 },
        derivedMetrics: { carbEstimated: 15 },
      },
    });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ slug: "low-carb-cat-food" });

    const content = JSON.parse(result.content[0].text);

    // Verify enriched products contain correct data from wrapped responses
    expect(content.data.recommendedProducts).toBeDefined();
    expect(content.data.recommendedProducts.length).toBeGreaterThan(0);

    const firstProduct = content.data.recommendedProducts[0];
    expect(firstProduct.name).toBe("Wrapped Product");
    expect(firstProduct.brand).toBe("Test Brand");
    expect(firstProduct.form).toBe("dry");
    expect(firstProduct.keyNutrition.protein).toBe(40);
    expect(firstProduct.keyNutrition.carbEstimated).toBe(15);
  });

  it("should handle API responses with Zod validation", async () => {
    // Mock API returning wrapped format (validated by Zod in client.ts)
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: {
        id: "prod-validated-123",
        name: "Validated Product",
        brand: "Test Brand",
        detailUrl: "https://fitpick.example.com/products/prod-validated-123",
        form: "wet",
        nutrition: { protein: 35 },
        derivedMetrics: { carbEstimated: 8 },
      },
    });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ slug: "low-carb-cat-food" });

    const content = JSON.parse(result.content[0].text);

    // Verify enriched products work with Zod-validated responses
    expect(content.data.recommendedProducts).toBeDefined();
    expect(content.data.recommendedProducts.length).toBeGreaterThan(0);

    const firstProduct = content.data.recommendedProducts[0];
    expect(firstProduct.name).toBe("Validated Product");
    expect(firstProduct.brand).toBe("Test Brand");
    expect(firstProduct.form).toBe("wet");
  });

  it("should handle multiple wrapped responses", async () => {
    // Mock multiple wrapped responses (all validated by Zod in client.ts)
    vi.spyOn(client, "getProductDetail")
      .mockResolvedValueOnce({
        product: {
          id: "prod-multi-1",
          name: "Product 1",
          brand: "Brand A",
          detailUrl: "https://fitpick.example.com/products/prod-multi-1",
          nutrition: { protein: 42 },
        },
      })
      .mockResolvedValueOnce({
        product: {
          id: "prod-multi-2",
          name: "Product 2",
          brand: "Brand B",
          detailUrl: "https://fitpick.example.com/products/prod-multi-2",
          nutrition: { protein: 38 },
        },
      })
      .mockResolvedValueOnce({
        product: {
          id: "prod-multi-3",
          name: "Product 3",
          brand: "Brand C",
          detailUrl: "https://fitpick.example.com/products/prod-multi-3",
          nutrition: { protein: 45 },
        },
      });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ slug: "low-carb-cat-food" });

    const content = JSON.parse(result.content[0].text);

    // Verify all products are enriched correctly with Zod-validated responses
    expect(content.data.recommendedProducts).toBeDefined();
    expect(content.data.recommendedProducts.length).toBe(3);

    expect(content.data.recommendedProducts[0].name).toBe("Product 1");
    expect(content.data.recommendedProducts[1].name).toBe("Product 2");
    expect(content.data.recommendedProducts[2].name).toBe("Product 3");
  });

  it("should handle null product in wrapped response", async () => {
    // Mock wrapped response with null product
    vi.spyOn(client, "getProductDetail").mockResolvedValue({
      product: null,
    });

    const mockServer = createMockServer();
    registerCurationTool(mockServer as Parameters<typeof registerCurationTool>[0], client, bucketManager, getClientId);

    expect(capturedHandler).not.toBeNull();
    const result = await getHandler()({ slug: "low-carb-cat-food" });

    const content = JSON.parse(result.content[0].text);

    // Verify products with null data show error
    expect(content.data.recommendedProducts).toBeDefined();
    expect(content.data.recommendedProducts.length).toBeGreaterThan(0);

    const firstProduct = content.data.recommendedProducts[0];
    expect(firstProduct.error).toBe("Product not found");
  });
});
