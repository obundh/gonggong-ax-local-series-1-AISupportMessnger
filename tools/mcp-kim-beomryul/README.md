# Kim Beomryul MCP

Standalone MCP stdio server for the Heyu Kim Beomryul legal-support context.

## Run

```bash
node tools/mcp-kim-beomryul/server.cjs
```

## Tools

- `legal_search`: returns the same local legal context text used by Kim Beomryul.
- `legal_evidence_json`: returns structured legal evidence records as JSON.

This server is intentionally separate from the Electron app. It reuses the existing local search functions and data, but does not change the original app flow.
