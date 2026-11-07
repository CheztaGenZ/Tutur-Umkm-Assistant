const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  status: null,
  drafts: [],
  contacts: [],
  preview: null,
  settings: null,
  usage: null,
  settingsFormOrigin: null,
};

const ADMIN_TOKEN =
  new URLSearchParams(location.search).get('token') ||
  sessionStorage.getItem('tutur_admin') ||
  '';
if (new URLSearchParams(location.search).get('token')) {
  sessionStorage.setItem('tutur_admin', ADMIN_TOKEN);
}

async function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const hasBody = opts.body !== undefined && opts.body !== null;
  const body = hasBody
    ? JSON.stringify(opts.body)
    : ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? '{}'
      : undefined;
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {}),
    },
    ...opts,
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';

const numFmt = new Intl.NumberFormat('id-ID');
const compactFmt = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
const fmtNum = (n) => numFmt.format(Number(n) || 0);
const fmtCompact = (n) => compactFmt.format(Number(n) || 0);
const shortModel = (model) => {
  const text = String(model || '')
    .split('/')
    .pop()
    .replace(/:free$/, '');
  return text.length > 26 ? `${text.slice(0, 23)}…` : text;
};
const fmtDateTime = (ts) =>
  ts
    ? new Date(ts).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/* -------------------------------- status -------------------------------- */

async function refreshStatus() {
  try {
    const s = await api('/api/status');
    state.status = s;

    const wa = s.wa;
    const dot = $('#dot');
    dot.className = 'dot ' + (wa.status || '');
    const label =
      wa.status === 'open'
        ? `terhubung${wa.me?.number ? ' · ' + wa.me.number : ''}`
        : wa.status === 'qr'
          ? 'scan QR'
          : wa.status === 'logged_out'
            ? 'logout'
            : 'terputus';
    const pill = $('#waStatus');
    pill.textContent = label;

    const brandNumber = $('#brandNumber');
    if (brandNumber) {
      const brandName = s.config.me || wa.me?.name || 'Tutur';
      brandNumber.textContent = wa.me?.number
        ? `${brandName} · ${wa.me.number}`
        : `${brandName} · belum terhubung`;
    }

    const meEl = $('#meName');
    if (meEl) meEl.textContent = s.config.me ? `· ${s.config.me}` : '';
    $('#quota').textContent = `${s.sentToday} / ${s.config.maxPerDay}`;
    const sentEl = $('#kpiSent');
    if (sentEl) sentEl.textContent = s.sentToday;
    const fresh = $('#freshness');
    if (fresh) {
      fresh.textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    }

    const ai = $('#aiStatus');
    const visionModel = s.config.visionModel || '';
    ai.textContent = s.aiReady ? 'AI siap' : 'AI belum siap';
    const meter = $('#aiMeter');
    if (meter) meter.classList.toggle('off', !s.aiReady);
    ai.title = s.aiReady
      ? `Teks: ${s.config.model}${visionModel ? `\nGambar/video: ${visionModel}` : ''}`
      : 'Isi API key lewat menu Setting';

    const pauseBtn = $('#pauseBtn');
    pauseBtn.textContent = s.paused ? 'Lanjutkan' : 'Jeda';
    pauseBtn.classList.toggle('primary', s.paused);

    const canWrite = s.canWrite !== false;
    const readOnlyBanner = $('#readOnlyBanner');
    if (readOnlyBanner) readOnlyBanner.classList.toggle('hidden', canWrite);
    pauseBtn.disabled = !canWrite;
    const logoutBtn = $('#logoutBtn');
    if (logoutBtn) logoutBtn.disabled = !canWrite;
    syncClearDraftButton();

    const usage = s.usage || {};
    const usageTotal = Number(usage.totalTokens) || 0;
    const usageToday = Number(usage.todayTokens) || 0;
    const usageCalls = Number(usage.calls) || 0;
    const byKind = Array.isArray(usage.byKind) ? usage.byKind : [];
    const kindTokens = (kind) =>
      byKind.filter((x) => x.kind === kind).reduce((sum, x) => sum + (Number(x.tokens) || 0), 0);
    const replyTokens = kindTokens('reply');
    const testTokens = kindTokens('test') + kindTokens('playground');
    const replyCalls = byKind
      .filter((x) => x.kind === 'reply')
      .reduce((sum, x) => sum + (Number(x.calls) || 0), 0);
    const otherTokens = Math.max(0, usageTotal - replyTokens - testTokens);
    const usageEl = $('#usageTotal');
    if (usageEl) {
      usageEl.textContent = fmtCompact(replyTokens);
      $('#usageToday').textContent = `${fmtCompact(usageToday)} hari ini`;
      $('#usageCalls').textContent = `${fmtNum(replyCalls || usageCalls)} balasan`;
      const breakdown = $('#usageBreakdown');
      if (breakdown) {
        breakdown.textContent =
          testTokens || otherTokens
            ? `Tes & Coba Chat ${fmtCompact(testTokens)} · Lain ${fmtCompact(otherTokens)}`
            : 'Hanya balasan WhatsApp';
      }
      const usageCard = $('#usageCard');
      if (usageCard) {
        usageCard.title = `Balas WA: ${fmtNum(replyTokens)} token (${fmtNum(replyCalls)} panggilan)\nTes: ${fmtNum(
          testTokens,
        )} token\nLain: ${fmtNum(otherTokens)} token\nTotal semua: ${fmtNum(usageTotal)}`;
      }
    }

    const privacyInfo = $('#statusPrivacyInfo');
    if (privacyInfo) {
      const p = s.privacy;
      const mode = Number(p?.mode);
      const who = s.wa?.me?.number ? ` (${s.wa.me.number})` : '';
      if (!p || p.mode == null) {
        privacyInfo.textContent = `Privasi Status${who} belum tersinkron. Status akan ditahan sampai privasi terbaca.`;
      } else if (mode === 2) {
        privacyInfo.textContent = `Privasi Status${who}: semua kontak.`;
      } else if (mode === 1) {
        privacyInfo.textContent = `Privasi Status${who}: semua kontak, kecuali ${fmtNum(
          p.count,
        )} dikecualikan.`;
      } else if (mode === 0) {
        privacyInfo.textContent = `Privasi Status${who}: hanya ${fmtNum(
          p.count,
        )} kontak yang dipilih.`;
      } else if (mode === 3) {
        privacyInfo.textContent = `Privasi Status${who}: teman dekat (${fmtNum(p.count)} kontak).`;
      } else {
        privacyInfo.textContent = `Privasi Status${who}: mode tidak dikenal. Status akan ditahan.`;
      }
    }

    const overlay = $('#qrOverlay');
    if (wa.status === 'qr' && wa.qr) {
      $('#qrImg').src = wa.qr;
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }

    const waTitle = $('#waPanelTitle');
    if (waTitle) {
      const sub = $('#waPanelSub');
      const btn = $('#waConnectBtn');
      if (wa.status === 'open') {
        waTitle.textContent = 'WhatsApp tersambung';
        sub.textContent = wa.me?.number
          ? `Nomor ${wa.me.number}. Chat masuk akan muncul di antrean bawah.`
          : 'Chat masuk akan muncul di antrean bawah.';
        btn.textContent = 'Tersambung';
        btn.disabled = true;
      } else if (wa.status === 'qr' && wa.qr) {
        waTitle.textContent = 'Scan QR untuk menyambungkan';
        sub.textContent = 'Buka WhatsApp di HP, pilih Perangkat tertaut, lalu scan.';
        btn.textContent = 'Tampilkan QR';
        btn.disabled = false;
      } else {
        waTitle.textContent = 'WhatsApp belum tersambung';
        sub.textContent = 'Hubungkan nomor usaha untuk menerima chat dan membuat draft di sini.';
        btn.textContent = 'Hubungkan WhatsApp';
        btn.disabled = false;
      }
    }
  } catch (err) {
    console.error(err);
  }
}

/* -------------------------------- drafts -------------------------------- */

async function refreshDrafts() {
  try {
    state.drafts = await api('/api/drafts?status=pending');
    renderDrafts();
    const badge = $('#draftCount');
    badge.textContent = state.drafts.length;
    badge.classList.toggle('zero', state.drafts.length === 0);
    syncClearDraftButton();
    await refreshKpis();
  } catch (err) {
    console.error(err);
  }
}

function syncClearDraftButton() {
  const btn = $('#clearDraftsBtn');
  if (!btn) return;
  btn.classList.toggle(
    'hidden',
    state.drafts.length === 0 || state.status?.canWrite === false,
  );
}

async function refreshKpis() {
  try {
    const [contacts, jobs] = await Promise.all([api('/api/contacts'), api('/api/status-jobs')]);
    const auto = contacts.filter((c) => c.mode === 'auto').length;
    const pending = jobs.filter((j) => j.status === 'pending').length;
    $('#kpiDrafts').textContent = state.drafts.length;
    $('#kpiAuto').textContent = auto;
    $('#kpiStatus').textContent = pending;
    $('#contactSummary').textContent = `${contacts.length} kontak`;
    $('#draftSummary').textContent = state.drafts.length
      ? `${state.drafts.length} pesan menunggu persetujuan`
      : 'Semua draft sudah dibereskan';
  } catch (err) {
    console.error(err);
  }
}

function confClass(c) {
  if (c == null) return 'low';
  return c >= 0.75 ? 'high' : c >= 0.45 ? 'mid' : 'low';
}

function renderDrafts() {
  const root = $('#drafts');
  if (!state.drafts.length) {
    root.innerHTML = `<div class="empty">Tidak ada draft menunggu. Kalau ada pesan masuk yang butuh jawaban, akan muncul di sini.</div>`;
    return;
  }

  const LIMIT = 6;
  const open = state.draftsExpanded === true;
  const shown = open ? state.drafts : state.drafts.slice(0, LIMIT);
  const sisa = state.drafts.length - shown.length;

  root.innerHTML =
    shown
      .map((d) => {
        const name = d.contact_name || d.contact_number || d.jid;
        return `
      <article class="card" data-id="${esc(d.id)}">
        <div class="card-head">
          <div class="who">
            <div class="avatar">${esc(name.slice(0, 2).toUpperCase())}</div>
            <div style="min-width:0">
              <div class="name">${esc(name)}</div>
              <div class="sub">${esc(fmtTime(d.created_at))} · ${esc(d.contact_mode || 'draft')}</div>
            </div>
          </div>
          <div class="meta">
            ${
              d.confidence != null
                ? `<span class="conf ${confClass(d.confidence)}">${Math.round(d.confidence * 100)}%</span>`
                : ''
            }
          </div>
        </div>
        <div class="incoming">${esc(d.incoming_body)}</div>
        <textarea class="reply-box" rows="1">${esc(d.reply || '')}</textarea>
        <div class="card-foot">
          <div class="meta" style="max-width:52%">${
            /Kontak di mode draft/i.test(d.reason || '') ? '' : esc(d.reason || '')
          }</div>
          <div class="actions">
            <button class="btn small ghost" data-act="regen">Buat ulang</button>
            <button class="btn small ghost danger" data-act="discard">Abaikan</button>
            <button class="btn small primary" data-act="send">Kirim</button>
          </div>
        </div>
      </article>`;
      })
      .join('') +
    (state.drafts.length > LIMIT
      ? `<div class="row list-more">
          <button class="btn ghost" data-expand="1">${
            open ? 'Ringkas daftar' : `Lihat semua ${state.drafts.length} draft`
          }</button>
          ${!open && sisa > 0 ? `<span class="muted">${sisa} lainnya disembunyikan</span>` : ''}
        </div>`
      : '');
}

$('#drafts').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-expand]');
  if (!btn) return;
  state.draftsExpanded = !state.draftsExpanded;
  renderDrafts();
});

$('#clearDraftsBtn').addEventListener('click', async () => {
  if (!state.drafts.length) return;
  if (state.status?.canWrite === false) return toast('Aksi hanya bisa dilakukan dari PC');
  const count = state.drafts.length;
  if (
    !window.confirm(
      `Hapus ${count} draft yang menunggu? Tindakan ini tidak bisa dibatalkan.`,
    )
  )
    return;
  try {
    const result = await api('/api/drafts?status=pending', { method: 'DELETE' });
    state.draftsExpanded = false;
    toast(`${result.deleted ?? count} draft dihapus`);
    await refreshDrafts();
  } catch (err) {
    toast(err.message);
  }
});

$('#drafts').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.card');
  const id = card.dataset.id;
  const reply = card.querySelector('.reply-box').value;
  const act = btn.dataset.act;

  btn.disabled = true;
  try {
    if (act === 'send') {
      await api(`/api/drafts/${id}/send`, { method: 'POST', body: { reply } });
      toast('Terkirim');
    } else if (act === 'discard') {
      await api(`/api/drafts/${id}/discard`, { method: 'POST' });
      toast('Draft diabaikan');
    } else if (act === 'regen') {
      toast('Menyusun ulang…');
      const updated = await api(`/api/drafts/${id}/regenerate`, { method: 'POST' });
      card.querySelector('.reply-box').value = updated.reply || '';
      toast('Draft diperbarui');
      btn.disabled = false;
      return;
    }
    await refreshDrafts();
    await refreshStatus();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
});

$('#drafts').addEventListener('input', async (e) => {
  if (!e.target.classList.contains('reply-box')) return;
  const card = e.target.closest('.card');
  clearTimeout(card._t);
  card._t = setTimeout(() => {
    api(`/api/drafts/${card.dataset.id}`, {
      method: 'PATCH',
      body: { reply: e.target.value },
    }).catch(() => {});
  }, 600);
});

/* ------------------------------- contacts ------------------------------- */

async function refreshContacts() {
  try {
    const q = $('#contactSearch').value.trim();
    state.contacts = await api(`/api/contacts?q=${encodeURIComponent(q)}`);
    renderContacts();
  } catch (err) {
    console.error(err);
  }
}

function renderContacts() {
  const root = $('#contacts');
  if (!state.contacts.length) {
    root.innerHTML = `<div class="empty">Belum ada kontak. Import chat dulu, atau tunggu ada pesan masuk.</div>`;
    return;
  }
  root.innerHTML = state.contacts
    .map((c) => {
      const name = c.name || c.number || c.jid;
      return `
      <article class="card">
        <div class="crow">
          <div class="crow-main">
            <div class="who">
              <div class="avatar">${esc(name.slice(0, 2).toUpperCase())}</div>
              <div style="min-width:0">
                <div class="name"><span data-rename="${esc(c.jid)}" title="Klik untuk ganti nama">${esc(name)}</span></div>
                <div class="sub">${c.alias ? `${esc(c.alias)} - ` : ''}${esc(c.number || c.jid.replace('name:', 'import: '))}${
                  c.sampleCount ? ` · ${c.sampleCount} pesan` : ''
                }</div>
              </div>
            </div>
            ${c.relationship ? `<div class="rel">${esc(c.relationship)}</div>` : ''}
          </div>
          <div style="display: flex; gap: 6px; align-items: center">
            <div class="seg" data-jid="${esc(c.jid)}">
              <button data-mode="auto" class="${c.mode === 'auto' ? 'on' : ''}">auto</button>
              <button data-mode="draft" class="${c.mode === 'draft' ? 'on' : ''}">draft</button>
              <button data-mode="ignore" class="${c.mode === 'ignore' ? 'on' : ''}">jangan</button>
            </div>
            <button class="btn small ghost" data-rebuild="${esc(c.jid)}" title="Perbarui profil dari chat tersimpan">↻</button>
            <button class="btn small ghost" data-history="${esc(c.jid)}" title="Tarik riwayat chat dari HP">↓</button>
            <select class="input" data-register="${esc(c.jid)}" title="Level kesopanan" style="max-width: 140px; padding: 4px 8px; font-size: 11.5px">
              ${['wajib_sopan', 'keluarga', 'temen', 'temen_dekat', 'temen_poll']
                .map((v) => {
                  const label =
                    v === 'wajib_sopan'
                      ? 'Wajib sopan'
                      : v === 'keluarga'
                        ? 'Keluarga'
                        : v === 'temen'
                          ? 'Teman'
                          : v === 'temen_dekat'
                            ? 'Teman dekat'
                            : 'Teman poll';
                  const active =
                    c.register === v ||
                    (v === 'temen' && (c.register === 'sopan' || c.register === 'auto')) ||
                    (v === 'temen_dekat' && c.register === 'kasar');
                  return `<option value="${v}" ${active ? 'selected' : ''}>${label}</option>`;
                })
                .join('')}
            </select>
            ${
              c.jid.startsWith('name:')
                ? ''
                : `<button class="btn small ghost" data-link="${esc(c.jid)}" title="Gabungkan dengan profil hasil import">gabung</button>`
            }
          </div>
        </div>
      </article>`;
    })
    .join('');
}

$('#contacts').addEventListener('click', async (e) => {
  const renameEl = e.target.closest('[data-rename]');
  if (renameEl) {
    const jid = renameEl.dataset.rename;
    const name = window.prompt(
      'Nama kontak (samakan dengan nama yang kamu simpan di WhatsApp):',
      renameEl.textContent,
    );
    if (!name) return;
    try {
      await api(`/api/contacts/${encodeURIComponent(jid)}`, { method: 'PATCH', body: { name } });
      toast('Nama disimpan');
      await refreshContacts();
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  const linkBtn = e.target.closest('button[data-link]');
  if (linkBtn) {
    const jid = linkBtn.dataset.link;
    const query = window.prompt('Nama kontak hasil import yang mau digabung (misal: roaaaa)');
    if (!query) return;
    try {
      const r = await api(`/api/contacts/${encodeURIComponent(jid)}/link`, {
        method: 'POST',
        body: { query },
      });
      toast(`Digabung: ${r.samples} contoh`);
      await refreshContacts();
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  const regBtn = e.target.closest('button[data-register]');
  if (regBtn) {
    const jid = regBtn.dataset.register;
    const next = regBtn.textContent.includes('KASAR')
      ? 'keluarga'
      : regBtn.textContent.includes('KELUARGA')
        ? 'sopan'
        : 'kasar';
    try {
      await api(`/api/contacts/${encodeURIComponent(jid)}`, { method: 'PATCH', body: { register: next } });
      toast(
        next === 'kasar'
          ? 'Mode kasar: boleh ngumpat & ngajak ribut'
          : next === 'keluarga'
            ? 'Mode keluarga: sopan, tanpa kata kasar'
            : 'Mode sopan: bahasa dijaga',
      );
      await refreshContacts();
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  const histBtn = e.target.closest('button[data-history]');
  if (histBtn) {
    const jid = histBtn.dataset.history;
    histBtn.disabled = true;
    try {
      await api(`/api/contacts/${encodeURIComponent(jid)}/history`, {
        method: 'POST',
        body: { count: 300 },
      });
      toast('Permintaan dikirim. Riwayat masuk beberapa detik lagi');
    } catch (err) {
      toast(err.message);
    } finally {
      histBtn.disabled = false;
    }
    return;
  }

  const rebuildBtn = e.target.closest('button[data-rebuild]');
  if (rebuildBtn) {
    const jid = rebuildBtn.dataset.rebuild;
    rebuildBtn.disabled = true;
    try {
      const r = await api(`/api/contacts/${encodeURIComponent(jid)}/rebuild`, { method: 'POST' });
      toast(`Profil diperbarui: ${r.samples} pesanmu, ${r.pairs} pasangan`);
      await refreshContacts();
    } catch (err) {
      toast(err.message);
    } finally {
      rebuildBtn.disabled = false;
    }
    return;
  }

  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  const seg = btn.closest('.seg');
  const jid = seg.dataset.jid;
  const mode = btn.dataset.mode;
  try {
    await api(`/api/contacts/${encodeURIComponent(jid)}`, { method: 'PATCH', body: { mode } });
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    toast(
      mode === 'auto'
        ? 'AI akan balas otomatis (dalam batas aman)'
        : mode === 'draft'
          ? 'Draft dulu, kamu yang putuskan'
          : 'AI diam total untuk kontak ini',
    );
  } catch (err) {
    toast(err.message);
  }
});

let searchTimer;
$('#contactSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshContacts, 250);
});

$('#contacts').addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-register]');
  if (!sel) return;
  try {
    await api(`/api/contacts/${encodeURIComponent(sel.dataset.register)}`, {
      method: 'PATCH',
      body: { register: sel.value },
    });
    toast(`Level: ${sel.options[sel.selectedIndex].text}`);
    await refreshContacts();
  } catch (err) {
    toast(err.message);
  }
});

/* ------------------------------- activities ------------------------------ */

const EMOJIS = ['😀', '😅', '😂', '🥹', '😭', '😎', '🔥', '✨', '🙏', '👍', '❤️', '💀', '🗿', '☕', '📚', '💻']; // taste-skill-ignore: emoji picker is product content for status captions

async function refreshActivities() {
  try {
    const r = await api('/api/activities');
    const root = $('#activityList');
    if (!r.list.length) {
      root.innerHTML = '<div class="empty">Belum ada aktivitas. Isi di atas biar AI tahu kamu sedang apa.</div>';
      return;
    }
    root.innerHTML = r.list
      .map(
        (a) => `
      <article class="card">
        <div class="card-head">
          <div class="who">
            <div class="avatar">${a.active ? 'ON' : 'OFF'}</div>
            <div>
              <div class="name">${esc(a.text).slice(0, 90)}</div>
              <div class="sub">${
                a.expires_at ? 'sampai ' + new Date(a.expires_at).toLocaleString('id-ID') : 'tanpa batas'
              }${a.has_image ? ' · ada foto' : ''}</div>
            </div>
          </div>
          <div class="actions">
            <button class="btn small ghost" data-act-toggle="${a.id}">${a.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
            <button class="btn small ghost danger" data-act-del="${a.id}">Hapus</button>
          </div>
        </div>
      </article>`,
      )
      .join('');
  } catch (err) {
    console.error(err);
  }
}

$('#saveActivityBtn').addEventListener('click', async () => {
  const text = $('#activityText').value.trim();
  if (!text) return toast('Isi dulu aktivitasnya');
  try {
    let image = null;
    const file = $('#activityImage').files?.[0];
    if (file) image = await readFileBase64(file);
    await api('/api/activities', {
      method: 'POST',
      body: { text, image, hours: Number($('#activityHours').value) || 8 },
    });
    $('#activityText').value = '';
    $('#activityImage').value = '';
    toast('Aktivitas aktif. AI akan pakai ini');
    await refreshActivities();
  } catch (err) {
    toast(err.message);
  }
});

$('#activityList').addEventListener('click', async (e) => {
  const t = e.target.closest('button[data-act-toggle]');
  const d = e.target.closest('button[data-act-del]');
  if (t) {
    await api(`/api/activities/${t.dataset.actToggle}/toggle`, { method: 'POST' }).catch((err) => toast(err.message));
    await refreshActivities();
  } else if (d) {
    await api(`/api/activities/${d.dataset.actDel}`, { method: 'DELETE' }).catch((err) => toast(err.message));
    await refreshActivities();
  }
});

/* --------------------------------- status -------------------------------- */

$('#emojiRow').innerHTML = EMOJIS.map(
  (e) => `<button class="btn small ghost" data-emoji="${e}">${e}</button>`,
).join('');

$('#emojiRow').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-emoji]');
  if (!b) return;
  const ta = $('#statusCaption');
  ta.value += b.dataset.emoji;
  ta.focus();
});

async function refreshStatusJobs() {
  try {
    const jobs = await api('/api/status-jobs');
    const root = $('#statusList');
    if (!jobs.length) {
      root.innerHTML = '<div class="empty">Belum ada jadwal atau riwayat status.</div>';
      return;
    }
    root.innerHTML = jobs
      .map((j) => {
        const when = new Date(j.scheduled_at).toLocaleString('id-ID');
        const color =
          j.status === 'sent' ? 'var(--accent)' : j.status === 'failed' ? 'var(--red)' : 'var(--muted)';
        const actions = [];
        if (j.status === 'pending') {
          actions.push(
            `<button class="btn small ghost" data-status-now="${j.id}">Post sekarang</button>`,
          );
        }
        if (j.status === 'sent' && j.can_revoke) {
          actions.push(
            `<button class="btn small ghost" data-status-revoke="${j.id}" title="Tarik status dari WhatsApp">Tarik</button>`,
          );
        }
        actions.push(
          `<button class="btn small ghost danger" data-status-del="${j.id}" data-status-kind="${esc(
            j.status,
          )}">${
            j.status === 'pending'
              ? 'Batal'
              : j.can_revoke
                ? 'Hapus catatan'
                : 'Hapus'
          }</button>`,
        );
        return `
        <article class="card">
          <div class="card-head">
            <div class="who">
              <div class="avatar">${j.status === 'sent' ? 'OK' : j.status === 'failed' ? 'X' : '-'}</div>
              <div>
                <div class="name">${esc(j.caption || '(tanpa caption)').slice(0, 80)}</div>
                <div class="sub">${esc(when)} · <span style="color:${color}">${esc(j.status)}</span>${
                  j.has_image ? ' · foto' : ''
                }${j.recipient_count ? ` · ${j.recipient_count} kontak` : ''}</div>
              </div>
            </div>
            <div class="actions">${actions.join('')}</div>
          </div>
        </article>`;
      })
      .join('');
  } catch (err) {
    console.error(err);
  }
}

$('#saveStatusBtn').addEventListener('click', async () => {
  const date = $('#statusDate').value;
  const time = $('#statusTime').value;
  if (!date || !time) return toast('Isi tanggal & jam');
  const when = new Date(`${date}T${time}:00`);
  if (!Number.isFinite(when.getTime())) return toast('Tanggal/jam tidak valid');

  const privacy = state.status?.privacy;
  if (privacy && Number(privacy.mode) === 2) {
    if (
      !window.confirm(
        'Privasi Status akun ini "semua kontak". Status akan terlihat oleh semua kontak, termasuk yang ingin kamu kecualikan. Tetap jadwalkan?',
      )
    )
      return;
  }

  try {
    let image = null;
    const file = $('#statusImage').files?.[0];
    if (file) image = await readFileBase64(file);
    await api('/api/status-jobs', {
      method: 'POST',
      body: {
        image,
        caption: $('#statusCaption').value,
        scheduledAt: when.getTime(),
      },
    });
    $('#statusCaption').value = '';
    $('#statusImage').value = '';
    toast('Status dijadwalkan');
    await refreshStatusJobs();
  } catch (err) {
    toast(err.message);
  }
});

$('#statusList').addEventListener('click', async (e) => {
  const now = e.target.closest('button[data-status-now]');
  const revoke = e.target.closest('button[data-status-revoke]');
  const del = e.target.closest('button[data-status-del]');
  if (now) {
    try {
      const result = await api(`/api/status-jobs/${now.dataset.statusNow}/post-now`, {
        method: 'POST',
      });
      toast(
        result.ok
          ? 'Status diposting'
          : 'Status belum terkirim. Cek kuota harian atau privasi Status.',
      );
      await refreshStatusJobs();
    } catch (err) {
      toast(err.message);
      await refreshStatusJobs();
    }
  } else if (revoke) {
    if (
      !window.confirm(
        'Tarik status ini dari WhatsApp? Status akan hilang dari daftar status orang lain.',
      )
    )
      return;
    try {
      await api(`/api/status-jobs/${revoke.dataset.statusRevoke}/revoke`, {
        method: 'POST',
      });
      toast('Status ditarik dari WhatsApp');
      await refreshStatusJobs();
    } catch (err) {
      toast(err.message);
    }
  } else if (del) {
    const pending = del.dataset.statusKind === 'pending';
    const message = pending
      ? 'Batalkan jadwal status ini?'
      : 'Hapus status ini dari daftar? Status yang sudah terlanjur diposting di WhatsApp tidak ikut terhapus.';
    if (!window.confirm(message)) return;
    try {
      await api(`/api/status-jobs/${del.dataset.statusDel}`, { method: 'DELETE' });
      toast(pending ? 'Jadwal status dibatalkan' : 'Status dihapus dari daftar');
      await refreshStatusJobs();
    } catch (err) {
      toast(err.message);
    }
  }
});

/* ---------------------------------- test --------------------------------- */

async function loadTestContacts() {
  const contacts = await api('/api/contacts');
  const sel = $('#testContact');
  if (!contacts.length) {
    sel.innerHTML = '<option value="">(belum ada kontak)</option>';
    return;
  }
  sel.innerHTML = contacts
    .map((c) => `<option value="${esc(c.jid)}">${esc(c.name)} · ${esc(c.register)}</option>`)
    .join('');
}

$('#testBtn').addEventListener('click', async () => {
  const jid = $('#testContact').value;
  const message = $('#testMessage').value.trim();
  if (!jid || !message) return toast('Pilih kontak & isi pesan');

  const btn = $('#testBtn');
  btn.disabled = true;
  $('#testInfo').textContent = 'AI menyusun…';
  try {
    const r = await api('/api/test-reply', { method: 'POST', body: { jid, message } });
    const color =
      r.decision.action === 'auto' ? 'var(--accent)' : r.decision.action === 'draft' ? 'var(--amber)' : 'var(--red)';
    const bubbles = (r.bubbles || []).map((b) => `<div class="incoming">${esc(b)}</div>`).join('');
    $('#testResult').innerHTML = `
      <div class="panel">
        <div class="card-head">
          <div class="who">
            <div class="avatar">AI</div>
            <div>
              <div class="name">Balasan yang akan dikirim</div>
              <div class="sub">confidence ${(r.confidence * 100).toFixed(0)}% · ${esc(r.reason || '')}</div>
            </div>
          </div>
          <span class="pill" style="color:${color}; border-color:${color}">${esc(r.decision.action)}</span>
        </div>
        ${bubbles || '<div class="hint">(AI memilih tidak membalas)</div>'}
        ${
          r.sticker
            ? `<div class="hint" style="margin-top:8px">Stiker: ${esc(r.sticker)}</div>`
            : ''
        }
        ${
          r.attachActivity
            ? `<div class="hint" style="margin-top:4px">Melampirkan foto aktivitas: ${esc(r.activityText || '')}</div>`
            : ''
        }
        <div class="hint" style="margin-top:8px">Keputusan: ${esc(r.decision.reason)}</div>
      </div>`;
    $('#testInfo').textContent = '';
  } catch (err) {
    $('#testInfo').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

/* --------------------------------- import -------------------------------- */

const batch = [];

async function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsText(file);
  });
}

async function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function addOne(name, raw) {
  if (batch.some((r) => r.name === name)) return true; // sudah ada di daftar
  const p = await api('/api/ingest/preview', { method: 'POST', body: { raw } });
  if (!p.total) {
    toast(`${name}: tidak ada pesan terbaca`);
    return false;
  }
  batch.push({ name, raw, authors: p.authors, total: p.total, contact: '', status: '' });
  return true;
}

/** Tebak "aku" dari seluruh file: nama yang muncul di paling banyak chat. */
function detectMeName() {
  const votes = new Map();
  for (const row of batch) {
    for (const name of new Set(row.authors.map((a) => a.name))) {
      votes.set(name, (votes.get(name) || 0) + 1);
    }
  }
  const myName = (state.status?.config?.me || '').toLowerCase();
  let best = '';
  let bestScore = -1;
  for (const [name, files] of votes) {
    const score =
      files * 10 + (myName && name.toLowerCase().includes(myName) ? 100 : 0) + name.length / 1000;
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

function renderBatch() {
  $('#batchPanel').classList.toggle('hidden', batch.length === 0);
  if (!batch.length) return;

  const names = [...new Set(batch.flatMap((r) => r.authors.map((a) => a.name)))];
  const prev = $('#meSelect').value;
  $('#meSelect').innerHTML = names
    .map((n) => {
      const files = batch.filter((r) => r.authors.some((a) => a.name === n)).length;
      const kamu = /^(anda|you|kamu)$/i.test(n) ? ' (kamu)' : '';
      return `<option value="${esc(n)}">${esc(n)}${kamu}, muncul di ${files} file</option>`;
    })
    .join('');
  $('#meSelect').value = names.includes(prev) ? prev : detectMeName();

  const me = $('#meSelect').value;
  $('#batchInfo').textContent = `${batch.length} file · ${batch.reduce(
    (s, r) => s + r.total,
    0,
  )} pesan terbaca`;

  $('#batchRows').innerHTML = batch
    .map((row, i) => {
      const others = row.authors.filter((a) => a.name !== me);
      if (!others.some((o) => o.name === row.contact)) row.contact = others[0]?.name || '';
      return `
      <div class="card">
        <div class="crow">
          <div class="crow-main">
            <div class="name">${esc(row.name)}</div>
            <div class="sub">${row.total} pesan · kamu: ${esc(me)} · ${others.length} lawan bicara${
              others.length > 1
                ? ' · <span style="color: var(--amber)">grup, dipakai latihan gaya, tidak dibalas</span>'
                : ''
            }</div>
            ${row.status ? `<div class="hint" style="margin-top:6px">${esc(row.status)}</div>` : ''}
          </div>
          <select class="input" data-row="${i}" style="max-width: 240px">
            ${others
              .map(
                (o) =>
                  `<option value="${esc(o.name)}" ${o.name === row.contact ? 'selected' : ''}>${esc(
                    o.name,
                  )} (${o.count})</option>`,
              )
              .join('')}
          </select>
        </div>
      </div>`;
    })
    .join('');
}

async function addFiles(files) {
  const before = batch.length;
  const gagal = [];

  for (const file of files) {
    try {
      if (/\.zip$/i.test(file.name)) {
        // Export WhatsApp di Windows/iPhone datang sebagai .zip berisi .txt
        const dataUrl = await readFileBase64(file);
        const res = await api('/api/ingest/unzip', { method: 'POST', body: { file: dataUrl } });
        for (const inner of res.files) {
          // Tampilkan nama zip-nya, bukan "chat.txt" yang semuanya sama.
          const label = res.files.length === 1 ? file.name : `${file.name} › ${inner.name}`;
          const ok = await addOne(label, inner.raw);
          if (!ok) gagal.push(label);
        }
      } else {
        const ok = await addOne(file.name, await readFile(file));
        if (!ok) gagal.push(file.name);
      }
    } catch (err) {
      console.error('[import]', file.name, err);
      gagal.push(`${file.name} (${err.message})`);
    }
  }

  renderBatch();

  // Umpan balik permanen, bukan toast yang cepat hilang.
  if (batch.length === before) {
    $('#previewInfo').textContent =
      gagal.length > 0
        ? `Gagal dibaca: ${gagal.slice(0, 3).join(', ')}${gagal.length > 3 ? ` +${gagal.length - 3} lain` : ''}`
        : 'Tidak ada file yang berhasil dibaca.';
    $('#previewInfo').style.color = 'var(--red)';
  } else {
    $('#previewInfo').textContent = `${batch.length - before} chat siap diimpor`;
    $('#previewInfo').style.color = '';
  }
}

$('#fileInput').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  if (!files.length) return;
  $('#previewInfo').textContent = `Membaca ${files.length} file…`;
  await addFiles(files);
  $('#previewInfo').textContent = '';
  e.target.value = '';
});

$('#addPasteBtn').addEventListener('click', async () => {
  const raw = $('#rawInput').value;
  if (!raw.trim()) return toast('Tempel dulu isi chat-nya');
  try {
    const p = await api('/api/ingest/preview', { method: 'POST', body: { raw } });
    if (!p.total) return toast('Tidak ada pesan yang bisa dibaca. Cek format export.');
    batch.push({
      name: `tempelan ${batch.length + 1}`,
      raw,
      authors: p.authors,
      total: p.total,
      contact: '',
      status: '',
    });
    $('#rawInput').value = '';
    renderBatch();
  } catch (err) {
    toast(err.message);
  }
});

$('#meSelect').addEventListener('change', renderBatch);

$('#batchRows').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-row]');
  if (!sel) return;
  batch[Number(sel.dataset.row)].contact = sel.value;
});

$('#clearBtn').addEventListener('click', () => {
  batch.length = 0;
  $('#resultPanel').classList.add('hidden');
  renderBatch();
});

$('#expandSlangBtn').addEventListener('click', async () => {
  const btn = $('#expandSlangBtn');
  btn.disabled = true;
  try {
    const r = await api('/api/slang/expand', { method: 'POST' });
    $('#previewInfo').textContent = `${r.total} kata baru ditambahkan ke kamus`;
    $('#previewInfo').style.color = '';
    toast(`${r.total} kata baru`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
});

function showResult(results) {
  const last = results[results.length - 1];
  const panel = $('#resultPanel');
  panel.innerHTML = `
    <div class="card-head">
      <h3 style="margin: 0">Selesai</h3>
      <span class="conf high">${results.length} profil</span>
    </div>
    <ul class="styled-list">
      ${results
        .map(
          (r) =>
            `<li><b>${esc(r.contact)}</b>: ${r.myMessages} pesanmu, ${r.pairs} pasangan chat</li>`,
        )
        .join('')}
    </ul>
    <div class="label">Catatan gaya dari sampel terakhir</div>
    <ul class="styled-list">${(last.style?.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    ${
      last.relationship && !/^\(gagal/.test(last.relationship)
        ? `<div class="label">Ringkasan relasi</div><div class="incoming">${esc(last.relationship)}</div>`
        : ''
    }
    <div class="row">
      <button class="btn primary" id="openContact">Atur mode kontak</button>
    </div>`;
  panel.classList.remove('hidden');
  $('#openContact').onclick = async () => {
    switchTab('contacts');
    await refreshContacts();
  };
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#importAllBtn').addEventListener('click', async () => {
  const meName = $('#meSelect').value;
  const btn = $('#importAllBtn');
  btn.disabled = true;
  btn.textContent = 'Mengimpor…';
  const done = [];

  for (const row of batch) {
    row.status = 'menganalisis…';
    renderBatch();
    try {
      const r = await api('/api/ingest', {
        method: 'POST',
        body: { raw: row.raw, meName, contactName: row.contact },
      });
      if (r.group) {
        row.status = `OK · grup: ${r.myMessages} pesanmu dipakai untuk latihan gaya`;
        row.ok = true;
        done.push(r);
      } else if (r.skipped) {
        row.status = `Dilewati · ${r.reason}`;
        row.ok = true;
        done.push({ ...r, skipped: true });
      } else {
        row.status = `OK · ${r.myMessages} pesanmu, ${r.pairs} pasangan`;
        row.ok = true;
        done.push(r);
      }
    } catch (err) {
      const msg = /fetch/i.test(err.message)
        ? 'server tidak merespon. Cek jendela npm start masih hidup'
        : err.message;
      row.status = `Gagal · ${msg}`;
      row.ok = false;
    }
  }

  // Buang baris yang sudah berhasil, sisakan yang gagal untuk dicoba lagi.
  const gagal = batch.filter((r) => !r.ok);
  batch.length = 0;
  batch.push(...gagal);

  renderBatch();
  btn.disabled = false;
  btn.textContent = 'Import semua';

  if (gagal.length) {
    $('#previewInfo').textContent = `${gagal.length} file gagal, sisanya berhasil`;
    $('#previewInfo').style.color = 'var(--amber)';
  }

  if (done.length) {
    showResult(done);
    toast(`${done.length} profil tersimpan`);
    refreshContacts();
  } else {
    toast('Tidak ada yang berhasil diimpor');
  }
});

/* ---------------------------------- log ---------------------------------- */

const logRoot = $('#log');
function addLog(tag, msg) {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}</span><span class="log-tag ${esc(tag)}">${esc(tag)}</span><span class="log-msg">${esc(msg)}</span>`;
  logRoot.appendChild(line);
  while (logRoot.children.length > 400) logRoot.removeChild(logRoot.firstChild);
  logRoot.scrollTop = logRoot.scrollHeight;
}

function handleEvent(ev) {
  const who = ev.contact || ev.jid || '';
  if (ev.type === 'sent') addLog('sent', ev.reply ? `ke ${who}: ${ev.reply}` : 'pesan terkirim');
  else if (ev.type === 'draft')
    addLog('draft', ev.contact ? `draft untuk ${who} menunggu persetujuan` : 'draft baru menunggu persetujuan');
  else if (ev.type === 'skip')
    addLog('skip', ev.reason ? `${who}: ${ev.reason}` : 'pesan dilewati');
  else if (ev.type === 'error') addLog('error', ev.message || 'Terjadi error');
  else if (ev.type === 'ingest')
    addLog('ingest', ev.contact ? `profil ${who} diperbarui (${ev.samples} pesan)` : 'profil kontak diperbarui');
  else if (ev.type === 'wa') addLog('wa', `status WhatsApp: ${ev.state?.status}`);
  else if (ev.type === 'settings')
    addLog(
      'settings',
      ev.model
        ? `provider AI: ${ev.model}${ev.visionModel ? ` + ${ev.visionModel}` : ''}${
            ev.host ? ' · ' + ev.host : ''
          }`
        : 'pengaturan AI diperbarui',
    );

  clearTimeout(handleEvent._t);
  handleEvent._t = setTimeout(() => {
    refreshDrafts();
    refreshStatus();
    if ($('#view-settings').classList.contains('active')) {
      loadSettings();
      refreshUsage();
    }
  }, 400);
  if (ev.type === 'ingest') refreshContacts();
}

function connectSSE() {
  const es = new EventSource(`/api/events${ADMIN_TOKEN ? `?token=${encodeURIComponent(ADMIN_TOKEN)}` : ''}`);
  es.onmessage = (e) => {
    try {
      handleEvent(JSON.parse(e.data));
    } catch {}
  };
  es.onerror = () => {
    // EventSource reconnect otomatis.
  };
}

/* -------------------------------- settings ------------------------------- */

const PROVIDERS = [
  { id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
  { id: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  {
    id: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.1-flash-lite',
    visionModel: '',
  },
  {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    visionModel: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  },
  { id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'custom', baseUrl: '', model: '' },
];

const KIND_LABELS = {
  reply: 'Balas pesan',
  relationship: 'Profil kontak',
  memory: 'Memori',
  sticker: 'Stiker',
  test: 'Tes koneksi',
  chat: 'Lainnya',
};

const kindLabel = (kind) => KIND_LABELS[kind] || kind || 'Lainnya';
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return String(url || '');
  }
};
const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return String(url || '');
  }
};

function setSettingsDisabled(disabled) {
  const ids = [
    '#setBaseUrl',
    '#setModel',
    '#setVisionModel',
    '#setApiKey',
    '#setMe',
    '#setThinking',
    '#setTemperature',
    '#setMaxTokens',
    '#saveSettingsBtn',
    '#testSettingsBtn',
    '#toggleKeyBtn',
  ];
  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = disabled;
  }
  document.querySelectorAll('#providerPresets .preset').forEach((btn) => {
    btn.disabled = disabled;
  });
}

function syncPreset() {
  const base = ($('#setBaseUrl')?.value || '').trim().replace(/\/+$/, '');
  document.querySelectorAll('#providerPresets .preset').forEach((btn) => {
    const provider = PROVIDERS.find((x) => x.id === btn.dataset.provider);
    const on = Boolean(provider?.baseUrl) && provider.baseUrl.replace(/\/+$/, '') === base;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function updateKeyHint() {
  const hint = $('#apiKeyHint');
  const s = state.settings;
  if (!hint || !s) return;

  const baseUrl = $('#setBaseUrl')?.value || '';
  const keyValue = $('#setApiKey')?.value.trim() || '';
  const changed = originOf(s.baseUrl) !== originOf(baseUrl);

  if (changed && keyValue) {
    hint.textContent = 'Key yang kamu isi akan dipakai untuk provider baru.';
  } else if (changed && s.hasApiKey) {
    hint.textContent =
      'Provider berubah. API key lama tidak ikut; isi key kalau provider baru membutuhkan.';
  } else if (changed) {
    hint.textContent = 'Provider baru. Isi API key kalau provider ini membutuhkan.';
  } else if (s.hasApiKey) {
    hint.textContent =
      'Kosongkan kalau tidak mau mengganti key. Key tersimpan tidak pernah ditampilkan penuh.';
  } else {
    hint.textContent = 'Belum ada API key tersimpan.';
  }

  try {
    const url = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol === 'http:' && !local) {
      hint.textContent += ' Koneksi http:// tidak terenkripsi.';
    }
  } catch {}
}

function handleBaseUrlChange() {
  const nextOrigin = originOf($('#setBaseUrl').value);
  if (state.settingsFormOrigin && nextOrigin !== state.settingsFormOrigin) {
    const keyInput = $('#setApiKey');
    if (keyInput.value.trim()) {
      keyInput.value = '';
    }
  }
  state.settingsFormOrigin = nextOrigin;
  syncPreset();
  updateKeyHint();
}

function renderSettings(s) {
  state.settings = s;
  state.settingsFormOrigin = originOf(s.baseUrl);
  const set = (id, value) => {
    const el = $(id);
    if (el) el.value = value ?? '';
  };
  set('#setBaseUrl', s.baseUrl);
  set('#setModel', s.model);
  set('#setVisionModel', s.visionModel || '');
  set('#setMe', s.me);
  set('#setThinking', s.thinking);
  set('#setTemperature', s.temperature);
  set('#setMaxTokens', s.maxTokens);

  const key = $('#setApiKey');
  if (key) {
    key.value = '';
    key.type = 'text';
    key.classList.remove('revealed');
    key.placeholder = s.hasApiKey
      ? `Tersimpan${s.apiKeyMasked ? ` · ${s.apiKeyMasked}` : ''}`
      : 'Belum ada API key';
  }
  const toggle = $('#toggleKeyBtn');
  if (toggle) toggle.textContent = 'Lihat';

  $('#settingsProviderHint').textContent = `${hostOf(s.baseUrl)} · ${shortModel(s.model)}${
    s.visionModel && s.visionModel !== s.model ? ` + ${shortModel(s.visionModel)}` : ''
  }`;
  $('#settingsLocked').classList.toggle('hidden', Boolean(s.canEdit));
  setSettingsDisabled(!s.canEdit);
  syncPreset();
  updateKeyHint();
}

async function loadSettings() {
  const info = $('#settingsInfo');
  if (info) info.textContent = 'Memuat…';
  try {
    const [settings, usage] = await Promise.all([api('/api/settings'), api('/api/usage')]);
    renderSettings(settings);
    renderUsage(usage);
    if (info) info.textContent = '';
  } catch (err) {
    if (info) info.textContent = err.message;
    toast(err.message);
  }
}

function collectSettings() {
  const apiKey = $('#setApiKey').value.trim();
  const body = {
    baseUrl: $('#setBaseUrl').value.trim(),
    model: $('#setModel').value.trim(),
    visionModel: $('#setVisionModel').value.trim(),
    thinking: $('#setThinking').value,
    temperature: Number($('#setTemperature').value),
    maxTokens: Number($('#setMaxTokens').value),
    me: $('#setMe').value.trim(),
  };
  if (apiKey) body.apiKey = apiKey;
  return body;
}

async function saveSettings() {
  const btn = $('#saveSettingsBtn');
  const info = $('#settingsInfo');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    const result = await api('/api/settings', { method: 'PUT', body: collectSettings() });
    const canEdit = state.settings?.canEdit ?? true;
    renderSettings({ ...result, canEdit });
    const notes = [];
    if (result.keyCleared) {
      notes.push('Provider baru aktif tanpa API key. Isi key kalau provider ini membutuhkan.');
    }
    if (!result.persisted) {
      notes.push(result.warning || 'Setting aktif, tapi .env gagal ditulis.');
    }
    info.textContent = notes.join(' ');
    toast(result.persisted ? `Setting aktif · ${result.model}` : 'Setting aktif (hanya di memori)');
    await refreshStatus();
  } catch (err) {
    info.textContent = err.message;
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function friendlyAiError(err) {
  if (err.status === 401) return 'API key ditolak. Cek lagi key-nya.';
  if (err.status === 402) return 'Saldo provider habis. Isi ulang dulu.';
  if (err.status === 404) return 'Base URL atau model tidak ditemukan.';
  if (err.status === 429) return 'Kena rate limit. Tunggu sebentar lalu coba lagi.';
  if (err.status === 400) return err.message;
  if (!err.status) return 'Tidak bisa menghubungi provider. Cek koneksi internet.';
  return err.message;
}

async function testSettings() {
  const btn = $('#testSettingsBtn');
  const box = $('#settingsTestResult');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menguji…';
  box.className = 'test-result';
  box.textContent = 'Menghubungi provider…';

  try {
    const result = await api('/api/settings/test', {
      method: 'POST',
      body: collectSettings(),
    });
    box.classList.add('ok');
    box.innerHTML = `<b>Tersambung</b> · ${fmtNum(result.ms)} ms · ${esc(
      result.model,
    )} · ${fmtNum(result.usage?.totalTokens)} token`;
    await refreshUsage();
    await refreshStatus();
  } catch (err) {
    box.classList.add('err');
    box.textContent = friendlyAiError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function renderUsage(u = {}) {
  const total = Number(u.totalTokens) || 0;
  const today = Number(u.todayTokens) || 0;
  const calls = Number(u.calls) || 0;
  const prompt = Number(u.promptTokens) || 0;
  const completion = Number(u.completionTokens) || 0;

  $('#usageTotalBig').textContent = fmtNum(total);
  $('#usageSub').textContent = `${fmtNum(today)} hari ini · ${fmtNum(calls)} panggilan`;
  $('#usagePrompt').textContent = fmtNum(prompt);
  $('#usageCompletion').textContent = fmtNum(completion);

  const pct = total > 0 ? Math.min(100, Math.round((prompt / total) * 100)) : 0;
  $('#tokenBarIn').style.width = `${pct}%`;
  $('#tokenBarOut').style.width = total > 0 ? `${100 - pct}%` : '0%';

  $('#usageLast').textContent = u.last
    ? `Terakhir: ${fmtDateTime(u.last.ts)} · ${kindLabel(u.last.kind)}${
        u.last.model ? ` · ${u.last.model}` : ''
      }`
    : 'Belum ada panggilan';

  const rows = (u.byKind || [])
    .filter((x) => (Number(x.tokens) || 0) > 0 || (Number(x.calls) || 0) > 0)
    .map((x) => {
      const share =
        total > 0 ? Math.min(100, Math.round(((Number(x.tokens) || 0) / total) * 100)) : 0;
      return `<div class="usage-row"><span class="usage-row-label">${esc(
        kindLabel(x.kind),
      )}</span><span class="usage-row-track"><span style="width:${share}%"></span></span><b>${fmtNum(
        x.tokens,
      )}</b></div>`;
    });
  $('#usageBreakdown').innerHTML = rows.join('');
  $('#usageNote').textContent =
    calls > 0 && total === 0 ? 'Provider ini tidak mengirim rincian token.' : '';

  const usageEl = $('#usageTotal');
  if (usageEl) {
    usageEl.textContent = fmtCompact(total);
    $('#usageToday').textContent = `${fmtCompact(today)} hari ini`;
    $('#usageCalls').textContent = `${fmtCompact(calls)} panggilan`;
  }
}

async function refreshUsage() {
  try {
    const usage = await api('/api/usage');
    state.usage = usage;
    renderUsage(usage);
  } catch (err) {
    toast(err.message);
  }
}

document.querySelectorAll('#providerPresets .preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!state.settings?.canEdit) return;
    const provider = PROVIDERS.find((x) => x.id === btn.dataset.provider);
    if (!provider) return;
    if (provider.baseUrl) $('#setBaseUrl').value = provider.baseUrl;
    if (provider.model) $('#setModel').value = provider.model;
    $('#setVisionModel').value = provider.visionModel || '';
    if (provider.id === 'custom') $('#setBaseUrl').focus();
    handleBaseUrlChange();
  });
});

$('#setBaseUrl').addEventListener('input', handleBaseUrlChange);
$('#setApiKey').addEventListener('input', updateKeyHint);

$('#toggleKeyBtn').addEventListener('click', () => {
  const input = $('#setApiKey');
  const show = !input.classList.contains('revealed');
  input.classList.toggle('revealed', show);
  $('#toggleKeyBtn').textContent = show ? 'Sembunyikan' : 'Lihat';
});

$('#saveSettingsBtn').addEventListener('click', saveSettings);
$('#testSettingsBtn').addEventListener('click', testSettings);
$('#usageCard').addEventListener('click', () => switchTab('settings'));
$('#refreshUsageBtn').addEventListener('click', async () => {
  await refreshUsage();
  await refreshStatus();
});

/* --------------------------------- tabs ---------------------------------- */

const TITLES = {
  drafts: ['Draft menunggu', 'Pesan yang butuh persetujuanmu sebelum terkirim.'],
  contacts: ['Kontak', 'Atur siapa yang dibalas otomatis dan seberapa sopan.'],
  activities: ['Aktivitas terkini', 'Kabar terbaru yang dipakai AI saat menjawab.'],
  status: ['Status terjadwal', 'Jadwalkan upload status WhatsApp.'],
  import: ['Import chat', 'Latih gaya ngetik dari export WhatsApp.'],
  test: ['Tes balasan', 'Coba balasan tanpa mengirim ke WhatsApp.'],
  log: ['Log langsung', 'Catatan keputusan sistem.'],
  settings: ['Setting', 'Hubungkan provider AI dan pantau token yang terpakai.'],
};

function replayAnimation(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function switchTab(name) {
  const nextView = document.getElementById(`view-${name}`);
  const wasActive = nextView?.classList.contains('active');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  const [title, sub] = TITLES[name] || ['', ''];
  $('#pageTitle').textContent = title;
  $('#pageSub').textContent = sub;

  if (!wasActive) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion) {
      replayAnimation(nextView, 'view-enter');
      replayAnimation($('.page-head'), 'page-head-enter');
    }
  }

  if (name === 'contacts') refreshContacts();
  if (name === 'drafts') refreshDrafts();
  if (name === 'activities') refreshActivities();
  if (name === 'test') loadTestContacts();
  if (name === 'settings') loadSettings();
  if (name === 'status') {
    refreshStatusJobs();
    if (!$('#statusDate').value) {
      const d = new Date(Date.now() + 10 * 60 * 1000);
      $('#statusDate').value = d.toISOString().slice(0, 10);
      $('#statusTime').value = d.toTimeString().slice(0, 5);
    }
  }
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

/* --------------------------------- theme --------------------------------- */

const themeBtn = $('#themeBtn');

function syncThemeLabel(theme) {
  themeBtn.setAttribute(
    'aria-label',
    theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap',
  );
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('wa-theme', theme);
  } catch {}
  syncThemeLabel(theme);
}

syncThemeLabel(document.documentElement.dataset.theme);

themeBtn.addEventListener('click', () => {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!document.startViewTransition || reduce) {
    applyTheme(next);
    return;
  }

  const rect = themeBtn.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  root.classList.add('theme-switching');
  const transition = document.startViewTransition(() => applyTheme(next));

  transition.finished.then(
    () => root.classList.remove('theme-switching'),
    () => root.classList.remove('theme-switching'),
  );

  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
        },
        {
          duration: 480,
          easing: 'cubic-bezier(.2,.8,.2,1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    .catch(() => {});
});

/* -------------------------------- actions -------------------------------- */

$('#logoutBtn').addEventListener('click', async () => {
  if (
    !window.confirm(
      'Putuskan sesi WhatsApp? Kamu harus scan QR lagi. Data kontak, chat, dan profil tetap aman.',
    )
  )
    return;
  try {
    await api('/api/wa/logout', { method: 'POST' });
    toast('Sesi diputus. Scan QR baru');
    await refreshStatus();
  } catch (err) {
    toast(err.message);
  }
});

$('#waConnectBtn')?.addEventListener('click', async () => {
  const wa = state.status?.wa;
  if (wa?.status === 'qr' && wa.qr) {
    $('#qrImg').src = wa.qr;
    $('#qrOverlay').classList.remove('hidden');
    return;
  }
  const btn = $('#waConnectBtn');
  btn.disabled = true;
  btn.textContent = 'Menghubungkan...';
  try {
    await api('/api/wa/connect', { method: 'POST' });
    toast('Menunggu koneksi WhatsApp. QR akan muncul sebentar lagi.');
    await refreshStatus();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = 'Hubungkan WhatsApp';
  }
});

$('#pauseBtn').addEventListener('click', async () => {  const paused = !state.status?.paused;
  try {
    await api('/api/pause', { method: 'POST', body: { paused } });
    toast(paused ? 'Sistem dijeda. Tidak ada balasan otomatis' : 'Sistem aktif lagi');
    await refreshStatus();
  } catch (err) {
    toast(err.message);
  }
});

$('#closeQr').addEventListener('click', () => $('#qrOverlay').classList.add('hidden'));

/* ------------------------------- katalog -------------------------------- */

const PRODUCT_THUMB = {
  Makanan: '/logo-tutur.png',
  Minuman: '/logo-tutur.png',
  Paket: '/logo-tutur.png',
  Jasa: '/logo-tutur.png',
  Lainnya: '/logo-tutur.png',
};

async function refreshProducts() {
  const box = $('#dashCatalogList');
  if (!box) return;
  try {
    const data = await api('/api/products');
    const items = data.products || [];
    if (!items.length) {
      box.innerHTML =
        '<p class="muted">Belum ada produk. <a href="/katalog">Tambahkan produk pertama</a> supaya Tutur bisa menjawab harga.</p>';
      return;
    }
    box.innerHTML = items
      .map(
        (item) => `
        <div class="dash-product">
          <img class="${item.image_url ? '' : 'fallback'}" src="${esc(item.image_url || PRODUCT_THUMB[item.category] || '/logo-tutur.png')}" width="54" height="54" alt="" loading="lazy" />
          <div>
            <strong>${esc(item.name)}</strong>
            <span>Rp${new Intl.NumberFormat('id-ID').format(Number(item.price) || 0)}</span>
          </div>
        </div>`,
      )
      .join('');
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

/* --------------------------------- boot ---------------------------------- */

refreshStatus();
refreshDrafts();
refreshProducts();
connectSSE();
addLog('wa', 'dashboard dimuat, menunggu event…');
setInterval(() => {
  refreshStatus();
  if ($('#view-settings').classList.contains('active')) refreshUsage();
}, 20000);
