// All data lives on the Solar Calculator v2 domain — this app calls it
// directly from the browser (CORS is open there). No API key/session is
// involved anywhere in this file; the URL tokens *are* the access control.

function apiBaseUrl() {
  return (window.APP_CONFIG && window.APP_CONFIG.SOLAR_APP_BASE_URL) || '';
}

function adminApiBaseUrl() {
  return (window.APP_CONFIG && window.APP_CONFIG.ADMIN_APP_BASE_URL) || '';
}

async function searchCustomersByName(name) {
  const res = await fetch(`${apiBaseUrl()}/api/v1/customer-portal/search?name=${encodeURIComponent(name)}`, {
    headers: { Accept: 'application/json' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || 'Search failed. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data.matches;
}

async function fetchCustomerPortal(customerId) {
  const res = await fetch(`${apiBaseUrl()}/api/v1/customer-portal/${encodeURIComponent(customerId)}`, {
    headers: { Accept: 'application/json' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || 'Could not find that Customer ID.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// One official receipt per verified payment:
// {ADMIN}/api/official-receipts/{payment.bubble_id}
// Do not use the list payload's receipt_url. Admin builds that from the
// request host, which is an internal address, not the public admin domain.
function officialReceiptUrl(paymentUid) {
  const base = String(adminApiBaseUrl() || '').replace(/\/+$/, '');
  return `${base}/api/official-receipts/${encodeURIComponent(paymentUid)}`;
}

async function fetchOfficialReceipts(invoiceBubbleUid) {
  // Same-origin proxy of the admin list. Opening a receipt does not use
  // this call — officialReceiptUrl() points at the admin PDF for that payment.
  const res = await fetch(`/api/official-receipts/invoice/${encodeURIComponent(invoiceBubbleUid)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (res.status === 404) return [];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Could not load official receipts.');
    err.status = res.status;
    throw err;
  }
  return data.receipts || [];
}

async function submitPayment(invoiceBubbleId, fields, file) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') form.append(key, value);
  });
  if (file) form.append('proof', file, file.name);

  const res = await fetch(`${apiBaseUrl()}/api/v1/customer-portal/invoice/${encodeURIComponent(invoiceBubbleId)}/submit-payment`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to submit payment.');
  }
  return data.payment;
}

function sedaApiBase(shareToken) {
  return `${apiBaseUrl()}/api/v1/seda-public/${encodeURIComponent(shareToken)}`;
}

async function fetchSedaData(shareToken) {
  const res = await fetch(sedaApiBase(shareToken), { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || 'This SEDA registration link is unavailable.');
    err.status = res.status;
    throw err;
  }
  return data.data;
}

async function saveSedaFields(shareToken, fields) {
  const res = await fetch(sedaApiBase(shareToken), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(fields)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to save.');
  }
  return data;
}

async function uploadSedaFile(shareToken, fieldKey, file) {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(`${sedaApiBase(shareToken)}/upload/${encodeURIComponent(fieldKey)}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Upload failed.');
  }
  return data;
}

// ---- Document scanning (MyKad / TNB bill) ----------------------------------
// The LLM reads one JPEG page. Photos are shrunk first (phone photos are huge);
// PDFs have their first page rendered with pdf.js, loaded only when needed.
const SCAN_MAX_SIDE = 1800;
const PDFJS_VERSION = '3.11.174';

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Could not load the PDF reader.'));
    document.head.appendChild(s);
  });
}

async function fileToScanImage(file) {
  let source;
  let width;
  let height;
  if (file.type === 'application/pdf') {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({
      data: await file.arrayBuffer(),
      // PDFs that don't embed their fonts (common for generated bills) need these.
      standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`
    }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.5, SCAN_MAX_SIDE / Math.max(base.width, base.height)) });
    source = document.createElement('canvas');
    source.width = width = Math.round(viewport.width);
    source.height = height = Math.round(viewport.height);
    await page.render({ canvasContext: source.getContext('2d'), viewport }).promise;
  } else {
    source = await createImageBitmap(file);
    width = source.width;
    height = source.height;
  }
  const ratio = Math.min(1, SCAN_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// kind: 'mykad' | 'tnb-bill'. Resolves to the OCR result; nothing is saved.
async function scanDocument(kind, file) {
  const image = await fileToScanImage(file);
  const res = await fetch(`/api/ocr/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ image })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not read the document.');
  }
  return data;
}

async function deleteSedaFile(shareToken, fieldKey, url) {
  const res = await fetch(`${sedaApiBase(shareToken)}/file/${encodeURIComponent(fieldKey)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Delete failed.');
  }
  return data;
}

async function restoreSedaFile(shareToken, fieldKey, recycleBinId) {
  const res = await fetch(`${sedaApiBase(shareToken)}/restore/${encodeURIComponent(fieldKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ recycleBinId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Restore failed.');
  }
  return data;
}
