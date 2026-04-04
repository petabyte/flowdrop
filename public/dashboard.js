let currentUser = null;

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function init() {
  const res = await fetch('/auth/me');
  if (!res.ok) { window.location.href = '/login'; return; }
  const { user } = await res.json();
  currentUser = user;
  renderUser(user);
  loadFiles();
}

function renderUser(user) {
  document.getElementById('userEmail').textContent = user.email;
  const badge = document.getElementById('tierBadge');
  badge.textContent = user.tier;
  badge.className = `tier-badge ${user.tier}`;
  document.getElementById('apiKeyDisplay').textContent = user.api_key;
  document.getElementById('accountEmail').textContent = user.email;
  document.getElementById('memberSince').textContent = new Date(user.created_at).toLocaleDateString();
  document.getElementById('billingTier').textContent = user.tier.charAt(0).toUpperCase() + user.tier.slice(1);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'files') loadFiles();
  });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = '#667eea'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'rgba(255,255,255,0.15)'; });
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.style.borderColor = 'rgba(255,255,255,0.15)'; uploadFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', () => uploadFiles(fileInput.files));

async function uploadFiles(files) {
  const form = new FormData();
  for (const f of files) form.append('file', f);
  const res = await fetch('/api/upload', { method: 'POST', headers: { 'x-api-key': currentUser.api_key }, body: form });
  const data = await res.json();
  const results = document.getElementById('uploadResults');
  if (res.ok) {
    results.innerHTML = data.files.map(f => `
      <div class="file-row">
        <span class="file-name">${esc(f.filename)}</span>
        <span class="file-meta">${(f.size / 1024).toFixed(1)} KB</span>
        <button class="btn-copy" data-url="${esc(f.url)}">Copy URL</button>
      </div>`).join('');
    document.querySelectorAll('#uploadResults .btn-copy').forEach(btn => {
      btn.addEventListener('click', () => navigator.clipboard.writeText(btn.dataset.url));
    });
  } else {
    results.innerHTML = `<p style="color:#ff6b6b">${data.error}: ${data.message}</p>`;
  }
}

async function loadFiles() {
  if (!currentUser) return;
  const res = await fetch('/api/files', { headers: { 'x-api-key': currentUser.api_key } });
  const data = await res.json();
  const container = document.getElementById('filesList');
  if (!res.ok || !data.files || data.files.length === 0) {
    container.innerHTML = '<div class="empty-state">No files uploaded yet.</div>';
    return;
  }
  container.innerHTML = data.files.map(f => `
    <div class="file-row" id="row-${esc(f.key)}">
      <span class="file-name">${esc(f.filename)}</span>
      <span class="file-meta">${(f.size / 1024).toFixed(1)} KB · ${esc(f.tier)}</span>
      ${f.expires_at ? `<span class="file-meta">Expires ${new Date(f.expires_at).toLocaleDateString()}</span>` : '<span class="file-meta">Never expires</span>'}
      <button class="btn-copy" data-url="${esc(f.url)}">Copy URL</button>
      <button class="btn-delete" data-key="${esc(f.key)}">Delete</button>
    </div>`).join('');

  document.querySelectorAll('#filesList .btn-copy').forEach(btn => {
    btn.addEventListener('click', () => navigator.clipboard.writeText(btn.dataset.url));
  });
  document.querySelectorAll('#filesList .btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteFile(btn.dataset.key));
  });
}

async function deleteFile(key) {
  if (!confirm('Delete this file?')) return;
  const res = await fetch(`/api/files/${key}`, { method: 'DELETE', headers: { 'x-api-key': currentUser.api_key } });
  if (res.ok) document.getElementById(`row-${key}`)?.remove();
}

document.getElementById('copyKeyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(currentUser.api_key);
  document.getElementById('copyKeyBtn').textContent = 'Copied!';
  setTimeout(() => { document.getElementById('copyKeyBtn').textContent = 'Copy'; }, 2000);
});

document.getElementById('regenKeyBtn').addEventListener('click', async () => {
  if (!confirm('Regenerate your API key? The old key will stop working immediately.')) return;
  const res = await fetch('/auth/regenerate-key', { method: 'POST' });
  const data = await res.json();
  if (res.ok) {
    currentUser.api_key = data.api_key;
    document.getElementById('apiKeyDisplay').textContent = data.api_key;
  }
});

document.getElementById('upgradeStarterBtn').addEventListener('click', () => checkout('starter'));
document.getElementById('upgradeProBtn').addEventListener('click', () => checkout('pro'));
document.getElementById('portalBtn').addEventListener('click', () => { window.location.href = '/api/payments/portal'; });

async function checkout(plan) {
  const res = await fetch('/api/payments/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  const data = await res.json();
  if (res.ok) window.location.href = data.url;
}

init();
