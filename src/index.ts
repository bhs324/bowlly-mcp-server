#!/usr/bin/env node
/**
 * Bowlly MCP Server Entry Point
 */

// Handle CLI commands before importing heavy dependencies
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Bowlly MCP Server - Cat food product search and analysis

Usage:
  npx @bowlly/mcp-server [options]
  fitpick-mcp [options]

Options:
  --setup, -s    Run interactive setup and configuration
  --version, -v  Show version number
  --help, -h     Show this help message

Environment Variables:
  FITPICK_API_KEY    Your Bowlly API key (required)
  FITPICK_API_BASE_URL  Bowlly API base URL (optional)
  FITPICK_API_URL       Alias for FITPICK_API_BASE_URL (optional)

For more information: https://bowlly.io/docs/mcp
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log("0.1.2");
  process.exit(0);
}

if (args.includes("--setup") || args.includes("-s")) {
  import("./cli/setup.js")
    .then(({ runSetup }) => runSetup())
    .catch((err) => {
      console.error("Failed to load setup module:", err);
      process.exit(1);
    });
} else {
  // Normal MCP server startup
  import("./server.js")
    .then(({ startServer }) => startServer())
    .catch((err) => {
      console.error("Failed to load server module:", err);
      process.exit(1);
    });
}
