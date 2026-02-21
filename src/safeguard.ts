const AFFILIATE_PATTERNS: readonly RegExp[] = [
  /tag=/i,
  /amazon\./i,
  /amzn\./i, // Amazon short links
  /a\.co/i, // Amazon URL shortener
  /\/dp\//i,
  /\/gp\/product\//i,
  /affiliate/i,
  /ref=/i,
  /referral/i,
  /subid=/i,
  /clickid=/i,
];

/**
 * Safely URL decodes a string, returning original if decoding fails.
 */
function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Return original if decoding fails (e.g., malformed URI)
    return value;
  }
}

/**
 * Checks if a string contains affiliate link patterns.
 * Performs URL decoding and case-insensitive matching.
 */
function containsAffiliatePattern(value: string): boolean {
  // URL decode to catch encoded patterns like tag%3D
  const decoded = safeDecodeURIComponent(value);

  // Check both original and decoded strings
  const stringsToCheck = [value, decoded];

  for (const str of stringsToCheck) {
    // Convert to lowercase for case-insensitive matching
    const lowerStr = str.toLowerCase();
    if (AFFILIATE_PATTERNS.some((p) => p.test(lowerStr))) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively checks object for affiliate link patterns without full JSON serialization.
 * More memory-efficient for large objects.
 */
function checkObjectForAffiliateLinks(data: unknown, visited: Set<unknown>): boolean {
  // Check strings directly
  if (typeof data === "string") {
    return containsAffiliatePattern(data);
  }

  // Handle objects and arrays (with cycle detection)
  if (data && typeof data === "object" && !visited.has(data)) {
    visited.add(data);

    if (Array.isArray(data)) {
      for (const item of data) {
        if (checkObjectForAffiliateLinks(item, visited)) {
          return true;
        }
      }
    } else {
      for (const value of Object.values(data)) {
        if (checkObjectForAffiliateLinks(value, visited)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function assertNoAffiliateLinks(data: unknown): void {
  const visited = new Set<unknown>();
  if (checkObjectForAffiliateLinks(data, visited)) {
    throw new Error("Affiliate link leak detected in response");
  }
}
