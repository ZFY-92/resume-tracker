const INSTALL_DISMISS_KEY = 'pwa-install-dismissed';
const APP_VERSION = 'v8';

let deferredPrompt = null;
let refreshing = false;

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function canRegisterServiceWorker() {
  return (
    'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  );
}

function setUpdateStatus(text) {
  const el = document.getElementById('updateStatus');
  if (el) el.textContent = text;
}

function activateWaitingWorker(registration) {
  if (registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }
  return false;
}

async function checkForAppUpdate(manual = false) {
  if (!canRegisterServiceWorker()) {
    if (manual) alert('当前环境不支持自动更新，请用浏览器打开网址后刷新。');
    return { updated: false, message: '不支持' };
  }

  if (manual) setUpdateStatus('检查中…');

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      if (manual) setUpdateStatus('未启用离线缓存');
      return { updated: false, message: '未注册' };
    }

    await registration.update();

    if (activateWaitingWorker(registration)) {
      if (manual) setUpdateStatus('正在更新…');
      return { updated: true, message: '更新中' };
    }

    if (registration.installing) {
      await new Promise((resolve) => {
        registration.installing.addEventListener('statechange', function onStateChange() {
          if (this.state === 'installed') {
            this.removeEventListener('statechange', onStateChange);
            if (navigator.serviceWorker.controller && registration.waiting) {
              activateWaitingWorker(registration);
            }
            resolve();
          }
        });
      });
      if (manual) setUpdateStatus('正在更新…');
      return { updated: true, message: '更新中' };
    }

    if (manual) {
      setUpdateStatus('已是最新');
      alert('当前已是最新版本');
    } else {
      setUpdateStatus('已是最新');
    }
    return { updated: false, message: '已是最新' };
  } catch {
    if (manual) {
      setUpdateStatus('检查失败');
      alert('检查更新失败，请检查网络后重试');
    }
    return { updated: false, message: '失败' };
  }
}

function registerServiceWorker() {
  if (!canRegisterServiceWorker()) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js')
      .then((registration) => {
        setUpdateStatus('已是最新');
        checkForAppUpdate(false);
        return registration;
      })
      .catch(() => {});
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkForAppUpdate(false);
    }
  });
}

function showInstallBanner() {
  if (isStandalone()) return;
  if (localStorage.getItem(INSTALL_DISMISS_KEY)) return;

  const banner = document.getElementById('installBanner');
  const text = document.getElementById('installBannerText');
  const btnInstall = document.getElementById('btnInstall');

  if (!banner || !text) return;

  if (deferredPrompt) {
    text.textContent = '将此应用安装到手机桌面，像 APP 一样快速打开';
    btnInstall.hidden = false;
  } else if (isIOS()) {
    text.textContent = '安装方法：点击 Safari 底部分享按钮 →「添加到主屏幕」';
    btnInstall.hidden = true;
  } else {
    return;
  }

  banner.hidden = false;
}

function hideInstallBanner(remember = false) {
  const banner = document.getElementById('installBanner');
  if (banner) banner.hidden = true;
  if (remember) localStorage.setItem(INSTALL_DISMISS_KEY, '1');
}

async function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  hideInstallBanner(true);
}

function bindInstallEvents() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBanner(true);
  });

  const btnInstall = document.getElementById('btnInstall');
  const btnDismiss = document.getElementById('btnDismissInstall');

  if (btnInstall) btnInstall.addEventListener('click', promptInstall);
  if (btnDismiss) btnDismiss.addEventListener('click', () => hideInstallBanner(true));

  if (isIOS() && !isStandalone()) {
    setTimeout(showInstallBanner, 800);
  }

  const btnCheckUpdate = document.getElementById('btnCheckUpdate');
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', () => checkForAppUpdate(true));
  }
}

window.checkForAppUpdate = checkForAppUpdate;
window.APP_VERSION = APP_VERSION;

registerServiceWorker();
bindInstallEvents();
