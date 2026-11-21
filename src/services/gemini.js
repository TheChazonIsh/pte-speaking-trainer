import {
  STORAGE_KEYS,
  TTS_CACHE_MAX_ITEMS,
  DEFAULT_GEMINI_MODEL,
  GEMINI_TTS_ENDPOINT,
  GEMINI_TEXT_TIMEOUT_MS,
  GEMINI_TTS_TIMEOUT_MS,
} from '../config/constants.js';
import { escapeHtml } from '../utils/security.js';
import { isQuotaExceededError, showStorageQuotaToast } from '../utils/storage.js';
import { state, el } from '../state/store.js';

export function getGeminiTtsVoiceName(accent = state.ttsAccent, targetMode = state.mode) {
  if (accent === 'en-AU') return 'Puck';
  if (accent === 'en-GB') return 'Charon';
  if (accent === 'en-US') return 'Kore';
  return targetMode === 'retell-lecture' ? 'Fenrir' : 'Aoede';
}

export function isGeminiTtsActive() {
  return Boolean(state.useGeminiTts && state.geminiApiKey && state.geminiApiKey.trim());
}

export function updateTtsCacheBadges() {
  const count = state.ttsAudioCache ? state.ttsAudioCache.size : 0;
  [el.rsTtsCacheBadge, el.rlTtsCacheBadge].forEach(badge => {
    if (badge) badge.textContent = `캐시 ${count}건`;
  });
}

export function syncGeminiTtsUI() {
  const checkboxes = [el.chkRsGeminiTts, el.chkRlGeminiTts];
  const badges = [
    { el: el.rsGeminiTtsBadge, mode: 'repeat-sentence' },
    { el: el.rlGeminiTtsBadge, mode: 'retell-lecture' }
  ];
  const hasKey = Boolean(state.geminiApiKey && state.geminiApiKey.trim());

  checkboxes.forEach(chk => {
    if (chk) chk.checked = Boolean(state.useGeminiTts);
  });

  badges.forEach(({ el: badge, mode }) => {
    if (!badge) return;
    const voiceName = getGeminiTtsVoiceName(state.ttsAccent, mode);
    if (state.useGeminiTts && hasKey) {
      badge.textContent = `✨ Gemini 3.8 Flash · ${voiceName}`;
      badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800';
    } else if (state.useGeminiTts && !hasKey) {
      badge.textContent = '키 미등록 → 브라우저 음성 자동 폴백';
      badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800';
    } else {
      badge.textContent = 'OFF · 브라우저 기본 음성 사용';
      badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-200 text-slate-600';
    }
  });

  updateTtsCacheBadges();
}

export function pcmBase64ToWavBlob(base64Data, mimeType = 'audio/L16;rate=24000') {
  const cleanB64 = String(base64Data || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binaryStr = atob(cleanB64);
  const len = binaryStr.length;
  const pcmBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    pcmBytes[i] = binaryStr.charCodeAt(i);
  }

  // Skip adding header if response already contains a standard RIFF container
  if (
    len >= 12 &&
    pcmBytes[0] === 0x52 && pcmBytes[1] === 0x49 &&
    pcmBytes[2] === 0x46 && pcmBytes[3] === 0x46
  ) {
    return new Blob([pcmBytes], { type: 'audio/wav' });
  }

  const rateMatch = String(mimeType || '').match(/rate=(\d+)/i);
  const chanMatch = String(mimeType || '').match(/channels=(\d+)/i);
  const sampleRate = rateMatch ? Math.max(8000, parseInt(rateMatch[1], 10) || 24000) : 24000;
  const numChannels = chanMatch ? Math.max(1, parseInt(chanMatch[1], 10) || 1) : 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);

  return new Blob([wavHeader, pcmBytes], { type: 'audio/wav' });
}

export function getTtsCacheEntry(cacheKey) {
  if (!state.ttsAudioCache || !state.ttsAudioCache.has(cacheKey)) return null;
  const entry = state.ttsAudioCache.get(cacheKey);
  // Move to most-recently-used position at end of Map
  state.ttsAudioCache.delete(cacheKey);
  state.ttsAudioCache.set(cacheKey, entry);
  return entry;
}

export function setTtsCacheEntry(cacheKey, entry) {
  if (!state.ttsAudioCache) state.ttsAudioCache = new Map();
  if (state.ttsAudioCache.has(cacheKey)) {
    const prev = state.ttsAudioCache.get(cacheKey);
    state.ttsAudioCache.delete(cacheKey);
    if (prev && prev.blobUrl && prev.blobUrl !== entry.blobUrl) {
      try { URL.revokeObjectURL(prev.blobUrl); } catch (e) {}
    }
  }
  state.ttsAudioCache.set(cacheKey, entry);
  while (state.ttsAudioCache.size > TTS_CACHE_MAX_ITEMS) {
    const oldestKey = state.ttsAudioCache.keys().next().value;
    const oldest = state.ttsAudioCache.get(oldestKey);
    state.ttsAudioCache.delete(oldestKey);
    if (oldest && oldest.blobUrl) {
      try { URL.revokeObjectURL(oldest.blobUrl); } catch (e) {}
    }
  }
  updateTtsCacheBadges();
}

export async function fetchOrGetCachedGeminiTts(text, voiceName, { timeoutMs = GEMINI_TTS_TIMEOUT_MS } = {}) {
  const cleanText = String(text || '').trim();
  const cacheKey = `${voiceName}::${cleanText}`;
  const cached = getTtsCacheEntry(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const apiKey = (state.geminiApiKey || '').trim();
  if (!apiKey) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }

  if (state.ttsFetchAbortController) {
    try { state.ttsFetchAbortController.abort(); } catch (e) {}
  }
  const controller = new AbortController();
  state.ttsFetchAbortController = controller;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try { controller.abort(); } catch (e) {}
  }, timeoutMs);

  const endpoint = GEMINI_TTS_ENDPOINT;
  try {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: cleanText }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName
                }
              }
            }
          }
        })
      });
    } catch (fetchErr) {
      if (fetchErr && fetchErr.name === 'AbortError') {
        if (timedOut) {
          const err = new Error('AI 음성 생성 시간이 초과되었습니다(30초). 브라우저 음성으로 전환하거나 다시 시도해 주세요.');
          err.isTimeout = true;
          throw err;
        }
        const err = new Error('TTS_ABORTED');
        err.isAborted = true;
        throw err;
      }
      throw fetchErr;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = payload?.error?.message || `HTTP ${response.status} 오류가 발생했습니다.`;
      throw new Error(errMsg);
    }

    const parts = payload?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find(p => p.inlineData && p.inlineData.data);
    if (!audioPart) {
      throw new Error('Gemini TTS 응답에 오디오 데이터가 포함되지 않았습니다.');
    }

    const wavBlob = pcmBase64ToWavBlob(
      audioPart.inlineData.data,
      audioPart.inlineData.mimeType || 'audio/L16;rate=24000'
    );
    const blobUrl = URL.createObjectURL(wavBlob);
    const entry = { blobUrl, voiceName, byteLength: wavBlob.size };
    setTtsCacheEntry(cacheKey, entry);
    return { ...entry, fromCache: false };
  } finally {
    clearTimeout(timeoutId);
    if (state.ttsFetchAbortController === controller) {
      state.ttsFetchAbortController = null;
    }
  }
}

export function updateAiHeaderUI() {
  const hasKey = Boolean(state.geminiApiKey && state.geminiApiKey.trim());
  const modelName = (state.geminiModel || DEFAULT_GEMINI_MODEL).trim() || 'gemini-4-hydrogen';
  if (hasKey) {
    el.headerAiDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    el.headerAiLabel.textContent = `⚙️ AI 연결됨 (${modelName})`;
  } else {
    el.headerAiDot.className = 'w-2 h-2 rounded-full bg-slate-300';
    el.headerAiLabel.textContent = '⚙️ AI 설정';
  }
  syncGeminiTtsUI();
}

export function showAiSettingsFeedback(msg, isError = false) {
  el.aiSettingsFeedback.textContent = msg;
  el.aiSettingsFeedback.className = isError
    ? 'text-xs font-semibold rounded-lg px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200'
    : 'text-xs font-semibold rounded-lg px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200';
  el.aiSettingsFeedback.classList.remove('hidden');
}

export function openAiSettingsModal(initialMessage = '') {
  el.inputGeminiApiKey.value = state.geminiApiKey || '';
  el.inputGeminiApiKey.type = 'password';
  el.btnToggleKeyVisibility.textContent = '보기';
  const model = (state.geminiModel || DEFAULT_GEMINI_MODEL).trim() || 'gemini-4-hydrogen';
  el.inputGeminiModel.value = model;
  el.previewModelName.textContent = model;
  if (initialMessage) {
    showAiSettingsFeedback(initialMessage, true);
  } else {
    el.aiSettingsFeedback.classList.add('hidden');
  }
  el.aiSettingsModal.classList.remove('hidden');
  setTimeout(() => el.inputGeminiApiKey.focus(), 20);
}

export function closeAiSettingsModal() {
  el.aiSettingsModal.classList.add('hidden');
}

export function parseGeminiJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('AI 응답 텍스트가 비어 있습니다.');
  }
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw firstErr;
  }
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result || '';
      const idx = String(res).indexOf(',');
      resolve(idx !== -1 ? String(res).slice(idx + 1) : String(res));
    };
    reader.onerror = () => reject(new Error('오디오 Base64 변환에 실패했습니다.'));
    reader.readAsDataURL(blob);
  });
}

export async function callGeminiApi(parts, { timeoutMs = GEMINI_TEXT_TIMEOUT_MS, signal = null } = {}) {
  const apiKey = (state.geminiApiKey || '').trim();
  if (!apiKey) {
    openAiSettingsModal('먼저 Google AI Studio Gemini API 키를 입력하고 저장해주세요.');
    const err = new Error('NO_API_KEY');
    err.isMissingKey = true;
    throw err;
  }

  if (signal && signal.aborted) {
    const abortErr = new Error('요청이 취소되었습니다.');
    abortErr.isAborted = true;
    throw abortErr;
  }

  const model = (state.geminiModel || DEFAULT_GEMINI_MODEL).trim() || 'gemini-4-hydrogen';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  const onExternalAbort = () => {
    externallyAborted = true;
    try { controller.abort(); } catch (e) {}
  };
  if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try { controller.abort(); } catch (e) {}
  }, timeoutMs);

  try {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json'
          }
        })
      });
    } catch (fetchErr) {
      if (fetchErr && fetchErr.name === 'AbortError') {
        if (timedOut) {
          const tErr = new Error('AI 응답 시간이 초과되었습니다(25초). 네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
          tErr.isTimeout = true;
          throw tErr;
        }
        const aErr = new Error(externallyAborted ? '요청이 취소되었습니다.' : 'AI 요청이 중단되었습니다.');
        aErr.isAborted = true;
        throw aErr;
      }
      throw fetchErr;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = payload?.error?.message || `HTTP ${response.status} 오류가 발생했습니다.`;
      throw new Error(msg);
    }

    const textPart = payload?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '')
      .join('')
      .trim();

    if (!textPart) {
      throw new Error('Gemini API가 유효한 응답을 반환하지 않았습니다.');
    }
    return parseGeminiJson(textPart);
  } finally {
    clearTimeout(timeoutId);
    if (signal && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function cancelPendingSpeakingGrade() {
  state.speakingGradeSeq += 1;
  if (state.speakingGradeAbort) {
    try { state.speakingGradeAbort.abort(); } catch (e) {}
    state.speakingGradeAbort = null;
  }
  state.speakingGradingBusy = false;
  if (el.btnAiGradeSpeaking) {
    el.btnAiGradeSpeaking.disabled = false;
    el.btnAiGradeSpeaking.classList.remove('opacity-60');
  }
}

export function cancelPendingWritingGrade() {
  state.writingGradeSeq += 1;
  if (state.writingGradeAbort) {
    try { state.writingGradeAbort.abort(); } catch (e) {}
    state.writingGradeAbort = null;
  }
  state.writingGradingBusy = false;
  if (el.btnAiGradeWriting) {
    el.btnAiGradeWriting.disabled = false;
    el.btnAiGradeWriting.classList.remove('opacity-60');
  }
}

export function cancelPendingYtsGrade() {
  state.ytsGradeSeq += 1;
  if (state.ytsGradeAbort) {
    try { state.ytsGradeAbort.abort(); } catch (e) {}
    state.ytsGradeAbort = null;
  }
  state.ytsAiGrading = false;
  if (el.btnYtsAiGrade) {
    el.btnYtsAiGrade.disabled = false;
    el.btnYtsAiGrade.classList.remove('opacity-60');
  }
}

export function setAiLoadingState(containerEl, btnEl, label) {
  containerEl.classList.remove('hidden');
  containerEl.innerHTML = `
    <div class="flex items-center gap-3 text-indigo-800 py-2">
      <span class="w-5 h-5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin shrink-0"></span>
      <div>
        <p class="text-sm font-bold">${escapeHtml(label)}</p>
        <p class="text-xs text-slate-500">모델: ${escapeHtml(state.geminiModel || DEFAULT_GEMINI_MODEL)} 호출 중...</p>
      </div>
    </div>
  `;
  btnEl.disabled = true;
  btnEl.classList.add('opacity-60');
}

export function renderAiErrorCard(containerEl, errMsg) {
  containerEl.classList.remove('hidden');
  containerEl.innerHTML = `
    <div class="rounded-xl border border-rose-200 bg-rose-50 p-4 space-y-2.5">
      <p class="text-xs sm:text-sm font-bold text-rose-800">⚠️ AI 채점 오류</p>
      <p class="text-xs text-rose-700 leading-relaxed break-words">${escapeHtml(errMsg)}</p>
      <button type="button" data-open-ai-settings="1"
        class="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-rose-300 text-rose-800 hover:bg-rose-100 cursor-pointer">
        ⚙️ API 키 / 모델 설정 확인하기
      </button>
    </div>
  `;
}

export function renderHighScoreExpressionsSection(expressions) {
  const list = Array.isArray(expressions) ? expressions.slice(0, 3) : [];
  if (list.length === 0) return '';
  return `
    <div class="space-y-2">
      <h4 class="text-xs font-bold uppercase tracking-wider text-teal-800">💎 고득점 추천 표현 3가지 (단어장에 바로 저장)</h4>
      <div class="grid grid-cols-1 gap-2">
        ${list.map(exp => `
          <div class="rounded-xl border border-teal-200 bg-teal-50/50 p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
            <div class="space-y-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs sm:text-sm font-bold text-slate-900">${escapeHtml(exp.expression || exp.word || '')}</span>
                <span class="text-xs font-semibold text-teal-800 bg-white px-2 py-0.5 rounded-md border border-teal-200">${escapeHtml(exp.meaningKo || exp.meaning || '')}</span>
              </div>
              ${exp.example ? `<p class="text-xs text-slate-600 italic">"${escapeHtml(exp.example)}"</p>` : ''}
            </div>
            <button type="button"
              data-ai-vocab-word="${escapeHtml(exp.expression || exp.word || '')}"
              data-ai-vocab-meaning="${escapeHtml(exp.meaningKo || exp.meaning || '')}"
              data-ai-vocab-example="${escapeHtml(exp.example || '')}"
              class="shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition cursor-pointer">
              + 단어장 추가
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

export function initGeminiSettings() {
  el.btnAiSettings.addEventListener('click', () => openAiSettingsModal());
  el.btnCloseAiModal.addEventListener('click', closeAiSettingsModal);
  el.btnCancelAiModal.addEventListener('click', closeAiSettingsModal);
  el.aiSettingsModal.addEventListener('click', (e) => {
    if (e.target === el.aiSettingsModal) closeAiSettingsModal();
  });
  el.btnToggleKeyVisibility.addEventListener('click', () => {
    const isPw = el.inputGeminiApiKey.type === 'password';
    el.inputGeminiApiKey.type = isPw ? 'text' : 'password';
    el.btnToggleKeyVisibility.textContent = isPw ? '숨기기' : '보기';
  });
  el.inputGeminiModel.addEventListener('input', () => {
    el.previewModelName.textContent = el.inputGeminiModel.value.trim() || 'gemini-4-hydrogen';
  });
  el.btnSaveApiKey.addEventListener('click', () => {
    const key = el.inputGeminiApiKey.value.trim();
    const model = el.inputGeminiModel.value.trim() || 'gemini-4-hydrogen';
    if (!key) {
      showAiSettingsFeedback('API 키를 입력해주세요. 키를 삭제하려면 "키 삭제" 버튼을 누르세요.', true);
      return;
    }
    state.geminiApiKey = key;
    state.geminiModel = model;
    try {
      localStorage.setItem(STORAGE_KEYS.geminiApiKey, key);
      localStorage.setItem(STORAGE_KEYS.geminiModel, model);
    } catch (err) {
      if (isQuotaExceededError(err)) showStorageQuotaToast();
      showAiSettingsFeedback('브라우저 저장 공간에 저장하지 못했습니다.', true);
      return;
    }
    updateAiHeaderUI();
    showAiSettingsFeedback('브라우저 localStorage(pte_gemini_api_key)에 안전하게 저장되었습니다.', false);
    setTimeout(closeAiSettingsModal, 700);
  });
  el.btnClearApiKey.addEventListener('click', () => {
    state.geminiApiKey = '';
    state.geminiModel = 'gemini-4-hydrogen';
    try {
      localStorage.removeItem(STORAGE_KEYS.geminiApiKey);
      localStorage.removeItem(STORAGE_KEYS.geminiModel);
    } catch (err) {}
    el.inputGeminiApiKey.value = '';
    el.inputGeminiModel.value = 'gemini-4-hydrogen';
    el.previewModelName.textContent = 'gemini-4-hydrogen';
    updateAiHeaderUI();
    showAiSettingsFeedback('저장된 API 키가 삭제되었습니다.', false);
  });
}
