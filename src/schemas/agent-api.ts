import { z } from "zod";

/**
 * NOTE: These schemas reflect the currently deployed Agent API shape at
 * `https://api.bowlly.net/agent/*` (no `/v1` prefix).
 */

const AgentProductListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string(),
  detailUrl: z.string(),
  imageUrl: z.string().optional(),
  form: z.enum(["dry", "wet"]).optional(),
  lifeStageTags: z.array(z.string()).optional(),
  conditionTags: z.array(z.string()).optional(),
  // Optional: some environments may include ingredient previews in list responses.
  ingredientsPreview: z.array(z.string()).optional(),
  ingredientsFull: z.array(z.string()).optional(),
  nutrition: z
    .object({
      protein: z.number().optional(),
      fat: z.number().optional(),
      fiber: z.number().optional(),
      moisture: z.number().optional(),
    })
    .optional(),
  derivedMetrics: z
    .object({
      meatScore: z.number().optional(),
      carbEstimated: z.number().optional(),
    })
    .optional(),
});

export const ApiProductSchema = z.object({
  product: z.object({
    id: z.string(),
    name: z.string(),
    brand: z.string(),
    detailUrl: z.string(),
    imageUrl: z.string(),
    form: z.enum(["dry", "wet"]),
    lifeStageTags: z.array(z.string()),
    conditionTags: z.array(z.string()),
    nutrition: z
      .object({
        protein: z.number().optional(),
        fat: z.number().optional(),
        fiber: z.number().optional(),
        moisture: z.number().optional(),
      })
      .optional(),
    derivedMetrics: z
      .object({
        meatScore: z.number().optional(),
        carbEstimated: z.number().optional(),
      })
      .optional(),
    ingredientsPreview: z.array(z.string()),
    ingredientsFull: z.array(z.string()),
    energyKcalPerKg: z.number().optional(),
    hasOffer: z.boolean(),
  }),
});

export const AgentProductsResponseSchema = z.object({
  items: z.array(AgentProductListItemSchema),
  meta: z.object({
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
    hasMore: z.boolean().optional(),
  }),
});

export const AgentCompareResponseSchema = z.object({
  products: z.array(AgentProductListItemSchema),
  compared: z.number(),
  requested: z.number(),
});

export type AgentProductsResponse = z.infer<typeof AgentProductsResponseSchema>;
export type AgentCompareResponse = z.infer<typeof AgentCompareResponseSchema>;

export type AgentProductListItem = z.infer<typeof AgentProductListItemSchema>;
