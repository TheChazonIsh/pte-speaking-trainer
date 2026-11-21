let storageQuotaToastShown = false;

export function isQuotaExceededError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  );
}

export function showStorageQuotaToast() {
  if (storageQuotaToastShown) return;
  storageQuotaToastShown = true;
  try {
    if (document.getElementById('storage-quota-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'storage-quota-toast';
    toast.setAttribute('role', 'alert');
    toast.className = 'fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 shadow-lg p-3.5 flex items-start justify-between gap-3 text-xs';
    toast.innerHTML = `
      <div class="space-y-1">
        <p class="font-extrabold text-amber-900">⚠️ 브라우저 저장 공간이 가득 찼습니다</p>
        <p class="text-amber-800 leading-relaxed">상단 <strong>[🔄 동기화]</strong>에서 학습 데이터를 파일로 백업한 뒤 오래된 세트·기록을 정리해 주세요.</p>
      </div>
      <button type="button" aria-label="알림 닫기"
        class="shrink-0 px-2 py-1 rounded-lg font-bold text-amber-800 hover:bg-amber-200/70 transition cursor-pointer">
        닫기
      </button>
    `;
    const closeBtn = toast.querySelector('button');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => toast.remove());
    }
    document.body.appendChild(toast);
    setTimeout(() => {
      try { toast.remove(); } catch (e) {}
    }, 10000);
  } catch (e) {
    // ignore DOM errors
  }
}

export function safeGetStorage(key, fallback = null, parseJson = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    if (!parseJson) return raw;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? parsed : fallback;
    }
    if (typeof fallback === 'boolean') {
      return typeof parsed === 'boolean' ? parsed : fallback;
    }
    if (fallback !== null && typeof fallback === 'object') {
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : fallback;
    }
    return parsed;
  } catch (e) {
    return fallback;
  }
}

export function loadJsonStorage(key, fallback) {
  return safeGetStorage(key, fallback, true);
}

export function loadObjectArrayStorage(key, predicate = null) {
  const arr = loadJsonStorage(key, []);
  return arr.filter(item => item && typeof item === 'object' && !Array.isArray(item) && (!predicate || predicate(item)));
}

export function loadRawStorage(key, fallback = '') {
  return safeGetStorage(key, fallback, false);
}

export function saveStorage(key, val) {
  try {
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    return true;
  } catch (e) {
    if (isQuotaExceededError(e)) {
      showStorageQuotaToast();
    }
    return false;
  }
}
