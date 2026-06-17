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

// Simulate traffic
const SIM_PAGES = [
  { name: 'Home',                 url: 'https://example.com/' },
  { name: 'Product: Shoes',       url: 'https://example.com/products/shoes' },
  { name: 'Product: Bags',        url: 'https://example.com/products/bags' },
  { name: 'Product: Hats',        url: 'https://example.com/products/hats' },
  { name: 'Product: Jackets',     url: 'https://example.com/products/jackets' },
  { name: 'Blog: Trends',         url: 'https://example.com/blog/trends' },
  { name: 'Checkout',             url: 'https://example.com/checkout' },
  { name: 'Cart',                 url: 'https://example.com/cart' },
  { name: 'Order Confirmation',   url: 'https://example.com/order-confirmation' },
  { name: 'Search',               url: 'https://example.com/search' },
  { name: 'Category: Sale',       url: 'https://example.com/sale' },
  { name: 'Category: Men',        url: 'https://example.com/men' },
  { name: 'Category: Women',      url: 'https://example.com/women' },
];

const WEIGHTED_PAGES = [
  ...Array(5).fill(SIM_PAGES[0]),
  ...Array(3).fill(SIM_PAGES[1]),
  ...Array(2).fill(SIM_PAGES[2]),
  ...Array(2).fill(SIM_PAGES[3]),
  ...Array(2).fill(SIM_PAGES[4]),
  ...Array(2).fill(SIM_PAGES[5]),
  ...Array(3).fill(SIM_PAGES[6]),
  ...Array(3).fill(SIM_PAGES[7]),
  SIM_PAGES[8], SIM_PAGES[9], SIM_PAGES[10], SIM_PAGES[11], SIM_PAGES[12],
];

const SIM_DEVICES   = ['browser', 'browser', 'browser', 'mobile', 'mobile', 'tablet'];
const SIM_COUNTRIES = ['US','US','US','GB','GB','DE','FR','CA','AU','NL','ES','IT'];
const SIM_TRACKING  = [
  'email_spring_sale', 'email_new_arrivals', 'social_instagram',
  'social_tiktok', 'paid_google_brand', 'paid_google_generic',
  'paid_meta', 'affiliate_partner1', 'direct', 'direct', 'direct',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateSimEvent() {
  const page      = pick(WEIGHTED_PAGES);
  const device    = pick(SIM_DEVICES);
  const country   = pick(SIM_COUNTRIES);
  const tracking  = pick(SIM_TRACKING);
  const isProduct = page.name.startsWith('Product');
  const isCart    = page.name === 'Cart';
  const isCheckout = page.name === 'Checkout';
  const isConfirm  = page.name === 'Order Confirmation';
  const addToCart  = isCart ? 1 : 0;
  const purchase   = isConfirm ? 1 : 0;

  return {
    id:        crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    pageName:  page.name,
    pageUrl:   page.url,
    deviceType: device,
    country,
    trackingCode: tracking,
    pageView:        1,
    productPageView: isProduct ? 1 : 0,
    addToCart,
    purchase,
  };
}

let simInterval = null;

app.post('/simulate/start', (req, res) => {
  if (simInterval) return res.json({ status: 'already running' });

  simInterval = setInterval(() => {
    const count = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < count; i++) {
      const evt = generateSimEvent();
      events.push(evt);
      if (events.length > MAX_EVENTS) events.shift();
      broadcast(evt);
    }
  }, 800);

  res.json({ status: 'started' });
});

app.post('/simulate/stop', (_req, res) => {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  res.json({ status: 'stopped' });
});

app.get('/simulate/status', (_req, res) => {
  res.json({ running: simInterval !== null });
});

app.listen(PORT, () => {
  console.log(`AEP webhook server listening on :${PORT}`);
  console.log(`Auth: ${WEBHOOK_SECRET ? 'enabled' : 'disabled (set WEBHOOK_SECRET to enable)'}`);
});
