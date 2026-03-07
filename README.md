# fing-mcp-server

MCP server per la Fing Local API. Espone i dati di rete (dispositivi e presenza) a Claude Desktop via protocollo MCP su HTTP (Streamable HTTP transport).

## Prerequisiti

- Node.js v18+
- Fing Desktop (o Fing Agent) in esecuzione sulla stessa macchina
- API key di Fing (Settings → Local API in Fing Desktop)

## Setup

```bash
# 1. Installa le dipendenze
npm install

# 2. Crea il file di configurazione
cp .env.example .env
# Modifica .env e inserisci la tua FING_API_KEY

# 3. Build
npm run build

# 4. Avvia il server
npm start
```

In alternativa, puoi passare la variabile direttamente:

```bash
FING_API_KEY=la-tua-api-key npm start
```

Il server risponde su `http://localhost:3010/mcp`.

## Variabili d'ambiente

| Variabile       | Default                    | Descrizione                          |
|-----------------|----------------------------|--------------------------------------|
| `FING_API_KEY`  | *(obbligatoria)*           | API key di Fing Local API            |
| `FING_BASE_URL` | `http://localhost:49090/1` | URL base dell'agente Fing            |
| `PORT`          | `3010`                     | Porta su cui esporre il server MCP   |
| `LOG_LEVEL`     | `info`                     | Livello di logging: `debug`, `info`, `warn`, `error` |

Puoi configurarle tramite un file `.env` nella root del progetto (vedi `.env.example`).

## Sviluppo

```bash
# Avvio in modalità sviluppo (senza build)
npm run dev
```

## Logging Verboso

Il server supporta logging dettagliato per aiutare il debug e il monitoraggio. Imposta la variabile `LOG_LEVEL` per controllare la verbosità:

```bash
# Logging dettagliato (tutte le richieste API, risposte, filtri)
LOG_LEVEL=debug npm start

# Logging standard (solo eventi importanti)
LOG_LEVEL=info npm start

# Solo warning ed errori
LOG_LEVEL=warn npm start

# Solo errori critici
LOG_LEVEL=error npm start
```

Cosa viene loggato:
- **debug**: Richieste/risposte HTTP, dettagli API Fing, operazioni di filtraggio
- **info**: Chiamate ai tool, risultati delle API, avvio server
- **warn**: Problemi non critici
- **error**: Errori API, autenticazione fallita, servizi non disponibili

Esempio di output con `LOG_LEVEL=debug`:
```
[2026-03-07T15:30:00.123Z] [INFO] Fing MCP server started { port: 3010, host: "0.0.0.0", logLevel: "debug" }
[2026-03-07T15:30:05.456Z] [INFO] MCP request received { method: "POST", url: "/mcp", userAgent: "mcp-remote/1.0" }
[2026-03-07T15:30:05.789Z] [INFO] fing_get_devices called { filter_state: "UP", response_format: "text" }
[2026-03-07T15:30:05.890Z] [DEBUG] Making Fing API request { endpoint: "devices", url: "http://localhost:49090/1/devices" }
[2026-03-07T15:30:06.123Z] [DEBUG] Fing API response { status: 200, statusText: "OK", ok: true }
[2026-03-07T15:30:06.234Z] [DEBUG] Fing API success { endpoint: "devices", dataType: "object" }
[2026-03-07T15:30:06.345Z] [INFO] Devices fetched successfully { totalDevices: 5, networkId: "12345" }
[2026-03-07T15:30:06.456Z] [DEBUG] Devices filtered { beforeFilter: 5, afterFilter: 3, filterState: "UP" }
```

## Avvio automatico con Windows Task Scheduler

Per far girare il server all'avvio del PC:

1. Crea un file `start.bat` nella cartella del progetto:
```bat
@echo off
set FING_API_KEY=la-tua-api-key
cd /d C:\path\to\fing-mcp-server
node dist/index.js
```

2. Apri Task Scheduler → "Create Basic Task"
3. Trigger: "When the computer starts"
4. Action: Start program → `start.bat`
5. Spunta "Run whether user is logged on or not"

## Configurazione Claude Desktop

Nel file `claude_desktop_config.json` aggiungi:

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
        "http://<IP-DEL-SERVER>:3010/mcp"
      ]
    }
  }
}
```

Se accedi da remoto tramite Tailscale, usa l'IP Tailscale della macchina che ospita il server.

## Tool disponibili

### `fing_get_devices`
Lista tutti i dispositivi rilevati sulla rete locale.

Parametri:
- `filter_state`: `UP` | `DOWN` | `ALL` (default: `ALL`)
- `response_format`: `text` | `json` (default: `text`)

Output in formato `text`:
```
Network: <networkId>
Devices shown: 5 (🟢 3 UP, 🔴 2 DOWN)

• NAS-Synology [🟢 UP]
  MAC: aa:bb:cc:dd:ee:ff | IP: 192.168.1.10
  Type: Synology DiskStation NAS
  Last changed: 07/03/2026, 08:30:00
```

Output in formato `json`: oggetto strutturato con `networkId`, `count` e array `devices`.

### `fing_get_people`
Lista le persone configurate in Fing con il loro stato di presenza.

Parametri:
- `filter_state`: `ONLINE` | `OFFLINE` | `ALL` (default: `ALL`)
- `response_format`: `text` | `json` (default: `text`)

Output in formato `text`:
```
Network: <networkId>
People shown: 2 (🟢 1 ONLINE, 🔴 1 OFFLINE)
Last network change: 07/03/2026, 09:00:00

• Mario Rossi [🟢 ONLINE]
  Last state change: 07/03/2026, 07:45:00
```

Output in formato `json`: oggetto strutturato con `networkId`, `lastChangeTime`, `count` e array `people`.

> **Nota:** Le persone devono essere configurate in Fing Desktop o nell'app Fing per ottenere dati utili.

## Gestione degli errori

Il server gestisce i seguenti errori della Fing API:

| Codice HTTP | Causa                                     | Messaggio restituito                          |
|-------------|-------------------------------------------|-----------------------------------------------|
| `401`       | API key non valida                        | `Unauthorized: invalid Fing API key`          |
| `503`       | Fing Desktop/Agent non in esecuzione      | `Fing agent service is unavailable. Make sure Fing Desktop or Fing Agent is running.` |
| altri       | Errore generico                           | `Fing API error: <status> <statusText>`       |

## Health check

```
GET http://localhost:3010/health
```

Risposta:
```json
{ "status": "ok", "service": "fing-mcp-server", "version": "1.0.0" }
```

## Licenza

MIT — vedi [LICENSE](LICENSE).
