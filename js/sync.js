(function () {
  const SYNC_KEY_STORAGE = 'resume-sync-key';
  const SYNC_CLOUD_ENABLED_KEY = 'resume-sync-cloud-enabled';
  const SYNC_LAST_AT_KEY = 'resume-sync-last-at';
  const SYNC_CODE_PREFIX = 'RT1:';
  const TABLE_NAME = 'sync_vault';
  const PBKDF2_SALT = new TextEncoder().encode('resume-tracker-sync-v1');
  const PUSH_DEBOUNCE_MS = 800;

  let supabaseClient = null;
  let callbacks = {};
  let pushTimer = null;
  let syncing = false;
  let status = 'disabled';

  function isCloudConfigured() {
    const cfg = window.SUPABASE_CONFIG;
    return !!(cfg && cfg.url && cfg.anonKey);
  }

  function isCloudEnabled() {
    return localStorage.getItem(SYNC_CLOUD_ENABLED_KEY) === '1' && !!getSyncKey() && isCloudConfigured();
  }

  function hasSyncKey() {
    return !!getSyncKey();
  }

  function getSyncKey() {
    return localStorage.getItem(SYNC_KEY_STORAGE) || '';
  }

  function getLastSyncAt() {
    return localStorage.getItem(SYNC_LAST_AT_KEY) || '';
  }

  function setLastSyncAt(iso) {
    localStorage.setItem(SYNC_LAST_AT_KEY, iso);
  }

  function setStatus(next) {
    status = next;
    if (callbacks.onStatusChange) callbacks.onStatusChange(next);
    updateSettingsUI();
  }

  function getStatusLabel(state = status) {
    if (isCloudEnabled()) {
      switch (state) {
        case 'syncing':
          return '同步中…';
        case 'error':
          return '同步失败';
        case 'ok':
          return formatLastSyncLabel(getLastSyncAt()) || '已同步';
        default:
          return '自动同步已开启';
      }
    }
    if (hasSyncKey()) return '已设密钥';
    return '未设置';
  }

  function formatLastSyncLabel(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff) || diff < 0) return '';
    if (diff < 60000) return '刚刚同步';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${new Date(iso).toLocaleDateString('zh-CN')} 同步`;
  }

  function maskSyncKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return `${'•'.repeat(Math.min(key.length - 4, 12))}${key.slice(-4)}`;
  }

  function showDialog(modal) {
    if (!modal) return;
    try {
      if (typeof modal.showModal === 'function') {
        if (!modal.open) modal.showModal();
        return;
      }
    } catch (err) {
      console.warn('showModal failed:', err);
    }
    modal.setAttribute('open', '');
  }

  function hideDialog(modal) {
    if (!modal) return;
    try {
      if (typeof modal.close === 'function' && modal.open) {
        modal.close();
        return;
      }
    } catch (err) {
      console.warn('close failed:', err);
    }
    modal.removeAttribute('open');
  }

  async function loadSupabaseClient() {
    if (!isCloudConfigured()) return null;
    if (supabaseClient) return supabaseClient;

    if (typeof supabase !== 'undefined') {
      supabaseClient = supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
      return supabaseClient;
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Supabase SDK 加载失败'));
      document.head.appendChild(script);
    });

    if (typeof supabase === 'undefined') return null;
    supabaseClient = supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return supabaseClient;
  }

  function initCloudClient() {
    if (!isCloudConfigured()) return false;
    if (supabaseClient) return true;
    loadSupabaseClient().catch(() => {});
    return false;
  }

  function validateSyncKey(raw) {
    const key = String(raw || '').trim();
    if (key.length < 8) {
      throw new Error('同步密钥至少 8 位，建议使用「生成」创建随机密钥');
    }
    return key;
  }

  function generateSyncKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashSyncKey(syncKey) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(syncKey.trim()));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function deriveAesKey(syncKey) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(syncKey.trim()),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: PBKDF2_SALT, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptPayload(syncKey, payload) {
    const key = await deriveAesKey(syncKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload))
    );
    return {
      payload: bufferToBase64(encrypted),
      iv: bufferToBase64(iv),
    };
  }

  async function decryptPayload(syncKey, payload, ivBase64) {
    const key = await deriveAesKey(syncKey);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(base64ToBuffer(ivBase64)) },
      key,
      base64ToBuffer(payload)
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  }

  function mergeApplications(local, remote) {
    const map = new Map();
    local.forEach((app) => map.set(app.id, app));
    remote.forEach((app) => {
      const existing = map.get(app.id);
      if (!existing) {
        map.set(app.id, app);
        return;
      }
      const localTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      const remoteTime = new Date(app.updatedAt || app.createdAt || 0).getTime();
      map.set(app.id, remoteTime >= localTime ? app : existing);
    });
    return Array.from(map.values());
  }

  function mergeResumeVersions(local, remote) {
    const map = new Map();
    local.forEach((item) => map.set(item.id, item));
    remote.forEach((item) => {
      const existing = map.get(item.id);
      if (!existing) {
        map.set(item.id, item);
        return;
      }
      const localTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      const remoteTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
      map.set(item.id, remoteTime >= localTime ? item : existing);
    });
    return Array.from(map.values());
  }

  function mergePayload(localData, remoteData) {
    const localApps = localData.applications || [];
    const remoteApps = remoteData.applications || [];
    return {
      applications: mergeApplications(localApps, remoteApps),
      resumeVersions: mergeResumeVersions(localData.resumeVersions || [], remoteData.resumeVersions || []),
      reminderSentIds: [
        ...new Set([...(localData.reminderSentIds || []), ...(remoteData.reminderSentIds || [])]),
      ],
      syncedAt: new Date().toISOString(),
    };
  }

  function getErrorMessage(err) {
    if (!err) return '同步失败';
    if (typeof err.message === 'string' && err.message) return err.message;
    return '同步失败';
  }

  async function pullRemote(syncKey) {
    const vaultId = await hashSyncKey(syncKey);
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .select('payload, iv')
      .eq('vault_id', vaultId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.payload || !data?.iv) return null;
    return decryptPayload(syncKey, data.payload, data.iv);
  }

  async function pushRemote(syncKey, payload) {
    const vaultId = await hashSyncKey(syncKey);
    const encrypted = await encryptPayload(syncKey, payload);
    const { error } = await supabaseClient.from(TABLE_NAME).upsert({
      vault_id: vaultId,
      payload: encrypted.payload,
      iv: encrypted.iv,
      client_updated_at: payload.syncedAt,
    });
    if (error) throw error;
    setLastSyncAt(new Date().toISOString());
  }

  async function runCloudSync({ forcePush = false } = {}) {
    if (!isCloudEnabled() || syncing) return { changed: false };

    syncing = true;
    setStatus('syncing');

    try {
      const client = await loadSupabaseClient();
      if (!client) {
        setStatus('error');
        return { changed: false, error: '未配置 Supabase' };
      }
      supabaseClient = client;
      const syncKey = getSyncKey();
      const localData = callbacks.getData ? callbacks.getData() : { applications: [], reminderSentIds: [] };
      const remoteData = await pullRemote(syncKey);

      if (!remoteData) {
        const payload = {
          applications: localData.applications || [],
          resumeVersions: localData.resumeVersions || [],
          reminderSentIds: localData.reminderSentIds || [],
          syncedAt: new Date().toISOString(),
        };
        await pushRemote(syncKey, payload);
        setStatus('ok');
        return { changed: false };
      }

      const merged = mergePayload(localData, remoteData);
      const changed =
        JSON.stringify(localData.applications || []) !== JSON.stringify(merged.applications || []) ||
        JSON.stringify(localData.resumeVersions || []) !== JSON.stringify(merged.resumeVersions || []);

      if (changed && callbacks.applyData) callbacks.applyData(merged);
      if (changed || forcePush) await pushRemote(syncKey, merged);
      else setLastSyncAt(new Date().toISOString());

      setStatus('ok');
      return { changed };
    } catch (err) {
      console.error('Cloud sync failed:', err);
      setStatus('error');
      return { changed: false, error: getErrorMessage(err) };
    } finally {
      syncing = false;
    }
  }

  function schedulePush() {
    if (!isCloudEnabled()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => runCloudSync({ forcePush: true }), PUSH_DEBOUNCE_MS);
  }

  function saveSyncKey(rawKey) {
    const syncKey = validateSyncKey(rawKey);
    localStorage.setItem(SYNC_KEY_STORAGE, syncKey);
    updateSettingsUI();
    return syncKey;
  }

  async function enableCloudSync() {
    if (!hasSyncKey()) {
      alert('请先填写并保存同步密钥');
      return false;
    }
    if (!isCloudConfigured()) {
      alert(
        '尚未配置自动同步云端。\n\n你可以直接使用「复制同步码 / 粘贴同步码」在多设备间同步，无需注册任何账号。\n\n若需要打开即自动同步，部署者可在 Supabase 用邮箱注册并填写 js/supabase-config.js。'
      );
      return false;
    }

    try {
      const client = await loadSupabaseClient();
      if (!client) throw new Error('SDK 加载失败');
      supabaseClient = client;
    } catch {
      alert('Supabase 初始化失败，请检查配置。');
      return false;
    }

    localStorage.setItem(SYNC_CLOUD_ENABLED_KEY, '1');
    const result = await runCloudSync({ forcePush: true });
    if (result.error) {
      localStorage.removeItem(SYNC_CLOUD_ENABLED_KEY);
      alert(`开启自动同步失败：${result.error}`);
      return false;
    }
    updateSettingsUI();
    return true;
  }

  function disableCloudSync() {
    localStorage.removeItem(SYNC_CLOUD_ENABLED_KEY);
    setStatus('disabled');
    updateSettingsUI();
  }

  function normalizeSyncCodeInput(rawText) {
    const text = String(rawText || '').trim().replace(/\s/g, '');
    if (!text) {
      throw new Error('请粘贴同步码');
    }
    if (/^[a-f0-9]{16,64}$/i.test(text)) {
      throw new Error(
        '您粘贴的是「同步密钥」（32位十六进制），不是「同步码」。\n\n请在本机依次操作：保存密钥 → 点「复制同步码」→ 粘贴以 RT1: 开头的长文本。'
      );
    }
    if (!text.startsWith(SYNC_CODE_PREFIX)) {
      throw new Error('同步码应以 RT1: 开头。请点「复制同步码」获取，不要复制密钥。');
    }
    return text;
  }

  async function buildSyncCode(syncKey) {
    if (!callbacks.getData) {
      throw new Error('应用尚未就绪，请刷新页面后重试');
    }
    const localData = callbacks.getData();
    const encrypted = await encryptPayload(syncKey, {
      ...localData,
      syncedAt: new Date().toISOString(),
    });
    const payloadJson = JSON.stringify(encrypted);
    return `${SYNC_CODE_PREFIX}${bufferToBase64(new TextEncoder().encode(payloadJson))}`;
  }

  async function copyFromTextarea(textarea) {
    if (!textarea) return false;
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textarea.value);
        return true;
      }
    } catch {
      /* fall through */
    }
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }

  async function copyStringWithFallback(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through */
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function setSyncCodeStatus(message) {
    const el = document.getElementById('syncCodeCopyStatus');
    if (el) el.textContent = message || '';
  }

  function openSyncCodeModal(code) {
    const modal = document.getElementById('syncCodeModal');
    const textarea = document.getElementById('syncCodeExportText');
    if (!modal || !textarea) {
      alert('同步码弹窗加载失败，请刷新页面后重试');
      return;
    }
    textarea.value = code;
    setSyncCodeStatus('');
    showDialog(modal);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.select();
    });
  }

  function closeSyncCodeModal() {
    hideDialog(document.getElementById('syncCodeModal'));
  }

  async function shareSyncCode(text) {
    if (!navigator.share) return false;
    try {
      await navigator.share({
        title: '简历投递同步码',
        text,
      });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return true;
      return false;
    }
  }

  async function copyText(text, successMessage) {
    const ok = await copyStringWithFallback(text);
    if (ok) {
      alert(successMessage);
      return true;
    }
    alert('无法自动复制，请长按文本全选后手动复制。');
    return false;
  }

  async function exportSyncCode() {
    let syncKey = getSyncKey();
    const input = document.getElementById('syncKeyInput');
    if (input?.value.trim()) {
      syncKey = validateSyncKey(input.value);
      saveSyncKey(syncKey);
    }
    if (!syncKey) {
      alert('请先设置并保存同步密钥');
      openSyncModal();
      return;
    }

    try {
      const code = await buildSyncCode(syncKey);
      openSyncCodeModal(code);
      setSyncCodeStatus('请点「复制」或「分享到微信」发送完整同步码');
    } catch (err) {
      alert(err.message || '生成同步码失败');
    }
  }

  async function importSyncCode(rawText) {
    const text = normalizeSyncCodeInput(rawText);

    let syncKey = getSyncKey();
    const input = document.getElementById('syncKeyInput');
    if (input?.value.trim()) syncKey = validateSyncKey(input.value);
    if (!syncKey) {
      throw new Error('请先在「同步密钥」中保存与导出设备相同的密钥');
    }

    let encrypted;
    try {
      const payloadJson = new TextDecoder().decode(base64ToBuffer(text.slice(SYNC_CODE_PREFIX.length)));
      encrypted = JSON.parse(payloadJson);
    } catch {
      throw new Error('同步码内容损坏或不完整，请重新复制');
    }

    if (!encrypted?.payload || !encrypted?.iv) {
      throw new Error('同步码内容无效，请重新复制');
    }

    let remoteData;
    try {
      remoteData = await decryptPayload(syncKey, encrypted.payload, encrypted.iv);
    } catch {
      throw new Error('解密失败，请确认两台设备使用了相同的同步密钥');
    }

    const localData = callbacks.getData ? callbacks.getData() : { applications: [], reminderSentIds: [] };
    const merged = mergePayload(localData, remoteData);

    if (callbacks.applyData) callbacks.applyData(merged);
    if (isCloudEnabled()) schedulePush();
    return merged.applications.length;
  }

  function updateSettingsUI() {
    const statusEl = document.getElementById('syncStatus');
    const keyEl = document.getElementById('syncKeyPreview');
    const btnSyncNow = document.getElementById('btnSyncNow');
    const btnDisableCloud = document.getElementById('btnDisableCloud');
    const btnEnableCloud = document.getElementById('btnEnableCloud');
    const btnCopyCode = document.getElementById('btnCopySyncCode');
    const btnPasteCode = document.getElementById('btnPasteSyncCode');

    if (statusEl) statusEl.textContent = getStatusLabel();
    if (keyEl) keyEl.textContent = hasSyncKey() ? maskSyncKey(getSyncKey()) : '未设置';
    if (btnSyncNow) btnSyncNow.hidden = !isCloudEnabled();
    if (btnDisableCloud) btnDisableCloud.hidden = !isCloudEnabled();
    if (btnEnableCloud) btnEnableCloud.hidden = !hasSyncKey() || isCloudEnabled() || !isCloudConfigured();
    if (btnCopyCode) btnCopyCode.hidden = !hasSyncKey();
    if (btnPasteCode) btnPasteCode.hidden = false;

    const input = document.getElementById('syncKeyInput');
    if (input && document.activeElement !== input && hasSyncKey()) {
      input.value = getSyncKey();
    }
  }

  function openSyncModal() {
    const modal = document.getElementById('syncModal');
    if (!modal) {
      alert('同步功能加载失败，请刷新页面或检查更新。');
      return;
    }
    const input = document.getElementById('syncKeyInput');
    if (input) input.value = getSyncKey();
    updateSettingsUI();
    showDialog(modal);
  }

  function closeSyncModal() {
    hideDialog(document.getElementById('syncModal'));
  }

  function openPasteModal() {
    const modal = document.getElementById('pasteSyncModal');
    const textarea = document.getElementById('pasteSyncInput');
    if (!modal) {
      alert('同步功能加载失败，请刷新页面或检查更新。');
      return;
    }
    if (textarea) textarea.value = '';
    showDialog(modal);
  }

  function closePasteModal() {
    hideDialog(document.getElementById('pasteSyncModal'));
  }

  async function copySyncKey() {
    const input = document.getElementById('syncKeyInput');
    const key = validateSyncKey(input?.value || getSyncKey());
    await copyText(key, '同步密钥已复制。\n\n请在另一台设备的「同步密钥」中粘贴并保存。\n\n注意：密钥不是同步码，传数据还需再点「复制同步码」。');
  }

  let uiBound = false;

  function bindUI() {
    if (uiBound) return;
    uiBound = true;

    document.getElementById('btnSyncSetup')?.addEventListener('click', openSyncModal);
    document.getElementById('btnSyncNow')?.addEventListener('click', async () => {
      const result = await runCloudSync({ forcePush: true });
      alert(result.error ? `同步失败：${result.error}` : '同步完成');
    });
    document.getElementById('btnCopySyncCode')?.addEventListener('click', exportSyncCode);
    document.getElementById('btnPasteSyncCode')?.addEventListener('click', openPasteModal);
    document.getElementById('btnCloseSync')?.addEventListener('click', closeSyncModal);
    document.getElementById('btnCancelSync')?.addEventListener('click', closeSyncModal);
    document.getElementById('btnGenerateSyncKey')?.addEventListener('click', () => {
      const input = document.getElementById('syncKeyInput');
      if (input) input.value = generateSyncKey();
    });
    document.getElementById('btnCopySyncKey')?.addEventListener('click', copySyncKey);
    document.getElementById('btnCopySyncCodeInModal')?.addEventListener('click', exportSyncCode);
    document.getElementById('btnCopySyncCodeConfirm')?.addEventListener('click', async () => {
      const textarea = document.getElementById('syncCodeExportText');
      const ok = await copyFromTextarea(textarea);
      setSyncCodeStatus(ok ? '已复制完整同步码，可去另一台设备粘贴' : '复制失败，请长按上方文本框 → 全选 → 拷贝');
    });
    document.getElementById('btnShareSyncCode')?.addEventListener('click', async () => {
      const text = document.getElementById('syncCodeExportText')?.value;
      if (!text) return;
      const ok = await shareSyncCode(text);
      setSyncCodeStatus(ok ? '已打开分享，请发送到微信文件传输助手' : '当前浏览器不支持分享，请点「复制」');
    });
    document.getElementById('btnCloseSyncCode')?.addEventListener('click', closeSyncCodeModal);
    document.getElementById('btnCloseSyncCodeFooter')?.addEventListener('click', closeSyncCodeModal);
    document.getElementById('syncCodeModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'syncCodeModal') closeSyncCodeModal();
    });
    document.getElementById('btnSaveSyncKey')?.addEventListener('click', () => {
      const input = document.getElementById('syncKeyInput');
      try {
        saveSyncKey(input?.value);
        alert('密钥已保存。\n\n下一步：点「复制同步码」导出数据（以 RT1: 开头的长文本）。');
      } catch (err) {
        alert(err.message);
      }
    });
    document.getElementById('btnEnableCloud')?.addEventListener('click', async () => {
      const input = document.getElementById('syncKeyInput');
      if (input?.value.trim()) saveSyncKey(input.value);
      const ok = await enableCloudSync();
      if (ok) {
        alert('自动同步已开启！');
        closeSyncModal();
      }
    });
    document.getElementById('btnDisableCloud')?.addEventListener('click', () => {
      if (confirm('关闭后不再自动同步，云端数据仍保留。确定吗？')) {
        disableCloudSync();
        closeSyncModal();
      }
    });
    document.getElementById('btnClosePasteSync')?.addEventListener('click', closePasteModal);
    document.getElementById('btnCancelPasteSync')?.addEventListener('click', closePasteModal);
    document.getElementById('btnConfirmPasteSync')?.addEventListener('click', async () => {
      const text = document.getElementById('pasteSyncInput')?.value;
      try {
        const count = await importSyncCode(text);
        alert(`同步成功！当前共 ${count} 条记录。`);
        closePasteModal();
      } catch (err) {
        alert(`导入失败：${err.message}\n\n请确认同步码完整，且密钥与导出时一致。`);
      }
    });
    document.getElementById('syncModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'syncModal') closeSyncModal();
    });
    document.getElementById('pasteSyncModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'pasteSyncModal') closePasteModal();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && isCloudEnabled()) runCloudSync();
    });
  }

  function bootSyncUI() {
    bindUI();
    updateSettingsUI();
  }

  window.ResumeSync = {
    init(options = {}) {
      callbacks = { ...callbacks, ...options };
      bootSyncUI();
      initCloudClient();
      setStatus(isCloudEnabled() ? 'ok' : 'disabled');
    },
    isConfigured: isCloudConfigured,
    isEnabled: isCloudEnabled,
    getStatusLabel,
    schedulePush,
    syncOnLaunch() {
      if (!isCloudEnabled()) return Promise.resolve({ changed: false });
      return runCloudSync();
    },
    syncNow: () => runCloudSync({ forcePush: true }),
    updateSettingsUI,
    openSyncModal,
    openPasteModal,
    exportSyncCode,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSyncUI);
  } else {
    bootSyncUI();
  }
})();
