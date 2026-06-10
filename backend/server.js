import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const MAX_EVENTS = parseInt(process.env.MAX_EVENTS || '1000');

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// ── In-memory store ────────────────────────────────────────────────────────────
const events = [];         // raw event log (capped at MAX_EVENTS)
const sseClients = new Map(); // id → res

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseEvent(body) {
  // Supports both a raw XDM payload and a wrapped { xdm: ... } envelope
  const xdm = body.xdm ?? body;
  return {
    id: crypto.randomUUID(),
    timestamp: xdm.timestamp ?? new Date().toISOString(),
    // Dimensions
    pageName:   xdm.web?.webPageDetails?.name     ?? xdm.pageName   ?? null,
    pageUrl:    xdm.web?.webPageDetails?.URL      ?? xdm.pageUrl    ?? null,
    deviceType: xdm.environment?.type             ?? xdm.deviceType ?? null,
    country:    xdm.placeContext?.geo?.countryCode ?? xdm.country   ?? null,
    trackingCode: xdm.trackingCode ?? xdm.trackingCode ?? null,
    // Metrics (1 = event fired, 0 = not present)
    pageView:        xdm.web?.webPageDetails?.pageViews?.value   ?? (xdm.pageView        ? 1 : 0),
    productPageView: xdm.commerce?.productViews?.value           ?? (xdm.productPageView ? 1 : 0),
    addToCart:       xdm.commerce?.productListAdds?.value        ?? (xdm.addToCart       ? 1 : 0),
    purchase:        xdm.commerce?.purchases?.value              ?? (xdm.purchase        ? 1 : 0),
  };
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach(res => {
    res.write(data);
  });
}

// ── Middleware: optional shared secret ────────────────────────────────────────
function authMiddleware(req, res, next) {
  if (!WEBHOOK_SECRET) return next();
  const auth = req.headers['authorization'] ?? '';
  if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Cloud Connector posts here
app.post('/webhook', authMiddleware, (req, res) => {
  try {
    // Cloud Connector may batch-send as an array
    const payloads = Array.isArray(req.body) ? req.body : [req.body];
    const parsed = payloads.map(parseEvent);

    parsed.forEach(evt => {
      events.push(evt);
      if (events.length > MAX_EVENTS) events.shift();
      broadcast(evt);
    });

    res.status(200).json({ received: parsed.length });
  } catch (err) {
    console.error('Webhook parse error', err);
    res.status(400).json({ error: 'Bad payload' });
  }
});

// Dashboard connects here for live updates via SSE
app.get('/events/stream', (req, res) => {
  res.setHeader('Content-Type',        'text/event-stream');
  res.setHeader('Cache-Control',       'no-cache');
  res.setHeader('Connection',          'keep-alive');
  res.setHeader('X-Accel-Buffering',   'no');

  // Disable Nagle's algorithm so small chunks are sent immediately
  req.socket.setNoDelay(true);

  const id = crypto.randomUUID();
  sseClients.set(id, res);

  const history = events.slice(-500);
  res.write(`data: ${JSON.stringify({ type: 'history', events: history })}\n\n`);

  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    sseClients.delete(id);
    clearInterval(ping);
  });
});

// REST snapshot — useful for initial page load or ad-hoc queries
app.get('/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '200'), MAX_EVENTS);
  res.json(events.slice(-limit));
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', events: events.length, clients: sseClients.size });
});

app.listen(PORT, () => {
  console.log(`AEP webhook server listening on :${PORT}`);
  console.log(`Auth: ${WEBHOOK_SECRET ? 'enabled' : 'disabled (set WEBHOOK_SECRET to enable)'}`);
});
