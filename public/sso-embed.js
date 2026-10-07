// Đăng nhập 1 lần: khi trang được nhúng (iframe) trong dashboard chính, mọi thao tác đăng nhập
// được chuyển lên khung ngoài; phiên Firebase dùng chung (cùng origin) nên các tab tự nhận trạng thái.
import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const embedded = window.parent !== window;
if (embedded) {
  const needLock = new URL(import.meta.url).searchParams.get('lock') === '1';
  const askLogin = () => window.parent.postMessage({ type: 'd07-login' }, location.origin);

  // Bắt mọi nút mở popup đăng nhập riêng của trang → mở popup đăng nhập chung ở khung ngoài
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[onclick*="openLoginModal"]');
    if (t) { e.preventDefault(); e.stopImmediatePropagation(); askLogin(); }
  }, true);

  window.addEventListener('load', () => {
    if (!getApps().length) return;
    const auth = getAuth(getApp());
    let lock;
    const showLock = on => {
      if (!needLock) return;
      if (!lock) {
        lock = document.createElement('div');
        lock.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f0f4ff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:Inter,Arial,sans-serif;color:#4a5568';
        lock.innerHTML = '<div style="font-size:34px">🔒</div><div style="font-size:13px">Đăng nhập một lần để xem tất cả các tab</div><button style="padding:9px 18px;border:0;border-radius:9px;background:#4361ee;color:#fff;font-weight:700;cursor:pointer">Đăng nhập</button>';
        lock.querySelector('button').onclick = askLogin;
        document.body.appendChild(lock);
      }
      lock.style.display = on ? 'flex' : 'none';
    };
    onAuthStateChanged(auth, u => showLock(!u));
    // Khung ngoài báo vừa đăng nhập: nếu phiên chưa đồng bộ sang đây thì tải lại để nhận
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || e.data?.type !== 'd07-auth' || !e.data.loggedIn) return;
      setTimeout(() => { if (!auth.currentUser) location.reload(); }, 1500);
    });
  });
}
