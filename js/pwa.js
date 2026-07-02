const INSTALL_DISMISS_KEY = 'pwa-install-dismissed';
const UPDATE_ATTEMPTS_PREFIX = 'resume-update-attempts-';
const APP_VERSION = 'v16';

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

function updateVersionDisplay(version = APP_VERSION) {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = version;
}

function getAppBaseUrl() {
  const path = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
  return `${window.location.origin}${path || ''}/`;
}

function activateWaitingWorker(registration) {
  if (registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }
  return false;
}

async function fetchRemoteVersion() {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch {
    return null;
  }
}

function showManualUpdateGuide(localVersion, remoteVersion) {
  const url = `${getAppBaseUrl()}?appv=${Date.now()}`;
  setUpdateStatus(`需手动更新 ${remoteVersion}`);
  alert(
    `自动更新未成功，当前仍为 ${localVersion}，最新为 ${remoteVersion}。\n\n请按以下步骤操作：\n1. 删除手机桌面上的旧图标\n2. 用 Safari 打开：\n${url}\n3. 确认版本号正确后，重新「添加到主屏幕」`
  );
}

async function clearAppCachesAndReload(remoteVersion) {
  const attemptKey = `${UPDATE_ATTEMPTS_PREFIX}${remoteVersion || 'unknown'}`;
  const attempts = parseInt(sessionStorage.getItem(attemptKey) || '0', 10) + 1;
  sessionStorage.setItem(attemptKey, String(attempts));

  if (attempts > 2) {
    showManualUpdateGuide(window.APP_VERSION || APP_VERSION, remoteVersion);
    return false;
  }

  refreshing = true;
  setUpdateStatus('正在更新…');

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      await registration.unregister();
    }
  } catch (err) {
    console.warn('Clear cache failed:', err);
  }

  const base = `${window.location.pathname}${window.location.search}`;
  const separator = base.includes('?') ? '&' : '?';
  window.location.replace(`${base}${separator}appv=${Date.now()}`);
  return true;
}

async function runServiceWorkerUpdate(manual) {
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

  return { updated: false, message: '无 waiting worker' };
}

async function checkForAppUpdate(manual = false) {
  if (!canRegisterServiceWorker()) {
    if (manual) alert('当前环境不支持自动更新，请用浏览器打开网址后刷新。');
    return { updated: false, message: '不支持' };
  }

  if (manual) setUpdateStatus('检查中…');

  const localVersion = window.APP_VERSION || APP_VERSION;
  const remoteVersion = await fetchRemoteVersion();

  if (remoteVersion && remoteVersion !== localVersion) {
    setUpdateStatus(`发现 ${remoteVersion}`);

    if (manual) {
      const ok = window.confirm(
        `发现新版本 ${remoteVersion}（当前 ${localVersion}）。\n\n是否立即清缓存并更新？\n\n若更新失败，请按提示用 Safari 重新打开。`
      );
      if (ok) {
        const started = await clearAppCachesAndReload(remoteVersion);
        return { updated: started, message: started ? '更新中' : '需手动更新' };
      }
      return { updated: false, message: '已取消' };
    }

    return runServiceWorkerUpdate(false);
  }

  if (remoteVersion === localVersion) {
    const attemptKey = `${UPDATE_ATTEMPTS_PREFIX}${remoteVersion}`;
    sessionStorage.removeItem(attemptKey);
  }

  try {
    const swResult = await runServiceWorkerUpdate(manual);
    if (swResult.updated) return swResult;

    if (manual) {
      setUpdateStatus('已是最新');
      alert(`当前已是最新版本（${localVersion}）`);
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
    updateVersionDisplay();
    navigator.serviceWorker
      .register('./service-worker.js')
      .then((registration) => {
        setUpdateStatus('已是最新');
        checkForAppUpdate(false);
        return registration;
      })
      .catch(() => {});
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
