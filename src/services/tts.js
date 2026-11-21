import { STORAGE_KEYS, NEURAL_REGEX } from '../config/constants.js';
import { saveStorage } from '../utils/storage.js';
import { state, el } from '../state/store.js';
import { ensureAudioContext, releaseMicrophoneStream } from './audio.js';
import {
  isGeminiTtsActive,
  getGeminiTtsVoiceName,
  fetchOrGetCachedGeminiTts,
  syncGeminiTtsUI,
} from './gemini.js';
import { getCurrentQuestion } from '../features/speaking.js';

export function isNeuralVoice(voice) {
  if (!voice) return false;
  return NEURAL_REGEX.test(`${voice.name} ${voice.voiceURI || ''}`);
}

export function scoreVoice(voice, targetAccent) {
  let score = 0;
  if (isNeuralVoice(voice)) score += 100;
  if (voice.localService === false) score += 10;
  const lang = (voice.lang || '').toLowerCase();
  const t = (targetAccent || 'all').toLowerCase();
  if (t !== 'all') {
    if (lang === t || (t === 'en-au' && lang === 'en-nz')) {
      score += 50;
    } else if (lang.startsWith(t.slice(0, 5))) {
      score += 35;
    }
  } else {
    if (lang === 'en-au' || lang === 'en-nz') score += 15;
    else if (lang === 'en-gb') score += 12;
    else if (lang === 'en-us') score += 10;
  }
  return score;
}

export function getFilteredRankedVoices() {
  const englishVoices = (state.allVoices || []).filter(v => /^en([-_]|$)/i.test(v.lang || ''));
  const accent = state.ttsAccent;

  let filtered = englishVoices;
  if (accent !== 'all') {
    const target = accent.toLowerCase();
    const matching = englishVoices.filter(v => {
      const l = (v.lang || '').toLowerCase();
      if (target === 'en-au') return l.startsWith('en-au') || l.startsWith('en-nz');
      return l.startsWith(target);
    });
    if (matching.length > 0) filtered = matching;
  }

  return [...filtered].sort((a, b) => scoreVoice(b, accent) - scoreVoice(a, accent));
}

export function syncVoiceDropdowns() {
  const ranked = getFilteredRankedVoices();
  const selects = [el.rsVoiceSelect, el.rlVoiceSelect];
  const accentSelects = [el.rsAccentSelect, el.rlAccentSelect];
  const rateSelects = [el.rsRateSelect, el.rlRateSelect];
  const badges = [el.rsVoiceQualityBadge, el.rlVoiceQualityBadge];

  accentSelects.forEach(s => { s.value = state.ttsAccent; });
  rateSelects.forEach(s => { s.value = String(state.ttsRate); });

  // Ensure chosen voiceUri exists in ranked list; otherwise auto-pick top neural voice
  let selectedVoice = ranked.find(v => v.voiceURI === state.ttsVoiceUri);
  if (!selectedVoice && ranked.length > 0) {
    selectedVoice = ranked[0];
    state.ttsVoiceUri = selectedVoice.voiceURI;
    saveStorage(STORAGE_KEYS.ttsVoiceUri, state.ttsVoiceUri);
  }

  selects.forEach(sel => {
    sel.innerHTML = '';
    if (ranked.length === 0) {
      const fallbackOpts = [
        { uri: 'fallback:en-AU', label: '기본 호주/NZ 영어 (en-AU)' },
        { uri: 'fallback:en-GB', label: '기본 영국 영어 (en-GB)' },
        { uri: 'fallback:en-US', label: '기본 미국 영어 (en-US)' }
      ];
      fallbackOpts.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.uri;
        opt.textContent = item.label;
        sel.appendChild(opt);
      });
      const fbKey = `fallback:${state.ttsAccent === 'all' ? 'en-AU' : state.ttsAccent}`;
      sel.value = fbKey;
    } else {
      ranked.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        const neuralTag = isNeuralVoice(v) ? '★ 고품질 · ' : '';
        opt.textContent = `${neuralTag}${v.name} (${v.lang})`;
        sel.appendChild(opt);
      });
      if (selectedVoice) {
        sel.value = selectedVoice.voiceURI;
      }
    }
  });

  const neuralActive = selectedVoice && isNeuralVoice(selectedVoice);
  badges.forEach(b => {
    if (neuralActive) {
      b.textContent = '★ 뉴럴 고품질 음성';
      b.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700';
    } else if (ranked.length > 0) {
      b.textContent = '표준 브라우저 음성';
      b.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-pte-blue';
    } else {
      b.textContent = '기본 TTS 폴백';
      b.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800';
    }
  });

  syncGeminiTtsUI();
}

export function loadVoices() {
  if (!('speechSynthesis' in window)) {
    syncVoiceDropdowns();
    return;
  }
  state.allVoices = window.speechSynthesis.getVoices() || [];
  syncVoiceDropdowns();
}

export function getSelectedVoiceObject() {
  const ranked = getFilteredRankedVoices();
  return ranked.find(v => v.voiceURI === state.ttsVoiceUri) || ranked[0] || null;
}

export function getTtsUiTargets(targetMode) {
  if (targetMode === 'retell-lecture') {
    return {
      isRL: true,
      isRS: false,
      waveBars: el.rlWaveBars,
      statusLabel: el.rlAudioStatus,
      doneText: '강의 오디오 재생 완료',
      browserPrefix: '🔊 강의 재생 중',
      browserSuffix: ' — 메모장에 필기하세요',
      geminiPrefix: '🔊 Gemini AI 강의 재생 중',
      geminiSuffix: ' — 메모장에 필기하세요'
    };
  }
  if (targetMode === 'read-aloud') {
    return {
      isRL: false,
      isRS: false,
      waveBars: el.raWaveBars,
      statusLabel: el.raAudioStatus,
      doneText: '원어민 모범 읽기 완료 — 억양·끊어 읽기를 참고해 말해보세요',
      browserPrefix: '🔊 원어민 지문 읽기 중',
      browserSuffix: ' (섀도잉/억양 집중)',
      geminiPrefix: '🔊 Gemini AI 원어민 읽기 중',
      geminiSuffix: ' (억양·끊어 읽기 참고)'
    };
  }
  if (targetMode === 'impromptu') {
    return {
      isRL: false,
      isRS: false,
      waveBars: el.impWaveBars,
      statusLabel: el.impAudioStatus,
      doneText: '모범 답변 재생 완료',
      browserPrefix: '🔊 모범 답변 재생 중',
      browserSuffix: '',
      geminiPrefix: '🔊 Gemini AI 모범 답변 재생 중',
      geminiSuffix: ''
    };
  }
  if (targetMode === 'roleplay') {
    return {
      isRL: false,
      isRS: false,
      waveBars: el.rpWaveBars,
      statusLabel: el.rpAudioStatus,
      doneText: '상대방 발화 재생 완료 · 🎤 내 답변 녹음하기를 눌러 말해보세요',
      browserPrefix: '🔊 상대방 음성 재생 중',
      browserSuffix: '',
      geminiPrefix: '🔊 Gemini AI 상대방 음성 재생 중',
      geminiSuffix: ''
    };
  }
  if (targetMode === 'weakness-drill') {
    return {
      isRL: false,
      isRS: false,
      waveBars: el.weaknessWaveBars,
      statusLabel: el.weaknessTtsStatus,
      doneText: '원어민 발음 재생 완료 · 바로 따라 말해보세요',
      browserPrefix: '🔊 취약점 교정 문장 재생 중',
      browserSuffix: '',
      geminiPrefix: '🔊 Gemini AI 교정 문장 재생 중',
      geminiSuffix: ''
    };
  }
  if (targetMode === 'yt-shadowing') {
    return {
      isRL: false,
      isRS: false,
      waveBars: el.ytsWaveBars,
      statusLabel: el.ytsPlayerStatus,
      doneText: '✅ AI 성우 원어민 발음 재생 완료 · 바로 따라 말해보세요 (광고 0초)',
      browserPrefix: '🔊 AI/브라우저 성우 재생 중',
      browserSuffix: ' (광고 0초)',
      geminiPrefix: '🔊 Gemini 3.8 Flash 성우 재생 중',
      geminiSuffix: ' (광고 0초)'
    };
  }
  if (targetMode === 'brain-pattern') {
    return {
      isRL: false,
      isRS: false,
      waveBars: el.bpWaveBars,
      statusLabel: el.bpTtsStatus,
      doneText: '✅ 원어민 뉘앙스 발음 재생 완료 · 영어를 가리고 직접 말해보세요',
      browserPrefix: '🔊 원어민 음성 재생 중',
      browserSuffix: '',
      geminiPrefix: '🔊 Gemini 3.8 Flash 원어민 재생 중',
      geminiSuffix: ''
    };
  }
  return {
    isRL: false,
    isRS: true,
    waveBars: el.rsWaveBars,
    statusLabel: el.rsAudioStatus,
    doneText: '음성 재생 완료',
    browserPrefix: '🔊 원어민 음성 재생 중',
    browserSuffix: '... 집중해서 들으세요',
    geminiPrefix: '🔊 Gemini AI 원어민 음성 재생 중',
    geminiSuffix: '... 집중해서 들으세요'
  };
}

export function cancelSpeech() {
  state.speechSessionId += 1;
  if (state.ttsFetchAbortController) {
    try { state.ttsFetchAbortController.abort(); } catch (e) {}
    state.ttsFetchAbortController = null;
  }
  if (state.ttsKeepAliveTimerId !== null) {
    clearInterval(state.ttsKeepAliveTimerId);
    state.ttsKeepAliveTimerId = null;
  }
  if (state.ttsSafetyTimerId !== null) {
    clearTimeout(state.ttsSafetyTimerId);
    state.ttsSafetyTimerId = null;
  }
  if (el.geminiTtsAudio) {
    try {
      el.geminiTtsAudio.onended = null;
      el.geminiTtsAudio.onerror = null;
      el.geminiTtsAudio.pause();
      el.geminiTtsAudio.currentTime = 0;
    } catch (e) {
      // ignore
    }
  }
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      // ignore
    }
  }
  [el.rsWaveBars, el.rlWaveBars, el.raWaveBars, el.impWaveBars].forEach(bars => {
    if (!bars) return;
    bars.classList.add('hidden');
    bars.classList.remove('flex');
  });
}

export function stopShadowingCompare(clearStatus = true) {
  state.shadowingSessionId += 1;
  if (state.shadowingDelayTimerId !== null) {
    clearTimeout(state.shadowingDelayTimerId);
    state.shadowingDelayTimerId = null;
  }
  state.shadowingRunning = false;
  if (el.audioPlayback) {
    el.audioPlayback.onended = null;
    el.audioPlayback.onerror = null;
    try {
      el.audioPlayback.pause();
      el.audioPlayback.currentTime = 0;
    } catch (e) {
      // ignore
    }
  }
  if (el.btnShadowingCompare) {
    const span = el.btnShadowingCompare.querySelector('span');
    if (span) span.textContent = '🔄 원어민 → 내 발음 연속 비교 듣기';
  }
  if (clearStatus && el.shadowingCompareStatus) {
    el.shadowingCompareStatus.classList.add('hidden');
    el.shadowingCompareStatus.textContent = '';
  }
}

export function startShadowingCompare() {
  if (state.shadowingRunning) {
    stopShadowingCompare(true);
    cancelSpeech();
    return;
  }
  if (state.mode !== 'read-aloud' && state.mode !== 'repeat-sentence') return;
  const q = getCurrentQuestion();
  if (!q || !state.recordingUrl) return;

  ensureAudioContext();
  stopShadowingCompare(false);
  state.shadowingRunning = true;
  state.shadowingSessionId += 1;
  const mySession = state.shadowingSessionId;

  const btnSpan = el.btnShadowingCompare.querySelector('span');
  if (btnSpan) btnSpan.textContent = '⏹️ 비교 듣기 중지';
  el.shadowingCompareStatus.textContent = '1/2 🔊 원어민 음성 재생 중... (억양·강세·연음에 집중하세요)';
  el.shadowingCompareStatus.className = 'text-xs font-semibold rounded-lg px-3 py-2 bg-sky-50 text-pte-blue border border-sky-200 text-center';
  el.shadowingCompareStatus.classList.remove('hidden');

  const targetText = state.mode === 'read-aloud' ? q.passage : q.sentence;

  speakText(targetText, {
    targetMode: state.mode,
    onComplete: () => {
      if (!state.shadowingRunning || mySession !== state.shadowingSessionId) return;
      el.shadowingCompareStatus.textContent = '⏳ 0.7초 후 내 녹음 발음이 자동으로 이어집니다...';
      el.shadowingCompareStatus.className = 'text-xs font-semibold rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 text-center';

      state.shadowingDelayTimerId = setTimeout(async () => {
        state.shadowingDelayTimerId = null;
        if (!state.shadowingRunning || mySession !== state.shadowingSessionId) return;

        el.shadowingCompareStatus.textContent = '2/2 🎧 내 발음 재생 중... (방금 들은 원어민과 비교해 보세요)';
        el.shadowingCompareStatus.className = 'text-xs font-semibold rounded-lg px-3 py-2 bg-teal-50 text-teal-800 border border-teal-200 text-center';

        el.audioPlayback.onended = () => {
          if (mySession !== state.shadowingSessionId) return;
          state.shadowingRunning = false;
          if (btnSpan) btnSpan.textContent = '🔄 원어민 → 내 발음 연속 비교 듣기';
          el.shadowingCompareStatus.textContent = '✅ 원어민 → 내 발음 연속 비교 완료! 다시 눌러 반복 비교할 수 있습니다.';
          el.shadowingCompareStatus.className = 'text-xs font-semibold rounded-lg px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-center';
        };
        el.audioPlayback.onerror = () => {
          if (mySession !== state.shadowingSessionId) return;
          stopShadowingCompare(false);
          el.shadowingCompareStatus.textContent = '⚠️ 내 녹음 오디오 재생 중 오류가 발생했습니다.';
          el.shadowingCompareStatus.className = 'text-xs font-semibold rounded-lg px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200 text-center';
        };

        try {
          el.audioPlayback.currentTime = 0;
          await el.audioPlayback.play();
        } catch (playErr) {
          if (mySession !== state.shadowingSessionId) return;
          stopShadowingCompare(false);
          el.shadowingCompareStatus.textContent = '⚠️ 자동 재생이 차단되었습니다. 위 재생 버튼을 직접 눌러 확인해 주세요.';
          el.shadowingCompareStatus.className = 'text-xs font-semibold rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 text-center';
        }
      }, 700);
    }
  });
}

export function speakWithBrowserTts({ text, sessionId, ui, finish, fallbackNotice = '' }) {
  if (sessionId !== state.speechSessionId) return;

  const { isRS, waveBars, statusLabel, browserPrefix, browserSuffix } = ui;
  const voice = getSelectedVoiceObject();
  const effectiveLang = (voice && voice.lang) || (state.ttsAccent !== 'all' ? state.ttsAccent : 'en-AU');

  waveBars.classList.remove('hidden');
  waveBars.classList.add('flex');
  if (fallbackNotice) {
    statusLabel.textContent = `🔊 브라우저 음성 폴백 재생 중 (${voice ? voice.name : effectiveLang})`;
    if (isRS && el.rsTtsFallbackNote) {
      el.rsTtsFallbackNote.textContent = fallbackNotice;
      el.rsTtsFallbackNote.classList.remove('hidden');
    }
  } else {
    statusLabel.textContent = `${browserPrefix} (${voice ? voice.name : effectiveLang})${browserSuffix}`;
    if (isRS && el.rsTtsFallbackNote) {
      el.rsTtsFallbackNote.classList.add('hidden');
    }
  }

  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    if (isRS && el.rsTtsFallbackNote) {
      el.rsTtsFallbackNote.textContent = '이 브라우저는 SpeechSynthesis를 지원하지 않아 타이머 모드로 진행됩니다.';
      el.rsTtsFallbackNote.classList.remove('hidden');
    }
    state.ttsSafetyTimerId = setTimeout(finish, 2500);
    return;
  }

  // iOS Safari & Chromium keep-alive: nudge engine every 10s so speech never stalls silently
  state.ttsKeepAliveTimerId = setInterval(() => {
    if (sessionId !== state.speechSessionId || !('speechSynthesis' in window)) return;
    try {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    } catch (e) {
      // ignore keep-alive errors
    }
  }, 10000);

  // Split text into natural sentence chunks so mobile/desktop engines never stall mid-speech
  const chunks = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  let chunkIdx = 0;

  const speakNextChunk = () => {
    if (sessionId !== state.speechSessionId) return;
    if (chunkIdx >= chunks.length) {
      finish();
      return;
    }

    const chunk = chunks[chunkIdx];
    const chunkWords = chunk.split(/\s+/).length;
    const chunkFallbackMs = Math.min(14000, Math.max(3000, Math.round((chunkWords * 480) / state.ttsRate)));

    let chunkHandled = false;
    const advanceChunk = () => {
      if (chunkHandled || sessionId !== state.speechSessionId) return;
      chunkHandled = true;
      if (state.ttsSafetyTimerId !== null) {
        clearTimeout(state.ttsSafetyTimerId);
        state.ttsSafetyTimerId = null;
      }
      chunkIdx += 1;
      speakNextChunk();
    };

    try {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = effectiveLang;
      utterance.rate = state.ttsRate;
      utterance.pitch = 1.0;
      if (voice) utterance.voice = voice;

      utterance.onend = advanceChunk;
      utterance.onerror = advanceChunk;

      state.ttsSafetyTimerId = setTimeout(advanceChunk, chunkFallbackMs);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('SpeechSynthesis chunk error:', err);
      state.ttsSafetyTimerId = setTimeout(advanceChunk, 2000);
    }
  };

  speakNextChunk();
}

export async function speakText(text, { targetMode = 'repeat-sentence', onComplete = null } = {}) {
  ensureAudioContext();
  // iOS Safari/PWA fix: ensure mic stream is released so AirPods stay in Media mode during playback
  releaseMicrophoneStream();
  cancelSpeech();
  const sessionId = state.speechSessionId;
  const ui = getTtsUiTargets(targetMode);
  const { isRS, waveBars, statusLabel, doneText, geminiPrefix, geminiSuffix } = ui;

  const finish = () => {
    if (sessionId !== state.speechSessionId) return;
    if (state.ttsKeepAliveTimerId !== null) {
      clearInterval(state.ttsKeepAliveTimerId);
      state.ttsKeepAliveTimerId = null;
    }
    if (state.ttsSafetyTimerId !== null) {
      clearTimeout(state.ttsSafetyTimerId);
      state.ttsSafetyTimerId = null;
    }
    waveBars.classList.add('hidden');
    waveBars.classList.remove('flex');
    statusLabel.textContent = doneText;
    if (typeof onComplete === 'function') onComplete();
  };

  if (isGeminiTtsActive() && el.geminiTtsAudio) {
    const voiceName = getGeminiTtsVoiceName(state.ttsAccent, targetMode);
    const cleanText = String(text || '').trim();
    const isCached = state.ttsAudioCache.has(`${voiceName}::${cleanText}`);

    if (isRS && el.rsTtsFallbackNote) {
      el.rsTtsFallbackNote.classList.add('hidden');
    }
    waveBars.classList.remove('hidden');
    waveBars.classList.add('flex');
    statusLabel.textContent = isCached
      ? `⚡ Gemini 3.8 Flash 캐시 음성 로드 중 (${voiceName})...`
      : `✨ Gemini 3.8 Flash 원어민 음성 생성 중 (${voiceName})...`;

    try {
      const { blobUrl, fromCache } = await fetchOrGetCachedGeminiTts(cleanText, voiceName);
      if (sessionId !== state.speechSessionId) return;

      const audio = el.geminiTtsAudio;
      audio.src = blobUrl;
      audio.defaultPlaybackRate = state.ttsRate || 1.0;
      audio.playbackRate = state.ttsRate || 1.0;

      const cacheTag = fromCache ? ' · 캐시 즉시 재생 ⚡' : '';
      statusLabel.textContent = `${geminiPrefix} (${voiceName}${cacheTag})${geminiSuffix}`;

      audio.onended = () => {
        if (sessionId === state.speechSessionId) finish();
      };
      audio.onerror = () => {
        if (sessionId !== state.speechSessionId) return;
        speakWithBrowserTts({
          text,
          sessionId,
          ui,
          finish,
          fallbackNotice: 'Gemini 오디오 재생에 실패해 브라우저 기본 음성으로 전환했습니다.'
        });
      };

      await audio.play();
      audio.playbackRate = state.ttsRate || 1.0;
    } catch (err) {
      if (err?.isAborted || sessionId !== state.speechSessionId) return;
      console.warn('Gemini TTS fallback to SpeechSynthesis:', err);
      speakWithBrowserTts({
        text,
        sessionId,
        ui,
        finish,
        fallbackNotice: `Gemini TTS 폴백 (${err.message || '연결 오류'}) → 브라우저 음성으로 재생 중`
      });
    }
    return;
  }

  speakWithBrowserTts({
    text,
    sessionId,
    ui,
    finish
  });
}

export function initTtsEngine() {
  if ('speechSynthesis' in window) {
    loadVoices();
    if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  } else {
    syncVoiceDropdowns();
  }
}
