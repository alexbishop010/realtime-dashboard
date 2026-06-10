# AEP Event Analytics Dashboard

Real-time event visualization for Adobe Experience Platform Event Forwarding.
Events arrive via the **Cloud Connector** extension and stream live to the dashboard.

```
AEP Web SDK → Edge Network → Event Forwarding (Cloud Connector) → /webhook → SSE → Dashboard
```

---

## Quick start

```bash
# 1. Clone / copy this project
cd aep-dashboard

# 2. Configure environment
cp .env.example .env
# Edit .env — set WEBHOOK_SECRET to something random

# 3. Build and start
docker compose up --build

# Dashboard → http://localhost:8080
# Webhook   → http://localhost:3001/webhook
```

---

## Expose the webhook publicly (for Cloud Connector)

Cloud Connector runs on Adobe's Edge Network and needs to reach your `/webhook`
endpoint over the internet. For local dev use **ngrok**:

```bash
# In a separate terminal (while docker compose is running)
ngrok http 3001
# → Forwarding: https://abc123.ngrok.io → localhost:3001
```

Use `https://abc123.ngrok.io/webhook` as the Cloud Connector endpoint URL.

For production, deploy behind a real domain (Railway, Render, Fly.io, etc.)
and point Cloud Connector at `https://your-domain.com/webhook`.

---

## Cloud Connector configuration

In your AEP Event Forwarding property:

| Field | Value |
|---|---|
| Extension | Adobe Cloud Connector |
| Action type | Make Fetch Call |
| Request type | POST |
| Endpoint URL | `https://<your-host>/webhook` |

**Headers tab**

| Key | Value |
|---|---|
| Content-Type | `application/json` |
| Authorization | `Bearer <your WEBHOOK_SECRET>` |

**Body (Raw)**

```
{{arc.event.xdm}}
```

Or use **Body as JSON** to forward only the fields you need:

```json
{
  "xdm":       "{{arc.event.xdm}}",
  "timestamp": "{{arc.event.xdm.timestamp}}"
}
```

---

## XDM field mapping

The backend maps these XDM paths by default. Edit `backend/server.js → parseEvent()`
to match your actual schema.

| Dashboard field | XDM path | Fallback |
|---|---|---|
| pageName | `xdm.web.webPageDetails.name` | `body.pageName` |
| pageUrl | `xdm.web.webPageDetails.URL` | `body.pageUrl` |
| deviceType | `xdm.environment.type` | `body.deviceType` |
| country | `xdm.placeContext.geo.countryCode` | `body.country` |
| pageView | `xdm.web.webPageDetails.pageViews.value` | `body.pageView` |
| productPageView | `xdm.commerce.productViews.value` | `body.productPageView` |
| addToCart | `xdm.commerce.productListAdds.value` | `body.addToCart` |
| purchase | `xdm.commerce.purchases.value` | `body.purchase` |

---

## Test the webhook locally

```bash
curl -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret" \
  -d '{
    "xdm": {
      "timestamp": "2024-01-01T12:00:00Z",
      "web": {
        "webPageDetails": {
          "name": "Home",
          "URL": "https://example.com/",
          "pageViews": { "value": 1 }
        }
      },
      "environment": { "type": "browser" },
      "placeContext": { "geo": { "countryCode": "US" } }
    }
  }'
```

---

## Project structure

```
aep-dashboard/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js          ← webhook receiver + SSE broadcaster
└── frontend/
    ├── Dockerfile          ← multi-stage: Vite build → nginx serve
    ├── nginx.conf          ← reverse proxy + SSE tuning
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        └── App.jsx         ← React dashboard
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WEBHOOK_SECRET` | _(empty)_ | Bearer token; leave empty to disable auth |
| `MAX_EVENTS` | `1000` | Max events kept in memory |
| `FRONTEND_PORT` | `8080` | Host port for the dashboard |
| `BACKEND_PORT` | `3001` | Host port for direct backend access |

---

## Production notes

- **Persistence**: the backend stores events in memory. For durability across
  restarts, replace the `events` array with Redis (e.g. `ioredis` + a sorted set).
- **Scale**: a single Node.js process handles SSE fine for dozens of clients.
  For more, add a Redis pub/sub fan-out.
- **HTTPS**: put a TLS-terminating load balancer or reverse proxy (Caddy, Traefik)
  in front when deploying publicly.
