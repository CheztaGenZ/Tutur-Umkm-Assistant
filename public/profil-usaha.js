const $ = (sel) => document.querySelector(sel);
let pendingQris = null;

function setQrisPreview(url) {
  const box = $('#qrisPreview');
  if (url) {
    $('#qrisPreviewImg').src = url;
    box.hidden = false;
  } else {
    $('#qrisPreviewImg').removeAttribute('src');
    box.hidden = true;
  }
}

$('#qrisImage').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingQris = reader.result;
    setQrisPreview(pendingQris);
  };
  reader.readAsDataURL(file);
});

function alertBox(text, kind = 'error') {
  const el = $('#alert');
  el.textContent = text;
  el.className = `alert ${kind}`.trim();
  el.hidden = false;
}

async function boot() {
  try {
    const me = await (await fetch('/api/public/auth/me')).json();
    if (!me.user) {
      location.replace('/masuk?next=/profil-usaha');
      return;
    }
    if (!me.user.termsAccepted) {
      location.replace('/persetujuan');
      return;
    }
    const data = await (await fetch('/api/business')).json();
    const p = data.profile;
    if (!p) return;
    $('#name').value = p.name || '';
    $('#category').value = p.category || 'Warung makan';
    $('#location').value = p.location || '';
    $('#hours').value = p.hours || '';
    $('#specialty').value = p.specialty || '';
    $('#contact').value = p.contact || '';
    $('#notes').value = p.notes || '';
    const methods = String(p.payment_methods || '').toLowerCase();
    $('#payCash').checked = methods.includes('tunai');
    $('#payQris').checked = methods.includes('qris');
    $('#payBank').checked = methods.includes('transfer') || methods.includes('bank');
    $('#bankInfo').value = p.bank_info || '';
    if (p.qris_image_path) setQrisPreview(p.qris_image_path);
    $('#save').textContent = 'Simpan perubahan';
  } catch (err) {
    alertBox(err.message);
  }
}

$('#business-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    name: $('#name').value.trim(),
    category: $('#category').value,
    location: $('#location').value.trim(),
    hours: $('#hours').value.trim(),
    specialty: $('#specialty').value.trim(),
    contact: $('#contact').value.trim(),
    notes: $('#notes').value.trim(),
    paymentMethods: [
      $('#payCash').checked ? 'Tunai' : '',
      $('#payQris').checked ? 'QRIS' : '',
      $('#payBank').checked ? 'Transfer bank' : '',
    ].filter(Boolean),
    bankInfo: $('#bankInfo').value.trim(),
  };
  if (pendingQris) payload.qrisImage = pendingQris;
  if (!payload.name) return alertBox('Nama usaha wajib diisi.');
  const btn = $('#save');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';
  try {
    const res = await fetch('/api/business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan profil.');
    location.replace('/dashboard');
  } catch (err) {
    alertBox(err.message);
    btn.disabled = false;
    btn.textContent = 'Simpan dan buka dashboard';
  }
});

boot();
