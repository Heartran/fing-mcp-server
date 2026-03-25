# fing-mcp-server

MCP server for the Fing local API. It exposes Fing network devices and presence
data to MCP clients over HTTP using both Streamable HTTP and SSE.

This server is designed to run on `PC-FEDERICO`, where Fing Agent exposes the
local API on `http://localhost:49090` and stores its auth token in:

`%APPDATA%\FingAgent\conf\localapi\fingagent.json`

## How It Works on my machine

At startup the server:

1. Reads the Fing local API config from
   `%APPDATA%\FingAgent\conf\localapi\fingagent.json`
2. Extracts the real `port` and `auth` values
3. Calls the local API endpoints directly:
   - `/devices?auth=...`
   - `/people?auth=...`

On Windows it uses `curl.exe` as the local transport because Fing Agent returns
HTTP responses that are accepted by `curl.exe` but can break Node's native HTTP
client parsing.

## Requirements

- Node.js 18+
- Fing Desktop or Fing Agent running on the same machine
- Fing local API enabled

## Setup

```bash
npm install
npm run build
npm start
```

If the server is launched on `PC-FEDERICO`, no manual API key setup is required
as long as Fing Agent is already configured and the local API file exists.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `FING_LOCALAPI_AUTH` | auto-discovered | Explicit Fing local API auth token |
| `FING_API_KEY` | alias of `FING_LOCALAPI_AUTH` | Backward-compatible auth token env var |
| `FING_LOCALAPI_PORT` | auto-discovered or `49090` | Override the local API port |
| `FING_BASE_URL` | auto-discovered or `http://localhost:49090` | Override the Fing local API base URL |
| `FING_LOCALAPI_CONFIG` | `%APPDATA%\FingAgent\conf\localapi\fingagent.json` | Override the Fing local API config file path |
| `PORT` | `3010` | Port used by this MCP server |

Notes:

- The old `/1` suffix is not used by Fing Agent local API on `PC-FEDERICO`.
- If both env vars and local config are present, env vars win.

## Run in Development

```bash
npm run dev
```

## Endpoints

- `GET /mcp`
  SSE endpoint for `mcp-remote`
- `POST /mcp/message`
  SSE message endpoint for `mcp-remote`
- `POST /mcp`
  Native Streamable HTTP MCP endpoint
- `GET /health`
  Health check

## MCP Tools

### `fing_get_devices`

Returns devices discovered by Fing Agent.

Arguments:

- `filter_state`: `UP` | `DOWN` | `ALL`
- `response_format`: `text` | `json`

### `fing_get_people`

Returns presence information for people configured in Fing.

Arguments:

- `filter_state`: `ONLINE` | `OFFLINE` | `ALL`
- `response_format`: `text` | `json`

## Claude Desktop / mcp-remote

Example `claude_desktop_config.json` entry:

```json
{
  "mcpServers": {
    "fing": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "mcp-remote",
        "http://PC-FEDERICO:3010/mcp"
      ]
    }
  }
}
```

If you expose the server over Tailscale or another remote network, replace the
host with the reachable IP or DNS name of `PC-FEDERICO`.

## Troubleshooting

- `Unauthorized: invalid Fing local API auth token`
  The local API auth token is wrong or outdated.
- `Fing agent service is unavailable`
  Fing Desktop or Fing Agent is not running.
- `curl.exe is required on Windows`
  The server is running on Windows without the built-in curl executable
  available in `PATH`.

## License

MIT. See [LICENSE](LICENSE).
