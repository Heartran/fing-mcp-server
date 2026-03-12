import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express, { Request, Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const execFileAsync = promisify(execFile);

const DEFAULT_LOCALAPI_PORT = "49090";
const DEFAULT_SERVER_PORT = 3010;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_LOCALAPI_PORT}`;

interface FingLocalApiConfigFile {
  enabled?: string;
  port?: string;
  auth?: string;
}

interface ResolvedFingConfig {
  authToken: string;
  baseUrl: string;
  localApiConfigPath: string;
  localApiEnabled?: boolean;
}

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
  mac: string;
  ip: string[];
  state: "UP" | "DOWN" | string;
  name?: string;
  type?: string;
  make?: string;
  model?: string;
  last_changed?: string;
}

interface FingContactInfo {
  contactId?: string;
  displayName?: string;
  name?: string;
  contactType?: string;
  [key: string]: unknown;
}

interface FingPerson {
  stateChangeTime?: string;
  contactInfo?: FingContactInfo;
  currentState?: "ONLINE" | "OFFLINE" | string;
  presenceDeviceDetails?: FingPersonPresenceDeviceDetails[];
}

interface FingPeopleResponse {
  networkId: string;
  lastChangeTime?: string;
  lastUpdateTime?: string;
  people: FingPerson[];
}

function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/1") ? trimmed.slice(0, -2) : trimmed;
}

function defaultLocalApiConfigPath(): string {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "FingAgent", "conf", "localapi", "fingagent.json");
}

function readLocalApiConfig(filePath: string): FingLocalApiConfigFile | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as FingLocalApiConfigFile;
  } catch {
    return undefined;
  }
}

function resolveFingConfig(): ResolvedFingConfig {
  const localApiConfigPath = process.env.FING_LOCALAPI_CONFIG ?? defaultLocalApiConfigPath();
  const localApiConfig = readLocalApiConfig(localApiConfigPath);
  const authToken =
    process.env.FING_LOCALAPI_AUTH ??
    process.env.FING_API_KEY ??
    localApiConfig?.auth ??
    "";
  const localApiPort =
    process.env.FING_LOCALAPI_PORT ??
    process.env.FING_PORT ??
    localApiConfig?.port ??
    DEFAULT_LOCALAPI_PORT;
  const baseUrl = normalizeBaseUrl(
    process.env.FING_BASE_URL ?? `http://localhost:${localApiPort}`
  );

  if (!authToken) {
    console.error(
      "ERROR: Fing local API auth token not found. Set FING_LOCALAPI_AUTH/FING_API_KEY " +
      `or make sure ${localApiConfigPath} exists and contains the localapi auth value.`
    );
    process.exit(1);
  }

  return {
    authToken,
    baseUrl,
    localApiConfigPath,
    localApiEnabled: localApiConfig?.enabled === "true"
  };
}

const FING_CONFIG = resolveFingConfig();
const FING_API_KEY = FING_CONFIG.authToken;
const FING_BASE_URL = FING_CONFIG.baseUrl;
const PORT = parseInt(process.env.PORT ?? String(DEFAULT_SERVER_PORT), 10);

function buildFingUrl(endpoint: string): string {
  const url = new URL(endpoint, `${FING_BASE_URL}/`);
  url.searchParams.set("auth", FING_API_KEY);
  return url.toString();
}

function parseCurlResponse(stdout: string): { status: number; body: string } {
  const match = stdout.match(/\r?\n(\d{3})\s*$/);
  if (!match || match.index === undefined) {
    throw new Error("Unexpected curl output while talking to Fing local API");
  }

  return {
    status: Number(match[1]),
    body: stdout.slice(0, match.index)
  };
}

async function fingGetViaCurl<T>(url: string): Promise<T> {
  let stdout: string;
  let stderr: string;

  try {
    ({ stdout, stderr } = await execFileAsync(
      "curl.exe",
      ["-sS", "--max-time", "10", "-o", "-", "-w", "\n%{http_code}", url],
      {
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024
      }
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/i.test(message)) {
      throw new Error("curl.exe is required on Windows to talk to the Fing local API");
    }

    throw new Error(`Fing local API request failed: ${message}`);
  }

  if (stderr.trim()) {
    const lowered = stderr.toLowerCase();
    if (
      lowered.includes("failed to connect") ||
      lowered.includes("could not connect") ||
      lowered.includes("timed out")
    ) {
      throw new Error(
        "Fing agent service is unavailable. Make sure Fing Desktop or Fing Agent is running."
      );
    }
  }

  const { status, body } = parseCurlResponse(stdout);

  if (status === 401) {
    throw new Error("Unauthorized: invalid Fing local API auth token");
  }

  if (status === 503) {
    throw new Error(
      "Fing agent service is unavailable. Make sure Fing Desktop or Fing Agent is running."
    );
  }

  if (status < 200 || status >= 300) {
    throw new Error(`Fing API error: ${status}`);
  }

  try {
    return JSON.parse(body) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON returned by Fing local API: ${message}`);
  }
}

async function fingGetViaFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Unauthorized: invalid Fing local API auth token");
    }

    if (response.status === 503) {
      throw new Error(
        "Fing agent service is unavailable. Make sure Fing Desktop or Fing Agent is running."
      );
    }

    throw new Error(`Fing API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function fingGet<T>(endpoint: string): Promise<T> {
  const url = buildFingUrl(endpoint);

  if (process.platform === "win32") {
    return fingGetViaCurl<T>(url);
  }

  return fingGetViaFetch<T>(url);
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "n/a";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDevice(device: FingDevice): string {
  const ips = device.ip?.join(", ") ?? "unknown";
  const name = device.name ?? "Unnamed device";
  const type = [device.make, device.model, device.type].filter(Boolean).join(" ") || "Unknown";
  const state = device.state === "UP" ? "UP" : "DOWN";

  return [
    `- ${name} [${state}]`,
    `  MAC: ${device.mac} | IP: ${ips}`,
    `  Type: ${type}`,
    `  Last changed: ${formatTimestamp(device.last_changed)}`
  ].join("\n");
}

function formatPerson(person: FingPerson, index: number): string {
  const name =
    person.contactInfo?.displayName ??
    person.contactInfo?.name ??
    `Person ${index + 1}`;
  const state = person.currentState === "ONLINE" ? "ONLINE" : "OFFLINE";
  const devices =
    person.presenceDeviceDetails?.map((device) => `${device.name ?? device.mac} [${device.state}]`).join(", ");

  return [
    `- ${name} [${state}]`,
    `  Last state change: ${formatTimestamp(person.stateChangeTime)}`,
    ...(devices ? [`  Devices: ${devices}`] : [])
  ].join("\n");
}

function mostRecentTimestamp(values: Array<string | undefined>): string | undefined {
  let bestValue: string | undefined;
  let bestTime = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const time = Date.parse(value);
    if (Number.isNaN(time)) {
      continue;
    }

    if (time > bestTime) {
      bestTime = time;
      bestValue = value;
    }
  }

  return bestValue;
}

function enrichPeopleWithPresence(people: FingPerson[], devices: FingDevice[]): FingPerson[] {
  const devicesByContactId = new Map<string, FingPersonPresenceDeviceDetails[]>();

  for (const device of devices) {
    if (!device.contactId) {
      continue;
    }

    const entry = devicesByContactId.get(device.contactId) ?? [];
    entry.push({
      mac: device.mac,
      ip: device.ip ?? [],
      state: device.state,
      name: device.name,
      type: device.type,
      make: device.make,
      model: device.model,
      last_changed: device.last_changed
    });
    devicesByContactId.set(device.contactId, entry);
  }

  return people.map((person) => {
    const associatedDevices = person.contactInfo?.contactId
      ? (devicesByContactId.get(person.contactInfo.contactId) ?? [])
      : [];
    const hasOnlineDevice = associatedDevices.some((device) => device.state === "UP");

    return {
      ...person,
      currentState: person.currentState ?? (hasOnlineDevice ? "ONLINE" : "OFFLINE"),
      stateChangeTime: person.stateChangeTime ?? mostRecentTimestamp(
        associatedDevices.map((device) => device.last_changed)
      ),
      presenceDeviceDetails: associatedDevices
    };
  });
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "fing-mcp-server",
    version: "1.0.0"
  });

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
  - "Who is connected right now?" -> filter_state: 'UP'
  - "Show me all known devices" -> filter_state: 'ALL'
  - "Is my NAS online?" -> filter_state: 'UP', then check by name/IP

Error handling:
  - Returns error if Fing API auth is invalid (401)
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error fetching devices: ${message}` }] };
      }

      const devices =
        filter_state === "ALL"
          ? data.devices
          : data.devices.filter((device) => device.state === filter_state);

      if (response_format === "json") {
        const output = {
          networkId: data.networkId,
          count: devices.length,
          devices
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output
        };
      }

      const upCount = devices.filter((device) => device.state === "UP").length;
      const downCount = devices.filter((device) => device.state === "DOWN").length;
      const lines = [
        `Network: ${data.networkId}`,
        `Devices shown: ${devices.length} (${upCount} UP, ${downCount} DOWN)`,
        "",
        ...devices.map(formatDevice)
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

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
  - Returns error if Fing API auth is invalid (401)
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
      let peopleData: FingPeopleResponse;
      let devicesData: FingDevicesResponse;

      try {
        [peopleData, devicesData] = await Promise.all([
          fingGet<FingPeopleResponse>("people"),
          fingGet<FingDevicesResponse>("devices")
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error fetching people: ${message}` }] };
      }

      const resolvedLastChangeTime =
        peopleData.lastChangeTime ??
        peopleData.lastUpdateTime ??
        mostRecentTimestamp(devicesData.devices.map((device) => device.last_changed));
      const resolvedPeople = enrichPeopleWithPresence(peopleData.people, devicesData.devices);
      const people =
        filter_state === "ALL"
          ? resolvedPeople
          : resolvedPeople.filter((person) => person.currentState === filter_state);

      if (response_format === "json") {
        const output = {
          networkId: peopleData.networkId,
          lastChangeTime: resolvedLastChangeTime,
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
            text:
              filter_state === "ALL"
                ? "No people configured in Fing. Add people in Fing Desktop/App to track presence."
                : `No people with state ${filter_state} found.`
          }]
        };
      }

      const onlineCount = people.filter((person) => person.currentState === "ONLINE").length;
      const lines = [
        `Network: ${peopleData.networkId}`,
        `People shown: ${people.length} (${onlineCount} ONLINE, ${people.length - onlineCount} OFFLINE)`,
        `Last network change: ${formatTimestamp(resolvedLastChangeTime)}`,
        "",
        ...people.map(formatPerson)
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

const sseTransports = new Map<string, SSEServerTransport>();

app.get("/mcp", async (_req: Request, res: Response) => {
  const transport = new SSEServerTransport("/mcp/message", res);
  sseTransports.set(transport.sessionId, transport);
  res.on("close", () => sseTransports.delete(transport.sessionId));

  const server = createMcpServer();
  await server.connect(transport);
});

app.post("/mcp/message", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports.get(sessionId);

  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

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

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "fing-mcp-server", version: "1.0.0" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.error(`Fing MCP server running on http://0.0.0.0:${PORT}`);
  console.error(`Using Fing local API at ${FING_BASE_URL}`);
  console.error(`Local API config path: ${FING_CONFIG.localApiConfigPath}`);

  if (FING_CONFIG.localApiEnabled === false) {
    console.error("WARNING: Fing local API is disabled in the local FingAgent config file.");
  }

  console.error(`  SSE (mcp-remote):         GET  http://0.0.0.0:${PORT}/mcp`);
  console.error(`  Streamable HTTP (native): POST http://0.0.0.0:${PORT}/mcp`);
  console.error(`  Health check:             GET  http://0.0.0.0:${PORT}/health`);
});
