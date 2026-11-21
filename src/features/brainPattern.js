import { STORAGE_KEYS, DEFAULT_LIVE_ACADEMY_SETS } from '../config/constants.js';
import { escapeHtml, sanitizeHttpUrl } from '../utils/security.js';
import { saveStorage } from '../utils/storage.js';
import { state, el } from '../state/store.js';
import { blobToBase64, callGeminiApi } from '../services/gemini.js';
import { cancelSpeech, speakText } from '../services/tts.js';
import {
  ensureAudioContext,
  requestMicrophone,
  releaseMicrophoneStream,
  pickSupportedMimeType,
} from '../services/audio.js';
import { switchMode, renderStudyStepper } from './speaking.js';
import { parseYouTubeVideoId, toCanonicalWatchUrl, formatYouTubeDirectAiError } from './youtube.js';
import { recordWeaknessEntry } from './vocab.js';

export function getActiveBpSet() {
  const sets = Array.isArray(state.liveAcademySets) && state.liveAcademySets.length > 0
    ? state.liveAcademySets
    : DEFAULT_LIVE_ACADEMY_SETS;
  return sets.find(s => s.id === state.bpActiveSetId) || sets[0];
}

export function saveBpProgress() {
  saveStorage(STORAGE_KEYS.liveAcademyProgress, state.bpProgress);
}

export function getBpItemChecks(setId, itemId) {
  const key = `${setId}::${itemId}`;
  const cur = state.bpProgress?.checks?.[key];
  return {
    s1: Boolean(cur?.s1),
    s2: Boolean(cur?.s2),
    s3: Boolean(cur?.s3)
  };
}

export function cleanTtsPhrase(rawText) {
  return String(rawText || '')
    .split('/')[0]
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderRoleplayMissionBar() {
  if (!el.rpMissionBar || !el.rpMissionChips) return;
  const missions = Array.isArray(state.rpMissionTargets) ? state.rpMissionTargets : [];
  if (missions.length === 0) {
    el.rpMissionBar.classList.add('hidden');
    el.rpMissionChips.innerHTML = '';
    return;
  }
  el.rpMissionBar.classList.remove('hidden');
  el.rpMissionChips.innerHTML = missions.map(m => `
    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
      m.completed
        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
        : 'bg-white text-indigo-900 border-indigo-300'
    }" title="${escapeHtml(m.en || '')}">
      <span>${m.completed ? '✓' : '🎯'}</span>
      <span>${escapeHtml(m.pattern)}</span>
      ${m.completed ? '<span class="text-[10px] font-extrabold text-emerald-700">완료</span>' : ''}
    </span>
  `).join('');
}

export function buildMissionMatcherTokens(patternText, enText) {
  const cleanPattern = String(patternText || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/~ing\b/g, ' ')
    .replace(/~/g, ' ')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stop = new Set(['something', 'verb', 'adj', 'adv', 'pp', 'p', 'a', 'the', 'to', 'for', 'of', 'in', 'on', 'with', 'this', 'that', 'you', 'i', 'she', 'he', 'it', 'they', 'we', 'are', 'is', 'am', 'be', 'do']);
  const patternWords = cleanPattern.split(' ').filter(w => w.length >= 2 && !stop.has(w));
  const cleanEnWords = String(enText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stop.has(w));

  return {
    cleanPattern,
    keywords: patternWords.length >= 2 ? patternWords : cleanEnWords.slice(0, 3)
  };
}

export function checkAndCompleteRoleplayMissions(userText) {
  if (!Array.isArray(state.rpMissionTargets) || state.rpMissionTargets.length === 0) return;
  const norm = String(userText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return;

  let changed = false;
  state.rpMissionTargets.forEach(m => {
    if (m.completed) return;
    const { cleanPattern, keywords } = buildMissionMatcherTokens(m.pattern, m.en);
    if (cleanPattern && cleanPattern.length >= 5 && norm.includes(cleanPattern)) {
      m.completed = true;
      changed = true;
      return;
    }
    if (keywords.length > 0) {
      const matchedCount = keywords.filter(kw => norm.includes(kw)).length;
      const threshold = keywords.length <= 2 ? keywords.length : Math.max(2, Math.ceil(keywords.length * 0.65));
      if (matchedCount >= threshold) {
        m.completed = true;
        changed = true;
      }
    }
  });

  if (changed) {
    renderRoleplayMissionBar();
  }
}

export function renderBpNuanceList(set) {
  if (!el.bpNuanceList || !el.btnBpToggleNuance) return;
  const open = Boolean(state.bpNuanceOpen);
  el.bpNuanceList.classList.toggle('hidden', !open);
  el.btnBpToggleNuance.setAttribute('aria-expanded', String(open));
  el.btnBpToggleNuance.textContent = open ? '뉘앙스 비교 접기 ▲' : '뉘앙스 비교 펼치기 ▼';

  const pairs = Array.isArray(set?.nuanceComparisons) ? set.nuanceComparisons : [];
  if (pairs.length === 0) {
    el.bpNuanceList.innerHTML = '<p class="text-xs text-slate-500">이 세트에는 등록된 뉘앙스 비교 카드가 없습니다.</p>';
    return;
  }

  el.bpNuanceList.innerHTML = pairs.map((n, idx) => `
    <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5 text-xs">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="px-2 py-0.5 rounded-md font-bold bg-rose-100 text-rose-800">❌ 직역 / 콩글리시</span>
        <button type="button" data-bp-speak-nuance="${idx}"
          class="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-sky-50 text-pte-blue border border-sky-200 transition cursor-pointer inline-flex items-center justify-center">
          🔊 비교 듣기
        </button>
      </div>
      <p class="text-slate-600 line-through font-medium">${escapeHtml(n.literal || '')}</p>
      <div class="space-y-1">
        <span class="inline-block px-2 py-0.5 rounded-md font-bold bg-emerald-100 text-emerald-800">✅ 원어민 표현</span>
        <p class="text-sm font-extrabold text-emerald-950">${escapeHtml(n.native || '')}</p>
      </div>
      ${n.noteKo ? `<p class="text-slate-600 leading-relaxed border-t border-slate-200/70 pt-2">${escapeHtml(n.noteKo)}</p>` : ''}
    </div>
  `).join('');
}

export function renderBpItemList(set) {
  if (!el.bpItemList) return;
  const items = Array.isArray(set?.items) ? set.items : [];

  if (el.btnBpBlindToggle) {
    el.btnBpBlindToggle.setAttribute('aria-pressed', String(state.bpBlindMode));
    if (state.bpBlindMode) {
      el.btnBpBlindToggle.textContent = '👁️ 영어 가리기 (1초 인출 모드): ON';
      el.btnBpBlindToggle.className = 'min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold border border-indigo-700 bg-indigo-600 text-white shadow-xs transition cursor-pointer shrink-0';
    } else {
      el.btnBpBlindToggle.textContent = '👁️ 영어 가리기 (1초 인출 모드): OFF';
      el.btnBpBlindToggle.className = 'min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 shadow-2xs transition cursor-pointer shrink-0';
    }
  }

  let completedCount = 0;
  items.forEach(it => {
    const chk = getBpItemChecks(set.id, it.id);
    if (chk.s1 && chk.s2 && chk.s3) completedCount += 1;
  });
  if (el.bpProgressBadge) {
    el.bpProgressBadge.textContent = `${completedCount} / ${items.length} 완료`;
  }

  if (items.length === 0) {
    el.bpItemList.innerHTML = '<p class="text-xs text-slate-500">이 세트에 문장이 없습니다.</p>';
    return;
  }

  el.bpItemList.innerHTML = items.map((it, idx) => {
    const key = `${set.id}::${it.id}`;
    const isMasked = state.bpBlindMode && !state.bpRevealedItems[key];
    const chk = getBpItemChecks(set.id, it.id);
    const isRec = state.bpItemRecordingIdx === idx;
    const fb = state.bpItemFeedbackMap[key];
    const variants = Array.isArray(it.variants) ? it.variants : [];

    return `
      <div class="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-1.5 min-w-0">
            <span class="px-2 py-0.5 rounded-md text-[11px] font-extrabold bg-indigo-600 text-white">Q${idx + 1}</span>
            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-pte-navy">${escapeHtml(it.pattern || '')}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <button type="button" data-bp-speak-item="${idx}"
              class="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-sky-50 text-pte-blue border border-sky-200 transition cursor-pointer inline-flex items-center justify-center">
              🔊 듣기
            </button>
            <button type="button" data-bp-record-item="${idx}"
              class="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer inline-flex items-center justify-center ${
                isRec
                  ? 'bg-slate-900 text-white ring-2 ring-rose-400'
                  : 'bg-rose-600 hover:bg-rose-700 text-white'
              }">
              ${isRec ? '⏹️ 녹음 완료' : '🎤 영어로 말하기'}
            </button>
            <button type="button"
              data-ai-vocab-word="${escapeHtml(it.en || it.pattern)}"
              data-ai-vocab-meaning="${escapeHtml(it.kr || '')}"
              data-ai-vocab-example="${escapeHtml(it.pattern || '')}"
              class="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition cursor-pointer inline-flex items-center justify-center">
              + 단어장
            </button>
          </div>
        </div>

        <!-- Korean Prompt -->
        <p class="text-sm sm:text-base font-extrabold text-slate-900 leading-snug">${escapeHtml(it.kr || '')}</p>

        <!-- English Model Box (Masked in 1-Second Retrieval Mode unless revealed) -->
        ${isMasked ? `
          <div class="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/70 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-semibold text-indigo-800">👁️ 1초 인출 모드: 영어를 보지 말고 먼저 입으로 내뱉어 보세요!</span>
            <button type="button" data-bp-reveal-item="${idx}"
              class="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition cursor-pointer inline-flex items-center justify-center shrink-0">
              👀 정답 보기
            </button>
          </div>
        ` : `
          <div class="rounded-xl border border-emerald-200 bg-white p-3.5 space-y-1.5">
            <p class="text-sm sm:text-base font-bold text-emerald-950">${escapeHtml(it.en || '')}</p>
            ${variants.length > 0 ? `
              <div class="pt-1 border-t border-slate-100 space-y-0.5 text-xs text-slate-600">
                ${variants.map(v => `<p>• ${escapeHtml(v)}</p>`).join('')}
              </div>
            ` : ''}
          </div>
        `}

        <!-- 3 Persistent Progress Checkboxes -->
        <div class="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-700">
          <label class="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" data-bp-check-item="${idx}" data-bp-check-step="s1" ${chk.s1 ? 'checked' : ''}
              class="rounded border-slate-300 text-pte-blue focus:ring-pte-blue" />
            <span class="font-semibold">1회 읽기</span>
          </label>
          <label class="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" data-bp-check-item="${idx}" data-bp-check-step="s2" ${chk.s2 ? 'checked' : ''}
              class="rounded border-slate-300 text-pte-blue focus:ring-pte-blue" />
            <span class="font-semibold">2회 읽기</span>
          </label>
          <label class="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" data-bp-check-item="${idx}" data-bp-check-step="s3" ${chk.s3 ? 'checked' : ''}
              class="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600" />
            <span class="font-bold text-emerald-800">3회 보지 않고 말하기</span>
          </label>
        </div>

        <!-- Spoken Attempt AI Evaluation & Audio Playback -->
        ${fb ? `
          <div class="rounded-xl border border-indigo-200 bg-white p-3.5 space-y-2 text-xs">
            ${fb.audioUrl ? `<audio controls preload="metadata" src="${escapeHtml(fb.audioUrl)}" class="w-full h-8 rounded-lg"></audio>` : ''}
            ${fb.loading ? `
              <p class="text-indigo-700 font-bold animate-pulse">🤖 Gemini AI가 직역 여부와 원어민 뉘앙스를 분석 중입니다...</p>
            ` : fb.error ? `
              <p class="text-rose-700 font-semibold">${escapeHtml(fb.error)}</p>
            ` : `
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${fb.matchedNativeNuance ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                  ${fb.matchedNativeNuance ? '✅ 원어민 뉘앙스 적중!' : '💡 직역 탈출 코칭'}
                </span>
                ${fb.transcript ? `<span class="text-slate-500">내 발화: "${escapeHtml(fb.transcript)}"</span>` : ''}
              </div>
              <p class="text-slate-800 leading-relaxed font-medium">${escapeHtml(fb.feedbackKo || '')}</p>
              ${fb.naturalUpgrade ? `
                <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                  <span class="font-bold text-emerald-900">추천 표현: ${escapeHtml(fb.naturalUpgrade)}</span>
                  <button type="button"
                    data-ai-vocab-word="${escapeHtml(fb.naturalUpgrade)}"
                    data-ai-vocab-meaning="${escapeHtml(it.kr || '원어민 패턴 교정')}"
                    data-ai-vocab-example=""
                    class="px-2 py-0.5 rounded text-[11px] font-bold bg-teal-600 hover:bg-teal-700 text-white cursor-pointer">
                    + 단어장
                  </button>
                </div>
              ` : ''}
            `}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

export function renderBpMyoList(set) {
  if (!el.bpMyoList) return;
  const prompts = Array.isArray(set?.makeYourOwnPrompts) ? set.makeYourOwnPrompts : [];
  if (prompts.length === 0) {
    el.bpMyoList.innerHTML = '<p class="text-xs text-slate-500">등록된 응용 영작 프롬프트가 없습니다.</p>';
    return;
  }

  el.bpMyoList.innerHTML = prompts.map((p, idx) => {
    const key = `${set.id}::${p.id || idx}`;
    const draft = state.bpProgress?.myoDrafts?.[key] || {};
    const userVal = draft.userText || '';
    const ai = draft.aiResult || null;
    const isVoice = state.bpMyoVoiceIdx === idx;
    const isBusy = Boolean(draft.loading);

    return `
      <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5 text-xs">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="px-2.5 py-0.5 rounded-full font-bold bg-teal-100 text-teal-800">${escapeHtml(p.pattern || '')}</span>
            <span class="font-bold text-slate-800 text-xs sm:text-sm">${escapeHtml(p.promptKo || '')}</span>
          </div>
        </div>
        <div class="flex flex-col sm:flex-row gap-2">
          <input type="text" data-bp-myo-input="${idx}" value="${escapeHtml(userVal)}"
            placeholder="위 패턴을 활용해 나만의 영어 문장을 입력하거나 음성으로 말해보세요..."
            class="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
          <div class="flex items-center gap-2 shrink-0">
            <button type="button" data-bp-myo-voice="${idx}"
              class="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer inline-flex items-center justify-center ${
                isVoice ? 'bg-slate-900 text-white ring-2 ring-rose-400' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
              }">
              ${isVoice ? '⏹️ 정지' : '🎤 음성 입력'}
            </button>
            <button type="button" data-bp-myo-grade="${idx}" ${isBusy ? 'disabled' : ''}
              class="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition cursor-pointer inline-flex items-center justify-center disabled:opacity-50">
              ${isBusy ? '교정 중...' : '✨ AI 원어민 교정'}
            </button>
          </div>
        </div>
        ${draft.error ? `<p class="text-rose-700 font-semibold">${escapeHtml(draft.error)}</p>` : ''}
        ${ai && ai.correctedEn ? `
          <div class="rounded-xl border border-emerald-200 bg-white p-3 space-y-1.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-bold text-emerald-800">✅ 원어민 (NZ 실생활/직장) 추천 문장</span>
              <div class="flex items-center gap-1.5 shrink-0">
                <button type="button" data-bp-speak-text="${escapeHtml(ai.correctedEn)}"
                  class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-50 hover:bg-sky-100 text-pte-blue border border-sky-200 cursor-pointer">
                  🔊 듣기
                </button>
                <button type="button"
                  data-ai-vocab-word="${escapeHtml(ai.correctedEn)}"
                  data-ai-vocab-meaning="${escapeHtml(ai.meaningKo || p.promptKo || '')}"
                  data-ai-vocab-example="${escapeHtml(p.pattern || '')}"
                  class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-teal-600 hover:bg-teal-700 text-white cursor-pointer">
                  + 단어장 저장
                </button>
              </div>
            </div>
            <p class="text-sm font-bold text-slate-900">${escapeHtml(ai.correctedEn)}</p>
            ${ai.explanationKo ? `<p class="text-slate-600 leading-relaxed">${escapeHtml(ai.explanationKo)}</p>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

export function getBpSelectedMissionIds(set) {
  if (!state.bpProgress.selectedMissions) state.bpProgress.selectedMissions = {};
  let selected = state.bpProgress.selectedMissions[set.id];
  if (!Array.isArray(selected)) {
    selected = (set.items || []).slice(0, 2).map(it => it.id);
    state.bpProgress.selectedMissions[set.id] = selected;
    saveBpProgress();
  }
  return selected;
}

export function renderBpMissionList(set) {
  if (!el.bpMissionList) return;
  const items = Array.isArray(set?.items) ? set.items : [];
  const selected = new Set(getBpSelectedMissionIds(set));

  if (el.bpMissionCountBadge) {
    el.bpMissionCountBadge.textContent = `${selected.size}개 선택됨`;
  }

  el.bpMissionList.innerHTML = items.map(it => {
    const isChecked = selected.has(it.id);
    return `
      <label class="flex items-start gap-2 rounded-xl border p-3 cursor-pointer transition text-xs ${
        isChecked ? 'border-indigo-400 bg-white shadow-2xs ring-1 ring-indigo-200' : 'border-indigo-200/70 bg-white/70 hover:bg-white'
      }">
        <input type="checkbox" data-bp-mission-id="${escapeHtml(it.id)}" ${isChecked ? 'checked' : ''}
          class="mt-0.5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500" />
        <div class="min-w-0">
          <p class="font-bold text-slate-900 truncate">${escapeHtml(it.pattern)}</p>
          <p class="text-[11px] text-slate-500 truncate">${escapeHtml(it.kr)}</p>
        </div>
      </label>
    `;
  }).join('');
}

export function renderBpStepTabs() {
  const activeStep = [1, 2, 3].includes(state.bpActiveStep) ? state.bpActiveStep : 1;
  state.bpActiveStep = activeStep;
  const stages = [
    { step: 1, btn: el.btnBpStep1, panel: el.bpStage1 },
    { step: 2, btn: el.btnBpStep2, panel: el.bpStage2 },
    { step: 3, btn: el.btnBpStep3, panel: el.bpStage3 }
  ];
  stages.forEach(({ step, btn, panel }) => {
    const isActive = step === activeStep;
    if (panel) panel.classList.toggle('hidden', !isActive);
    if (btn) {
      btn.setAttribute('aria-selected', String(isActive));
      btn.className = isActive
        ? 'min-h-[44px] px-2 sm:px-3 py-2 rounded-xl text-[11px] sm:text-xs font-bold bg-white text-pte-navy shadow-xs transition cursor-pointer text-center leading-tight'
        : 'min-h-[44px] px-2 sm:px-3 py-2 rounded-xl text-[11px] sm:text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer text-center leading-tight';
    }
  });
}

export function setBpStep(step) {
  const nextStep = Number(step);
  if (![1, 2, 3].includes(nextStep)) return;
  state.bpActiveStep = nextStep;
  if (nextStep === 1) {
    state.bpNuanceOpen = true;
    renderBpNuanceList(getActiveBpSet());
  }
  renderBpStepTabs();
  renderStudyStepper();
}

export function renderBpWorkspace() {
  const sets = Array.isArray(state.liveAcademySets) && state.liveAcademySets.length > 0
    ? state.liveAcademySets
    : DEFAULT_LIVE_ACADEMY_SETS;
  const set = getActiveBpSet();
  if (set) state.bpActiveSetId = set.id;

  if (el.bpSetSelect) {
    el.bpSetSelect.innerHTML = sets.map(s => `
      <option value="${escapeHtml(s.id)}" ${s.id === state.bpActiveSetId ? 'selected' : ''}>
        ${escapeHtml(s.title)} (${(s.items || []).length}문장)
      </option>
    `).join('');
  }
  if (el.bpYtLink) {
    const safeYtUrl = sanitizeHttpUrl(set?.youtubeUrl);
    el.bpYtLink.href = safeYtUrl;
    el.bpYtLink.setAttribute('rel', 'noopener noreferrer');
    el.bpYtLink.classList.toggle('hidden', safeYtUrl === '#');
  }
  if (el.btnBpDeleteSet) {
    const isOnlyDefault = sets.length <= DEFAULT_LIVE_ACADEMY_SETS.length && String(set.id || '').startsWith('la-set-');
    el.btnBpDeleteSet.disabled = isOnlyDefault;
    el.btnBpDeleteSet.classList.toggle('opacity-45', isOnlyDefault);
  }

  renderBpStepTabs();
  renderBpNuanceList(set);
  renderBpItemList(set);
  renderBpMyoList(set);
  renderBpMissionList(set);
  renderStudyStepper();
}

export function stopBpRecording(discard = false) {
  if (state.bpMediaRecorder && state.bpMediaRecorder.state !== 'inactive') {
    state._bpDiscard = Boolean(discard);
    try {
      state.bpMediaRecorder.stop();
    } catch (e) {
      releaseMicrophoneStream();
      state.bpItemRecordingIdx = null;
      state.bpMyoVoiceIdx = null;
    }
  } else {
    if (discard) releaseMicrophoneStream();
    state.bpItemRecordingIdx = null;
    state.bpMyoVoiceIdx = null;
  }
  renderStudyStepper();
}

export async function toggleBpItemRecording(idx) {
  if (state.bpItemRecordingIdx === idx) {
    stopBpRecording(false);
    return;
  }
  stopBpRecording(true);
  ensureAudioContext();
  cancelSpeech();

  const set = getActiveBpSet();
  const item = set?.items?.[idx];
  if (!item) return;

  if (el.bpTtsStatus) el.bpTtsStatus.textContent = `마이크 연결 중... (Q${idx + 1})`;
  const ok = await requestMicrophone();
  if (!ok || !state.micStream || state.mode !== 'brain-pattern') {
    releaseMicrophoneStream();
    if (el.bpTtsStatus) el.bpTtsStatus.textContent = '마이크 권한이 없거나 장치를 찾을 수 없습니다.';
    return;
  }

  try {
    state.bpAudioChunks = [];
    state._bpDiscard = false;
    const mime = pickSupportedMimeType();
    const options = mime ? { mimeType: mime } : undefined;
    const recorder = new MediaRecorder(state.micStream, options);
    const actualMime = (recorder.mimeType || mime || 'audio/webm').split(';')[0];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) state.bpAudioChunks.push(ev.data);
    };

    recorder.onstop = () => {
      // Strictly release microphone immediately so iOS earphones return to Media mode
      releaseMicrophoneStream();
      state.bpMediaRecorder = null;
      const prevIdx = state.bpItemRecordingIdx;
      state.bpItemRecordingIdx = null;
      const discard = state._bpDiscard;
      state._bpDiscard = false;

      if (discard || prevIdx === null || state.bpAudioChunks.length === 0) {
        state.bpAudioChunks = [];
        renderBpWorkspace();
        return;
      }

      const blob = new Blob(state.bpAudioChunks, { type: actualMime });
      state.bpAudioChunks = [];
      evaluateBpItemAudio(set, prevIdx, blob, actualMime);
    };

    state.bpMediaRecorder = recorder;
    state.bpItemRecordingIdx = idx;
    recorder.start();
    if (el.bpTtsStatus) el.bpTtsStatus.textContent = `🔴 Q${idx + 1} 녹음 중... 완료되면 [⏹️ 녹음 완료]를 누르세요.`;
    renderBpWorkspace();
  } catch (err) {
    releaseMicrophoneStream();
    state.bpItemRecordingIdx = null;
    renderBpWorkspace();
  }
}

export async function evaluateBpItemAudio(set, idx, blob, mimeType) {
  const item = set?.items?.[idx];
  if (!item) return;
  const key = `${set.id}::${item.id}`;
  const prevUrl = state.bpItemFeedbackMap[key]?.audioUrl;
  if (prevUrl) { try { URL.revokeObjectURL(prevUrl); } catch (e) {} }
  const audioUrl = URL.createObjectURL(blob);

  const reqSeq = (state.bpEvalSeqMap[key] || 0) + 1;
  state.bpEvalSeqMap[key] = reqSeq;
  state.bpRevealedItems[key] = true;
  state.bpItemFeedbackMap[key] = { audioUrl, loading: true };
  renderBpWorkspace();

  const prompt = [
    `You are a native English speaking coach focusing on Korean-to-English nuance and avoiding literal Konglish translation.`,
    `Korean Prompt: "${item.kr}"`,
    `Target Pattern: "${item.pattern}"`,
    `Native Model Sentence: "${item.en}"${Array.isArray(item.variants) && item.variants.length ? ` (Variants: ${item.variants.join(' | ')})` : ''}`,
    `\nListen carefully to the learner's recorded English speech.`,
    `1) Transcribe what they said.`,
    `2) Check if they fell into awkward literal Korean-English translation or missed the native nuance/pattern.`,
    `3) Give concise 1-2 sentence Korean feedback + a natural correction if needed.`,
    `Respond strictly in JSON:`,
    `{`,
    `  "transcript": "<what the learner said>",`,
    `  "matchedNativeNuance": <true or false>,`,
    `  "feedbackKo": "<1-2 concise Korean sentences explaining literal vs native nuance feedback>",`,
    `  "naturalUpgrade": "<natural native English sentence if needed, or the best phrasing>",`,
    `  "weaknessTarget": "<specific Konglish phrase or mispronounced word if any, else empty string>",`,
    `  "weaknessCategory": "<konglish or pronunciation>"`,
    `}`
  ].join('\n');

  try {
    const base64Audio = await blobToBase64(blob);
    const res = await callGeminiApi([
      { text: prompt },
      { inlineData: { mimeType, data: base64Audio } }
    ]);
    if (state.bpEvalSeqMap[key] !== reqSeq) return;

    state.bpItemFeedbackMap[key] = {
      audioUrl,
      loading: false,
      transcript: res.transcript || '',
      matchedNativeNuance: Boolean(res.matchedNativeNuance),
      feedbackKo: res.feedbackKo || '',
      naturalUpgrade: res.naturalUpgrade || ''
    };

    if (res.weaknessTarget || res.matchedNativeNuance === false) {
      recordWeaknessEntry({
        target: res.weaknessTarget || res.transcript || item.pattern,
        correction: res.naturalUpgrade || item.en,
        category: res.weaknessCategory === 'pronunciation' ? 'pronunciation' : 'konglish',
        sourceMode: 'brain-pattern'
      });
    }
  } catch (err) {
    if (state.bpEvalSeqMap[key] !== reqSeq) return;
    state.bpItemFeedbackMap[key] = {
      audioUrl,
      loading: false,
      error: err.isMissingKey
        ? '⚙️ 상단 [AI 설정]에서 Gemini API 키를 저장하면 음성 뉘앙스 채점이 실행됩니다.'
        : (err.message || '채점 중 오류가 발생했습니다.')
    };
  }
  if (state.bpEvalSeqMap[key] === reqSeq && state.mode === 'brain-pattern' && getActiveBpSet()?.id === set.id) {
    renderBpWorkspace();
  }
}

export async function gradeBpMyoItem(idx, { audioBlob = null, mimeType = 'audio/webm' } = {}) {
  const set = getActiveBpSet();
  const promptObj = set?.makeYourOwnPrompts?.[idx];
  if (!promptObj) return;
  const key = `${set.id}::${promptObj.id || idx}`;
  if (!state.bpProgress.myoDrafts) state.bpProgress.myoDrafts = {};
  const draft = state.bpProgress.myoDrafts[key] || { userText: '' };
  if (draft.loading) return;
  const userText = (draft.userText || '').trim();

  if (!audioBlob && userText.length < 3) {
    draft.error = '영어 문장을 작성하거나 [🎤 음성 입력]으로 말한 뒤 AI 교정을 요청하세요.';
    state.bpProgress.myoDrafts[key] = draft;
    renderBpMyoList(set);
    return;
  }

  const reqSeq = (state.bpMyoSeqMap[key] || 0) + 1;
  state.bpMyoSeqMap[key] = reqSeq;
  draft.loading = true;
  draft.error = '';
  state.bpProgress.myoDrafts[key] = draft;
  renderBpMyoList(set);

  const prompt = [
    `You are a New Zealand daily life & early childhood education (ECE) workplace English coach.`,
    `Target Pattern: "${promptObj.pattern}"`,
    `Task Prompt (Korean): "${promptObj.promptKo}"`,
    audioBlob
      ? `Listen to the attached audio sentence created by the learner, transcribe it, and refine it into natural New Zealand English.`
      : `Refine the learner sentence below so it sounds completely natural in New Zealand everyday/workplace life while using the target pattern:\n"${userText}"`,
    `Respond strictly in JSON:`,
    `{`,
    `  "userTranscript": "<learner English sentence>",`,
    `  "correctedEn": "<polished natural NZ English sentence>",`,
    `  "meaningKo": "<short Korean meaning>",`,
    `  "explanationKo": "<concise Korean feedback on naturalness and NZ nuance>"`,
    `}`
  ].join('\n');

  try {
    const parts = [{ text: prompt }];
    if (audioBlob) {
      const base64Audio = await blobToBase64(audioBlob);
      parts.push({ inlineData: { mimeType, data: base64Audio } });
    }
    const res = await callGeminiApi(parts);
    if (state.bpMyoSeqMap[key] !== reqSeq) return;
    draft.loading = false;
    if (res.userTranscript) draft.userText = res.userTranscript;
    draft.aiResult = {
      correctedEn: res.correctedEn || '',
      meaningKo: res.meaningKo || promptObj.promptKo,
      explanationKo: res.explanationKo || ''
    };
    state.bpProgress.myoDrafts[key] = draft;
    saveBpProgress();
  } catch (err) {
    if (state.bpMyoSeqMap[key] !== reqSeq) return;
    draft.loading = false;
    draft.error = err.isMissingKey
      ? '⚙️ AI 설정에서 Gemini API 키를 입력하면 원어민 교정 결과를 받을 수 있습니다.'
      : (err.message || '교정 중 오류가 발생했습니다.');
    state.bpProgress.myoDrafts[key] = draft;
  }
  if (state.bpMyoSeqMap[key] === reqSeq && state.mode === 'brain-pattern' && getActiveBpSet()?.id === set.id) {
    renderBpMyoList(set);
  }
}

export async function toggleBpMyoVoiceInput(idx) {
  if (state.bpMyoVoiceIdx === idx) {
    stopBpRecording(false);
    return;
  }
  stopBpRecording(true);
  ensureAudioContext();
  cancelSpeech();

  const set = getActiveBpSet();
  const promptObj = set?.makeYourOwnPrompts?.[idx];
  if (!promptObj) return;

  const ok = await requestMicrophone();
  if (!ok || !state.micStream || state.mode !== 'brain-pattern') {
    releaseMicrophoneStream();
    return;
  }

  try {
    state.bpAudioChunks = [];
    state._bpDiscard = false;
    const mime = pickSupportedMimeType();
    const options = mime ? { mimeType: mime } : undefined;
    const recorder = new MediaRecorder(state.micStream, options);
    const actualMime = (recorder.mimeType || mime || 'audio/webm').split(';')[0];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) state.bpAudioChunks.push(ev.data);
    };
    recorder.onstop = () => {
      releaseMicrophoneStream();
      state.bpMediaRecorder = null;
      const prevIdx = state.bpMyoVoiceIdx;
      state.bpMyoVoiceIdx = null;
      const discard = state._bpDiscard;
      state._bpDiscard = false;

      if (discard || prevIdx === null || state.bpAudioChunks.length === 0) {
        state.bpAudioChunks = [];
        renderBpWorkspace();
        return;
      }
      const blob = new Blob(state.bpAudioChunks, { type: actualMime });
      state.bpAudioChunks = [];
      gradeBpMyoItem(prevIdx, { audioBlob: blob, mimeType: actualMime });
    };

    state.bpMediaRecorder = recorder;
    state.bpMyoVoiceIdx = idx;
    recorder.start();
    renderBpWorkspace();
  } catch (e) {
    releaseMicrophoneStream();
    state.bpMyoVoiceIdx = null;
    renderBpWorkspace();
  }
}

export async function generateBpSetWithAi() {
  if (state.bpGenerating) return;
  const urlInput = (el.bpGenUrlInput?.value || '').trim();
  const notesInput = (el.bpGenNotesInput?.value || '').trim();
  const videoId = urlInput ? parseYouTubeVideoId(urlInput) : '';
  const canonicalWatchUrl = videoId ? toCanonicalWatchUrl(videoId) : '';

  if (!canonicalWatchUrl && notesInput.length < 20) {
    if (el.bpGenStatus) el.bpGenStatus.textContent = '⚠️ 유튜브 URL을 입력하거나 강의 필기 노트를 20자 이상 붙여넣어 주세요.';
    return;
  }

  const schemaText = [
    `Create an English Brain Pattern Training study set matching this exact JSON schema:`,
    `{`,
    `  "title": "<concise Korean/English set title>",`,
    `  "nuanceComparisons": [`,
    `    { "literal": "<Konglish or literal mistake>", "native": "<natural native English>", "noteKo": "<Korean nuance explanation>" }`,
    `  ],`,
    `  "items": [`,
    `    { "pattern": "<reusable core pattern>", "kr": "<natural Korean prompt>", "en": "<natural native English sentence>", "variants": ["<optional alternative phrasing>"] }`,
    `  ],`,
    `  "makeYourOwnPrompts": [`,
    `    { "pattern": "<pattern>", "promptKo": "<Korean personalized writing task>" }`,
    `  ]`,
    `}`
  ].join('\n');

  const parts = notesInput.length >= 20
    ? [{
        text: [
          `Convert the English study notes / transcript below into a structured pattern training set (4-10 items, 3-4 nuance comparisons, 3 Make-Your-Own prompts).`,
          notesInput.slice(0, 14000),
          schemaText
        ].join('\n')
      }]
    : [
        { fileData: { fileUri: canonicalWatchUrl } },
        {
          text: [
            `Analyze the attached English learning YouTube lesson (${canonicalWatchUrl}) and build a structured 4-step pattern training set (5-10 core sentence patterns, 3-4 literal vs native nuance comparisons, and 3 Make-Your-Own prompts).`,
            schemaText
          ].join('\n')
        }
      ];

  state.bpGenerating = true;
  if (el.btnBpGenerateSet) {
    el.btnBpGenerateSet.disabled = true;
    el.btnBpGenerateSet.classList.add('opacity-60');
  }
  if (el.bpGenStatus) {
    el.bpGenStatus.textContent = notesInput.length >= 20
      ? '⏳ 강의 노트로 패턴 훈련 세트를 생성 중입니다...'
      : `⏳ 유튜브 영상(${canonicalWatchUrl})에서 패턴 훈련 세트를 생성 중입니다...`;
  }

  try {
    const result = await callGeminiApi(parts);
    const itemsRaw = Array.isArray(result?.items) ? result.items : [];
    const stamp = Date.now();
    const safeYt = sanitizeHttpUrl(canonicalWatchUrl || urlInput);
    const newSet = {
      id: `la-custom-${stamp}`,
      title: String(result?.title || '새 패턴 훈련 세트').trim(),
      youtubeUrl: safeYt === '#' ? '' : safeYt,
      createdAt: stamp,
      nuanceComparisons: Array.isArray(result?.nuanceComparisons) ? result.nuanceComparisons : [],
      items: itemsRaw.map((it, i) => ({
        id: `la-${stamp}-q${i + 1}`,
        pattern: String(it.pattern || '').trim(),
        kr: String(it.kr || '').trim(),
        en: String(it.en || '').trim(),
        variants: Array.isArray(it.variants) ? it.variants.map(v => String(v).trim()).filter(Boolean) : []
      })).filter(it => it.kr && it.en),
      makeYourOwnPrompts: (Array.isArray(result?.makeYourOwnPrompts) ? result.makeYourOwnPrompts : []).map((p, i) => ({
        id: `la-${stamp}-myo-${i + 1}`,
        pattern: String(p.pattern || '').trim(),
        promptKo: String(p.promptKo || '').trim()
      }))
    };

    if (newSet.items.length === 0) {
      throw new Error('생성된 패턴 문장이 없습니다. 입력 내용을 확인해주세요.');
    }

    state.liveAcademySets.unshift(newSet);
    saveStorage(STORAGE_KEYS.liveAcademySets, state.liveAcademySets);
    state.bpActiveSetId = newSet.id;
    if (el.bpGeneratorBox) el.bpGeneratorBox.classList.add('hidden');
    if (el.bpGenStatus) el.bpGenStatus.textContent = `✅ '${newSet.title}' 세트가 저장되었습니다!`;
    renderBpWorkspace();
  } catch (err) {
    if (el.bpGenStatus && !err.isMissingKey) {
      el.bpGenStatus.textContent = '❌ ' + formatYouTubeDirectAiError(err, notesInput.length < 20);
    }
  } finally {
    state.bpGenerating = false;
    if (el.btnBpGenerateSet) {
      el.btnBpGenerateSet.disabled = false;
      el.btnBpGenerateSet.classList.remove('opacity-60');
    }
  }
}


export function initBrainPatternFeature() {
  const bpWorkspaceEl = document.getElementById('brain-pattern-workspace');
  if (bpWorkspaceEl) {
    bpWorkspaceEl.addEventListener('click', (e) => {
      const stepTab = e.target.closest('[data-bp-step]');
      if (stepTab) {
        const targetStep = parseInt(stepTab.dataset.bpStep, 10);
        setBpStep(targetStep);
        return;
      }
      const gotoBtn = e.target.closest('[data-bp-goto-step]');
      if (gotoBtn) {
        const targetStep = parseInt(gotoBtn.dataset.bpGotoStep, 10);
        setBpStep(targetStep);
        bpWorkspaceEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
  if (el.btnRpClearMission) {
    el.btnRpClearMission.addEventListener('click', () => {
      state.rpMissionTargets = [];
      renderRoleplayMissionBar();
    });
  }
  if (el.btnBpOpenGenerator) {
    el.btnBpOpenGenerator.addEventListener('click', () => {
      el.bpGeneratorBox?.classList.toggle('hidden');
    });
  }
  if (el.bpSetSelect) {
    el.bpSetSelect.addEventListener('change', (e) => {
      stopBpRecording(true);
      cancelSpeech();
      state.bpActiveSetId = e.target.value;
      renderBpWorkspace();
    });
  }
  if (el.btnBpDeleteSet) {
    el.btnBpDeleteSet.addEventListener('click', () => {
      const sets = Array.isArray(state.liveAcademySets) ? state.liveAcademySets : [];
      if (sets.length <= 1) return;
      stopBpRecording(true);
      const remaining = sets.filter(s => s.id !== state.bpActiveSetId);
      state.liveAcademySets = remaining.length > 0 ? remaining : DEFAULT_LIVE_ACADEMY_SETS;
      saveStorage(STORAGE_KEYS.liveAcademySets, state.liveAcademySets);
      state.bpActiveSetId = state.liveAcademySets[0].id;
      renderBpWorkspace();
    });
  }
  if (el.btnBpGenerateSet) {
    el.btnBpGenerateSet.addEventListener('click', generateBpSetWithAi);
  }
  if (el.btnBpToggleNuance) {
    el.btnBpToggleNuance.addEventListener('click', () => {
      state.bpNuanceOpen = !state.bpNuanceOpen;
      renderBpNuanceList(getActiveBpSet());
    });
  }
  if (el.btnBpBlindToggle) {
    el.btnBpBlindToggle.addEventListener('click', () => {
      state.bpBlindMode = !state.bpBlindMode;
      if (state.bpBlindMode) state.bpRevealedItems = {};
      renderBpItemList(getActiveBpSet());
    });
  }
  if (el.bpNuanceList) {
    el.bpNuanceList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bp-speak-nuance]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.bpSpeakNuance, 10);
      const n = getActiveBpSet()?.nuanceComparisons?.[idx];
      if (n && n.native) {
        speakText(cleanTtsPhrase(n.native), { targetMode: 'brain-pattern' });
      }
    });
  }
  if (el.bpItemList) {
    el.bpItemList.addEventListener('click', (e) => {
      const speakBtn = e.target.closest('[data-bp-speak-item]');
      if (speakBtn) {
        const idx = parseInt(speakBtn.dataset.bpSpeakItem, 10);
        const it = getActiveBpSet()?.items?.[idx];
        if (it && it.en) speakText(cleanTtsPhrase(it.en), { targetMode: 'brain-pattern' });
        return;
      }
      const revealBtn = e.target.closest('[data-bp-reveal-item]');
      if (revealBtn) {
        const set = getActiveBpSet();
        const idx = parseInt(revealBtn.dataset.bpRevealItem, 10);
        const it = set?.items?.[idx];
        if (set && it) {
          state.bpRevealedItems[`${set.id}::${it.id}`] = true;
          renderBpItemList(set);
        }
        return;
      }
      const recBtn = e.target.closest('[data-bp-record-item]');
      if (recBtn) {
        const idx = parseInt(recBtn.dataset.bpRecordItem, 10);
        if (!Number.isNaN(idx)) toggleBpItemRecording(idx);
      }
    });
    el.bpItemList.addEventListener('change', (e) => {
      const chk = e.target.closest('[data-bp-check-item]');
      if (!chk) return;
      const set = getActiveBpSet();
      const idx = parseInt(chk.dataset.bpCheckItem, 10);
      const stepKey = chk.dataset.bpCheckStep;
      const it = set?.items?.[idx];
      if (!set || !it || !stepKey) return;
      const key = `${set.id}::${it.id}`;
      if (!state.bpProgress.checks) state.bpProgress.checks = {};
      const cur = getBpItemChecks(set.id, it.id);
      cur[stepKey] = Boolean(chk.checked);
      state.bpProgress.checks[key] = cur;
      saveBpProgress();
      renderBpItemList(set);
    });
  }
  if (el.bpMyoList) {
    el.bpMyoList.addEventListener('input', (e) => {
      const inp = e.target.closest('[data-bp-myo-input]');
      if (!inp) return;
      const set = getActiveBpSet();
      const idx = parseInt(inp.dataset.bpMyoInput, 10);
      const promptObj = set?.makeYourOwnPrompts?.[idx];
      if (!set || !promptObj) return;
      const key = `${set.id}::${promptObj.id || idx}`;
      if (!state.bpProgress.myoDrafts) state.bpProgress.myoDrafts = {};
      const cur = state.bpProgress.myoDrafts[key] || {};
      cur.userText = inp.value;
      state.bpProgress.myoDrafts[key] = cur;
      saveBpProgress();
    });
    el.bpMyoList.addEventListener('click', (e) => {
      const voiceBtn = e.target.closest('[data-bp-myo-voice]');
      if (voiceBtn) {
        const idx = parseInt(voiceBtn.dataset.bpMyoVoice, 10);
        if (!Number.isNaN(idx)) toggleBpMyoVoiceInput(idx);
        return;
      }
      const gradeBtn = e.target.closest('[data-bp-myo-grade]');
      if (gradeBtn) {
        const idx = parseInt(gradeBtn.dataset.bpMyoGrade, 10);
        if (!Number.isNaN(idx)) gradeBpMyoItem(idx);
        return;
      }
      const speakBtn = e.target.closest('[data-bp-speak-text]');
      if (speakBtn) {
        speakText(cleanTtsPhrase(speakBtn.dataset.bpSpeakText), { targetMode: 'brain-pattern' });
      }
    });
  }
  if (el.bpMissionList) {
    el.bpMissionList.addEventListener('change', (e) => {
      const chk = e.target.closest('[data-bp-mission-id]');
      if (!chk) return;
      const set = getActiveBpSet();
      const id = chk.dataset.bpMissionId;
      if (!set || !id) return;
      const cur = getBpSelectedMissionIds(set).filter(x => x !== id);
      if (chk.checked) cur.push(id);
      state.bpProgress.selectedMissions[set.id] = cur;
      saveBpProgress();
      renderBpMissionList(set);
    });
  }
  if (el.btnBpStartMission) {
    el.btnBpStartMission.addEventListener('click', () => {
      const set = getActiveBpSet();
      const selectedIds = getBpSelectedMissionIds(set);
      const chosen = (set.items || []).filter(it => selectedIds.includes(it.id));
      if (chosen.length === 0) {
        if (el.bpMissionStatus) el.bpMissionStatus.textContent = '⚠️ 롤플레이에서 연습할 표현을 1개 이상 선택해주세요.';
        return;
      }
      state.rpMissionTargets = chosen.map(it => ({
        id: it.id,
        pattern: it.pattern,
        en: it.en,
        kr: it.kr,
        completed: false
      }));
      if (el.bpMissionStatus) el.bpMissionStatus.textContent = '';
      switchMode('roleplay');
    });
  }
}
