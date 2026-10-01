const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');

const app = express();
const PORT = process.env.PORT || 4000;
app.use(express.json({ limit: '1mb' }));

// The only "backend" this app has: it never touches a database directly.
// Every data read/write goes straight from the browser to Solar Calculator v2
// (customer-portal lookup + the existing public SEDA JSON API), which already
// allows cross-origin requests (CORS origin: '*'). This file just serves the
// static PWA shell and tells it which domain to call.
const SOLAR_APP_BASE_URL = (process.env.SOLAR_APP_BASE_URL || 'https://calculator.atap.solar').replace(/\/+$/, '');
const SAJ_API_BASE_URL = (process.env.SAJ_API_BASE_URL || 'https://ee-saj-api-production.up.railway.app').replace(/\/+$/, '');
const SAJ_TRIGGER_TOKEN = process.env.SAJ_TRIGGER_TOKEN || process.env.SAJ_API_TOKEN || '';

// Official receipts (one per verified payment) live on the admin domain's
// public API instead — no login/token required, same cross-origin setup.
const ADMIN_APP_BASE_URL = (process.env.ADMIN_APP_BASE_URL || 'https://admin.atap.solar').replace(/\/+$/, '');

app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = ${JSON.stringify({ SOLAR_APP_BASE_URL, ADMIN_APP_BASE_URL })};`);
});

// SAJ stays behind this same-origin proxy so its trigger token never reaches
// the customer browser. Only the two customer-scoped read/sync operations are
// exposed here; the admin, account, backfill and retention endpoints remain private.
function validCustomerKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value);
}

async function sajRequest(pathname, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (SAJ_TRIGGER_TOKEN) headers['X-Trigger-Token'] = SAJ_TRIGGER_TOKEN;
  const upstream = await fetch(`${SAJ_API_BASE_URL}${pathname}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(120000)
  });
  const body = await upstream.text();
  return { upstream, body };
}

app.post('/api/saj/sync', async (req, res) => {
  const customer = String(req.body?.customer || '').trim();
  const days = Number(req.body?.days || 7);
  if (!validCustomerKey(customer)) return res.status(400).json({ error: 'A valid customer reference is required.' });
  if (![7, 30].includes(days)) return res.status(400).json({ error: 'Data range must be 7 or 30 days.' });

  try {
    const { upstream, body } = await sajRequest(`/sync/fast?customer_id=${encodeURIComponent(customer)}&days=${days}&debug=false`, { method: 'POST' });
    res.status(upstream.status).set('Content-Type', upstream.headers.get('content-type') || 'application/json').set('Cache-Control', 'no-store').send(body);
  } catch (err) {
    console.error('[Eter Customer App] SAJ sync failed:', err.message);
    res.status(502).json({ error: 'The energy data service is temporarily unavailable.' });
  }
});

app.get('/api/saj/series', async (req, res) => {
  const customer = String(req.query.customer || '').trim();
  const days = Number(req.query.days || 7);
  if (!validCustomerKey(customer)) return res.status(400).json({ error: 'A valid customer reference is required.' });
  if (![7, 30].includes(days)) return res.status(400).json({ error: 'Data range must be 7 or 30 days.' });

  try {
    // The sync response may include the actual plant UID. The browser only
    // calls this route after a successful sync and the page renders the
    // upstream series defensively because the API does not publish a schema.
    const { upstream, body } = await sajRequest(`/plant/${encodeURIComponent(customer)}/series?days=${days}`);
    res.status(upstream.status).set('Content-Type', upstream.headers.get('content-type') || 'application/json').set('Cache-Control', 'no-store').send(body);
  } catch (err) {
    console.error('[Eter Customer App] SAJ series failed:', err.message);
    res.status(502).json({ error: 'The energy data service is temporarily unavailable.' });
  }
});

// The admin list endpoint is public but sends no CORS headers, so the
// browser cannot call it. This same-origin proxy only forwards that one
// list. Each receipt still opens on admin at
// /api/official-receipts/{payment.bubble_id}.
app.get('/api/official-receipts/invoice/:invoiceUid', async (req, res) => {
  const invoiceUid = req.params.invoiceUid || '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(invoiceUid)) {
    return res.status(400).json({ error: 'Invoice UID is required' });
  }

  try {
    const upstream = await fetch(
      `${ADMIN_APP_BASE_URL}/api/official-receipts/invoice/${encodeURIComponent(invoiceUid)}`,
      { headers: { Accept: 'application/json' } }
    );
    const body = await upstream.text();
    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.set('Cache-Control', 'no-store');
    res.send(body);
  } catch (err) {
    console.error('[Eter Customer App] official receipt list failed:', err);
    res.status(502).json({ error: 'Could not load official receipts.' });
  }
});

// ---- Document OCR (MyKad / TNB bill) -------------------------------------
// The browser sends one page as a JPEG/PNG data URL; the LLM key stays here.
// Nothing is stored or logged — the result is only used to pre-fill the form,
// and the customer still presses Save.
const LLM_BASED_URL = (process.env.LLM_BASED_URL || '').replace(/\/+$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const OCR_MODEL = process.env.LLM_MODEL || 'glm-5.3-flash';

app.set('trust proxy', 1);

const ocrHits = new Map();
function ocrRateLimit(req, res, next) {
  const now = Date.now();
  const hits = (ocrHits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (hits.length >= 20) return res.status(429).json({ error: 'Too many scans. Please wait a minute.' });
  hits.push(now);
  ocrHits.set(req.ip, hits);
  next();
}

const MYKAD_PROMPT = `This is a Malaysian MyKad (identity card). Read it and reply with ONLY a JSON object, no other text:
{"ic_no": "<12-digit IC number, format 900101-14-1234>", "name": "<full name exactly as printed>"}
Use null for anything you cannot read clearly. Do not guess.`;

const TNB_PROMPT = `This is a Tenaga Nasional Berhad (TNB) electricity bill. Read it and reply with ONLY a JSON object, no other text:
{"account_no": "<electricity account number exactly as printed, keep any X or * characters>", "address": "<the supply / premises address as printed, lines joined with ', '>"}
If the bill labels a separate supply/premises address, use that; otherwise use the address printed under the customer name.
Use null for anything you cannot read clearly. Do not guess.`;

// `usable(raw)` says whether a reply actually contains something. The router
// spreads requests over several backends and now and then one answers "no image
// attached" or fails outright, so an empty answer is retried (max 3 tries).
async function askLlmAboutImage(prompt, imageDataUrl, usable) {
  if (!LLM_BASED_URL || !LLM_API_KEY) {
    const err = new Error('Document scanning is not configured.');
    err.status = 503;
    throw err;
  }
  const payload = JSON.stringify({
    model: OCR_MODEL,
    temperature: 0,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }]
  });

  let reached = false;
  let last = {};
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const upstream = await fetch(`${LLM_BASED_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
        body: payload,
        signal: AbortSignal.timeout(90000)
      });
      const parsed = await upstream.json().catch(() => null);
      // Some backends wrap the OpenAI response as { data: { choices: [...] } }.
      const inner = parsed && (parsed.choices ? parsed : parsed.data);
      if (!upstream.ok || !inner || !inner.choices) {
        console.error(`[Eter Customer App] LLM attempt ${attempt} failed: HTTP ${upstream.status}`);
        continue;
      }
      reached = true;
      const text = String((inner.choices[0] && inner.choices[0].message && inner.choices[0].message.content) || '');
      const match = text.match(/\{[\s\S]*\}/);
      let raw = {};
      if (match) { try { raw = JSON.parse(match[0]); } catch { raw = {}; } }
      last = raw;
      if (usable(raw)) return raw;
    } catch (err) {
      console.error(`[Eter Customer App] LLM attempt ${attempt} failed: ${err.message}`);
    }
  }
  if (!reached) {
    const err = new Error('The scanner is unavailable right now.');
    err.status = 502;
    throw err;
  }
  return last;
}

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const v = value.replace(/\s+/g, ' ').trim();
  return v && v.toLowerCase() !== 'null' ? v : null;
}

function normalizeIc(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 ? `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}` : null;
}

function ocrRoute(prompt, shape, usable) {
  return async (req, res) => {
    const image = req.body && req.body.image;
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
      return res.status(400).json({ error: 'Please upload a clear photo or PDF.' });
    }
    try {
      const raw = await askLlmAboutImage(prompt, image, usable);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, ...shape(raw) });
    } catch (err) {
      console.error('[Eter Customer App] OCR failed:', err.message);
      res.status(err.status || 502).json({ error: err.message || 'Could not read the document.' });
    }
  };
}

app.post('/api/ocr/mykad', ocrRateLimit, express.json({ limit: '12mb' }), ocrRoute(MYKAD_PROMPT, (raw) => ({
  ic_no: normalizeIc(raw.ic_no),
  name: cleanText(raw.name) && cleanText(raw.name).toUpperCase()
}), (raw) => Boolean(normalizeIc(raw.ic_no) || cleanText(raw.name))));

app.post('/api/ocr/tnb-bill', ocrRateLimit, express.json({ limit: '12mb' }), ocrRoute(TNB_PROMPT, (raw) => {
  const account = cleanText(raw.account_no);
  // A bill that is not the owner's copy prints the account number partly
  // masked (e.g. 2200XXXX3456). Only a fully numeric number is usable.
  const compact = account ? account.replace(/[\s-]/g, '') : '';
  const masked = Boolean(account) && !/^\d{6,}$/.test(compact);
  return {
    account_no: account && !masked ? compact : null,
    account_masked: masked,
    address: cleanText(raw.address)
  };
}, (raw) => Boolean(cleanText(raw.account_no) || cleanText(raw.address))));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Eter Customer App] running on port ${PORT}, calling ${SOLAR_APP_BASE_URL} and ${ADMIN_APP_BASE_URL}`);
});
