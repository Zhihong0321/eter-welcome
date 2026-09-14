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

async function fetchOfficialReceipts(invoiceBubbleUid) {
  const res = await fetch(`${adminApiBaseUrl()}/api/official-receipts/invoice/${encodeURIComponent(invoiceBubbleUid)}`, {
    headers: { Accept: 'application/json' }
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
