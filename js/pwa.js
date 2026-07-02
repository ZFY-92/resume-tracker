const INSTALL_DISMISS_KEY = 'pwa-install-dismissed';
const VERSION_KEY = 'resume-tracker-app-version';
const APP_VERSION = '20';

let deferredPrompt = null;
let swRegistration = null;
let updateCheckStatus = { state: 'idle', remoteVersion: null, message: '已是最新' };

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

function updateVersionDisplay() {
  const versionEl = document.getElementById('appVersion');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
}

function renderUpdateUI() {
  const statusEl = document.getElementById('updateStatus');
  const reloadBtn = document.getElementById('btnReloadUpdate');
  const checkBtn = document.getElementById('btnCheckUpdate');
  const banner = document.getElementById('updateBanner');
  const bannerText = document.getElementById('updateBannerText');

  if (statusEl) {
    statusEl.textContent = updateCheckStatus.message;
  }
  if (reloadBtn) {
    reloadBtn.hidden = updateCheckStatus.state !== 'available';
  }
  if (checkBtn) {
    checkBtn.disabled = updateCheckStatus.state === 'checking';
  }
  if (banner) {
    banner.hidden = updateCheckStatus.state !== 'available';
  }
  if (bannerText && updateCheckStatus.state === 'available') {
    bannerText.textContent = updateCheckStatus.remoteVersion
      ? `发现新版本 v${updateCheckStatus.remoteVersion}（当前 v${APP_VERSION}），请刷新`
      : '发现新版本，请刷新页面';
  }
}

function showUpdateAvailable(remoteVersion, message) {
  updateCheckStatus = {
    state: 'available',
    remoteVersion,
    message: message || (remoteVersion ? `发现 v${remoteVersion}，请刷新` : '发现新版本，请刷新'),
  };
  renderUpdateUI();
}

async function fetchRemoteVersion() {
  const res = await fetch(`./service-worker.js?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('network');
  const text = await res.text();
  const match = text.match(/APP_VERSION = '(\d+)'/);
  if (!match) throw new Error('parse');
  return match[1];
}

async function checkForAppUpdate(options = {}) {
  if (!canRegisterServiceWorker()) {
    if (!options.silent) alert('当前环境不支持自动更新，请用浏览器打开网址后刷新。');
    return;
  }

  updateCheckStatus = { state: 'checking', remoteVersion: null, message: '检查中…' };
  renderUpdateUI();

  try {
    if (swRegistration) await swRegistration.update();
    const remoteVersion = await fetchRemoteVersion();
    const hasWaitingWorker = !!swRegistration?.waiting;
    const isNewer = Number(remoteVersion) > Number(APP_VERSION);

    if (isNewer || hasWaitingWorker) {
      showUpdateAvailable(
        remoteVersion,
        isNewer
          ? `发现 v${remoteVersion}（当前 v${APP_VERSION}）`
          : `新版本 v${remoteVersion} 已就绪`
      );
      if (!options.silent) {
        alert(`发现新版本 v${remoteVersion}，请点击顶部「立即刷新」。`);
      }
    } else {
      updateCheckStatus = {
        state: 'latest',
        remoteVersion,
        message: `已是最新（v${APP_VERSION}）`,
      };
      if (!options.silent) alert(`当前已是最新版本（v${APP_VERSION}）`);
    }
  } catch {
    updateCheckStatus = {
      state: 'error',
      remoteVersion: null,
      message: '检查失败',
    };
    if (!options.silent) alert('检查更新失败，请检查网络后重试');
  }

  renderUpdateUI();
}

function checkAppVersion() {
  const stored = localStorage.getItem(VERSION_KEY);
  if (stored && stored !== APP_VERSION) {
    showUpdateAvailable(APP_VERSION, `已加载 v${APP_VERSION}，建议刷新`);
  }
  localStorage.setItem(VERSION_KEY, APP_VERSION);
}

function registerServiceWorker() {
  if (!canRegisterServiceWorker()) return;

  navigator.serviceWorker
    .register(`./service-worker.js?v=${APP_VERSION}`)
    .then((reg) => {
      swRegistration = reg;
      const checkUpdate = () => reg.update().catch(() => {});
      checkUpdate();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkUpdate();
      });

      if (reg.waiting && navigator.serviceWorker.controller) {
        fetchRemoteVersion()
          .then((remoteVersion) => showUpdateAvailable(remoteVersion, '新版本已就绪，请刷新'))
          .catch(() => showUpdateAvailable(null, '新版本已就绪，请刷新'));
      }

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            fetchRemoteVersion()
              .then((remoteVersion) => showUpdateAvailable(remoteVersion, '新版本已就绪，请刷新'))
              .catch(() => showUpdateAvailable(null, '新版本已就绪，请刷新'));
          }
        });
      });
    })
    .catch(() => {});
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

  document.getElementById('btnInstall')?.addEventListener('click', promptInstall);
  document.getElementById('btnDismissInstall')?.addEventListener('click', () => hideInstallBanner(true));

  if (isIOS() && !isStandalone()) {
    setTimeout(showInstallBanner, 800);
  }

  document.getElementById('btnCheckUpdate')?.addEventListener('click', () => checkForAppUpdate());
  document.getElementById('btnReloadUpdate')?.addEventListener('click', () => window.location.reload());
  document.getElementById('btnReloadApp')?.addEventListener('click', () => window.location.reload());
}

window.checkForAppUpdate = checkForAppUpdate;
window.APP_VERSION = APP_VERSION;

updateVersionDisplay();
checkAppVersion();
registerServiceWorker();
bindInstallEvents();
renderUpdateUI();
