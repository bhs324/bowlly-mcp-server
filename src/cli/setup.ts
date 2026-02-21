/**
 * Interactive CLI setup for Bowlly MCP Server
 * Handles API key provisioning and Claude Desktop configuration
 */
import readline from "readline";

import { configureClaudeDesktop } from "./configure.js";

export async function runSetup(): Promise<void> {
  console.log("🔧 Bowlly MCP Server Setup\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> => new Promise((resolve) => rl.question(question, resolve));

  try {
    // Check for existing config
    const existingKey = process.env.FITPICK_API_KEY;
    if (existingKey) {
      console.log("✓ API key already configured\n");
    } else {
      console.log("📋 API Key Setup");
      console.log("The Bowlly MCP server requires an API key.");
      console.log("Visit https://bowlly.io/developer to get your free API key.\n");

      const apiKey = await ask("Enter your Bowlly API key: ");
      if (!apiKey.trim()) {
        console.log("❌ Setup cancelled - API key is required");
        process.exit(1);
      }
      // Store for configuration
      process.env.FITPICK_API_KEY = apiKey.trim();
    }

    // Configure Claude Desktop
    console.log("\n🤖 Claude Desktop Configuration");
    const shouldConfigure = await ask("Configure Claude Desktop automatically? (Y/n): ");

    if (shouldConfigure.toLowerCase() !== "n") {
      await configureClaudeDesktop();
    } else {
      console.log("\nSkipping Claude Desktop configuration.");
      console.log("To configure manually, see: https://bowlly.io/docs/mcp");
    }

    console.log("\n✅ Setup complete!");
    console.log("\nNext steps:");
    console.log("1. Restart Claude Desktop if it's running");
    console.log("2. The Bowlly tools should now be available");
    console.log("\nTry asking Claude: 'Find grain-free dry cat foods'");
  } finally {
    rl.close();
  }
}
