/* global XMLHttpRequest, FormData */

// ── Config ────────────────────────────────────────────────────
const API_BASE = window.location.origin; // same-origin: Express serves this

// ── DOM refs ──────────────────────────────────────────────────
const uploadZone   = document.getElementById('uploadZone');
const fileInput    = document.getElementById('fileInput');
const fileList     = document.getElementById('fileList');
const apiKeyInput  = document.getElementById('apiKeyInput');
const navbar       = document.getElementById('navbar');

// ── Navbar scroll effect ──────────────────────────────────────
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
});

// ── Smooth scroll nav links ───────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

// ── Drag & Drop ───────────────────────────────────────────────
['dragenter', 'dragover'].forEach((evt) =>
  uploadZone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    uploadZone.classList.add('drag-over');
  })
);
['dragleave', 'dragend'].forEach((evt) =>
  uploadZone.addEventListener(evt, () => uploadZone.classList.remove('drag-over'))
);
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation();
  uploadZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  if (files.length) handleFiles(files);
});

// ── Click to browse ───────────────────────────────────────────
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});
fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files);
  if (files.length) { handleFiles(files); fileInput.value = ''; }
});

// ── File type → emoji ─────────────────────────────────────────
function fileEmoji(mime) {
  if (mime.startsWith('image/'))       return '🖼️';
  if (mime.startsWith('video/'))       return '🎬';
  if (mime.startsWith('audio/'))       return '🎵';
  if (mime === 'application/pdf')      return '📄';
  if (mime.includes('zip'))            return '🗜️';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('word'))           return '📝';
  if (mime === 'text/plain')           return '📃';
  if (mime === 'application/json')     return '🔧';
  return '📁';
}

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatExpiry(isoString) {
  if (!isoString) return 'Never expires ✨';
  const d = new Date(isoString);
  return `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// ── Create a file card in "uploading" state ───────────────────
function createFileCard(file) {
  const card = document.createElement('div');
  card.className = 'file-card';
  card.innerHTML = `
    <div class="file-card-top">
      <div class="file-type-icon">${fileEmoji(file.type)}</div>
      <div class="file-meta">
        <div class="file-name">${escHtml(file.name)}</div>
        <div class="file-info">
          <span>${formatBytes(file.size)}</span>
          <span>${file.type || 'unknown'}</span>
        </div>
      </div>
    </div>
    <div class="file-progress">
      <div class="file-progress-bar" style="width:0%"></div>
    </div>
  `;
  fileList.prepend(card);
  return card;
}

// ── Update card after successful upload ──────────────────────
function upgradeCard(card, result) {
  const bar = card.querySelector('.file-progress-bar');
  if (bar) bar.style.width = '100%';

  setTimeout(() => {
    card.querySelector('.file-progress').remove();
    card.insertAdjacentHTML('beforeend', `
      <div class="file-info">
        <span class="file-tier" data-tier="${result.tier}">${result.tier}</span>
        <span class="file-expiry">${formatExpiry(result.expiresAt)}</span>
      </div>
      <div class="file-url-row">
        <input class="file-url-input" type="text" readonly value="${escHtml(result.url)}" />
        <button class="file-copy-btn" data-url="${escHtml(result.url)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy URL
        </button>
      </div>
    `);

    // Add delete button
    const topRow = card.querySelector('.file-card-top');
    const delBtn = document.createElement('button');
    delBtn.className = 'file-delete';
    delBtn.title = 'Delete file';
    delBtn.dataset.key = result.key;
    delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
    topRow.appendChild(delBtn);

    // Copy handler
    card.querySelector('.file-copy-btn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy URL`;
          btn.classList.remove('copied');
        }, 2000);
      });
    });

    // Delete handler
    delBtn.addEventListener('click', () => deleteFile(result.key, card));
  }, 200);
}

// ── Show error on card ────────────────────────────────────────
function showCardError(card, message) {
  card.classList.add('error');
  const bar = card.querySelector('.file-progress');
  if (bar) bar.remove();
  card.insertAdjacentHTML('beforeend', `<p class="file-error-msg">⚠ ${escHtml(message)}</p>`);
}

// ── Upload files via XHR (for progress events) ────────────────
function handleFiles(files) {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    apiKeyInput.focus();
    apiKeyInput.closest('.api-key-field').style.borderColor = 'rgba(255,60,60,0.6)';
    setTimeout(() => apiKeyInput.closest('.api-key-field').style.borderColor = '', 2000);
    return;
  }

  files.forEach((file) => {
    const card = createFileCard(file);
    const progressBar = card.querySelector('.file-progress-bar');

    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/upload`);
    xhr.setRequestHeader('x-api-key', apiKey);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 90); // go to 90% on upload
        progressBar.style.width = `${pct}%`;
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data.success) {
          upgradeCard(card, data.files[0]);
        } else {
          showCardError(card, data.message || 'Upload failed.');
        }
      } catch {
        showCardError(card, 'Unexpected server response.');
      }
    });

    xhr.addEventListener('error', () => showCardError(card, 'Network error. Could not connect to server.'));
    xhr.send(form);
  });
}

// ── Delete a file ─────────────────────────────────────────────
async function deleteFile(key, card) {
  const apiKey = apiKeyInput.value.trim();
  card.classList.add('removing');
  card.addEventListener('animationend', () => card.remove(), { once: true });

  try {
    await fetch(`${API_BASE}/api/files/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey },
    });
  } catch (err) {
    console.warn('Delete request failed (file may already be removed):', err.message);
  }
}

// ── API code tabs ─────────────────────────────────────────────
document.querySelectorAll('.code-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.code-tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.code-body .code-block').forEach((b) => b.classList.remove('active'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(`code-${tab.dataset.lang}`).classList.add('active');
  });
});

// ── Utility ──────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
