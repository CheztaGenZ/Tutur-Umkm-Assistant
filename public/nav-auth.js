const nav = document.querySelector('.nav');
if (nav) {
  fetch('/api/public/auth/me')
    .then((res) => res.json())
    .then((data) => {
      if (!data.user) return;
      const name = String(data.user.name || 'Akun').split(' ')[0];
      nav.innerHTML = `
        <a href="/dashboard">Dashboard</a>
        <a href="/katalog">Katalog</a>
        <a href="/profil-usaha">Profil usaha</a>
        <a href="/pesanan">Pesanan</a>
        <span class="nav-user">Hai, ${name.replace(/[&<>"']/g, '')}</span>
        <button class="nav-logout" type="button" id="navLogout">Keluar</button>
      `;

      const actions = document.querySelector('.hero .actions');
      if (actions) {
        actions.innerHTML = `
          <a class="btn light" href="/dashboard">Buka Dashboard Chat</a>
          <a class="btn outline" href="/katalog">Lihat Katalog</a>
        `;
      }
      const note = document.querySelector('.hero .small');
      if (note) note.textContent = `Masuk sebagai ${name}. Katalog dan data bisnis Anda tersimpan.`;

      const owners = document.querySelector('#ownersCta');
      if (owners) {
        owners.innerHTML = `
          <div>
            <h2>Katalog Anda sudah siap.</h2>
            <p>Buka dashboard untuk membalas chat, atau kelola produk dan foto di katalog.</p>
          </div>
          <div class="actions">
            <a class="btn light" href="/dashboard">Buka Dashboard Chat</a>
            <a class="btn outline" href="/katalog">Kelola Katalog</a>
          </div>
        `;
      }
      document.getElementById('navLogout')?.addEventListener('click', async () => {
        await fetch('/api/public/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        location.reload();
      });
    })
    .catch(() => {});
}
