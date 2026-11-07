const page = document.body.dataset.page;
const $ = (sel) => document.querySelector(sel);
const alertBox = $('#alert');
const submit = $('#submit');
const form = $('#auth-form');
const next = new URLSearchParams(location.search).get('next') || '/katalog';

const MESSAGES = {
  google_belum_diatur: 'Masuk dengan Google belum diatur. Gunakan email dan password dulu.',
  facebook_belum_diatur: 'Masuk dengan Facebook belum diatur. Gunakan email dan password dulu.',
  google_gagal: 'Masuk dengan Google gagal. Coba lagi atau pakai email.',
  facebook_gagal: 'Masuk dengan Facebook gagal. Coba lagi atau pakai email.',
  sesi_habis: 'Sesi Anda berakhir. Silakan masuk lagi.',
};

function showAlert(text, kind = 'error') {
  alertBox.textContent = text;
  alertBox.className = `alert ${kind}`.trim();
  alertBox.hidden = false;
}

function clearAlert() {
  alertBox.hidden = true;
  alertBox.textContent = '';
}

const errorParam = new URLSearchParams(location.search).get('error');
if (errorParam) showAlert(MESSAGES[errorParam] || 'Terjadi masalah. Coba lagi.');

document.querySelectorAll('[data-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.toggle);
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    button.textContent = shown ? 'Lihat' : 'Sembunyikan';
  });
});

async function checkSession() {
  try {
    const res = await fetch('/api/public/auth/me');
    const data = await res.json();
    if (data.user) location.replace(next);
  } catch {
    /* biarkan form tampil */
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAlert();

  const email = $('#email').value.trim();
  const password = $('#password').value;
  const name = $('#name')?.value.trim();

  if (!email || !password) {
    showAlert('Email dan password wajib diisi.');
    return;
  }
  if (page === 'daftar' && !name) {
    showAlert('Nama Anda wajib diisi.');
    return;
  }
  if (page === 'daftar' && password.length < 8) {
    showAlert('Password minimal 8 karakter.');
    return;
  }
  if (page === 'daftar' && !$('#terms')?.checked) {
    showAlert('Centang dulu persetujuan Ketentuan Layanan dan Kebijakan Privasi.');
    return;
  }

  submit.disabled = true;
  submit.textContent = page === 'daftar' ? 'Membuat akun...' : 'Masuk...';

  try {
    const res = await fetch(`/api/public/auth/${page === 'daftar' ? 'register' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        page === 'daftar' ? { name, email, password, acceptedTerms: true } : { email, password },
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Tidak bisa masuk. Coba lagi.');
    location.replace(next);
  } catch (err) {
    showAlert(err.message);
    submit.disabled = false;
    submit.textContent = page === 'daftar' ? 'Buat akun' : 'Masuk';
  }
});

checkSession();
