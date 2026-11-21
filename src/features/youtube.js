import {
  STORAGE_KEYS,
  DEFAULT_YT_CLIP_SETS,
  DEFAULT_YT_SHADOWING_SETS,
} from '../config/constants.js';
import { escapeHtml, sanitizeHttpUrl } from '../utils/security.js';
import { saveStorage } from '../utils/storage.js';
import { state, el } from '../state/store.js';
import {
  blobToBase64,
  callGeminiApi,
  cancelPendingYtsGrade,
  setAiLoadingState,
  renderAiErrorCard,
  renderHighScoreExpressionsSection,
} from '../services/gemini.js';
import { cancelSpeech, speakText } from '../services/tts.js';
import {
  ensureAudioContext,
  requestMicrophone,
  releaseMicrophoneStream,
  pickSupportedMimeType,
} from '../services/audio.js';
import {
  getActiveYtSet,
  getCurrentQuestion,
  resetPractice,
  renderQuestionSelector,
  renderQuestionContent,
  selectQuestion,
  renderStudyStepper,
  showInlineStatus,
} from './speaking.js';
import { formatMMSS } from './writing.js';
import { recordPracticeLog, extractAndRecordWeaknessesFromAi } from './vocab.js';

export function parseYouTubeVideoId(input) {
  const raw = (input || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProto);
    const host = url.hostname.replace(/^(?:www\.|m\.|music\.)+/i, '').toLowerCase();
    if (host === 'youtu.be') {
      const candidate = url.pathname.replace(/^\//, '').split('/')[0];
      if (/^[a-zA-Z0-9_-]{11}/.test(candidate)) return candidate.slice(0, 11);
    }
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}/.test(vParam)) return vParam.slice(0, 11);
      const pathMatch = url.pathname.match(/\/(?:shorts|live|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch) return pathMatch[1];
    }
  } catch (e) {
    // fall through to regex parser
  }

  const fallbackMatch = raw.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  return fallbackMatch ? fallbackMatch[1] : '';
}

export function toCanonicalWatchUrl(input) {
  const videoId = parseYouTubeVideoId(input);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
}

export function formatYouTubeDirectAiError(err, usedDirectVideo) {
  const msg = String(err?.message || '').trim();
  const lower = msg.toLowerCase();
  if (usedDirectVideo && (
    lower.includes('403') ||
    lower.includes('404') ||
    lower.includes('400') ||
    lower.includes('permission') ||
    lower.includes('private') ||
    lower.includes('unavailable') ||
    lower.includes('not found') ||
    lower.includes('youtube') ||
    lower.includes('file') ||
    lower.includes('uri') ||
    lower.includes('invalid argument')
  )) {
    return '비공개/일부공개 영상, 연령·지역 제한, 또는 길이/접근 제한으로 Gemini가 유튜브 URL을 직접 읽지 못했습니다. 공개(Public) 유튜브/쇼츠 링크인지 확인하거나 영상 자막(스크립트)을 함께 붙여넣어 다시 시도해주세요. (상세: ' + msg + ')';
  }
  return msg || '오류가 발생했습니다.';
}

let ytApiPromise = null;
let ytPlaySessionId = 0;

export function ensureYouTubeIframeApi() {
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        ytApiPromise = null;
        reject(new Error('YouTube IFrame API 로드 시간이 초과되었습니다.'));
      }
    }, 6000);

    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevCallback === 'function') {
        try { prevCallback(); } catch (e) {}
      }
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        resolve(window.YT);
      }
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          ytApiPromise = null;
          reject(new Error('YouTube IFrame 스크립트를 불러올 수 없습니다.'));
        }
      };
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

export function stopYouTubeClipPlayback() {
  ytPlaySessionId += 1;
  if (state.ytWatchTimerId !== null) {
    clearInterval(state.ytWatchTimerId);
    state.ytWatchTimerId = null;
  }
  if (state.ytPlayer && typeof state.ytPlayer.pauseVideo === 'function') {
    try {
      state.ytPlayer.pauseVideo();
    } catch (e) {
      // ignore
    }
  }
}

export function syncYtBlindModeUI() {
  if (!el.rlYtBlindOverlay || !el.btnRlYtBlindToggle) return;
  el.rlYtBlindOverlay.classList.toggle('hidden', !state.ytBlindMode);
  el.btnRlYtBlindToggle.setAttribute('aria-pressed', String(state.ytBlindMode));
  if (state.ytBlindMode) {
    el.btnRlYtBlindToggle.textContent = '👀 영상 화면 다시 보기';
    el.btnRlYtBlindToggle.className = 'px-2.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white border border-indigo-700 transition cursor-pointer';
  } else {
    el.btnRlYtBlindToggle.textContent = '🙈 화면 가리고 오디오만 듣기 (블라인드 모드)';
    el.btnRlYtBlindToggle.className = 'px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition cursor-pointer';
  }
}

export async function playYouTubeClipSegment(clip, { previewOnly = false, onComplete = null } = {}) {
  ensureAudioContext();
  releaseMicrophoneStream();
  cancelSpeech();
  stopYouTubeClipPlayback();

  if (!clip || !clip.videoId) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  const sessionId = ytPlaySessionId;
  const startSec = Math.max(0, Number(clip.startSec) || 0);
  const endSec = Math.max(startSec + 5, Number(clip.endSec) || startSec + 50);

  el.rlYtAudioStatus.textContent = `🎬 클립 로딩 중 (${formatMMSS(startSec)} ~ ${formatMMSS(endSec)})...`;

  const fallbackToTtsOrAdvance = (reason) => {
    if (sessionId !== ytPlaySessionId) return;
    el.rlYtAudioStatus.textContent = `⚠️ ${reason} — ${previewOnly ? '미리듣기 중단' : '스크립트 TTS/준비 타이머로 자동 전환합니다'}`;
    if (!previewOnly) {
      if (clip.script && ('speechSynthesis' in window)) {
        speakText(clip.script, { targetMode: 'retell-lecture', onComplete });
      } else {
        setTimeout(() => {
          if (sessionId === ytPlaySessionId && typeof onComplete === 'function') onComplete();
        }, 1500);
      }
    }
  };

  try {
    const YT = await ensureYouTubeIframeApi();
    if (sessionId !== ytPlaySessionId) return;

    const startWatcher = (player) => {
      if (state.ytWatchTimerId !== null) clearInterval(state.ytWatchTimerId);
      el.rlYtAudioStatus.textContent = `▶️ 재생 중 (${formatMMSS(startSec)} ~ ${formatMMSS(endSec)}) — 종료 시 자동 일시정지됩니다`;
      state.ytWatchTimerId = setInterval(() => {
        if (sessionId !== ytPlaySessionId) {
          clearInterval(state.ytWatchTimerId);
          state.ytWatchTimerId = null;
          return;
        }
        try {
          const cur = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
          const pState = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
          if (cur >= endSec - 0.15 || pState === YT.PlayerState.ENDED) {
            stopYouTubeClipPlayback();
            el.rlYtAudioStatus.textContent = `✅ 클립 구간(${formatMMSS(startSec)} ~ ${formatMMSS(endSec)}) 재생 완료`;
            if (typeof onComplete === 'function') onComplete();
          }
        } catch (pollErr) {
          stopYouTubeClipPlayback();
        }
      }, 250);
    };

    if (state.ytPlayer && typeof state.ytPlayer.loadVideoById === 'function') {
      state.ytPlayer.loadVideoById({
        videoId: clip.videoId,
        startSeconds: startSec,
        endSeconds: endSec
      });
      startWatcher(state.ytPlayer);
    } else {
      state.ytPlayer = new YT.Player('rl-yt-player', {
        videoId: clip.videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          start: startSec,
          end: endSec,
          rel: 0,
          modestbranding: 1,
          playsinline: 1
        },
        events: {
          onReady: (ev) => {
            if (sessionId !== ytPlaySessionId) return;
            try {
              ev.target.seekTo(startSec, true);
              ev.target.playVideo();
              startWatcher(ev.target);
            } catch (e) {
              fallbackToTtsOrAdvance('YouTube 재생 시작 실패');
            }
          },
          onStateChange: (ev) => {
            if (sessionId !== ytPlaySessionId) return;
            if (ev.data === YT.PlayerState.ENDED) {
              stopYouTubeClipPlayback();
              el.rlYtAudioStatus.textContent = `✅ 클립 구간(${formatMMSS(startSec)} ~ ${formatMMSS(endSec)}) 재생 완료`;
              if (typeof onComplete === 'function') onComplete();
            }
          },
          onError: () => {
            fallbackToTtsOrAdvance('임베드가 제한되었거나 재생할 수 없는 영상입니다');
          }
        }
      });
    }
  } catch (err) {
    fallbackToTtsOrAdvance(err.message || 'YouTube 플레이어를 불러올 수 없습니다');
  }
}

export function renderYtClipSetsAndClips() {
  const sets = Array.isArray(state.ytClipSets) && state.ytClipSets.length > 0
    ? state.ytClipSets
    : DEFAULT_YT_CLIP_SETS;
  const activeSet = getActiveYtSet() || sets[0];
  if (activeSet) state.activeYtSetId = activeSet.id;

  el.rlYtSetsSelect.innerHTML = '';
  sets.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.title} (${(s.clips || []).length} 클립)`;
    el.rlYtSetsSelect.appendChild(opt);
  });
  if (activeSet) el.rlYtSetsSelect.value = activeSet.id;

  el.rlYtOverallSummary.innerHTML = activeSet
    ? `<strong class="text-sky-900 block mb-1">📋 인터뷰 전체 요약:</strong>${escapeHtml(activeSet.overallSummary || '')}`
    : '';

  const clips = activeSet?.clips || [];
  const currentClipIdx = Math.min(state.questionIndex['retell-lecture'] || 0, Math.max(0, clips.length - 1));
  el.rlYtClipsList.innerHTML = clips.map((c, idx) => {
    const dur = Math.max(1, (Number(c.endSec) || 60) - (Number(c.startSec) || 0));
    const active = idx === currentClipIdx;
    const borderCls = active
      ? 'border-pte-blue bg-sky-50/90 ring-1 ring-pte-blue'
      : 'border-slate-200 bg-white hover:bg-slate-50';
    return `
      <button type="button" data-yt-clip-idx="${idx}"
        class="w-full min-w-0 overflow-hidden text-left rounded-xl border ${borderCls} p-3 transition cursor-pointer space-y-1.5">
        <div class="flex items-center justify-between gap-2 min-w-0">
          <span class="text-xs sm:text-sm font-bold text-slate-900 truncate min-w-0">${escapeHtml(c.title)}</span>
          <span class="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 tabular-nums">
            ${formatMMSS(c.startSec)} ~ ${formatMMSS(c.endSec)} (${dur}초)
          </span>
        </div>
        <div class="flex flex-wrap gap-1">
          ${(c.keywords || []).slice(0, 4).map(k => `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">${escapeHtml(k)}</span>`).join('')}
        </div>
      </button>
    `;
  }).join('');

  const activeClip = clips[currentClipIdx];
  if (activeClip) {
    const dur = Math.max(1, (Number(activeClip.endSec) || 60) - (Number(activeClip.startSec) || 0));
    el.rlYtActiveClipLabel.textContent = `${activeClip.title} · ${formatMMSS(activeClip.startSec)}~${formatMMSS(activeClip.endSec)} (${dur}초)`;
  } else {
    el.rlYtActiveClipLabel.textContent = '선택된 클립 없음';
  }
  syncYtBlindModeUI();
}

export function renderRetellLectureSourceUI() {
  const isYt = state.rlSourceMode === 'youtube';
  el.rlAcademicModeBox.classList.toggle('hidden', isYt);
  el.rlYoutubeModeBox.classList.toggle('hidden', !isYt);

  el.btnRlModeAcademic.className = !isYt
    ? 'flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold bg-white text-pte-blue shadow-xs transition cursor-pointer'
    : 'flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer';
  el.btnRlModeYoutube.className = isYt
    ? 'flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold bg-white text-pte-blue shadow-xs transition cursor-pointer'
    : 'flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer';

  if (isYt) {
    renderYtClipSetsAndClips();
  }
}

export function switchRlSourceMode(newSourceMode) {
  if (state.rlSourceMode === newSourceMode) return;
  resetPractice(true);
  state.rlSourceMode = newSourceMode;
  state.questionIndex['retell-lecture'] = 0;
  renderQuestionSelector();
  renderQuestionContent();
}

export async function extractYouTubeClipsWithAi() {
  if (state.ytExtracting) return;
  const urlInput = (el.rlYtUrlInput.value || '').trim();
  const topicFocus = (el.rlYtTopicInput.value || '').trim();
  const transcript = (el.rlYtTranscriptInput.value || '').trim();
  const videoId = parseYouTubeVideoId(urlInput);
  const canonicalWatchUrl = toCanonicalWatchUrl(videoId);

  if (!videoId || !canonicalWatchUrl) {
    showInlineStatus(el.rlYtExtractStatus, '올바른 유튜브/쇼츠 URL(예: https://www.youtube.com/watch?v=... 또는 /shorts/...) 또는 11자리 영상 ID를 입력해주세요.', 'error');
    return;
  }

  const hasTranscript = transcript.length >= 20;
  const schemaInstruction = [
    `\nExtract 3 to 5 high-value spoken segments ideal for PTE Retell Lecture practice (for longer videos aim for 45 to 60 seconds per clip; for Shorts under 60s extract 1 to 3 concise segments matching actual speech timestamps).`,
    `Respond strictly in JSON matching this schema:`,
    `{`,
    `  "setTitle": "<concise English title summarizing the video>",`,
    `  "overallSummary": "<2-3 sentences overall summary in Korean>",`,
    `  "clips": [`,
    `    {`,
    `      "title": "<short descriptive clip title>",`,
    `      "startSec": <integer start seconds>,`,
    `      "endSec": <integer end seconds>,`,
    `      "keywords": ["<keyword1>", "<keyword2>", "<keyword3>", "<keyword4>", "<keyword5>"],`,
    `      "script": "<clean English transcript spoken in this segment>",`,
    `      "modelAnswer": "<PTE Retell Lecture 4-sentence model summary in English>",`,
    `      "translation": "<concise Korean summary of this segment>"`,
    `    }`,
    `  ]`,
    `}`
  ].join('\n');

  const parts = hasTranscript
    ? [{
        text: [
          `You are a PTE Academic Retell Lecture curriculum expert.`,
          `Analyze the YouTube interview/lecture transcript below (Video ID: ${videoId}, URL: ${canonicalWatchUrl})${topicFocus ? ` focusing especially on "${topicFocus}"` : ''}.`,
          `If timestamps appear in the transcript, map startSec and endSec accurately in seconds; otherwise estimate natural timestamps starting from 15s onward.`,
          `Transcript:\n"""\n${transcript.slice(0, 12000)}\n"""`,
          schemaInstruction
        ].join('\n')
      }]
    : [
        { fileData: { fileUri: canonicalWatchUrl } },
        {
          text: [
            `You are a PTE Academic Retell Lecture curriculum expert.`,
            `Watch and listen directly to the attached YouTube video (${canonicalWatchUrl})${topicFocus ? ` focusing especially on "${topicFocus}"` : ''}.`,
            `Identify the exact spoken startSec and endSec timestamps in integer seconds and transcribe the speech verbatim for each extracted clip.`,
            schemaInstruction
          ].join('\n')
        }
      ];

  state.ytExtracting = true;
  el.btnRlYtExtract.disabled = true;
  el.btnRlYtExtract.classList.add('opacity-60');
  showInlineStatus(
    el.rlYtExtractStatus,
    hasTranscript
      ? `입력한 자막을 바탕으로 Gemini AI (${state.geminiModel || 'gemini-4-hydrogen'})가 핵심 클립을 추출 중입니다...`
      : `자막 없이 영상 오디오를 직접 분석 중입니다 (${canonicalWatchUrl})...`,
    'info'
  );

  try {
    const result = await callGeminiApi(parts);
    const rawClips = Array.isArray(result.clips) ? result.clips : [];
    if (rawClips.length === 0) {
      throw new Error('추출된 클립이 없습니다. 공개 영상 여부 또는 자막 내용을 확인해주세요.');
    }
    const stamp = Date.now().toString().slice(-4);
    const sanitizedClips = rawClips.slice(0, 5).map((c, idx) => {
      const startSec = Math.max(0, Math.round(Number(c.startSec) || (idx * 30)));
      let endSec = Math.round(Number(c.endSec) || (startSec + 45));
      if (endSec <= startSec + 4) endSec = startSec + 15;
      if (endSec - startSec > 65) endSec = startSec + 60;
      return {
        id: `YT-${stamp}-${idx + 1}`,
        title: String(c.title || `Clip ${idx + 1}`).trim(),
        startSec,
        endSec,
        keywords: Array.isArray(c.keywords) ? c.keywords.map(k => String(k).trim()).filter(Boolean) : [],
        script: String(c.script || '').trim(),
        modelAnswer: String(c.modelAnswer || '').trim(),
        translation: String(c.translation || '').trim()
      };
    });

    const newSet = {
      id: `yt-set-${Date.now()}`,
      title: String(result.setTitle || `YouTube (${videoId})`).trim(),
      videoId,
      url: canonicalWatchUrl,
      overallSummary: String(result.overallSummary || '').trim(),
      createdAt: Date.now(),
      clips: sanitizedClips
    };

    state.ytClipSets = [newSet, ...state.ytClipSets];
    state.activeYtSetId = newSet.id;
    state.questionIndex['retell-lecture'] = 0;
    saveStorage(STORAGE_KEYS.ytClipSets, state.ytClipSets);

    showInlineStatus(el.rlYtExtractStatus, `✅ '${newSet.title}' (${sanitizedClips.length}개 클립) 생성 및 저장 완료!`, 'success');
    if (state.mode === 'retell-lecture' && state.rlSourceMode === 'youtube') {
      resetPractice(true);
      renderQuestionSelector();
      renderQuestionContent();
    }
  } catch (err) {
    if (err.isMissingKey) {
      el.rlYtExtractStatus.classList.add('hidden');
    } else {
      showInlineStatus(el.rlYtExtractStatus, `⚠️ 클립 추출 실패: ${formatYouTubeDirectAiError(err, !hasTranscript)}`, 'error');
    }
  } finally {
    state.ytExtracting = false;
    el.btnRlYtExtract.disabled = false;
    el.btnRlYtExtract.classList.remove('opacity-60');
  }
}

let ytsPlaySessionId = 0;

export function getActiveYtsSet() {
  const sets = Array.isArray(state.ytShadowingSets) && state.ytShadowingSets.length > 0
    ? state.ytShadowingSets
    : DEFAULT_YT_SHADOWING_SETS;
  return sets.find(s => s.id === state.ytsActiveSetId) || sets[0];
}

export function getActiveYtsSentence() {
  const set = getActiveYtsSet();
  if (!set || !Array.isArray(set.sentences) || set.sentences.length === 0) return null;
  const safeIdx = Math.max(0, Math.min(state.ytsSentenceIndex, set.sentences.length - 1));
  state.ytsSentenceIndex = safeIdx;
  return { set, idx: safeIdx, sentence: set.sentences[safeIdx] };
}

export function stopYtsPlayback() {
  ytsPlaySessionId += 1;
  if (state.ytsWatchTimerId !== null) {
    clearInterval(state.ytsWatchTimerId);
    state.ytsWatchTimerId = null;
  }
  if (state.ytsPlayer && typeof state.ytsPlayer.pauseVideo === 'function') {
    try {
      state.ytsPlayer.pauseVideo();
    } catch (e) {
      // ignore
    }
  }
}

export function stopYtsComparePlayback(resetStatus = true) {
  state.ytsCompareActive = false;
  if (el.ytsAudioPlayback && !el.ytsAudioPlayback.paused) {
    try {
      el.ytsAudioPlayback.pause();
      el.ytsAudioPlayback.currentTime = 0;
    } catch (e) {}
  }
  if (resetStatus && el.ytsCompareStatus) {
    el.ytsCompareStatus.textContent = '';
  }
}

export function setYtsPlaybackRate(rate) {
  state.ytsRate = rate === 0.8 ? 0.8 : 1.0;
  if (el.btnYtsRate08) {
    el.btnYtsRate08.className = state.ytsRate === 0.8
      ? 'px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-pte-blue shadow-2xs transition cursor-pointer'
      : 'px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer';
  }
  if (el.btnYtsRate10) {
    el.btnYtsRate10.className = state.ytsRate === 1.0
      ? 'px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-pte-blue shadow-2xs transition cursor-pointer'
      : 'px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer';
  }
  if (state.ytsPlayer && typeof state.ytsPlayer.setPlaybackRate === 'function') {
    try {
      state.ytsPlayer.setPlaybackRate(state.ytsRate);
    } catch (e) {}
  }
}

export function renderYtsLoopUI() {
  if (!el.btnYtsLoop) return;
  el.btnYtsLoop.setAttribute('aria-pressed', String(state.ytsLoop));
  if (state.ytsLoop) {
    el.btnYtsLoop.textContent = '🔁 구간 반복: ON';
    el.btnYtsLoop.className = 'px-3 py-2 rounded-xl text-xs font-bold border border-indigo-300 bg-indigo-600 text-white shadow-xs transition cursor-pointer';
  } else {
    el.btnYtsLoop.textContent = '🔁 구간 반복: OFF';
    el.btnYtsLoop.className = 'px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition cursor-pointer';
  }
}

export function syncYtsVocabButtonState(btnEl, sentence) {
  if (!btnEl || !sentence) return;
  const word = (sentence.enText || '').trim();
  btnEl.dataset.aiVocabWord = word;
  btnEl.dataset.aiVocabMeaning = (sentence.koMeaning || '').trim();
  btnEl.dataset.aiVocabExample = (sentence.stressAndLinkingTip || '').trim();

  const inVocab = Array.isArray(state.vocabList)
    && state.vocabList.some(v => v && typeof v.word === 'string' && v.word.toLowerCase() === word.toLowerCase());
  if (inVocab) {
    btnEl.textContent = '✓ 단어장 저장됨';
    btnEl.disabled = true;
    btnEl.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default';
  } else {
    btnEl.textContent = '+ 단어장 추가';
    btnEl.disabled = false;
    btnEl.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition cursor-pointer';
  }
}

export function renderYtsSetSelector() {
  if (!el.ytsSetSelect) return;
  const sets = Array.isArray(state.ytShadowingSets) && state.ytShadowingSets.length > 0
    ? state.ytShadowingSets
    : DEFAULT_YT_SHADOWING_SETS;
  const activeSet = getActiveYtsSet();
  if (activeSet) state.ytsActiveSetId = activeSet.id;

  el.ytsSetSelect.innerHTML = sets.map(s => `
    <option value="${escapeHtml(s.id)}" ${s.id === state.ytsActiveSetId ? 'selected' : ''}>
      ${escapeHtml(s.title)} (${(s.sentences || []).length}문장)
    </option>
  `).join('');

  if (el.btnYtsDeleteSet) {
    el.btnYtsDeleteSet.disabled = sets.length <= 1 && sets[0]?.id === DEFAULT_YT_SHADOWING_SETS[0].id;
  }
}

export function renderYtsSentenceList() {
  if (!el.ytsSentenceList) return;
  const info = getActiveYtsSentence();
  if (!info) {
    el.ytsSentenceList.innerHTML = '<p class="text-xs text-slate-500 p-4 text-center">문장이 없습니다.</p>';
    if (el.ytsSentenceCountBadge) el.ytsSentenceCountBadge.textContent = '0문장';
    return;
  }

  const { set, idx } = info;
  if (el.ytsSentenceCountBadge) {
    el.ytsSentenceCountBadge.textContent = `${set.sentences.length}문장`;
  }

  el.ytsSentenceList.innerHTML = set.sentences.map((s, i) => {
    const active = i === idx;
    const dur = Math.max(1, Math.round((Number(s.endSec) || 0) - (Number(s.startSec) || 0)));
    const sitTag = (s.situationTag || '').trim();
    return `
      <div role="button" tabindex="0" data-yts-idx="${i}"
        class="w-full text-left rounded-xl border p-3 transition cursor-pointer space-y-1.5 ${
          active
            ? 'border-pte-blue bg-sky-50/85 ring-1 ring-pte-blue/40 shadow-xs'
            : 'border-slate-200 bg-slate-50/60 hover:bg-white hover:border-slate-300'
        }">
        <div class="flex flex-wrap items-center justify-between gap-1.5">
          <div class="flex flex-wrap items-center gap-1.5 min-w-0">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${active ? 'bg-pte-blue text-white' : 'bg-slate-200 text-slate-700'}">
              문장 ${i + 1}
            </span>
            ${sitTag ? `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-100 text-teal-800">${escapeHtml(sitTag)}</span>` : ''}
            <span class="text-[11px] font-bold tabular-nums text-slate-500">
              ${escapeHtml(formatMMSS(s.startSec))}~${escapeHtml(formatMMSS(s.endSec))} (${dur}s)
            </span>
          </div>
          <button type="button" data-yts-tts="${i}"
            class="min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition cursor-pointer shrink-0">
            🔊 AI 성우
          </button>
        </div>
        <p class="text-xs sm:text-sm font-bold text-slate-900 leading-snug line-clamp-2">${escapeHtml(s.enText || '')}</p>
        ${s.koMeaning ? `<p class="text-[11px] text-slate-500 truncate">${escapeHtml(s.koMeaning)}</p>` : ''}
      </div>
    `;
  }).join('');
}

export function renderYtsActiveSentence() {
  const info = getActiveYtsSentence();
  if (!info) return;
  const { set, idx, sentence } = info;
  const start = Math.max(0, Number(sentence.startSec) || 0);
  const end = Math.max(start + 1, Number(sentence.endSec) || start + 5);
  const dur = Math.round(end - start);

  if (el.ytsStartTimeLabel) el.ytsStartTimeLabel.textContent = `${formatMMSS(start)} (${start}s)`;
  if (el.ytsEndTimeLabel) el.ytsEndTimeLabel.textContent = `${formatMMSS(end)} (${end}s)`;
  if (el.ytsActiveBadge) {
    el.ytsActiveBadge.textContent = `문장 ${idx + 1} / ${set.sentences.length} · ${dur}초 (${formatMMSS(start)}~${formatMMSS(end)})`;
  }
  if (el.ytsActiveSituationBadge) {
    const sit = (sentence.situationTag || '').trim();
    el.ytsActiveSituationBadge.textContent = sit;
    el.ytsActiveSituationBadge.classList.toggle('hidden', !sit);
  }
  if (el.ytsActiveEn) el.ytsActiveEn.textContent = sentence.enText || '';
  if (el.ytsActiveKo) el.ytsActiveKo.textContent = sentence.koMeaning || '';
  if (el.ytsActiveTip) {
    el.ytsActiveTip.innerHTML = `<strong class="text-amber-900">💡 강세 · 연음 팁:</strong> ${escapeHtml(sentence.stressAndLinkingTip || '원어민의 강세와 연음 연결을 그대로 따라 말해보세요.')}`;
  }

  if (el.btnYtsPrev) el.btnYtsPrev.disabled = idx <= 0;
  if (el.btnYtsNext) el.btnYtsNext.disabled = idx >= set.sentences.length - 1;

  syncYtsVocabButtonState(el.btnYtsVocab, sentence);
  syncYtsVocabButtonState(el.btnYtsPostVocab, sentence);
}

export function resetYtsSentenceRecordingState() {
  cancelPendingYtsGrade();
  stopYtsComparePlayback(true);
  stopYtsRecording(true);
  if (state.ytsRecordedUrl) {
    try { URL.revokeObjectURL(state.ytsRecordedUrl); } catch (e) {}
    state.ytsRecordedUrl = '';
  }
  state.ytsRecordedBlob = null;
  if (el.ytsPlaybackBox) el.ytsPlaybackBox.classList.add('hidden');
  if (el.ytsAudioPlayback) {
    el.ytsAudioPlayback.removeAttribute('src');
    el.ytsAudioPlayback.load();
  }
  if (el.ytsAiResult) {
    el.ytsAiResult.classList.add('hidden');
    el.ytsAiResult.innerHTML = '';
  }
  if (el.ytsRecordStatus) {
    el.ytsRecordStatus.textContent = '문장을 들은 뒤 따라 말하고 녹음해 보세요.';
  }
}

export function renderYtsWorkspace() {
  renderYtsSetSelector();
  renderYtsSentenceList();
  renderYtsActiveSentence();
  renderYtsLoopUI();
  setYtsPlaybackRate(state.ytsRate);
}

export function selectYtsSentence(nextIdx) {
  const set = getActiveYtsSet();
  if (!set || !Array.isArray(set.sentences) || set.sentences.length === 0) return;
  const bounded = Math.max(0, Math.min(nextIdx, set.sentences.length - 1));
  stopYtsPlayback();
  cancelSpeech();
  resetYtsSentenceRecordingState();
  state.ytsSentenceIndex = bounded;
  if (el.ytsTimeSaveBadge) el.ytsTimeSaveBadge.classList.add('hidden');
  renderYtsSentenceList();
  renderYtsActiveSentence();
  const s = set.sentences[bounded];
  if (el.ytsPlayerStatus && s) {
    el.ytsPlayerStatus.textContent = `선택됨: 문장 ${bounded + 1} (${formatMMSS(s.startSec)} ~ ${formatMMSS(s.endSec)}) — ▶️ 구간 재생을 누르세요.`;
  }
}

export function adjustYtsSentenceTime(field, deltaSec) {
  const info = getActiveYtsSentence();
  if (!info) return;
  const { sentence } = info;
  const curStart = Math.max(0, Math.round(Number(sentence.startSec) || 0));
  const curEnd = Math.max(curStart + 1, Math.round(Number(sentence.endSec) || curStart + 5));

  if (field === 'start') {
    sentence.startSec = Math.max(0, Math.min(curEnd - 1, curStart + deltaSec));
  } else {
    sentence.endSec = Math.max(curStart + 1, curEnd + deltaSec);
  }

  saveStorage(STORAGE_KEYS.ytShadowingSets, state.ytShadowingSets);
  if (el.ytsTimeSaveBadge) {
    el.ytsTimeSaveBadge.textContent = '✓ 자동 저장됨';
    el.ytsTimeSaveBadge.classList.remove('hidden');
  }
  renderYtsSentenceList();
  renderYtsActiveSentence();
}

export async function playYtsSegment({ oneShot = false, onComplete = null } = {}) {
  ensureAudioContext();
  releaseMicrophoneStream();
  cancelSpeech();
  stopYouTubeClipPlayback();
  stopYtsPlayback();

  const info = getActiveYtsSentence();
  if (!info) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  const { set, sentence } = info;
  const videoId = set.videoId;
  const startSec = Math.max(0, Number(sentence.startSec) || 0);
  const endSec = Math.max(startSec + 1, Number(sentence.endSec) || startSec + 5);
  const sessionId = ytsPlaySessionId;

  if (!videoId) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  if (el.ytsPlayerStatus) {
    el.ytsPlayerStatus.textContent = `🎬 문장 구간 로딩 중 (${formatMMSS(startSec)} ~ ${formatMMSS(endSec)} · ${state.ytsRate}x)...`;
  }

  const handlePlayerUnavailable = (reason) => {
    if (sessionId !== ytsPlaySessionId) return;
    if (el.ytsPlayerStatus) {
      el.ytsPlayerStatus.textContent = `⚠️ ${reason} — 원어민 TTS 음성으로 대체 재생합니다.`;
    }
    if (sentence.enText) {
      speakText(sentence.enText, {
        targetMode: 'repeat-sentence',
        onComplete: () => {
          if (sessionId === ytsPlaySessionId && typeof onComplete === 'function') onComplete();
        }
      });
    } else if (typeof onComplete === 'function') {
      onComplete();
    }
  };

  try {
    const YT = await ensureYouTubeIframeApi();
    if (sessionId !== ytsPlaySessionId) return;

    const startWatcher = (player) => {
      if (state.ytsWatchTimerId !== null) clearInterval(state.ytsWatchTimerId);
      if (typeof player.setPlaybackRate === 'function') {
        try { player.setPlaybackRate(state.ytsRate); } catch (e) {}
      }
      if (el.ytsPlayerStatus) {
        el.ytsPlayerStatus.textContent = state.ytsLoop && !oneShot
          ? `🔁 구간 반복 중 (${formatMMSS(startSec)} ~ ${formatMMSS(endSec)} · ${state.ytsRate}x)`
          : `▶️ 재생 중 (${formatMMSS(startSec)} ~ ${formatMMSS(endSec)} · ${state.ytsRate}x) — 종료 시 자동 정지`;
      }

      state.ytsWatchTimerId = setInterval(() => {
        if (sessionId !== ytsPlaySessionId) {
          clearInterval(state.ytsWatchTimerId);
          state.ytsWatchTimerId = null;
          return;
        }
        try {
          const cur = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
          const pState = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
          if (cur >= endSec - 0.12 || pState === YT.PlayerState.ENDED) {
            if (state.ytsLoop && !oneShot) {
              player.seekTo(startSec, true);
              player.playVideo();
            } else {
              stopYtsPlayback();
              if (el.ytsPlayerStatus) {
                el.ytsPlayerStatus.textContent = `✅ 문장 구간(${formatMMSS(startSec)} ~ ${formatMMSS(endSec)}) 재생 완료`;
              }
              if (typeof onComplete === 'function') onComplete();
            }
          }
        } catch (err) {
          stopYtsPlayback();
        }
      }, 120);
    };

    if (state.ytsPlayer && typeof state.ytsPlayer.seekTo === 'function' && state.ytsLoadedVideoId === videoId) {
      // Do not call loadVideoById for the same videoId — seek directly to minimize YouTube ad re-triggers
      if (typeof state.ytsPlayer.setPlaybackRate === 'function') {
        try { state.ytsPlayer.setPlaybackRate(state.ytsRate); } catch (e) {}
      }
      state.ytsPlayer.seekTo(startSec, true);
      state.ytsPlayer.playVideo();
      startWatcher(state.ytsPlayer);
    } else if (state.ytsPlayer && typeof state.ytsPlayer.loadVideoById === 'function') {
      state.ytsLoadedVideoId = videoId;
      state.ytsPlayer.loadVideoById({
        videoId,
        startSeconds: startSec
      });
      startWatcher(state.ytsPlayer);
    } else {
      state.ytsLoadedVideoId = videoId;
      state.ytsPlayer = new YT.Player('yts-player', {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          start: startSec,
          rel: 0,
          modestbranding: 1,
          playsinline: 1
        },
        events: {
          onReady: (ev) => {
            if (sessionId !== ytsPlaySessionId) return;
            try {
              if (typeof ev.target.setPlaybackRate === 'function') {
                ev.target.setPlaybackRate(state.ytsRate);
              }
              ev.target.seekTo(startSec, true);
              ev.target.playVideo();
              startWatcher(ev.target);
            } catch (e) {
              handlePlayerUnavailable('YouTube 재생 시작 실패');
            }
          },
          onError: () => {
            handlePlayerUnavailable('임베드가 제한되었거나 오프라인 상태입니다');
          }
        }
      });
    }
  } catch (err) {
    handlePlayerUnavailable(err.message || 'YouTube 플레이어를 불러올 수 없습니다');
  }
}

export function speakYtsSentenceWithAiTts(sentenceIdx = state.ytsSentenceIndex) {
  const set = getActiveYtsSet();
  if (!set || !Array.isArray(set.sentences) || set.sentences.length === 0) return;
  const safeIdx = Math.max(0, Math.min(sentenceIdx, set.sentences.length - 1));
  if (safeIdx !== state.ytsSentenceIndex) {
    selectYtsSentence(safeIdx);
  }
  const sentence = set.sentences[safeIdx];
  if (!sentence || !sentence.enText) return;

  ensureAudioContext();
  stopYtsComparePlayback(true);
  stopYtsPlayback();
  releaseMicrophoneStream();
  speakText(sentence.enText, { targetMode: 'yt-shadowing' });
}

export function setYtsRecordingUI(isRec, msg = '') {
  state.ytsIsRecording = Boolean(isRec);
  if (!el.btnYtsRecord) return;
  if (isRec) {
    el.btnYtsRecord.className = 'min-h-[44px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-xs transition cursor-pointer flex items-center justify-center gap-2 ring-2 ring-rose-400';
    el.ytsRecordDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping';
    el.ytsRecordBtnLabel.textContent = '⏹️ 녹음 완료';
    el.btnYtsCancelRecord.classList.remove('hidden');
    el.ytsRecordTimer.classList.remove('hidden');
  } else {
    el.btnYtsRecord.className = 'min-h-[44px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-xs transition cursor-pointer flex items-center justify-center gap-2';
    el.ytsRecordDot.className = 'w-2.5 h-2.5 rounded-full bg-white/90';
    el.ytsRecordBtnLabel.textContent = '🎤 이 문장 따라 말하기';
    el.btnYtsCancelRecord.classList.add('hidden');
    el.ytsRecordTimer.classList.add('hidden');
    el.ytsRecordTimer.textContent = '00:00';
  }
  if (msg && el.ytsRecordStatus) el.ytsRecordStatus.textContent = msg;
  renderStudyStepper();
}

export function stopYtsRecording(discard = false) {
  if (state.ytsRecordTimerId) {
    clearInterval(state.ytsRecordTimerId);
    state.ytsRecordTimerId = null;
  }
  if (state.ytsMediaRecorder && state.ytsMediaRecorder.state !== 'inactive') {
    state.ytsRecordCancelFlag = Boolean(discard);
    try {
      state.ytsMediaRecorder.stop();
    } catch (e) {
      releaseMicrophoneStream();
    }
  } else {
    if (discard) releaseMicrophoneStream();
    setYtsRecordingUI(false);
  }
}

export async function toggleYtsRecording() {
  if (state.ytsIsRecording) {
    stopYtsRecording(false);
    return;
  }

  ensureAudioContext();
  stopYtsComparePlayback(true);
  stopYtsPlayback();
  cancelSpeech();

  if (el.ytsRecordStatus) el.ytsRecordStatus.textContent = '마이크 연결 중...';
  const ok = await requestMicrophone();
  if (!ok || !state.micStream || state.mode !== 'yt-shadowing') {
    releaseMicrophoneStream();
    setYtsRecordingUI(false, '마이크 권한이 없거나 장치를 찾을 수 없습니다. 권한을 허용한 뒤 다시 시도하세요.');
    return;
  }

  try {
    state.ytsAudioChunks = [];
    state.ytsRecordCancelFlag = false;
    const mime = pickSupportedMimeType();
    const options = mime ? { mimeType: mime } : undefined;
    const recorder = new MediaRecorder(state.micStream, options);
    const actualMime = (recorder.mimeType || mime || 'audio/webm').split(';')[0];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) state.ytsAudioChunks.push(ev.data);
    };

    recorder.onstop = () => {
      // iOS Safari/AirPods safety: immediately stop mic tracks so media mode restores
      releaseMicrophoneStream();
      state.ytsMediaRecorder = null;
      if (state.ytsRecordTimerId) {
        clearInterval(state.ytsRecordTimerId);
        state.ytsRecordTimerId = null;
      }

      const canceled = state.ytsRecordCancelFlag;
      state.ytsRecordCancelFlag = false;
      setYtsRecordingUI(false);

      if (canceled || state.ytsAudioChunks.length === 0) {
        state.ytsAudioChunks = [];
        if (el.ytsRecordStatus) el.ytsRecordStatus.textContent = '녹음이 취소되었습니다.';
        return;
      }

      const blob = new Blob(state.ytsAudioChunks, { type: actualMime });
      state.ytsAudioChunks = [];
      if (state.ytsRecordedUrl) {
        try { URL.revokeObjectURL(state.ytsRecordedUrl); } catch (e) {}
      }
      state.ytsRecordedBlob = blob;
      state.ytsRecordedMime = actualMime;
      state.ytsRecordedUrl = URL.createObjectURL(blob);

      if (el.ytsAudioPlayback) {
        el.ytsAudioPlayback.src = state.ytsRecordedUrl;
      }
      if (el.ytsPlaybackBox) el.ytsPlaybackBox.classList.remove('hidden');
      if (el.ytsRecordStatus) {
        el.ytsRecordStatus.textContent = '녹음 완료 · 비교 듣기 또는 AI 채점을 실행하세요.';
      }
      renderStudyStepper();
    };

    state.ytsMediaRecorder = recorder;
    recorder.start();
    state.ytsRecordStartMs = Date.now();
    setYtsRecordingUI(true, '🔴 녹음 중... 문장을 말한 뒤 [⏹️ 녹음 완료]를 누르세요.');

    state.ytsRecordTimerId = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - state.ytsRecordStartMs) / 1000);
      const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const ss = String(elapsedSec % 60).padStart(2, '0');
      if (el.ytsRecordTimer) el.ytsRecordTimer.textContent = `${mm}:${ss}`;
    }, 250);
  } catch (err) {
    releaseMicrophoneStream();
    setYtsRecordingUI(false, '녹음 시작 실패: ' + (err.message || 'AudioError'));
  }
}

export function startYtsComparePlayback() {
  if (!state.ytsRecordedUrl || !el.ytsAudioPlayback) return;
  stopYtsComparePlayback(false);
  stopYtsPlayback();
  cancelSpeech();
  releaseMicrophoneStream();

  state.ytsCompareActive = true;
  if (el.ytsCompareStatus) {
    el.ytsCompareStatus.textContent = '1/2 유튜브 원어민 구간 재생 중...';
  }

  playYtsSegment({
    oneShot: true,
    onComplete: () => {
      if (!state.ytsCompareActive) return;
      if (el.ytsCompareStatus) {
        el.ytsCompareStatus.textContent = '잠시 후 내 녹음이 이어서 재생됩니다...';
      }
      setTimeout(() => {
        if (!state.ytsCompareActive || !el.ytsAudioPlayback) return;
        if (el.ytsCompareStatus) {
          el.ytsCompareStatus.textContent = '2/2 내 발음 재생 중 — 원어민과 억양을 비교하세요!';
        }
        el.ytsAudioPlayback.currentTime = 0;
        el.ytsAudioPlayback.onended = () => {
          state.ytsCompareActive = false;
          if (el.ytsCompareStatus) {
            el.ytsCompareStatus.textContent = '✓ 원어민 vs 내 발음 비교 재생 완료';
          }
        };
        el.ytsAudioPlayback.play().catch(() => {
          state.ytsCompareActive = false;
        });
      }, 600);
    }
  });
}

export async function gradeYtsWithAi() {
  if (state.ytsAiGrading || !state.ytsRecordedBlob) return;
  const info = getActiveYtsSentence();
  if (!info) return;
  const { set, idx, sentence } = info;
  const reqSetId = set.id;
  const reqIdx = idx;

  if (state.ytsGradeAbort) {
    try { state.ytsGradeAbort.abort(); } catch (e) {}
  }
  const abortCtrl = new AbortController();
  state.ytsGradeAbort = abortCtrl;
  const reqSeq = ++state.ytsGradeSeq;
  state.ytsAiGrading = true;
  setAiLoadingState(el.ytsAiResult, el.btnYtsAiGrade, '유튜브 쉐도잉 발음·강세·연음을 분석 중입니다...');

  const prompt = [
    `You are a strict PTE Academic & Native English pronunciation coach evaluating a YouTube shadowing exercise.`,
    `Target Sentence: "${sentence.enText}"`,
    `Focus Tip: ${sentence.stressAndLinkingTip || 'Natural rhythm, stress, and linking'}`,
    `\nListen carefully to the learner audio and evaluate pronunciation accuracy, stress/rhythm matching, linking, and omissions.`,
    `Respond strictly in JSON matching this schema (feedback in Korean):`,
    `{`,
    `  "overallScore": <integer 10..90>,`,
    `  "pronunciationScore": "<e.g. 80/90>",`,
    `  "fluencyScore": "<e.g. 76/90>",`,
    `  "transcript": "<exact English transcription heard in the audio>",`,
    `  "feedbackKo": "<concise Korean coaching feedback on stress, linking, and fluency>",`,
    `  "omittedOrMispronounced": [`,
    `    { "target": "<mispronounced or missed word>", "issue": "<Korean pronunciation fix tip>" }`,
    `  ],`,
    `  "highScoreExpressions": [`,
    `    { "expression": "<useful chunk/expression from sentence>", "meaningKo": "<Korean meaning>", "example": "<example>" }`,
    `  ]`,
    `}`
  ].join('\n');

  try {
    const base64Audio = await blobToBase64(state.ytsRecordedBlob);
    const curInfo = getActiveYtsSentence();
    if (reqSeq !== state.ytsGradeSeq || state.mode !== 'yt-shadowing' || curInfo?.set?.id !== reqSetId || curInfo?.idx !== reqIdx) {
      return;
    }
    const result = await callGeminiApi([
      { text: prompt },
      { inlineData: { mimeType: state.ytsRecordedMime || 'audio/webm', data: base64Audio } }
    ], { timeoutMs: 25000, signal: abortCtrl.signal });
    const afterInfo = getActiveYtsSentence();
    if (reqSeq !== state.ytsGradeSeq || state.mode !== 'yt-shadowing' || afterInfo?.set?.id !== reqSetId || afterInfo?.idx !== reqIdx) {
      return;
    }

    const overall = Math.max(10, Math.min(90, Math.round(Number(result.overallScore) || 70)));
    const issues = Array.isArray(result.omittedOrMispronounced) ? result.omittedOrMispronounced : [];

    extractAndRecordWeaknessesFromAi(result, 'yt-shadowing');
    recordPracticeLog(`${reqSetId}-S${reqIdx + 1}`, 'yt-shadowing', sentence.enText.slice(0, 48), overall);

    el.ytsAiResult.classList.remove('hidden');
    el.ytsAiResult.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-indigo-100">
        <span class="text-xs font-extrabold text-indigo-900">✨ 유튜브 쉐도잉 AI 발음·유창성 분석</span>
        <span class="px-3 py-1 rounded-xl text-sm font-extrabold bg-indigo-600 text-white tabular-nums">${overall} / 90</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-xs text-center">
        <div class="rounded-lg bg-slate-50 border border-slate-200 p-2">
          <span class="block text-[10px] text-slate-500">발음 (Pronunciation)</span>
          <strong class="text-indigo-800">${escapeHtml(result.pronunciationScore || '-')}</strong>
        </div>
        <div class="rounded-lg bg-slate-50 border border-slate-200 p-2">
          <span class="block text-[10px] text-slate-500">유창성 · 리듬</span>
          <strong class="text-indigo-800">${escapeHtml(result.fluencyScore || '-')}</strong>
        </div>
      </div>
      ${result.transcript ? `<p class="text-xs text-slate-700 bg-slate-50 rounded-lg p-2.5 border border-slate-200"><strong>인식된 발화:</strong> ${escapeHtml(result.transcript)}</p>` : ''}
      ${result.feedbackKo ? `<p class="text-xs text-slate-800 bg-indigo-50/70 rounded-lg p-2.5 border border-indigo-100 leading-relaxed">${escapeHtml(result.feedbackKo)}</p>` : ''}
      ${issues.length > 0 ? `
        <div class="space-y-1 text-xs">
          <span class="font-bold text-rose-800 block">⚠️ 교정 포인트 (약점 리포트에 자동 기록됨)</span>
          ${issues.map(it => `<div class="rounded-lg border border-rose-200 bg-rose-50/60 px-2.5 py-1.5"><strong>${escapeHtml(it.target || '')}</strong> — ${escapeHtml(it.issue || '')}</div>`).join('')}
        </div>
      ` : ''}
      ${renderHighScoreExpressionsSection(result.highScoreExpressions)}
    `;
  } catch (err) {
    if (err?.isAborted || reqSeq !== state.ytsGradeSeq) return;
    if (err.isMissingKey) {
      el.ytsAiResult.classList.add('hidden');
    } else {
      renderAiErrorCard(el.ytsAiResult, err.message || 'AI 쉐도잉 채점 중 오류가 발생했습니다.');
    }
  } finally {
    if (state.ytsGradeAbort === abortCtrl) {
      state.ytsGradeAbort = null;
    }
    if (reqSeq === state.ytsGradeSeq) {
      state.ytsAiGrading = false;
      if (el.btnYtsAiGrade) {
        el.btnYtsAiGrade.disabled = false;
        el.btnYtsAiGrade.classList.remove('opacity-60');
      }
    }
  }
}

export async function extractYtsSentencesWithAi() {
  if (state.ytsExtracting) return;
  const urlInput = (el.ytsUrlInput?.value || '').trim();
  const transcript = (el.ytsTranscriptInput?.value || '').trim();
  const videoId = parseYouTubeVideoId(urlInput);
  const canonicalWatchUrl = toCanonicalWatchUrl(videoId);

  if (!videoId || !canonicalWatchUrl) {
    if (el.ytsExtractStatus) {
      el.ytsExtractStatus.textContent = '⚠️ 올바른 유튜브/쇼츠 URL(예: watch?v=... 또는 /shorts/...) 또는 Video ID를 입력하세요.';
    }
    return;
  }

  const hasTranscript = transcript.length >= 20;
  const schemaText = [
    `Extract 12 to 20 high-utility, practical everyday, workplace, or New Zealand life spoken English sentences suitable for shadowing practice (roughly 3 to 8 seconds per sentence). If it is a short YouTube Short under 60 seconds, extract all meaningful spoken sentences while filtering out filler noise, music, or laughter.`,
    `\nRespond strictly in JSON matching this exact schema:`,
    `{`,
    `  "setTitle": "<short Korean+English title for this shadowing set>",`,
    `  "sentences": [`,
    `    {`,
    `      "startSec": <integer start seconds>,`,
    `      "endSec": <integer end seconds, startSec + 3 to startSec + 8>,`,
    `      "situationTag": "<short 2-4 char Korean situation tag e.g. 감정표현, 부탁, 스몰토크, 의견제시, 일상설명, 업무대화>",`,
    `      "enText": "<exact English sentence spoken in this segment>",`,
    `      "koMeaning": "<natural Korean translation>",`,
    `      "stressAndLinkingTip": "<concise Korean tip on word stress, pauses, or linking sounds>"`,
    `    }`,
    `  ]`,
    `}`
  ].join('\n');

  const parts = hasTranscript
    ? [{
        text: [
          `Analyze the YouTube transcript below (Video ID: ${videoId}, URL: ${canonicalWatchUrl}).`,
          `Transcript:\n${transcript.slice(0, 14000)}`,
          schemaText
        ].join('\n')
      }]
    : [
        { fileData: { fileUri: canonicalWatchUrl } },
        {
          text: [
            `Listen carefully to the actual audio of the attached YouTube video (${canonicalWatchUrl}).`,
            `Transcribe practical spoken lines (12-20 sentences, or all meaningful sentences for a Short) with accurate integer timestamps (startSec and endSec, 3-8 seconds each), skipping filler noise.`,
            schemaText
          ].join('\n')
        }
      ];

  state.ytsExtracting = true;
  if (el.btnYtsExtract) {
    el.btnYtsExtract.disabled = true;
    el.btnYtsExtract.classList.add('opacity-60');
  }
  if (el.ytsExtractStatus) {
    el.ytsExtractStatus.textContent = hasTranscript
      ? '⏳ 입력한 자막에서 Gemini AI가 실전 회화 문장 12~20개를 추출 중입니다...'
      : `⏳ 자막 없이 영상 오디오를 직접 분석해 실전 문장 12~20개를 추출 중입니다 (${canonicalWatchUrl})...`;
  }

  try {
    const result = await callGeminiApi(parts);
    const rawSentences = Array.isArray(result?.sentences) ? result.sentences.slice(0, 20) : [];
    const normalized = rawSentences
      .map(s => {
        const startSec = Math.max(0, Math.round(Number(s.startSec) || 0));
        const endSec = Math.max(startSec + 3, Math.round(Number(s.endSec) || startSec + 5));
        return {
          startSec,
          endSec,
          situationTag: String(s.situationTag || '실전회화').trim(),
          enText: String(s.enText || '').trim(),
          koMeaning: String(s.koMeaning || '').trim(),
          stressAndLinkingTip: String(s.stressAndLinkingTip || '').trim()
        };
      })
      .filter(s => s.enText.length > 0);

    if (normalized.length === 0) {
      throw new Error('추출된 유효 문장이 없습니다. 공개 영상 여부 또는 자막을 확인해주세요.');
    }

    const newSet = {
      id: `yts-${Date.now()}`,
      title: String(result?.setTitle || `YouTube (${videoId}) 쉐도잉`).trim(),
      videoId,
      url: canonicalWatchUrl,
      createdAt: Date.now(),
      sentences: normalized
    };

    if (!Array.isArray(state.ytShadowingSets)) state.ytShadowingSets = [];
    state.ytShadowingSets.unshift(newSet);
    saveStorage(STORAGE_KEYS.ytShadowingSets, state.ytShadowingSets);
    state.ytsActiveSetId = newSet.id;
    state.ytsSentenceIndex = 0;

    if (el.ytsExtractorBox) el.ytsExtractorBox.classList.add('hidden');
    if (el.ytsExtractStatus) el.ytsExtractStatus.textContent = `✅ ${normalized.length}개 문장이 저장되었습니다!`;
    resetYtsSentenceRecordingState();
    renderYtsWorkspace();
  } catch (err) {
    if (el.ytsExtractStatus && !err.isMissingKey) {
      el.ytsExtractStatus.textContent = '❌ ' + formatYouTubeDirectAiError(err, !hasTranscript);
    }
  } finally {
    state.ytsExtracting = false;
    if (el.btnYtsExtract) {
      el.btnYtsExtract.disabled = false;
      el.btnYtsExtract.classList.remove('opacity-60');
    }
  }
}

export function initYoutubeFeature() {
  el.btnRlModeAcademic.addEventListener('click', () => switchRlSourceMode('academic'));
  el.btnRlModeYoutube.addEventListener('click', () => switchRlSourceMode('youtube'));
  el.btnRlYtExtract.addEventListener('click', extractYouTubeClipsWithAi);

  el.rlYtSetsSelect.addEventListener('change', (e) => {
    state.activeYtSetId = e.target.value;
    state.questionIndex['retell-lecture'] = 0;
    resetPractice(true);
    renderQuestionSelector();
    renderQuestionContent();
  });

  el.btnRlYtDeleteSet.addEventListener('click', () => {
    if (!state.activeYtSetId) return;
    state.ytClipSets = state.ytClipSets.filter(s => s.id !== state.activeYtSetId);
    if (state.ytClipSets.length === 0) {
      state.ytClipSets = [...DEFAULT_YT_CLIP_SETS];
      showInlineStatus(el.rlYtExtractStatus, '기본 샘플 세트를 유지하기 위해 샘플 인터뷰 세트를 복원했습니다.', 'info');
    }
    state.activeYtSetId = state.ytClipSets[0].id;
    state.questionIndex['retell-lecture'] = 0;
    saveStorage(STORAGE_KEYS.ytClipSets, state.ytClipSets);
    resetPractice(true);
    renderQuestionSelector();
    renderQuestionContent();
  });

  el.rlYtClipsList.addEventListener('click', (e) => {
    const cardBtn = e.target.closest('[data-yt-clip-idx]');
    if (!cardBtn) return;
    const idx = parseInt(cardBtn.dataset.ytClipIdx, 10) || 0;
    selectQuestion(idx);
  });

  el.btnRlYtPreviewClip.addEventListener('click', () => {
    if (state.mode !== 'retell-lecture' || state.rlSourceMode !== 'youtube') return;
    const q = getCurrentQuestion();
    if (q) playYouTubeClipSegment(q, { previewOnly: true });
  });

  el.btnRlYtBlindToggle.addEventListener('click', () => {
    state.ytBlindMode = !state.ytBlindMode;
    syncYtBlindModeUI();
  });

  // YouTube Shadowing Event Listeners
  if (el.btnYtsToggleExtractor) {
    el.btnYtsToggleExtractor.addEventListener('click', () => {
      const hidden = el.ytsExtractorBox.classList.toggle('hidden');
      el.btnYtsToggleExtractor.textContent = hidden
        ? '✨ 새 유튜브 문장 추출 열기'
        : '✨ 추출 창 닫기';
    });
  }
  if (el.ytsSetSelect) {
    el.ytsSetSelect.addEventListener('change', (e) => {
      stopYtsPlayback();
      resetYtsSentenceRecordingState();
      state.ytsActiveSetId = e.target.value;
      state.ytsSentenceIndex = 0;
      renderYtsWorkspace();
    });
  }
  if (el.btnYtsDeleteSet) {
    el.btnYtsDeleteSet.addEventListener('click', () => {
      if (!Array.isArray(state.ytShadowingSets)) return;
      stopYtsPlayback();
      resetYtsSentenceRecordingState();
      const remaining = state.ytShadowingSets.filter(s => s.id !== state.ytsActiveSetId);
      state.ytShadowingSets = remaining.length > 0 ? remaining : DEFAULT_YT_SHADOWING_SETS;
      saveStorage(STORAGE_KEYS.ytShadowingSets, state.ytShadowingSets);
      state.ytsActiveSetId = state.ytShadowingSets[0].id;
      state.ytsSentenceIndex = 0;
      renderYtsWorkspace();
    });
  }
  if (el.btnYtsExtract) {
    el.btnYtsExtract.addEventListener('click', extractYtsSentencesWithAi);
  }
  if (el.ytsSentenceList) {
    el.ytsSentenceList.addEventListener('click', (e) => {
      const ttsBtn = e.target.closest('[data-yts-tts]');
      if (ttsBtn) {
        e.stopPropagation();
        const ttsIdx = parseInt(ttsBtn.dataset.ytsTts, 10);
        if (!Number.isNaN(ttsIdx)) speakYtsSentenceWithAiTts(ttsIdx);
        return;
      }
      const btn = e.target.closest('[data-yts-idx]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.ytsIdx, 10);
      if (!Number.isNaN(idx)) selectYtsSentence(idx);
    });
  }
  if (el.btnYtsPlay) {
    el.btnYtsPlay.addEventListener('click', () => {
      stopYtsComparePlayback(true);
      playYtsSegment({ oneShot: false });
    });
  }
  if (el.btnYtsTtsPlay) {
    el.btnYtsTtsPlay.addEventListener('click', () => {
      speakYtsSentenceWithAiTts(state.ytsSentenceIndex);
    });
  }
  if (el.btnYtsPause) {
    el.btnYtsPause.addEventListener('click', () => {
      stopYtsComparePlayback(true);
      stopYtsPlayback();
      cancelSpeech();
      if (el.ytsPlayerStatus) el.ytsPlayerStatus.textContent = '⏸️ 일시정지됨';
    });
  }
  if (el.btnYtsLoop) {
    el.btnYtsLoop.addEventListener('click', () => {
      state.ytsLoop = !state.ytsLoop;
      renderYtsLoopUI();
    });
  }
  if (el.btnYtsRate08) el.btnYtsRate08.addEventListener('click', () => setYtsPlaybackRate(0.8));
  if (el.btnYtsRate10) el.btnYtsRate10.addEventListener('click', () => setYtsPlaybackRate(1.0));
  if (el.btnYtsStartMinus) el.btnYtsStartMinus.addEventListener('click', () => adjustYtsSentenceTime('start', -1));
  if (el.btnYtsStartPlus) el.btnYtsStartPlus.addEventListener('click', () => adjustYtsSentenceTime('start', 1));
  if (el.btnYtsEndMinus) el.btnYtsEndMinus.addEventListener('click', () => adjustYtsSentenceTime('end', -1));
  if (el.btnYtsEndPlus) el.btnYtsEndPlus.addEventListener('click', () => adjustYtsSentenceTime('end', 1));
  if (el.btnYtsPrev) el.btnYtsPrev.addEventListener('click', () => selectYtsSentence(state.ytsSentenceIndex - 1));
  if (el.btnYtsNext) el.btnYtsNext.addEventListener('click', () => selectYtsSentence(state.ytsSentenceIndex + 1));
  if (el.btnYtsRecord) el.btnYtsRecord.addEventListener('click', toggleYtsRecording);
  if (el.btnYtsCancelRecord) el.btnYtsCancelRecord.addEventListener('click', () => stopYtsRecording(true));
  if (el.btnYtsCompare) el.btnYtsCompare.addEventListener('click', startYtsComparePlayback);
  if (el.btnYtsAiGrade) el.btnYtsAiGrade.addEventListener('click', gradeYtsWithAi);
}
