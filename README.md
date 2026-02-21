# Bowlly MCP Server

[![npm version](https://img.shields.io/npm/v/@bowlly/mcp-server.svg)](https://www.npmjs.com/package/@bowlly/mcp-server)

MCP (Model Context Protocol) server for Bowlly cat food product search and ingredient analysis.
Enables Claude Desktop to search, analyze, and compare cat food products.

## Prerequisites

- **Node.js 22+** - Required for running the MCP server
- **Claude Desktop** - [Download here](https://claude.ai/download) if not installed

## Quick Start

### Option 1: One-Command Setup (Recommended)

```bash
npx @bowlly/mcp-server --setup
```

After running, restart Claude Desktop and you're ready to go!

### Option 2: Manual Configuration

1. **Edit your Claude Desktop config** at the appropriate path for your OS:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. **Add the Bowlly server configuration**:

```json
{
  "mcpServers": {
    "bowlly": {
      "command": "npx",
      "args": ["-y", "@bowlly/mcp-server"]
    }
  }
}
```

3. **Save the file and restart Claude Desktop**

## Available Tools

| Tool                 | Description                             |
| -------------------- | --------------------------------------- |
| `search_products`    | Search by ingredients, conditions, form |
| `get_product_detail` | Full product info with ingredients      |
| `compare_products`   | Side-by-side comparison                 |
| `analyze_nutrition`  | Ingredient breakdown & carb analysis    |
| `get_curation_list`  | Best-of category recommendations        |

### Example Natural Language Queries

```
"Find grain-free dry cat foods"
"Show me wet foods without chicken"
"Analyze the nutrition of Blue Buffalo Wilderness"
"Compare Orijen and Acana cat foods"
"What are the best low-carb options?"
"Show me foods for cats with sensitive stomachs"
```

## Configuration

### Config File Locations by Platform

| Platform | Path                                                              |
| -------- | ----------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows  | `%APPDATA%/Claude/claude_desktop_config.json`                     |
| Linux    | `~/.config/Claude/claude_desktop_config.json`                     |

## Verification

To confirm the MCP server is working:

1. **Restart Claude Desktop** (required after configuration changes)
2. **Open the tools menu** - Look for the hammer icon in the bottom left
3. **Verify Bowlly tools appear** - You should see 5 tools listed
4. **Test with a query**: Try asking "Find grain-free dry cat foods"

## Troubleshooting

### Tools not showing in Claude?

- **Restart Claude Desktop** - Configuration changes require a restart
- **Check the config file path** - Ensure you're editing the correct file for your OS
- **Verify JSON syntax** - Use a JSON validator if unsure
- **Check Claude Desktop logs**:
  - macOS: `~/Library/Logs/Claude/`
  - Windows: `%APPDATA%/Claude/Logs/`
  - Linux: `~/.config/Claude/Logs/`

### "Command not found" errors?

- **Ensure Node.js 22+ is installed**: `node --version`
- **Try with npx**: `npx @bowlly/mcp-server --setup`
- **Global install fallback**: `npm install -g @bowlly/mcp-server`

### Configuration not persisting?

- **Check file permissions** - Ensure you have write access to the config directory
- **Use absolute paths** - Relative paths may not resolve correctly
- **Validate JSON format** - Missing commas or brackets are common issues

## License

MIT
