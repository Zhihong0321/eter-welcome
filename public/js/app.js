// Shared helpers used by every page.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

function fmtMoney(value) {
  const n = Number(value || 0);
  return `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function showToast(message, type = 'info') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showLoading(container) {
  container.innerHTML = '<div class="card" style="padding:40px 20px;"><div class="spinner"></div></div>';
}

function showFatalError(container, message, options = {}) {
  const backHref = options.backHref || 'index.html';
  const backLabel = options.backLabel || 'Start over';
  container.innerHTML = `
    <div class="card empty-state">
      <p>${escapeHtml(message)}</p>
      <a class="btn btn-outline" style="margin-top:12px;display:inline-flex;width:auto;padding-left:1.2rem;padding-right:1.2rem;" href="${backHref}">${escapeHtml(backLabel)}</a>
    </div>
  `;
}
