import { escapeHtml } from '/escape.js';

const $ = (sel) => document.querySelector(sel);
const rupiah = (value) => `Rp${new Intl.NumberFormat('id-ID').format(Number(value) || 0)}`;

let products = [];
let pendingImage = null;
let removeImage = false;
let currentImage = null;

function setPreview(url) {
  const box = $('#preview');
  const img = $('#preview-img');
  if (url) {
    img.src = url;
    box.hidden = false;
  } else {
    img.removeAttribute('src');
    box.hidden = true;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const dataUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
  const max = 900;
  const side = Math.min(image.width, image.height);
  const sx = (image.width - side) / 2;
  const sy = (image.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = max;
  canvas.height = max;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, sx, sy, side, side, 0, 0, max, max);
  return canvas.toDataURL('image/jpeg', 0.82);
}

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

const FALLBACK_LOGO = '/logo-tutur.png';

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
        <img class="thumb${item.image_url ? '' : ' fallback'}" src="${escapeHtml(item.image_url || FALLBACK_LOGO)}" width="96" height="96" alt="" loading="lazy" />
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
  $('#image').value = '';
  pendingImage = null;
  removeImage = false;
  currentImage = null;
  setPreview(null);
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
  $('#image').value = '';
  pendingImage = null;
  removeImage = false;
  currentImage = item.image_url || null;
  setPreview(currentImage);
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
  if (pendingImage) payload.image = pendingImage;
  if (removeImage && !pendingImage) payload.removeImage = true;
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

$('#image').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    pendingImage = await compressImage(file);
    removeImage = false;
    setPreview(pendingImage);
  } catch {
    alertBox('Foto tidak bisa dibaca. Coba file lain.');
  }
});

$('#remove-image').addEventListener('click', () => {
  pendingImage = null;
  removeImage = true;
  $('#image').value = '';
  setPreview(null);
});

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
