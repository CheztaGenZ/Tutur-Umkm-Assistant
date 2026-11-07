import { escapeHtml } from '/escape.js';

const token =
  new URLSearchParams(location.search).get('token') ||
  sessionStorage.getItem('tutur_admin') ||
  '';

if (new URLSearchParams(location.search).get('token')) {
  sessionStorage.setItem('tutur_admin', token);
}

const $ = (sel) => document.querySelector(sel);

async function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const body =
    opts.body !== undefined
      ? opts.body
      : ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
        ? '{}'
        : undefined;
  const res = await fetch(path, {
    ...opts,
    method,
    body,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-admin-token': token } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

function render(items) {
  $('#count').textContent = `${items.length} baris`;
  const list = $('#list');
  if (!items.length) {
    list.innerHTML = '<p class="empty">Belum ada data. Tambahkan satu fakta di atas.</p>';
    return;
  }
  list.innerHTML = items
    .map(
      (item) => `
      <article class="item">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.body)}</p>
          <p class="meta">${escapeHtml(item.category)}${
            item.keywords ? ` · ${escapeHtml(item.keywords)}` : ''
          }</p>
        </div>
        <button type="button" data-id="${escapeHtml(item.id)}">Hapus</button>
      </article>`,
    )
    .join('');

  for (const button of list.querySelectorAll('button[data-id]')) {
    button.addEventListener('click', () => remove(button.dataset.id));
  }
}

async function load() {
  try {
    const data = await api('/api/knowledge');
    render(data.knowledge || []);
  } catch (err) {
    $('#list').innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  }
}

async function remove(id) {
  if (!confirm('Hapus data ini? Tutur tidak akan memakai fakta ini lagi.')) return;
  try {
    const data = await api(`/api/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' });
    render(data.knowledge || []);
    setStatus('Data dihapus.', 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

$('#knowledge-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    category: $('#category').value,
    title: $('#title').value.trim(),
    body: $('#body').value.trim(),
    keywords: $('#keywords').value.trim(),
  };
  if (!payload.title || !payload.body) {
    setStatus('Judul dan isi wajib diisi.', 'error');
    return;
  }
  try {
    const data = await api('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    render(data.knowledge || []);
    event.target.reset();
    setStatus('Data disimpan. Jawaban berikutnya memakai fakta ini.', 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

load();
