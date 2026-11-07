import { escapeHtml } from '/escape.js';

const $ = (sel) => document.querySelector(sel);

const rupiah = (value) => `Rp${new Intl.NumberFormat('id-ID').format(Number(value) || 0)}`;
const when = (ts) =>
  new Date(Number(ts)).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

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
    const orders = data.orders || [];
    const box = $('#orders');
    if (!orders.length) {
      box.innerHTML =
        '<p class="muted">Belum ada pesanan. Pesanan akan muncul di sini setelah pelanggan memesan lewat chat.</p>';
      return;
    }
    box.innerHTML = orders
      .map(
        (o) => `
        <article class="order">
          <div>
            <h2>${escapeHtml(o.customer_name || 'Tanpa nama')}</h2>
            <p>${escapeHtml(o.items)}</p>
            <small>${escapeHtml(when(o.created_at))} · ${escapeHtml(o.source === 'coba-chat' ? 'Coba Chat' : 'WhatsApp')}</small>
          </div>
          <div class="order-total">
            <strong>${rupiah(o.total)}</strong>
            <span>${escapeHtml(o.status)}</span>
          </div>
        </article>`,
      )
      .join('');
  } catch (err) {
    $('#orders').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

boot();
