/**
 * Nutrition Calculation Utilities
 *
 * Standalone nutrition calculation functions copied from @fitpick/core
 * to make MCP server independent.
 */

// ============================================
// Types (copied from @fitpick/core)
// ============================================

interface Nutrition {
  protein?: number;
  fat?: number;
  fiber?: number;
  moisture?: number;
  ash?: number;
}

type ProductForm = "dry" | "wet";

export interface CarbEstimatedResult {
  value: number | undefined;
  /** true if ash was missing and default value was used */
  isEstimated: boolean;
}

// ============================================
// Constants
// ============================================

const DEFAULT_DRY_ASH = 8; // %
const DEFAULT_WET_ASH = 2.5; // % (as-fed 기준)

// ============================================
// Functions
// ============================================

/**
 * 탄수화물 추정 비율 계산
 * 공식: 100 - (단백 + 지방 + 수분 + 섬유 + 회분)
 * @returns { value, isEstimated } - isEstimated는 ash 누락 시 기본값 사용했음을 표시
 */
export function calculateCarbEstimated(nutrition: Nutrition, options?: { form?: ProductForm }): CarbEstimatedResult {
  const { protein, fat, fiber, moisture } = nutrition;

  if (protein === undefined || fat === undefined || moisture === undefined) {
    return { value: undefined, isEstimated: false };
  }

  const fiberVal = fiber ?? 0;
  const ashMissing = nutrition.ash === undefined;
  const ash = nutrition.ash ?? (options?.form === "wet" ? DEFAULT_WET_ASH : DEFAULT_DRY_ASH);
  const carb = 100 - (protein + fat + fiberVal + moisture + ash);
  return {
    value: Math.max(0, Math.round(carb * 10) / 10),
    isEstimated: ashMissing,
  };
}
