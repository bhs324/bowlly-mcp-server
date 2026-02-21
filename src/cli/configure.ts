/**
 * Claude Desktop configuration automation
 */
import fs from "fs/promises";
import os from "os";
import path from "path";

interface ClaudeConfig {
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

function getClaudeConfigPath(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return path.join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
    default:
      return path.join(home, ".config", "Claude", "claude_desktop_config.json");
  }
}

export async function configureClaudeDesktop(): Promise<void> {
  const configPath = getClaudeConfigPath();

  try {
    // Read existing config or create new
    let config: ClaudeConfig = {};
    try {
      const content = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid, start fresh
      console.log("Creating new Claude Desktop configuration...");
    }

    // Ensure mcpServers exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add/update FitPick server config
    const apiKey = process.env.FITPICK_API_KEY || "";
    config.mcpServers.fitpick = {
      command: "npx",
      args: ["-y", "@bowlly/mcp-server"],
      env: apiKey ? { FITPICK_API_KEY: apiKey } : undefined,
    };

    // Ensure directory exists
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    // Write config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // Set restrictive permissions on Unix-like systems (macOS/Linux)
    // Windows ignores chmod, so this is safe cross-platform
    if (process.platform !== "win32") {
      await fs.chmod(configPath, 0o600);
    }

    console.log(`✓ Claude Desktop configured at: ${configPath}`);
    console.log("  The FitPick MCP server has been added to your Claude Desktop.");
  } catch (error) {
    console.error("❌ Failed to configure Claude Desktop:", error instanceof Error ? error.message : error);
    console.log("\nManual configuration required:");
    console.log(`1. Open: ${configPath}`);
    console.log("2. Add the following to mcpServers:");
    console.log(
      JSON.stringify(
        {
          fitpick: {
            command: "npx",
            args: ["-y", "@bowlly/mcp-server"],
          },
        },
        null,
        2
      )
    );
  }
}

export function getManualConfigSnippet(): string {
  return `
Manual Claude Desktop configuration:

1. Open Claude Desktop settings (Cmd/Ctrl + ,)
2. Go to Developer → Edit Config
3. Add to claude_desktop_config.json:

{
  "mcpServers": {
    "fitpick": {
      "command": "npx",
      "args": ["-y", "@bowlly/mcp-server"],
      "env": {
        "FITPICK_API_KEY": "your-api-key-here"
      }
    }
  }
}

4. Save and restart Claude Desktop
`;
}
