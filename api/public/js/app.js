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
    ensurePlaylistNav();

    if (actionEl) {
      actionEl.textContent = '로그아웃';
      actionEl.href = '#';
      actionEl.onclick = (ev) => {
        ev.preventDefault();
        showLogoutModal();
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
    ensurePlaylistNav();
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
function formatTime(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '0:00';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ensurePlaylistNav() {
  const nav = document.querySelector('.side-nav');
  if (!nav) return;
  const playLink = nav.querySelector('a[href="playlist.html"]');
  const logoutLink = nav.querySelector('#authAction');
  if (!playLink) {
    const link = document.createElement('a');
    link.href = 'playlist.html';
    link.textContent = '플레이리스트';
    if (logoutLink) nav.insertBefore(link, logoutLink);
    else nav.appendChild(link);
  } else if (logoutLink && playLink.nextSibling !== logoutLink) {
    nav.insertBefore(playLink, logoutLink);
  }
}

// 플레이리스트 API
async function fetchPlaylists() {
  const res = await api('/v1/playlists');
  return res?.items || [];
}
async function createPlaylistApi(title) {
  return api('/v1/playlists', { method: 'POST', body: { title } });
}
async function addTrackToPlaylistApi(trackId, playlistId) {
  return api(`/v1/playlists/${encodeURIComponent(playlistId)}/tracks`, { method: 'POST', body: { track_id: trackId } });
}
async function fetchPlaylistDetail(playlistId) {
  return api(`/v1/playlists/${encodeURIComponent(playlistId)}`);
}

// 플레이리스트 모달
function ensurePlaylistModals() {
  if (document.getElementById('playlistModalStyles')) return;
  const style = document.createElement('style');
  style.id = 'playlistModalStyles';
  style.textContent = `
    #playlistOverlay{position:fixed;inset:0;background:rgba(5,5,10,0.6);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;z-index:11000;}
    #playlistModal{background:rgba(20,22,35,0.96);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 18px 14px;width:320px;color:#e8e8f0;box-shadow:0 20px 60px rgba(0,0,0,0.55);}
    #playlistModal h4{margin:0 0 12px;font-size:18px;font-weight:800;}
    #playlistModal label{display:block;font-size:13px;margin-bottom:6px;color:#b6b9c9;}
    #playlistModal input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;}
    #playlistModal .actions{display:flex;gap:8px;margin-top:12px;}
    #playlistModal .actions button{flex:1;border:none;border-radius:10px;padding:10px;font-weight:700;cursor:pointer;}
    #playlistModal .primary{background:linear-gradient(120deg,var(--grad1,#a65cff),var(--grad2,#4b63ff));color:#fff;}
    #playlistModal .ghost{background:rgba(255,255,255,0.06);color:#e8e8f0;}

    #playlistSelect{position:fixed;inset:0;background:rgba(5,5,10,0.6);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;z-index:11000;}
    #playlistSelect .box{background:rgba(20,22,35,0.96);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:14px;width:320px;color:#e8e8f0;box-shadow:0 20px 60px rgba(0,0,0,0.55);}
    #playlistSelect h4{margin:0 0 10px;font-size:18px;font-weight:800;}
    #playlistSelect .item{padding:10px;border-radius:10px;cursor:pointer;}
    #playlistSelect .item:hover{background:rgba(255,255,255,0.08);}
    #playlistSelect .actions{display:flex;gap:8px;margin-top:12px;}
    #playlistSelect .actions button{flex:1;border:none;border-radius:10px;padding:10px;font-weight:700;cursor:pointer;background:rgba(255,255,255,0.06);color:#e8e8f0;}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'playlistOverlay';
  overlay.innerHTML = `
    <div id="playlistModal">
      <h4>새 플레이리스트</h4>
      <label for="playlistTitle">제목</label>
      <input id="playlistTitle" placeholder="플레이리스트 제목" />
      <div class="actions">
        <button class="ghost" id="plCancel" type="button">취소</button>
        <button class="primary" id="plCreate" type="button">생성</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });

  const select = document.createElement('div');
  select.id = 'playlistSelect';
  select.innerHTML = `
    <div class="box">
      <h4>플레이리스트 선택</h4>
      <div id="playlistSelectList"></div>
      <div class="actions">
        <button type="button" id="plSelectCancel">닫기</button>
        <button type="button" id="plSelectNew">새로 만들기</button>
      </div>
    </div>
  `;
  document.body.appendChild(select);
  select.addEventListener('click', (e) => { if (e.target === select) select.style.display = 'none'; });
}

function openCreatePlaylistModal(onCreate) {
  ensurePlaylistModals();
  const overlay = document.getElementById('playlistOverlay');
  const input = document.getElementById('playlistTitle');
  const btnCreate = document.getElementById('plCreate');
  const btnCancel = document.getElementById('plCancel');
  if (!overlay || !input || !btnCreate || !btnCancel) return;
  input.value = '';
  overlay.style.display = 'flex';
  input.focus();
  btnCancel.onclick = () => { overlay.style.display = 'none'; };
  btnCreate.onclick = async () => {
    const title = input.value.trim();
    const pl = await createPlaylistApi(title || '새 플레이리스트');
    overlay.style.display = 'none';
    if (onCreate) onCreate(pl);
  };
}

function openSelectPlaylistModal(track) {
  ensurePlaylistModals();
  const select = document.getElementById('playlistSelect');
  const listEl = document.getElementById('playlistSelectList');
  const btnCancel = document.getElementById('plSelectCancel');
  const btnNew = document.getElementById('plSelectNew');
  if (!select || !listEl || !btnCancel || !btnNew) return;
  fetchPlaylists().then(playlists => {
    listEl.innerHTML = playlists.length === 0
      ? '<div style="padding:10px;color:#b6b9c9;">플레이리스트가 없습니다. 새로 만들어주세요.</div>'
      : playlists.map(p => `<div class="item" data-pl="${p.id}">${p.title}</div>`).join('');
    select.style.display = 'flex';
    listEl.querySelectorAll('.item').forEach(item => {
      item.onclick = async () => {
        const pid = item.getAttribute('data-pl');
        if (pid) await addTrackToPlaylistApi(track.id, pid);
        select.style.display = 'none';
        alert('플레이리스트에 추가되었습니다.');
      };
    });
    btnCancel.onclick = () => { select.style.display = 'none'; };
    btnNew.onclick = () => {
      select.style.display = 'none';
      openCreatePlaylistModal(async (pl) => {
        await addTrackToPlaylistApi(track.id, pl.id);
        alert('플레이리스트에 추가되었습니다.');
      });
    };
  });
}

window.openCreatePlaylistModal = openCreatePlaylistModal;
window.openSelectPlaylistModal = openSelectPlaylistModal;
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

async function performLogout() {
  const actionEl = document.getElementById('authAction');
  try { await api('/v1/auth/logout', { method: 'POST' }); } catch {}
  try {
    localStorage.removeItem('texttune_global_player');
    sessionStorage.removeItem('texttune_global_player_session');
    localStorage.removeItem('texttune_playlists');
  } catch {}
  const gp = document.getElementById('globalPlayer');
  const audio = document.getElementById('gpAudio');
  if (audio) audio.pause();
  if (gp) gp.style.display = 'none';
  if (actionEl) {
    actionEl.textContent = '로그인';
    actionEl.href = '#';
    actionEl.onclick = (ev2) => { ev2.preventDefault(); openLoginModal(); };
  }
  await hydrateAuthControls();
}

function showLogoutModal() {
  ensureLogoutConfirmModal();
  const overlay = document.getElementById('logoutConfirmOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const confirmBtn = overlay.querySelector('#logoutConfirmBtn');
  const cancelBtn = overlay.querySelector('#logoutCancelBtn');
  const closeModal = () => { overlay.style.display = 'none'; };
  if (confirmBtn) confirmBtn.onclick = async () => { await performLogout(); closeModal(); };
  if (cancelBtn) cancelBtn.onclick = closeModal;
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
    showLogoutModal();
  };
}

// 글로벌 오디오 플레이어 (페이지 공통)
(function setupGlobalPlayer() {
  if (window.__globalPlayerReady) return;
  window.__globalPlayerReady = true;

  const style = document.createElement('style');
  style.textContent = `
    #globalPlayer{position:fixed;left:0;right:0;bottom:0;padding:12px 18px;background:rgba(10,12,22,0.94);border-top:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(10px);display:none;align-items:center;gap:14px;z-index:10000;}
    #globalPlayer .icon{width:44px;height:44px;border-radius:14px;background:linear-gradient(140deg,var(--grad1,#a65cff),var(--grad2,#4b63ff));display:grid;place-items:center;flex-shrink:0;}
    #globalPlayer .icon svg{width:24px;height:24px;fill:#fff;}
    #globalPlayer .info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
    #globalPlayer .info .title{font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #globalPlayer .info .meta{font-size:12px;color:var(--muted,#b6b9c9);}
    #globalPlayer .player-body{flex:1;min-width:0;display:flex;align-items:center;gap:10px;}
    #globalPlayer .play-btn{width:42px;height:42px;border-radius:14px;border:none;background:linear-gradient(140deg,var(--grad1,#a65cff),var(--grad2,#4b63ff));color:#fff;display:grid;place-items:center;cursor:pointer;}
    #globalPlayer .wave-wrap{flex:1;min-width:0;display:flex;align-items:center;gap:10px;}
    #globalPlayer .wave{position:relative;flex:1;height:26px;border-radius:8px;overflow:hidden;background:repeating-linear-gradient(90deg,rgba(255,255,255,0.12) 0 2px, transparent 2px 4px);}
    #globalPlayer .wave-progress{position:absolute;inset:0;width:0%;background:repeating-linear-gradient(90deg,#3f6bff 0 2px, transparent 2px 4px);mix-blend-mode:screen;}
    #globalPlayer .time{font-size:12px;color:var(--muted,#b6b9c9);white-space:nowrap;}
    #globalPlayer .actions{display:flex;align-items:center;gap:8px;}
    #globalPlayer .volume{display:flex;align-items:center;gap:8px;min-width:120px;}
    #globalPlayer .volume input[type=range]{width:120px;accent-color:var(--grad2,#4b63ff);}
    #globalPlayer .actions a, #globalPlayer .actions button{border:none;border-radius:10px;padding:8px 10px;font-weight:700;cursor:pointer;}
    #globalPlayer .actions a{background:rgba(255,255,255,0.08);color:var(--text,#e8e8f0);text-decoration:none;}
    #globalPlayer .actions button{background:rgba(255,255,255,0.06);color:var(--text,#e8e8f0);}
    #globalPlayer audio{display:none;}
    @media(max-width:720px){#globalPlayer{flex-direction:column;align-items:flex-start;}#globalPlayer .player-body{width:100%;flex-direction:column;align-items:flex-start;}#globalPlayer .wave-wrap{width:100%;}#globalPlayer .actions{width:100%;}}
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'globalPlayer';
  bar.setAttribute('aria-live','polite');
  bar.innerHTML = `
    <div class="icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 3.5v11.4a3.6 3.6 0 1 1-1.5-2.9V7.7l-6 1.5v7.7a3.6 3.6 0 1 1-1.5-2.9V5l9-2.2z"/></svg></div>
    <div class="info">
      <div class="title" id="gpTitle">재생할 트랙</div>
      <div class="meta" id="gpMeta"></div>
    </div>
    <div class="player-body">
      <button class="play-btn" id="gpPlay" type="button">▶</button>
      <div class="wave-wrap">
        <span class="time" id="gpTime">0:00</span>
        <div class="wave">
          <div class="wave-progress" id="gpWave"></div>
        </div>
        <span class="time" id="gpDuration">0:00</span>
      </div>
    </div>
    <audio id="gpAudio"></audio>
    <div class="actions">
      <div class="volume">
        <span style="font-size:12px;color:var(--muted,#b6b9c9);">🔊</span>
        <input id="gpVolume" type="range" min="0" max="1" step="0.01" value="1" />
      </div>
      <a id="gpDownload" href="#" download>다운로드</a>
      <button id="gpClose" type="button">닫기</button>
    </div>
  `;
  document.body.appendChild(bar);

  const audio = bar.querySelector('#gpAudio');
  const title = bar.querySelector('#gpTitle');
  const meta = bar.querySelector('#gpMeta');
  const dl = bar.querySelector('#gpDownload');
  const closeBtn = bar.querySelector('#gpClose');
  const playBtn = bar.querySelector('#gpPlay');
  const waveFill = bar.querySelector('#gpWave');
  const timeNow = bar.querySelector('#gpTime');
  const timeTotal = bar.querySelector('#gpDuration');
  const STORAGE_KEY = 'texttune_global_player';
  const SESSION_KEY = 'texttune_global_player_session';
  const volumeInput = bar.querySelector('#gpVolume');
  let queue = [];
  let queueIdx = 0;
  let loopQueue = true;

  function saveState(extra = {}) {
    if (!audio) return;
    const state = {
      src: audio.src || '',
      title: title?.textContent || '',
      meta: meta?.textContent || '',
      download: dl?.getAttribute('href') || '',
      currentTime: audio.currentTime || 0,
      volume: audio.volume,
      ...extra,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function setTrack(track, { autoplay = true, q = null, index = 0, loop = true } = {}) {
    if (!audio || !title || !meta || !dl) return;
    if (Array.isArray(q) && q.length) {
      queue = q;
      queueIdx = index >= 0 ? index : 0;
      loopQueue = loop;
    } else if (track && !q) {
      queue = [track];
      queueIdx = 0;
      loopQueue = loop;
    }
    title.textContent = track.title || track.prompt_title || track.prompt_raw || '재생할 트랙';
    meta.textContent = `${track.format || '?'} · ${track.samplerate || '?'}Hz · ${track.duration ? `${Math.round(track.duration)}s` : '?:??'}`;
    audio.src = track.audio_url;
    dl.href = track.download_url || track.audio_url || '#';
    bar.style.display = 'flex';
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch {}
    saveState({ src: audio.src, title: title.textContent, meta: meta.textContent, download: dl.href, currentTime: 0, volume: audio.volume });
    if (waveFill) waveFill.style.width = '0%';
    if (timeNow) timeNow.textContent = '0:00';
    if (timeTotal) timeTotal.textContent = formatTime(track.duration || 0);
    audio.load();
    if (autoplay) audio.play().catch(() => {});
  }
  function playNext() {
    if (!queue.length) return;
    queueIdx += 1;
    if (queueIdx >= queue.length) {
      if (!loopQueue) return;
      queueIdx = 0;
    }
    const next = queue[queueIdx];
    if (next) setTrack(next, { autoplay: true, q: queue, index: queueIdx, loop: loopQueue });
  }
  function playPrev() {
    if (!queue.length) return;
    queueIdx -= 1;
    if (queueIdx < 0) queueIdx = Math.max(queue.length - 1, 0);
    const prev = queue[queueIdx];
    if (prev) setTrack(prev, { autoplay: true, q: queue, index: queueIdx, loop: loopQueue });
  }

  function restore() {
    try {
      if (!sessionStorage.getItem(SESSION_KEY)) return;
    } catch {}
    const st = loadState();
    if (!st || !audio) return;
    if (st.src) {
      title.textContent = st.title || '재생할 트랙';
      meta.textContent = st.meta || '';
      dl.href = st.download || st.src;
      audio.src = st.src;
      if (volumeInput && typeof st.volume === 'number') {
        volumeInput.value = st.volume;
        audio.volume = st.volume;
      }
      bar.style.display = 'flex';
      audio.currentTime = st.currentTime || 0;
    }
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      audio.pause();
      bar.style.display = 'none';
      saveState({ currentTime: audio.currentTime || 0 });
    };
  }
  if (audio) {
    const updateProgress = () => {
      if (waveFill) {
        const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
        waveFill.style.width = `${pct}%`;
      }
      if (timeNow) timeNow.textContent = formatTime(audio.currentTime || 0);
      if (timeTotal && audio.duration) timeTotal.textContent = formatTime(audio.duration);
      saveState({ currentTime: audio.currentTime || 0 });
    };
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('play', () => { if (playBtn) playBtn.textContent = '⏸'; });
    audio.addEventListener('pause', () => { if (playBtn) playBtn.textContent = '▶'; });
    audio.addEventListener('ended', () => playNext());
  }
  if (volumeInput && audio) {
    volumeInput.addEventListener('input', () => {
      const v = parseFloat(volumeInput.value);
      if (!Number.isFinite(v)) return;
      audio.volume = Math.min(1, Math.max(0, v));
      saveState({ volume: audio.volume });
    });
  }
  if (playBtn && audio) {
    playBtn.onclick = () => {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    };
  }

  restore();

  window.setGlobalPlayerTrack = setTrack;
})();
