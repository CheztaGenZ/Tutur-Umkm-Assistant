import { escapeHtml } from '/escape.js';

const $ = (sel) => document.querySelector(sel);
const rupiah = (value) => `Rp${new Intl.NumberFormat('id-ID').format(Number(value) || 0)}`;

let products = [];

function alertBox(text, kind = 'error') {
  const el = $('#alert');
  el.textContent = text;
  el.className = `alert ${kind}`.trim();
  el.hidden = false;
}

function clearAlert() {
  const el = $('#alert');
  el.hidden = true;
  el.textContent = '';
}

async function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const body =
    opts.body !== undefined
      ? JSON.stringify(opts.body)
      : ['POST', 'PUT', 'DELETE'].includes(method)
        ? '{}'
        : undefined;
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Tidak bisa menyimpan (${res.status}).`);
  return data;
}

function render() {
  $('#count').textContent = `${products.length} produk`;
  const list = $('#products');
  if (!products.length) {
    list.innerHTML =
      '<p class="muted">Belum ada produk. Tambahkan satu produk di atas agar Tutur bisa menjawab harganya.</p>';
    return;
  }
  list.innerHTML = products
    .map(
      (item) => `
      <article class="product">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="price">${rupiah(item.price)}</p>
          ${item.description ? `<p class="desc">${escapeHtml(item.description)}</p>` : ''}
          <div class="meta">
            <span class="tag">${escapeHtml(item.category)}</span>
            <span class="tag ${item.available ? 'on' : 'off'}">${
              item.available ? 'Tersedia' : 'Tidak tersedia'
            }</span>
          </div>
        </div>
        <div class="product-actions">
          <button type="button" data-edit="${escapeHtml(item.id)}">Ubah</button>
          <button type="button" class="danger" data-delete="${escapeHtml(item.id)}">Hapus</button>
        </div>
      </article>`,
    )
    .join('');

  for (const button of list.querySelectorAll('[data-edit]')) {
    button.addEventListener('click', () => startEdit(button.dataset.edit));
  }
  for (const button of list.querySelectorAll('[data-delete]')) {
    button.addEventListener('click', () => remove(button.dataset.delete));
  }
}

function resetForm() {
  $('#product-id').value = '';
  $('#name').value = '';
  $('#price').value = '';
  $('#description').value = '';
  $('#category').value = 'Makanan';
  $('#available').checked = true;
  $('#save').textContent = 'Simpan produk';
  $('#cancel').hidden = true;
}

function startEdit(id) {
  const item = products.find((p) => p.id === id);
  if (!item) return;
  $('#product-id').value = item.id;
  $('#name').value = item.name;
  $('#price').value = item.price;
  $('#description').value = item.description || '';
  $('#category').value = item.category;
  $('#available').checked = Boolean(item.available);
  $('#save').textContent = 'Simpan perubahan';
  $('#cancel').hidden = false;
  $('#name').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function remove(id) {
  if (!confirm('Hapus produk ini dari katalog dan dari jawaban Tutur?')) return;
  try {
    const data = await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    products = data.products || [];
    render();
    if ($('#product-id').value === id) resetForm();
    alertBox('Produk dihapus.', 'ok');
  } catch (err) {
    alertBox(err.message);
  }
}

$('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAlert();
  const id = $('#product-id').value;
  const payload = {
    name: $('#name').value.trim(),
    price: Number($('#price').value) || 0,
    description: $('#description').value.trim(),
    category: $('#category').value,
    available: $('#available').checked,
  };
  if (!payload.name) return alertBox('Nama produk wajib diisi.');
  if (payload.price <= 0) return alertBox('Harga harus lebih dari 0.');

  $('#save').disabled = true;
  try {
    const data = id
      ? await api(`/api/products/${encodeURIComponent(id)}`, { method: 'PUT', body: payload })
      : await api('/api/products', { method: 'POST', body: payload });
    products = data.products || [];
    render();
    resetForm();
    alertBox(id ? 'Produk diperbarui. Tutur memakai harga baru.' : 'Produk ditambahkan. Tutur siap menjawab harganya.', 'ok');
  } catch (err) {
    alertBox(err.message);
  } finally {
    $('#save').disabled = false;
  }
});

$('#cancel').addEventListener('click', resetForm);

$('#logout').addEventListener('click', async () => {
  await fetch('/api/public/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  location.replace('/masuk');
});

async function boot() {
  try {
    const me = await (await fetch('/api/public/auth/me')).json();
    if (!me.user) {
      location.replace('/masuk?next=/katalog');
      return;
    }
    $('#user-name').textContent = me.user.name;
    const data = await api('/api/products');
    products = data.products || [];
    render();
  } catch (err) {
    alertBox(err.message);
  }
}

boot();
