import { describe, it, expect } from "vitest";

import { assertNoAffiliateLinks } from "../safeguard.js";

describe("assertNoAffiliateLinks", () => {
  it("passes clean ProductInfo data", () => {
    const cleanData = {
      id: "prod-123",
      name: "Premium Cat Food",
      brand: "Whiskas",
      detailUrl: "https://bowlly.net/products/x?src=agent",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(cleanData)).not.toThrow();
  });

  it("detects tag= pattern in response", () => {
    const dataWithTag = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https://example.com/product?tag=fitpick-20",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithTag)).toThrow("Affiliate link leak detected");
  });

  it("detects amazon. domain", () => {
    const dataWithAmazon = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https://amazon.com/dp/B001234",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithAmazon)).toThrow("Affiliate link leak detected");
  });

  it("detects /dp/ path", () => {
    const dataWithDpPath = {
      id: "prod-123",
      name: "Premium Cat Food",
      someField: "/dp/B001234",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithDpPath)).toThrow("Affiliate link leak detected");
  });

  it("detects patterns in nested objects", () => {
    const nestedDataWithAffiliate = {
      id: "prod-123",
      metadata: {
        source: {
          url: "https://amazon.com/dp/B001234?tag=fitpick-20",
        },
      },
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(nestedDataWithAffiliate)).toThrow("Affiliate link leak detected");
  });

  it("handles null and undefined values", () => {
    const dataWithNulls = {
      id: "prod-123",
      name: null,
      description: undefined,
      detailUrl: "https://bowlly.net/products/x",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithNulls)).not.toThrow();
  });

  it("detects amazon. in any field", () => {
    const dataWithAmazonInName = {
      id: "prod-123",
      name: "Available at amazon.com now",
      detailUrl: "https://bowlly.net/products/x",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithAmazonInName)).toThrow("Affiliate link leak detected");
  });

  it("detects tag= in nested arrays", () => {
    const dataWithTagInArray = {
      id: "prod-123",
      tags: ["cat-food", "tag=affiliate-code"],
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithTagInArray)).toThrow("Affiliate link leak detected");
  });

  it("passes with bowlly.net domain", () => {
    const dataWithBowlly = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https://bowlly.net/products/abc123?src=agent",
      imageUrl: "https://cdn.bowlly.net/images/abc.jpg",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithBowlly)).not.toThrow();
  });

  // Bypass detection tests (30-01)
  it("detects URL-encoded tag pattern (tag%3D)", () => {
    const dataWithEncodedTag = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https://example.com/product?tag%3Dfitpick-20",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithEncodedTag)).toThrow("Affiliate link leak detected");
  });

  it("detects uppercase AMAZON.COM domain", () => {
    const dataWithUppercaseAmazon = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https://AMAZON.COM/dp/B001234",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithUppercaseAmazon)).toThrow("Affiliate link leak detected");
  });

  it("detects amazon.co.uk international domain", () => {
    const dataWithUkAmazon = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https://amazon.co.uk/dp/B001234",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithUkAmazon)).toThrow("Affiliate link leak detected");
  });

  it("detects amzn.com short link", () => {
    const dataWithAmznShortLink = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https://amzn.com/dp/B001234",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithAmznShortLink)).toThrow("Affiliate link leak detected");
  });

  it("detects a.co URL shortener", () => {
    const dataWithACo = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https://a.co/d/abc123",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithACo)).toThrow("Affiliate link leak detected");
  });

  it("detects encoded amazon domain with tag", () => {
    const dataWithEncodedAmazon = {
      id: "prod-123",
      name: "Premium Cat Food",
      detailUrl: "https%3A%2F%2Famazon.com%2Fdp%2FB001234%3Ftag%3Dfitpick-20",
      hasOffer: true,
    };

    expect(() => assertNoAffiliateLinks(dataWithEncodedAmazon)).toThrow("Affiliate link leak detected");
  });
});
