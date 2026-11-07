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
      location.replace('/masuk?next=/profil-akun');
      return;
    }
    $('#name').value = me.user.name || '';
    $('#email').value = me.user.email || '';
  } catch (err) {
    alertBox(err.message);
  }
}

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#name').value.trim();
  if (name.length < 2) return alertBox('Nama minimal 2 karakter.');
  const btn = $('#save-name');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';
  try {
    const res = await fetch('/api/public/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan nama.');
    alertBox('Nama tersimpan.', 'ok');
  } catch (err) {
    alertBox(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan nama';
  }
});

$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const currentPassword = $('#currentPassword').value;
  const newPassword = $('#newPassword').value;
  const confirmPassword = $('#confirmPassword').value;
  if (newPassword !== confirmPassword) return alertBox('Password baru tidak sama.');
  if (newPassword.length < 8) return alertBox('Password baru minimal 8 karakter.');
  const btn = $('#save-password');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';
  try {
    const res = await fetch('/api/public/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal mengganti password.');
    $('#password-form').reset();
    alertBox('Password berhasil diganti.', 'ok');
  } catch (err) {
    alertBox(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ganti password';
  }
});

boot();

