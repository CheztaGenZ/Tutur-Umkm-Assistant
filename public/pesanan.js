import { escapeHtml } from '/escape.js';

const $ = (sel) => document.querySelector(sel);

const rupiah = (value) => `Rp${new Intl.NumberFormat('id-ID').format(Number(value) || 0)}`;
const when = (ts) =>
  new Date(Number(ts)).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

const STATUS = {
  pending: { label: 'Menunggu', next: [['done', 'Selesai'], ['cancelled', 'Batalkan']] },
  done: { label: 'Selesai', next: [['pending', 'Buka lagi']] },
  cancelled: { label: 'Dibatalkan', next: [['pending', 'Buka lagi']] },
};

let orders = [];

function render() {
  const box = $('#orders');
  if (!orders.length) {
    box.innerHTML =
      '<p class="muted">Belum ada pesanan. Pesanan akan muncul di sini setelah pelanggan memesan lewat chat.</p>';
    return;
  }
  box.innerHTML = orders
    .map((o) => {
      const status = STATUS[o.status] || { label: o.status, next: [] };
      const actions = status.next
        .map(
          ([value, label]) =>
            `<button class="order-action" type="button" data-order="${escapeHtml(o.id)}" data-status="${value}">${escapeHtml(label)}</button>`,
        )
        .join('');
      return `
        <article class="order${o.status === 'done' ? ' is-done' : ''}${o.status === 'cancelled' ? ' is-cancelled' : ''}">
          <div>
            <h2>${escapeHtml(o.customer_name || 'Tanpa nama')}</h2>
            <p>${escapeHtml(o.items)}</p>
            <small>${escapeHtml(when(o.created_at))} · ${escapeHtml(o.source === 'coba-chat' ? 'Coba Chat' : 'WhatsApp')}</small>
          </div>
          <div class="order-side">
            <div class="order-total">
              <strong>${rupiah(o.total)}</strong>
              <span class="order-status status-${escapeHtml(o.status)}">${escapeHtml(status.label)}</span>
            </div>
            ${actions ? `<div class="order-actions">${actions}</div>` : ''}
          </div>
        </article>`;
    })
    .join('');
}

async function setStatus(id, status, button) {
  const previous = orders;
  button.disabled = true;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal mengubah status pesanan.');
    orders = data.orders || orders;
    render();
  } catch (err) {
    orders = previous;
    render();
    const note = document.createElement('p');
    note.className = 'alert error';
    note.textContent = err.message;
    $('#orders').before(note);
    setTimeout(() => note.remove(), 4000);
  }
}

$('#orders').addEventListener('click', (event) => {
  const button = event.target.closest('[data-order]');
  if (!button) return;
  setStatus(button.dataset.order, button.dataset.status, button);
});

async function boot() {
  try {
    const me = await (await fetch('/api/public/auth/me')).json();
    if (!me.user) {
      location.replace('/masuk?next=/pesanan');
      return;
    }
    if (!me.user.termsAccepted) {
      location.replace('/persetujuan');
      return;
    }
    if (me.user.needsProfile) {
      location.replace('/profil-usaha');
      return;
    }
    const res = await fetch('/api/orders');
    const data = await res.json();
    orders = data.orders || [];
    render();
  } catch (err) {
    $('#orders').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

boot();
