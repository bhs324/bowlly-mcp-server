/**
 * Interactive CLI setup for Bowlly MCP Server
 * Configures Claude Desktop automatically
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
    // Configure Claude Desktop
    console.log("🤖 Claude Desktop Configuration");
    const shouldConfigure = await ask("Configure Claude Desktop automatically? (Y/n): ");

    if (shouldConfigure.toLowerCase() !== "n") {
      await configureClaudeDesktop();
    } else {
      console.log("\nSkipping Claude Desktop configuration.");
      console.log("See README.md for manual configuration instructions.");
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
