// 공용 API 헬퍼
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

// 로그인 모달
function buildLoginModal() {
  if (document.getElementById('loginModal')) return;
  const style = document.createElement('style');
  style.id = 'loginModalStyle';
  style.textContent = `
    #loginModalOverlay{position:fixed;inset:0;background:rgba(5,5,10,0.65);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;z-index:9999;}
    #loginModal{background:linear-gradient(160deg,rgba(25,28,51,0.95),rgba(15,18,34,0.95));border:1px solid rgba(255,255,255,0.06);border-radius:22px;padding:28px 26px;max-width:440px;width:92%;color:#e8e8f0;box-shadow:0 30px 90px rgba(0,0,0,0.45);position:relative;}
    #loginModal h2{margin:0 0 12px;font-size:24px;font-weight:800;text-align:center}
    #loginModal p{margin:0 0 16px;color:#b7b9ca;text-align:center;font-size:14px}
    #loginModal .close-btn{position:absolute;top:12px;right:12px;border:none;background:rgba(255,255,255,0.08);color:#ddd;border-radius:50%;width:32px;height:32px;cursor:pointer}
    #loginModal .google-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px 12px;border-radius:999px;border:1px solid #e0e0e0;background:#fff;color:#1f1f1f;font-weight:700;text-decoration:none;box-shadow:0 10px 28px rgba(0,0,0,0.2);}
    #loginModal .divider{margin:16px 0;text-align:center;color:#6f7085;font-size:12px;display:flex;align-items:center;gap:10px;}
    #loginModal .divider::before,#loginModal .divider::after{content:"";flex:1;height:1px;background:rgba(255,255,255,0.12)}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'loginModalOverlay';
  overlay.setAttribute('role','dialog');
  const modal = document.createElement('div');
  modal.id = 'loginModal';
  modal.innerHTML = `
    <button class="close-btn" aria-label="닫기">×</button>
    <h2>TexTune 로그인</h2>
    <p>Google 계정으로 TexTune을 바로 시작하세요.</p>
    <a class="google-btn" id="loginGoogleBtn" href="#">
      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" width="18" height="18" />
      <span>Google로 계속하기</span>
    </a>
    <div class="divider">또는</div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector('.close-btn').onclick = () => closeLoginModal();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLoginModal(); });
}

function openLoginModal() {
  buildLoginModal();
  const overlay = document.getElementById('loginModalOverlay');
  const btn = document.getElementById('loginGoogleBtn');
  if (btn) {
    const next = `${location.pathname}${location.search}` || '/';
    btn.href = `/v1/auth/google/start?next=${encodeURIComponent(next)}`;
  }
  if (overlay) overlay.style.display = 'flex';
}

function closeLoginModal() {
  const overlay = document.getElementById('loginModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

// 인증 보장
async function ensureAuthed() {
  try {
    return await getMe();
  } catch (e) {
    if (e?.status === 401) {
      openLoginModal();
      return null;
    }
    throw e;
  }
}

// 프로필/로그인 버튼 상태
async function hydrateAuthControls() {
  const actionEl = document.getElementById('authAction');
  const userEl = document.getElementById('authUser');
  try {
    const me = await getMe();
    const displayName = me.name || (me.email ? me.email.split('@')[0] : '');
    const initials = (displayName || me.email || '?').trim().slice(0, 1).toUpperCase();

    if (actionEl) {
      actionEl.textContent = '로그아웃';
      actionEl.href = '#';
      actionEl.onclick = async (ev) => {
        ev.preventDefault();
        try { await api('/v1/auth/logout', { method: 'POST' }); } catch {}
        if (userEl) userEl.innerHTML = '';
        actionEl.textContent = '로그인';
        actionEl.href = '#';
        actionEl.onclick = (e2) => { e2.preventDefault(); openLoginModal(); };
      };
    }
    if (userEl) {
      userEl.innerHTML = `
        <button id="profileSummary" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;margin-top:12px">
          <div style="width:36px;height:36px;border-radius:50%;background:#f39c12;display:grid;place-items:center;color:#1a1a1a;font-weight:800;font-size:14px;">${initials}</div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <span style="font-weight:700;">${displayName || '내 계정'}</span>
            <span style="color:#b7b9ca;font-size:12px;">${me.email || ''}</span>
          </div>
        </button>
      `;
      attachProfileInteractions(me, initials);
    }
    return me;
  } catch (e) {
    if (actionEl) {
      actionEl.textContent = '로그인';
      actionEl.href = '#';
      actionEl.onclick = (ev) => { ev.preventDefault(); openLoginModal(); };
    }
    if (userEl) userEl.innerHTML = '';
    return null;
  }
}

// DOM 유틸
function qs(sel) { return document.querySelector(sel); }
function ce(tag, cls) { const el = document.createElement(tag); if (cls) el.className = cls; return el; }

// 프로필 메뉴/모달 스타일
function ensureProfileStyles() {
  if (document.getElementById('profileStyles')) return;
  const style = document.createElement('style');
  style.id = 'profileStyles';
  style.textContent = `
    #profileMenu{position:fixed;display:none;flex-direction:column;gap:8px;padding:12px;background:rgba(30,32,48,0.95);border:1px solid rgba(255,255,255,0.08);border-radius:14px;box-shadow:0 18px 44px rgba(0,0,0,0.35);z-index:9998;min-width:160px;overflow:hidden;}
    #profileMenu button{all:unset;cursor:pointer;color:#e8e8f0;padding:10px 12px;border-radius:12px;font-size:14px;display:block;width:100%;box-sizing:border-box;}
    #profileMenu button:hover,#profileMenu button:focus-visible{background:rgba(255,255,255,0.08);outline:none;}
    #profileMenu .danger{color:#e76a6a;}
    #profileProfileOverlay{position:fixed;inset:0;background:rgba(5,5,10,0.65);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;z-index:9999;}
    #profileProfileModal{background:linear-gradient(160deg,rgba(25,28,51,0.95),rgba(15,18,34,0.95));border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:26px 24px;max-width:520px;width:92%;color:#e8e8f0;box-shadow:0 30px 90px rgba(0,0,0,0.45);position:relative;}
    #profileProfileModal .close-btn{position:absolute;top:12px;right:12px;border:none;background:rgba(255,255,255,0.08);color:#ddd;border-radius:50%;width:32px;height:32px;cursor:pointer}
    #profileProfileModal .avatar{width:86px;height:86px;border-radius:50%;background:#f39c12;display:grid;place-items:center;font-size:30px;font-weight:800;color:#1a1a1a;margin:0 auto 10px;}
    #profileProfileModal h3{margin:6px 0 6px;text-align:center}
    #profileProfileModal p{margin:2px 0;text-align:center;color:#b7b9ca;font-size:14px}
    #profileProfileModal .field{margin:18px 0 6px;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:10px 12px;background:rgba(255,255,255,0.04);}
    #profileProfileModal .primary{width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(90deg,var(--grad1,#a65cff),var(--grad2,#4b63ff));color:#fff;font-weight:800;cursor:pointer;margin-top:12px;}
    #logoutConfirmOverlay{position:fixed;inset:0;background:rgba(5,5,10,0.65);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;z-index:9999;}
    #logoutConfirmModal{background:linear-gradient(160deg,rgba(25,28,51,0.95),rgba(15,18,34,0.95));border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:22px 20px;max-width:360px;width:92%;color:#e8e8f0;box-shadow:0 26px 70px rgba(0,0,0,0.45);position:relative;}
    #logoutConfirmModal h4{margin:0 0 10px;font-size:18px;font-weight:800;text-align:center;}
    #logoutConfirmModal p{margin:0 0 18px;font-size:14px;color:#b7b9ca;text-align:center;}
    #logoutConfirmModal .actions{display:flex;gap:10px;}
    #logoutConfirmModal button{flex:1;padding:12px;border:none;border-radius:10px;font-weight:700;cursor:pointer;}
    #logoutConfirmModal .secondary{background:rgba(255,255,255,0.08);color:#e8e8f0;border:1px solid rgba(255,255,255,0.1);}
    #logoutConfirmModal .primary{background:linear-gradient(90deg,var(--grad1,#a65cff),var(--grad2,#4b63ff));color:#fff;}
  `;
  document.head.appendChild(style);
}

function ensureLogoutConfirmModal() {
  if (document.getElementById('logoutConfirmOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'logoutConfirmOverlay';
  overlay.innerHTML = `
    <div id="logoutConfirmModal">
      <h4>로그아웃 하시겠습니까?</h4>
      <p>현재 세션에서 로그아웃합니다.</p>
      <div class="actions">
        <button class="secondary" id="logoutCancelBtn" type="button">아니오</button>
        <button class="primary" id="logoutConfirmBtn" type="button">예</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
  overlay.querySelector('#logoutCancelBtn').onclick = () => { overlay.style.display = 'none'; };
}

// 프로필 메뉴
function buildProfileMenu() {
  ensureProfileStyles();
  if (document.getElementById('profileMenu')) return;
  const menu = document.createElement('div');
  menu.id = 'profileMenu';
  menu.innerHTML = `
    <button id="profileEditBtn">프로필 수정</button>
    <button id="profileLogoutBtn" class="danger">로그아웃</button>
  `;
  document.body.appendChild(menu);
}

// 프로필 모달
function buildProfileModal(me, initials) {
  ensureProfileStyles();
  let overlay = document.getElementById('profileProfileOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'profileProfileOverlay';
    overlay.innerHTML = `
      <div id="profileProfileModal">
        <button class="close-btn" aria-label="닫기">×</button>
        <div class="avatar">${initials}</div>
        <h3 id="profileModalName">${me.name || '내 계정'}</h3>
        <p id="profileModalEmail">이메일: ${me.email || ''}</p>
        <p id="profileModalId">사용자 ID: ${me.userId || 'N/A'}</p>
        <div class="field">
          <span>🙍‍♂️</span>
          <input id="profileModalNameInput" style="flex:1;background:transparent;border:none;color:inherit;outline:none" value="${me.name || ''}" placeholder="이름" />
        </div>
        <button class="primary" id="profileModalSave" type="button">저장</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeProfileModal(); });
    overlay.querySelector('.close-btn').onclick = () => closeProfileModal();
    const saveBtn = overlay.querySelector('#profileModalSave');
    const nameInput = overlay.querySelector('#profileModalNameInput');
    saveBtn.onclick = async () => {
      const nextName = (nameInput.value || '').trim();
      try {
        const updated = await api('/v1/me', { method: 'PATCH', body: { name: nextName } });
        overlay.querySelector('#profileModalName').textContent = updated.name || '내 계정';
        overlay.querySelector('#profileModalId').textContent = `사용자 ID: ${updated.userId || 'N/A'}`;
        overlay.querySelector('.avatar').textContent = (updated.name || updated.email || '?').trim().slice(0, 1).toUpperCase();
        await hydrateAuthControls();
        closeProfileModal();
      } catch (err) {
        console.error('Failed to save profile name', err);
        alert('이름 저장에 실패했습니다. 다시 시도해주세요.');
      }
    };
  } else {
    overlay.querySelector('#profileModalName').textContent = me.name || '내 계정';
    overlay.querySelector('#profileModalEmail').textContent = `이메일: ${me.email || ''}`;
    overlay.querySelector('#profileModalId').textContent = `사용자 ID: ${me.userId || 'N/A'}`;
    overlay.querySelector('#profileModalNameInput').value = me.name || '';
    overlay.querySelector('.avatar').textContent = initials;
  }
  overlay.style.display = 'flex';
}

function closeProfileModal() {
  const overlay = document.getElementById('profileProfileOverlay');
  if (overlay) overlay.style.display = 'none';
}

let profileOutsideHandlerAttached = false;

function attachProfileInteractions(me, initials) {
  buildProfileMenu();
  ensureLogoutConfirmModal();
  const summary = document.getElementById('profileSummary');
  const menu = document.getElementById('profileMenu');
  if (!summary || !menu) return;

  summary.onclick = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = summary.getBoundingClientRect();
    menu.style.left = `${rect.right + 8}px`;
    menu.style.top = `${rect.top}px`;
    menu.style.display = 'flex';
  };

  if (!profileOutsideHandlerAttached) {
    document.addEventListener('click', (e) => {
      const menuEl = document.getElementById('profileMenu');
      const summaryEl = document.getElementById('profileSummary');
      if (!menuEl || !summaryEl) return;
      if (!menuEl.contains(e.target) && !summaryEl.contains(e.target)) {
        menuEl.style.display = 'none';
      }
    });
    profileOutsideHandlerAttached = true;
  }

  const editBtn = document.getElementById('profileEditBtn');
  const delBtn = document.getElementById('profileDeleteBtn');
  const logoutBtn = document.getElementById('profileLogoutBtn');

  if (editBtn) editBtn.onclick = (e) => { e.preventDefault(); menu.style.display = 'none'; buildProfileModal(me, initials); };
  if (delBtn) delBtn.onclick = (e) => { e.preventDefault(); menu.style.display = 'none'; alert('계정 삭제는 아직 지원되지 않습니다.'); };
  if (logoutBtn) logoutBtn.onclick = async (e) => {
    e.preventDefault();
    menu.style.display = 'none';
    const overlay = document.getElementById('logoutConfirmOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    const confirmBtn = overlay.querySelector('#logoutConfirmBtn');
    const cancelBtn = overlay.querySelector('#logoutCancelBtn');
    const closeModal = () => { overlay.style.display = 'none'; };

    const onConfirm = async () => {
      const actionEl = document.getElementById('authAction');
      try { await api('/v1/auth/logout', { method: 'POST' }); } catch {}
      if (actionEl) {
        actionEl.textContent = '로그인';
        actionEl.href = '#';
        actionEl.onclick = (ev2) => { ev2.preventDefault(); openLoginModal(); };
      }
      await hydrateAuthControls();
      closeModal();
    };

    if (confirmBtn) confirmBtn.onclick = onConfirm;
    if (cancelBtn) cancelBtn.onclick = closeModal;
  };
}
