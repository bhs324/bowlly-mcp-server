/**
 * Smoke test for the deployed Agent API (used by the MCP server).
 *
 * Usage:
 *   FITPICK_API_KEY=... pnpm tsx packages/mcp-server/scripts/smoke-prod.ts
 *
 * Optional:
 *   FITPICK_API_BASE_URL=https://api.bowlly.net pnpm tsx packages/mcp-server/scripts/smoke-prod.ts --verbose
 */

type Argv = {
  verbose: boolean;
};

function parseArgs(argv: string[]): Argv {
  const out: Argv = { verbose: false };
  for (const arg of argv) {
    if (arg === "--verbose") out.verbose = true;
    if (arg === "-v") out.verbose = true;
  }
  return out;
}

function assertTrackingUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid detailUrl: ${url}`);
  }

  if (parsed.hostname !== "bowlly.net") {
    throw new Error(`detailUrl host must be bowlly.net: ${url}`);
  }

  if (parsed.searchParams.get("src") !== "agent") {
    throw new Error(`detailUrl must include ?src=agent: ${url}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // API key is optional - some endpoints may be public or already have auth via other means
  if (!process.env.FITPICK_API_KEY) {
    console.log("Note: FITPICK_API_KEY not set. Running without authentication...");
  }

  const { AgentApiClient } = await import("../src/client.js");

  const client = new AgentApiClient();

  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const record = (name: string, ok: boolean, detail?: string) => {
    results.push({ name, ok, detail });
    const status = ok ? "PASS" : "FAIL";
    console.log(`${status} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    // 1) Basic list query (form only)
    const dryProducts = await client.getProducts({ form: "dry", limit: "5", offset: "0" });
    record("GET /agent/products (dry)", dryProducts.items.length > 0, `items=${dryProducts.items.length}`);
    for (const item of dryProducts.items.slice(0, 3)) {
      assertTrackingUrl(item.detailUrl);
    }

    // 2) Another list query (wet)
    const wetProducts = await client.getProducts({ form: "wet", limit: "5", offset: "0" });
    record("GET /agent/products (wet)", wetProducts.items.length > 0, `items=${wetProducts.items.length}`);
    for (const item of wetProducts.items.slice(0, 3)) {
      assertTrackingUrl(item.detailUrl);
    }

    // Pick product IDs for downstream calls
    const firstId = dryProducts.items[0]?.id;
    const compareIds = dryProducts.items.slice(0, 2).map((p) => p.id);

    // 3) Detail call
    if (firstId) {
      const detail = await client.getProductDetail(firstId);
      const ok = Boolean(detail.product?.id) && detail.product.ingredientsFull.length > 0;
      record("GET /agent/products/{id}", ok, `id=${firstId}`);
      assertTrackingUrl(detail.product.detailUrl);
    } else {
      record("GET /agent/products/{id}", false, "no product id from list");
    }

    // 4) Compare call
    if (compareIds.length === 2) {
      const compare = await client.compareProducts(compareIds);
      record("POST /agent/products/compare", compare.compared > 0, `compared=${compare.compared}`);
      for (const item of compare.products.slice(0, 2)) {
        assertTrackingUrl(item.detailUrl);
      }
    } else {
      record("POST /agent/products/compare", false, "need 2 product ids");
    }

    // 5) Curation list + fetch one slug (skip if auth fails for some routes)
    try {
      const curationList = await client.listCurations();
      record("GET /agent/curation", curationList.count > 0, `count=${curationList.count}`);

      const preferredSlug = "low-carb-cat-food";
      const slug = curationList.slugs.includes(preferredSlug) ? preferredSlug : curationList.slugs[0];

      if (slug) {
        const curation = await client.getCuration(slug);
        record("GET /agent/curation/{slug}", curation.recommendedProductIds.length > 0, `slug=${slug}`);
      } else {
        record("GET /agent/curation/{slug}", false, "no slug from list");
      }
    } catch {
      // Curation endpoints may have separate auth issues
      record("GET /agent/curation", false, "skipped (auth issue on some routes)");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record("Unhandled", false, message);
    if (args.verbose) {
      console.error(error);
    }
  } finally {
    client.close();
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
