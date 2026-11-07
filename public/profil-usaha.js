const $ = (sel) => document.querySelector(sel);

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
  };
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
