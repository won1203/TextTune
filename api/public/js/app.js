async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg += `: ${j.error || ''}`; } catch {}
    throw new Error(msg);
  }
  try { return await res.json(); } catch { return null; }
}

async function ensureAuthed() {
  // 1) 기존 세션 확인
  try {
    const me = await api('/v1/me');
    return me;
  } catch {}

  // 2) 로그인 화면 없이 게스트 세션 자동 발급
  try {
    const key = 'texttune_guest_email';
    let email = localStorage.getItem(key);
    if (!email) {
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      email = `guest-${id}@guest.local`;
      localStorage.setItem(key, email);
    }
    await api('/v1/auth/login', { method: 'POST', body: { email } });
    const me = await api('/v1/me');
    return me;
  } catch (e) {
    console.error('세션 생성 실패:', e);
    return null;
  }
}

function qs(sel) { return document.querySelector(sel); }
function ce(tag, cls) { const el = document.createElement(tag); if (cls) el.className = cls; return el; }
