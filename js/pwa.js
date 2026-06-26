const INSTALL_DISMISS_KEY = 'pwa-install-dismissed';

let deferredPrompt = null;

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

function registerServiceWorker() {
  if (!canRegisterServiceWorker()) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js')
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
}

registerServiceWorker();
bindInstallEvents();
