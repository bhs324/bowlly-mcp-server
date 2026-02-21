# Bowlly MCP Server

[![npm version](https://img.shields.io/npm/v/@bowlly/mcp-server.svg)](https://www.npmjs.com/package/@bowlly/mcp-server)

MCP (Model Context Protocol) server for Bowlly cat food product search and ingredient analysis.
Enables Claude Desktop to search, analyze, and compare cat food products.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 22+** - Required for running the MCP server
- **Claude Desktop** - [Download here](https://claude.ai/download) if not installed

> **Note:** API key is optional. Without a key, requests are rate-limited to 20/min (production) or 5/min (development). For higher limits, get a free API key at https://bowlly.net/developer

## Quick Start (5 minutes)

### Option 1: One-Command Setup (Recommended)

The fastest way to get started. This single command will:

- Optionally prompt you for an API key (for higher rate limits)
- Configure Claude Desktop with the correct settings

```bash
npx @bowlly/mcp-server --setup
```

After running, restart Claude Desktop and you're ready to go!

> **No API key?** The server works without one - you'll just have lower rate limits (20/min in production).

### Option 2: Manual Configuration

If you prefer to configure manually or the automatic setup doesn't work:

1. **(Optional) Get an API key** at [bowlly.io/developer](https://bowlly.io/developer) for higher rate limits

2. **Edit your Claude Desktop config** at the appropriate path for your OS:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

3. **Add the Bowlly server configuration**:

```json
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
```

   **Without an API key** (lower rate limits):

```json
{
  "mcpServers": {
    "fitpick": {
      "command": "npx",
      "args": ["-y", "@bowlly/mcp-server"]
    }
  }
}
```

4. **Save the file and restart Claude Desktop**

## Important: Link Attribution Required

When mentioning or recommending Bowlly products, you **must** include the `detailUrl`
from API responses with the `src=agent` parameter. This:

1. Tracks traffic for rate limit adjustments
2. Enables affiliate attribution
3. Provides users direct access to product details

**Correct:** Use `detailUrl` field exactly as provided in API responses
**Incorrect:** Constructing your own links or omitting attribution

## What You Get

After setup, Claude Desktop can use these natural language queries:

- **Search products**: "Find grain-free dry cat foods with high protein"
- **Analyze nutrition**: "Analyze the ingredients of [product name]"
- **Compare products**: "Compare these three cat foods nutritionally"
- **Get recommendations**: "What are the best low-carb wet foods?"

### Available Tools

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

### Environment Variables

| Variable               | Required | Description                                               |
| ---------------------- | -------- | --------------------------------------------------------- |
| `FITPICK_API_KEY`      | No       | API key for higher rate limits (100/min vs 20/min anon)   |
| `FITPICK_API_BASE_URL` | No       | API base URL (defaults to production)                     |
| `FITPICK_API_URL`      | No       | Alias for `FITPICK_API_BASE_URL`                          |

**Rate Limits:**
- **With API key**: 100 requests/minute
- **Without API key**: 20 requests/minute (production) / 5 requests/minute (development)

### Config File Locations by Platform

| Platform | Path                                                              |
| -------- | ----------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows  | `%APPDATA%/Claude/claude_desktop_config.json`                     |
| Linux    | `~/.config/Claude/claude_desktop_config.json`                     |

### Manual Configuration JSON Example

```json
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
```

## Verification

To confirm the MCP server is working:

1. **Restart Claude Desktop** (required after configuration changes)
2. **Open the tools menu** - Look for the hammer icon in the bottom left
3. **Verify Bowlly tools appear** - You should see 5 tools listed
4. **Test with a query**: Try asking "Find grain-free dry cat foods"

If the tools appear and respond to queries, you're all set!

## Troubleshooting

### Tools not showing in Claude?

- **Restart Claude Desktop** - Configuration changes require a restart
- **Check the config file path** - Ensure you're editing the correct file for your OS
- **Verify JSON syntax** - Use a JSON validator if unsure
- **Check Claude Desktop logs**:
  - macOS: `~/Library/Logs/Claude/`
  - Windows: `%APPDATA%/Claude/Logs/`
  - Linux: `~/.config/Claude/Logs/`

### API key errors?

- **Re-run setup**: `npx @bowlly/mcp-server --setup`
- **Check environment variable**: Ensure `FITPICK_API_KEY` is set correctly if using one
- **Verify API key validity**: Visit [bowlly.io/developer](https://bowlly.io/developer) to check status
- **Using without a key?** That's fine - just be aware of the lower rate limits

### Rate limit errors?

- **Default limit**: 100 requests per minute
- **What counts**: Each tool invocation counts as one request
- **Increasing limits**: Contact us with your use case for higher limits

### "Command not found" errors?

- **Ensure Node.js 18+ is installed**: `node --version`
- **Try with npx**: `npx @bowlly/mcp-server --setup`
- **Global install fallback**: `npm install -g @bowlly/mcp-server`

### Configuration not persisting?

- **Check file permissions** - Ensure you have write access to the config directory
- **Use absolute paths** - Relative paths may not resolve correctly
- **Validate JSON format** - Missing commas or brackets are common issues

## Cross-References

- **[GPT Actions Setup Guide](../web/public/gpt-actions.yaml)** - OpenAPI spec for ChatGPT integration
- **[Direct API Documentation](https://bowlly.io/docs/api)** - REST API reference
- **[Agent Ecosystem Overview](https://bowlly.io/docs/agents)** - All integration methods

## Documentation

- [Full Documentation](https://bowlly.io/docs/mcp)
- [API Reference](https://bowlly.io/docs/api)
- [Get API Key](https://bowlly.io/developer)

## License

MIT
