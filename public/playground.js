import { escapeHtml } from '/escape.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  persona: null,
  language: 'auto',
  sessionId: null,
  sending: false,
};

const ACTION_LABEL = {
  auto: 'auto',
  draft: 'draft',
  ignore: 'ignore',
  error: 'error',
};

const INTENT_LABEL = {
  tanya_fakta: 'Tanya fakta',
  pesanan: 'Pesanan',
  booking: 'Booking',
  komplain: 'Komplain',
  obrolan: 'Obrolan',
  spam: 'Spam',
  error: 'Gagal',
};

const CATEGORY_LABEL = {
  menu: 'Menu',
  jam: 'Jam buka',
  lokasi: 'Lokasi',
  kebijakan: 'Kebijakan',
  layanan: 'Layanan',
  umum: 'Umum',
};

function addBubble(kind, text, who) {
  const empty = $('#chat-empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = `bubble ${kind}`;
  el.innerHTML = `${who ? `<span class="who">${escapeHtml(who)}</span>` : ''}${escapeHtml(text)}`;
  $('#chat').appendChild(el);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return el;
}

function setTraceStatus(text) {
  $('#trace-status').textContent = text;
}

function renderTrace(trace) {
  if (!trace) return;
  $('#trace-empty').hidden = true;
  $('#trace').hidden = false;

  const action = ACTION_LABEL[trace.action] || trace.action || '-';
  const pill = $('#trace-action');
  pill.textContent = action;
  pill.className = `action-pill ${trace.action || ''}`;
  $('#trace-reason').textContent = trace.policyReason || '';

  $('#trace-intent').textContent = INTENT_LABEL[trace.intent] || trace.intent || '-';
  $('#trace-confidence').textContent =
    typeof trace.confidence === 'number' ? `${Math.round(trace.confidence * 100)}%` : '-';
  $('#confidence-fill').style.width = `${Math.round((trace.confidence || 0) * 100)}%`;
  $('#trace-model').textContent = trace.model || '-';
  $('#trace-latency').textContent =
    typeof trace.latencyMs === 'number' ? `${(trace.latencyMs / 1000).toFixed(2)}s` : '-';

  const sources = $('#trace-sources');
  if (trace.sources?.length) {
    sources.innerHTML = trace.sources
      .map((s) => {
        const cat = CATEGORY_LABEL[s.category] || s.category || 'Data';
        const showCat = String(cat).toLowerCase() !== String(s.title).toLowerCase();
        return `<span class="source">${showCat ? `<b>${escapeHtml(cat)}</b>` : ''}${escapeHtml(s.title)}</span>`;
      })
      .join('');
  } else {
    sources.innerHTML = '<span class="source-empty">tidak ada sumber dipakai</span>';
  }

  const ownerBlock = $('#owner-block');
  if (trace.needsOwner) {
    ownerBlock.hidden = false;
    $('#trace-owner').textContent = trace.ownerReason || 'Pesan ini butuh keputusan pemilik.';
  } else {
    ownerBlock.hidden = true;
  }

  setTraceStatus('trace aktif');
}

async function loadConfig() {
  const res = await fetch('/api/public/playground/state');
  const data = await res.json();
  state.config = data;
  state.persona = data.personas[0];
  state.language = data.personas[0].language || 'auto';
  $('#business-name').textContent = data.business.name;
  $('#language').value = state.language === 'en' || state.language === 'id' ? state.language : 'auto';
  renderPersonas();
  renderScenarios();
  updateImpact(data.metrics);
  updatePersonaLine();
}

function updatePersonaLine() {
  const mode = state.persona.mode || 'baru';
  const modeText =
    mode === 'auto'
      ? 'mode auto, Tutur boleh membalas sendiri'
      : mode === 'draft'
        ? 'mode draft, balasan menunggu pemilik'
        : mode === 'ignore'
          ? 'mode ignore, Tutur tidak membalas'
          : 'nomor baru, balasan masuk draft';
  $('#current-persona').textContent = `Kamu chat sebagai ${state.persona.label.toLowerCase()}, ${modeText}.`;
}

function renderPersonas() {
  const wrap = $('#personas');
  wrap.innerHTML = '';
  for (const p of state.config.personas) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'persona';
    btn.setAttribute('aria-pressed', String(p.jid === state.persona.jid));
    btn.innerHTML = `${escapeHtml(p.label)}<span class="persona-mode">${escapeHtml(
      p.mode || 'baru',
    )}</span>`;
    btn.addEventListener('click', () => selectPersona(p));
    wrap.appendChild(btn);
  }
}

function renderScenarios() {
  const wrap = $('#scenarios');
  wrap.innerHTML = '';
  for (const s of state.config.scenarios) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scenario';
    btn.textContent = s.label;
    btn.addEventListener('click', () => {
      const persona = state.config.personas.find((p) => p.jid === s.personaJid);
      if (persona) selectPersona(persona);
      $('#message').value = s.message;
      send();
    });
    wrap.appendChild(btn);
  }
}

async function selectPersona(persona) {
  if (state.sessionId) {
    await fetch('/api/public/playground/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId }),
    }).catch(() => {});
  }
  state.sessionId = null;
  state.persona = persona;
  state.language = persona.language || 'auto';
  $('#language').value =
    state.language === 'en' || state.language === 'id' ? state.language : 'auto';
  renderPersonas();
  updatePersonaLine();
  $('#chat').innerHTML =
    '<div class="chat-empty" id="chat-empty">Persona diganti. Mulai percakapan baru.</div>';
  $('#trace').hidden = true;
  $('#trace-empty').hidden = false;
  setTraceStatus('menunggu');
}

async function resetConversation() {
  if (state.sessionId) {
    await fetch('/api/public/playground/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId }),
    }).catch(() => {});
  }
  state.sessionId = null;
  $('#chat').innerHTML =
    '<div class="chat-empty" id="chat-empty">Percakapan direset. Pilih skenario atau ketik pesan baru.</div>';
  $('#trace').hidden = true;
  $('#trace-empty').hidden = false;
  setTraceStatus('menunggu');
  $('#message').focus();
}

function updateImpact(metrics) {
  if (!metrics) return;
  const total = metrics.messages || 0;
  const autoPct = total ? Math.round(((metrics.auto || 0) / total) * 100) : 0;
  $('#impact-auto').textContent = total ? `${autoPct}%` : '-';
  $('#impact-escalated').textContent = metrics.escalated ?? '-';
  $('#impact-latency').textContent = metrics.avgLatencyMs
    ? `${(metrics.avgLatencyMs / 1000).toFixed(1)}s`
    : '-';
}

async function send() {
  const input = $('#message');
  const text = input.value.trim();
  if (!text || state.sending) return;

  state.sending = true;
  $('#send').disabled = true;
  input.value = '';
  addBubble('in', text, state.persona.label);

  const typing = addBubble('out typing', 'mengetik…', 'Tutur');
  setTraceStatus('memproses');

  try {
    const res = await fetch('/api/public/playground/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        personaJid: state.persona.jid,
        message: text,
        language: $('#language').value,
      }),
    });
    const data = await res.json();
    typing.remove();
    state.sessionId = data.sessionId || state.sessionId;

    if (data.reply) {
      addBubble('out', data.reply, 'Tutur');
    }
    if (data.paymentImage) {
      const el = document.createElement('div');
      el.className = 'bubble out payment';
      el.innerHTML = `<span class="who">QRIS</span><img src="${escapeHtml(data.paymentImage)}" alt="Kode QRIS" />`;
      $('#chat').appendChild(el);
    }
    if (data.order) {
      addBubble(
        'system',
        `Pesanan dicatat: ${data.order.customerName || 'tanpa nama'} · ${data.order.items} · Rp${new Intl.NumberFormat('id-ID').format(data.order.total || 0)}`,
      );
    }
    if (data.error) {
      addBubble('system', data.error);
    }
    if (!data.reply && !data.error) {
      addBubble('system', 'AI memilih tidak membalas pesan ini.');
    }
    if (data.trace) renderTrace(data.trace);
    setTraceStatus('trace aktif');

    const impact = await fetch('/api/public/impact').then((r) => r.json());
    updateImpact(impact);
  } catch (err) {
    typing.remove();
    addBubble('system', `Gagal menghubungi server: ${err.message}`);
    setTraceStatus('gagal');
  } finally {
    state.sending = false;
    $('#send').disabled = false;
    input.focus();
  }
}

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});

$('#reset').addEventListener('click', resetConversation);

$('#language').addEventListener('change', (e) => {
  state.language = e.target.value;
});

loadConfig().catch((err) => {
  addBubble('system', `Tidak bisa memuat demo: ${err.message}`);
});
