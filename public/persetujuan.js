const $ = (sel) => document.querySelector(sel);

async function boot() {
  try {
    const res = await fetch('/api/public/auth/me');
    const data = await res.json();
    if (!data.user) {
      location.replace('/masuk');
      return;
    }
    if (data.user.termsAccepted) {
      location.replace('/katalog');
    }
  } catch {
    $('#status').textContent = 'Tidak bisa memeriksa sesi. Coba muat ulang halaman.';
  }
}

$('#agree').addEventListener('change', (event) => {
  $('#accept').disabled = !event.target.checked;
});

$('#accept').addEventListener('click', async () => {
  const button = $('#accept');
  button.disabled = true;
  $('#status').textContent = 'Menyimpan persetujuan...';
  try {
    const res = await fetch('/api/public/auth/accept-terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan persetujuan.');
    location.replace('/katalog');
  } catch (err) {
    $('#status').textContent = err.message;
    button.disabled = false;
  }
});

boot();
