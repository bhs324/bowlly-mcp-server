/**
 * MCP Server Type Definitions
 *
 * Standalone types for the MCP server package.
 * NO imports from @fitpick/core - this package is self-contained.
 */

// ============================================
// Nutrition Types
// ============================================

export interface NutritionInfo {
  protein?: number;
  fat?: number;
  fiber?: number;
  moisture?: number;
}

// ============================================
// Derived Metrics Types
// ============================================

export interface DerivedMetricsInfo {
  meatScore?: number;
  carbEstimated?: number;
}

// ============================================
// Product Type (NO affiliate fields)
// ============================================

export interface ProductInfo {
  id: string;
  name: string;
  brand: string;
  detailUrl: string; // FitPick product page with ?src=agent
  imageUrl?: string;
  form?: "dry" | "wet";
  lifeStageTags?: string[];
  conditionTags?: string[];
  ingredientsPreview?: string[]; // top 5 ingredients (list view)
  ingredientsFull?: string[]; // full ingredient list (detail view)
  nutrition?: NutritionInfo;
  derivedMetrics?: DerivedMetricsInfo;
  energyKcalPerKg?: number;
  hasOffer: boolean; // boolean only, no price/URL
}

// ============================================
// Rate Limiting Types
// ============================================

// Rate limit metadata included in every tool response
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetEpochMs: number;
}

export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [x: string]: unknown;
}

// ============================================
// Error Handling Types
// ============================================

/** Standardized error types for tool responses */
export type ToolErrorType = "NOT_FOUND" | "RATE_LIMITED" | "VALIDATION" | "INTERNAL";

/** Structured error information */
export interface ToolError {
  type: ToolErrorType;
  message: string;
  details?: unknown;
}

/** Standardized error response structure */
export interface ErrorResponse {
  error: ToolError;
  rateLimit: RateLimitInfo;
}

// ============================================
// Search Tool Types
// ============================================

/** Lean item shape for search results — minimal data, use get_product_detail for full info */
export interface SearchResultItem {
  id: string;
  name: string;
  brand: string;
  form?: "dry" | "wet";
  /** Top 3 ingredients for quick scan */
  ingredientsPreview: string[];
  /** FitPick product page URL with ?src=agent tracking */
  detailUrl: string;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  hasMore: boolean;
  cursor: number;
  rateLimit: RateLimitInfo;
}

// ============================================
// Detail Tool Types
// ============================================

export interface DetailResult {
  product: ProductInfo;
  rateLimit: RateLimitInfo;
}

// ============================================
// Compare Tool Types
// ============================================

export interface CompareResult {
  products: ProductInfo[];
  requested: number;
  compared: number;
  rateLimit: RateLimitInfo;
}

// ============================================
// Nutrition Analysis Types
// ============================================

export interface IngredientClassification {
  name: string;
  categories: ("animalProtein" | "plantProtein" | "grainStarch" | "additives" | "other")[];
}

export interface NutritionAnalysisResult {
  productId: string;
  productName: string;
  asFed: {
    protein?: number;
    fat?: number;
    fiber?: number;
    moisture?: number;
    ash?: number;
  };
  carbohydrates: {
    asFed?: number;
    isEstimated: boolean;
    dmb?: number;
  };
  dmb: {
    protein?: number;
    fat?: number;
    fiber?: number;
    ash?: number;
    carbEstimated?: number;
  };
  ingredients: {
    totalCount: number;
    topIngredients: IngredientClassification[];
  };
  assumptions: string[];
  limitations: string[];
  disclaimer: string;
}

export const NUTRITION_DISCLAIMER =
  "This analysis is for informational purposes only and is not veterinary advice. Consult a veterinarian for specific dietary recommendations.";

// ============================================
// Curation Types
// ============================================

export interface RecommendedProductSummary {
  id: string;
  name: string;
  brand: string;
  form?: "dry" | "wet";
  keyNutrition?: {
    protein?: number;
    carbEstimated?: number;
  };
  detailToolLink: string;
}

export interface CurationResult {
  slug: string;
  title: string;
  description: string;
  tldr: string[];
  criteria: string[];
  methodology: string;
  recommendedProductIds: string[];
  recommendedProducts: (RecommendedProductSummary | { id: string; error: string })[];
  updatedAt: string;
  canonicalUrl: string;
  sections?: Array<{
    heading: string;
    capsule: string;
    content: string;
  }>;
  faq?: Array<{
    question: string;
    answer: string;
  }>;
}

// ============================================
// Compile-time type assertions
// ============================================

// Compile-time guarantee: ProductInfo cannot contain affiliate fields
type AssertNoAffiliateFields = ProductInfo extends { offerUrl: unknown } ? never : true;
type AssertNoAffiliateLink = ProductInfo extends { affiliateLink: unknown } ? never : true;
type AssertNoAsin = ProductInfo extends { asin: unknown } ? never : true;
type AssertNoTag = ProductInfo extends { tag: unknown } ? never : true;
type AssertNoMerchantUrl = ProductInfo extends { merchantUrl: unknown } ? never : true;
type AssertNoAffiliateTag = ProductInfo extends { affiliateTag: unknown } ? never : true;

// These assignments succeed only if McpProduct lacks the checked fields
const _assertNoAffiliate: AssertNoAffiliateFields = true as const;
const _assertNoLink: AssertNoAffiliateLink = true as const;
const _assertNoAsin: AssertNoAsin = true as const;
const _assertNoTag: AssertNoTag = true as const;
const _assertNoMerchantUrl: AssertNoMerchantUrl = true as const;
const _assertNoAffiliateTag: AssertNoAffiliateTag = true as const;

// Silence unused variable warnings while keeping type assertions
void _assertNoAffiliate;
void _assertNoLink;
void _assertNoAsin;
void _assertNoTag;
void _assertNoMerchantUrl;
void _assertNoAffiliateTag;
