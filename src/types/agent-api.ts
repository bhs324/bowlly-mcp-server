/**
 * Shared Agent API types for MCP tools
 *
 * Centralized type definitions to avoid duplication across tools.
 */

/**
 * Core product item returned by Agent API
 * Used by search_products and compare_products tools
 */
export interface AgentProductItem {
  id: string;
  name: string;
  brand: string;
  form?: "dry" | "wet";
  detailUrl: string;
  imageUrl?: string;
  lifeStageTags?: string[];
  conditionTags?: string[];
  ingredientsPreview?: string[];
  ingredientsFull?: string[];
  nutrition?: {
    protein?: number;
    fat?: number;
    fiber?: number;
    moisture?: number;
  };
  derivedMetrics?: {
    meatScore?: number;
    carbEstimated?: number;
  };
}

/**
 * Extended product item for search with pre-computed search text
 */
export interface SearchableProduct extends AgentProductItem {
  _searchText: string;
}

/**
 * Generic list response structure from Agent API
 */
export interface AgentListResponse<T> {
  items: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * Compare-specific product item (currently same as base)
 * Can be extended if compare endpoint returns additional fields
 */
export type AgentCompareItem = AgentProductItem;

/**
 * Agent API products list response structure
 * Used by search_products tool
 */
export interface AgentProductsResponse {
  items: AgentProductItem[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}
