# fing-mcp-server

MCP server per la Fing Local API. Espone i dati di rete (dispositivi e presenza) a Claude Desktop via Tailscale.

## Prerequisiti

- Node.js v18+
- Fing Desktop (o Fing Agent) in esecuzione sulla stessa macchina
- API key di Fing (Settings → Local API in Fing Desktop)

## Setup

```bash
# 1. Installa le dipendenze
npm install

# 2. Build
npm run build

# 3. Avvia il server
FING_API_KEY=la-tua-api-key npm start
```

Il server risponde su `http://localhost:3010/mcp`.

## Variabili d'ambiente

| Variabile       | Default                    | Descrizione                          |
|-----------------|----------------------------|--------------------------------------|
| `FING_API_KEY`  | *(obbligatoria)*           | API key di Fing Local API            |
| `FING_BASE_URL` | `http://localhost:49090/1` | URL base dell'agente Fing            |
| `PORT`          | `3010`                     | Porta su cui esporre il server MCP   |

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
      "type": "http",
      "url": "http://<TAILSCALE-IP>:3010/mcp"
    }
  }
}
```

## Tool disponibili

### `fing_get_devices`
Lista tutti i dispositivi rilevati sulla rete locale.

Parametri:
- `filter_state`: `UP` | `DOWN` | `ALL` (default: `ALL`)
- `response_format`: `text` | `json` (default: `text`)

### `fing_get_people`
Lista le persone configurate in Fing con il loro stato di presenza.

Parametri:
- `filter_state`: `ONLINE` | `OFFLINE` | `ALL` (default: `ALL`)
- `response_format`: `text` | `json` (default: `text`)

## Health check

```
GET http://localhost:3010/health
```
