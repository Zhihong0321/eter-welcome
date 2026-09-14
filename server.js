const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');

const app = express();
const PORT = process.env.PORT || 4000;

// The only "backend" this app has: it never touches a database directly.
// Every data read/write goes straight from the browser to Solar Calculator v2
// (customer-portal lookup + the existing public SEDA JSON API), which already
// allows cross-origin requests (CORS origin: '*'). This file just serves the
// static PWA shell and tells it which domain to call.
const SOLAR_APP_BASE_URL = (process.env.SOLAR_APP_BASE_URL || 'https://calculator.atap.solar').replace(/\/+$/, '');

// Official receipts (one per verified payment) live on the admin domain's
// public API instead — no login/token required, same cross-origin setup.
const ADMIN_APP_BASE_URL = (process.env.ADMIN_APP_BASE_URL || 'https://admin.atap.solar').replace(/\/+$/, '');

app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = ${JSON.stringify({ SOLAR_APP_BASE_URL, ADMIN_APP_BASE_URL })};`);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Eter Customer App] running on port ${PORT}, calling ${SOLAR_APP_BASE_URL} and ${ADMIN_APP_BASE_URL}`);
});
