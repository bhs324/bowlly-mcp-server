#!/usr/bin/env node
/**
 * Post-install hook for Bowlly MCP Server
 * Prompts user to run setup if not already configured
 */

const isGlobal = process.env.npm_config_global === "true" || process.env.NODE_ENV === "global";

// Skip in CI environments
if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
  process.exit(0);
}

console.log("\n🎉 Bowlly MCP Server installed!\n");

if (isGlobal) {
  console.log("To complete setup, run:");
  console.log("  fitpick-mcp --setup\n");
} else {
  console.log("To complete setup, run:");
  console.log("  npx @bowlly/mcp-server --setup\n");
}

console.log("Or configure manually:");
console.log("  https://bowlly.io/docs/mcp\n");
