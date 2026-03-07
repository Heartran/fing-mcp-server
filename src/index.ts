import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from "express";
import { z } from "zod";

// ─── Config ───────────────────────────────────────────────────────────────────

const FING_API_KEY = process.env.FING_API_KEY ?? "";
const FING_BASE_URL = process.env.FING_BASE_URL ?? "http://localhost:49090/1";
const PORT = parseInt(process.env.PORT ?? "3010", 10);

if (!FING_API_KEY) {
  console.error("ERROR: FING_API_KEY environment variable is required");
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FingDevice {
  mac: string;
  ip: string[];
  state: "UP" | "DOWN" | string;
  name?: string;
  type?: string;
  make?: string;
  model?: string;
  contactId?: string;
  first_seen?: string;
  last_changed?: string;
}

interface FingDevicesResponse {
  networkId: string;
  devices: FingDevice[];
}

interface FingPersonPresenceDeviceDetails {
  [key: string]: unknown;
}

interface FingContactInfo {
  [key: string]: unknown;
}

interface FingPerson {
  stateChangeTime?: string;
  contactInfo?: FingContactInfo;
  currentState?: "ONLINE" | "OFFLINE" | string;
  presenceDeviceDetails?: FingPersonPresenceDeviceDetails;
}

interface FingPeopleResponse {
  networkId: string;
  lastChangeTime?: string;
  people: FingPerson[];
}

// ─── Fing API Client ──────────────────────────────────────────────────────────

async function fingGet<T>(endpoint: string): Promise<T> {
  const url = `${FING_BASE_URL}/${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${FING_API_KEY}`,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Unauthorized: invalid Fing API key");
    }
    if (response.status === 503) {
      throw new Error("Fing agent service is unavailable. Make sure Fing Desktop or Fing Agent is running.");
    }
    throw new Error(`Fing API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function formatDevice(d: FingDevice): string {
  const ips = d.ip?.join(", ") ?? "unknown";
  const name = d.name ?? "Unnamed device";
  const type = [d.make, d.model, d.type].filter(Boolean).join(" ") || "Unknown";
  const state = d.state === "UP" ? "🟢 UP" : "🔴 DOWN";
  const lastChanged = d.last_changed ? new Date(d.last_changed).toLocaleString() : "n/a";
  return `• ${name} [${state}]\n  MAC: ${d.mac} | IP: ${ips}\n  Type: ${type}\n  Last changed: ${lastChanged}`;
}

function formatPerson(p: FingPerson, index: number): string {
  const name = (p.contactInfo as { name?: string })?.name ?? `Person ${index + 1}`;
  const state = p.currentState === "ONLINE" ? "🟢 ONLINE" : "🔴 OFFLINE";
  const changed = p.stateChangeTime ? new Date(p.stateChangeTime).toLocaleString() : "n/a";
  return `• ${name} [${state}]\n  Last state change: ${changed}`;
}

// ─── MCP Server Factory ───────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "fing-mcp-server",
    version: "1.0.0"
  });

  // Tool: fing_get_devices
  server.registerTool(
    "fing_get_devices",
    {
      title: "Get Network Devices",
      description: `Retrieve all devices detected on the local network by the Fing monitoring agent.

Returns device details including MAC address, IP address(es), connection state (UP/DOWN),
device name, type, manufacturer, model, and connection history timestamps.

Useful for:
- Checking which devices are currently connected (state: UP)
- Identifying unknown devices on the network
- Auditing MAC addresses
- Reviewing when a device was first seen or last changed

Args:
  - filter_state ('UP' | 'DOWN' | 'ALL'): Filter devices by connection state (default: 'ALL')
  - response_format ('text' | 'json'): Output format (default: 'text')

Returns:
  List of devices with: mac, ip[], state, name, type, make, model, first_seen, last_changed.
  Network ID is included in the response.

Examples:
  - "Who is connected right now?" → filter_state: 'UP'
  - "Show me all known devices" → filter_state: 'ALL'
  - "Is my NAS online?" → filter_state: 'UP', then check by name/IP

Error handling:
  - Returns error if Fing API key is invalid (401)
  - Returns error if Fing Desktop/Agent is not running (503)`,
      inputSchema: z.object({
        filter_state: z.enum(["UP", "DOWN", "ALL"]).default("ALL")
          .describe("Filter devices by connection state: UP (online), DOWN (offline), ALL"),
        response_format: z.enum(["text", "json"]).default("text")
          .describe("Output format: 'text' for human-readable, 'json' for structured data")
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filter_state, response_format }) => {
      let data: FingDevicesResponse;
      try {
        data = await fingGet<FingDevicesResponse>("devices");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error fetching devices: ${message}` }] };
      }

      const devices = filter_state === "ALL"
        ? data.devices
        : data.devices.filter(d => d.state === filter_state);

      if (response_format === "json") {
        const output = { networkId: data.networkId, count: devices.length, devices };
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output
        };
      }

      const upCount = devices.filter(d => d.state === "UP").length;
      const downCount = devices.filter(d => d.state === "DOWN").length;
      const lines = [
        `Network: ${data.networkId}`,
        `Devices shown: ${devices.length} (🟢 ${upCount} UP, 🔴 ${downCount} DOWN)`,
        "",
        ...devices.map(formatDevice)
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // Tool: fing_get_people
  server.registerTool(
    "fing_get_people",
    {
      title: "Get Network People / Presence",
      description: `Retrieve presence information for people associated with network devices in Fing.

People in Fing represent individuals whose devices are tracked on the network.
This tool shows who is currently ONLINE or OFFLINE based on device presence detection.

Useful for:
- Checking who is home / at the office
- Monitoring presence changes
- Correlating people with their devices

Args:
  - filter_state ('ONLINE' | 'OFFLINE' | 'ALL'): Filter by presence state (default: 'ALL')
  - response_format ('text' | 'json'): Output format (default: 'text')

Returns:
  List of people with: contactInfo, currentState, stateChangeTime, presenceDeviceDetails.
  Also includes network ID and last overall change time.

Note: People must be configured in Fing Desktop/App for this to return useful data.

Error handling:
  - Returns error if Fing API key is invalid (401)
  - Returns error if Fing Desktop/Agent is not running (503)`,
      inputSchema: z.object({
        filter_state: z.enum(["ONLINE", "OFFLINE", "ALL"]).default("ALL")
          .describe("Filter people by presence state: ONLINE, OFFLINE, ALL"),
        response_format: z.enum(["text", "json"]).default("text")
          .describe("Output format: 'text' for human-readable, 'json' for structured data")
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ filter_state, response_format }) => {
      let data: FingPeopleResponse;
      try {
        data = await fingGet<FingPeopleResponse>("people");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error fetching people: ${message}` }] };
      }

      const people = filter_state === "ALL"
        ? data.people
        : data.people.filter(p => p.currentState === filter_state);

      if (response_format === "json") {
        const output = {
          networkId: data.networkId,
          lastChangeTime: data.lastChangeTime,
          count: people.length,
          people
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output
        };
      }

      if (people.length === 0) {
        return {
          content: [{
            type: "text",
            text: filter_state === "ALL"
              ? "No people configured in Fing. Add people in Fing Desktop/App to track presence."
              : `No people with state ${filter_state} found.`
          }]
        };
      }

      const onlineCount = people.filter(p => p.currentState === "ONLINE").length;
      const lastChange = data.lastChangeTime ? new Date(data.lastChangeTime).toLocaleString() : "n/a";
      const lines = [
        `Network: ${data.networkId}`,
        `People shown: ${people.length} (🟢 ${onlineCount} ONLINE, 🔴 ${people.length - onlineCount} OFFLINE)`,
        `Last network change: ${lastChange}`,
        "",
        ...people.map((p, i) => formatPerson(p, i))
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  return server;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// SSE transport sessions (for mcp-remote compatibility)
const sseTransports = new Map<string, SSEServerTransport>();

// SSE: GET /mcp — opens the SSE stream (used by mcp-remote)
app.get("/mcp", async (req: Request, res: Response) => {
  const transport = new SSEServerTransport("/mcp/message", res);
  sseTransports.set(transport.sessionId, transport);
  res.on("close", () => sseTransports.delete(transport.sessionId));
  const server = createMcpServer();
  await server.connect(transport);
});

// SSE: POST /mcp/message — receives messages from mcp-remote
app.post("/mcp/message", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

// Streamable HTTP: POST /mcp — native Claude Desktop "type: http" support
app.post("/mcp", async (req: Request, res: Response) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  res.on("close", () => transport.close());
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "fing-mcp-server", version: "1.0.0" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.error(`Fing MCP server running on http://0.0.0.0:${PORT}`);
  console.error(`  SSE (mcp-remote):        GET  http://0.0.0.0:${PORT}/mcp`);
  console.error(`  Streamable HTTP (native): POST http://0.0.0.0:${PORT}/mcp`);
  console.error(`  Health check:             GET  http://0.0.0.0:${PORT}/health`);
});
