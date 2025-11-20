async function api(path, { method = "GET", body, headers = {} } = {}) {
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
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  try { return await res.json(); } catch { return null; }
}

async function getMe() {
  return api('/v1/me');
}

function redirectToLogin(nextPath) {
  const next = nextPath || `${location.pathname}${location.search}`;
  window.location.href = `/login.html?next=${encodeURIComponent(next)}`;
}

async function ensureAuthed(options = {}) {
  const next = options.next || `${location.pathname}${location.search}`;
  try {
    return await getMe();
  } catch (e) {
    if (e?.status === 401) {
      redirectToLogin(next);
      return null;
    }
    throw e;
  }
}

async function hydrateAuthControls() {
  const actionEl = document.getElementById('authAction');
  const userEl = document.getElementById('authUser');
  try {
    const me = await getMe();
    if (actionEl) {
      actionEl.textContent = '로그아웃';
      actionEl.href = '#';
      actionEl.onclick = async (ev) => {
        ev.preventDefault();
        try { await api('/v1/auth/logout', { method: 'POST' }); } catch {}
        if (userEl) userEl.textContent = '';
        actionEl.textContent = '로그인';
        actionEl.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
        actionEl.onclick = null;
      };
    }
    if (userEl) userEl.textContent = me.email || '';
    return me;
  } catch (e) {
    if (actionEl) {
      actionEl.textContent = '로그인';
      actionEl.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      actionEl.onclick = null;
    }
    if (userEl) userEl.textContent = '';
    return null;
  }
}

function qs(sel) { return document.querySelector(sel); }
function ce(tag, cls) { const el = document.createElement(tag); if (cls) el.className = cls; return el; }
