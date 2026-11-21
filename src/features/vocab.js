import {
  READ_ALOUD_QUESTIONS,
  RETELL_LECTURE_QUESTIONS,
  IMPROMPTU_QUESTIONS,
  SWT_QUESTIONS,
  ESSAY_QUESTIONS,
} from '../data/questions.js';
import { STORAGE_KEYS, ROLEPLAY_PRESETS } from '../config/constants.js';
import { escapeHtml } from '../utils/security.js';
import { saveStorage } from '../utils/storage.js';
import { state, el } from '../state/store.js';
import {
  callGeminiApi,
  openAiSettingsModal,
  renderAiErrorCard,
} from '../services/gemini.js';
import { cancelSpeech, speakText } from '../services/tts.js';
import {
  ensureAudioContext,
  requestMicrophone,
  releaseMicrophoneStream,
  pickSupportedMimeType,
} from '../services/audio.js';
import {
  getDescribeImageList,
  getRepeatSentenceList,
  getRetellLectureQuestions,
  getCurrentQuestion,
  isQuestionSolved,
  renderQuestionSelector,
  selectQuestion,
  switchMode,
} from './speaking.js';
import {
  getCurrentWritingQuestion,
  switchWritingSubmode,
  selectWritingQuestion,
} from './writing.js';

export const SECTION_CATALOG = [
  { key: 'read-aloud', label: 'Read Aloud', short: 'RA', filterGroup: 'read-aloud', badgeCls: 'bg-sky-100 text-sky-800', barCls: 'bg-pte-blue', getList: () => READ_ALOUD_QUESTIONS },
  { key: 'describe-image', label: 'Describe Image', short: 'DI', filterGroup: 'describe-image', badgeCls: 'bg-indigo-100 text-indigo-800', barCls: 'bg-indigo-500', getList: () => getDescribeImageList() },
  { key: 'repeat-sentence', label: 'Repeat Sentence', short: 'RS', filterGroup: 'repeat-sentence', badgeCls: 'bg-teal-100 text-teal-800', barCls: 'bg-pte-teal', getList: () => getRepeatSentenceList() },
  { key: 'retell-lecture', label: 'Retell Lecture', short: 'RL', filterGroup: 'retell-lecture', badgeCls: 'bg-violet-100 text-violet-800', barCls: 'bg-violet-500', getList: () => RETELL_LECTURE_QUESTIONS },
  { key: 'impromptu', label: '1분 즉흥 말하기', short: 'IMP', filterGroup: 'impromptu', badgeCls: 'bg-emerald-100 text-emerald-800', barCls: 'bg-emerald-500', getList: () => IMPROMPTU_QUESTIONS },
  { key: 'swt', label: 'Writing · SWT', short: 'SWT', filterGroup: 'writing', badgeCls: 'bg-amber-100 text-amber-800', barCls: 'bg-amber-500', getList: () => SWT_QUESTIONS },
  { key: 'essay', label: 'Writing · Essay', short: 'Essay', filterGroup: 'writing', badgeCls: 'bg-rose-100 text-rose-800', barCls: 'bg-rose-500', getList: () => ESSAY_QUESTIONS }
];

export function getSectionMeta(sectionKey) {
  if (sectionKey === 'roleplay') {
    return {
      key: 'roleplay',
      label: '실전 AI 롤플레이 (NZ 회화)',
      short: 'RP',
      filterGroup: 'roleplay',
      badgeCls: 'bg-indigo-100 text-indigo-800',
      barCls: 'bg-indigo-600',
      getList: () => []
    };
  }
  if (sectionKey === 'yt-shadowing') {
    return {
      key: 'yt-shadowing',
      label: '유튜브 쉐도잉 (문장별 따라 말하기)',
      short: 'YTS',
      filterGroup: 'yt-shadowing',
      badgeCls: 'bg-rose-100 text-rose-800',
      barCls: 'bg-rose-500',
      getList: () => []
    };
  }
  if (sectionKey === 'brain-pattern') {
    return {
      key: 'brain-pattern',
      label: '영어 뇌 패턴 훈련',
      short: 'BP',
      filterGroup: 'brain-pattern',
      badgeCls: 'bg-indigo-100 text-indigo-800',
      barCls: 'bg-indigo-500',
      getList: () => []
    };
  }
  return SECTION_CATALOG.find(s => s.key === sectionKey) || {
    key: sectionKey,
    label: sectionKey || '기타',
    short: sectionKey || '-',
    filterGroup: sectionKey,
    badgeCls: 'bg-slate-100 text-slate-700',
    barCls: 'bg-slate-500',
    getList: () => []
  };
}

export function getTodayDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatLogTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

export function findQuestionLocation(qId) {
  for (const sec of SECTION_CATALOG) {
    const list = sec.getList();
    const idx = list.findIndex(item => item.id === qId);
    if (idx !== -1) {
      const isWritingSec = sec.key === 'swt' || sec.key === 'essay';
      return {
        workspaceMode: isWritingSec ? 'writing' : sec.key,
        writingSubmode: isWritingSec ? sec.key : null,
        rlSourceMode: sec.key === 'retell-lecture' ? 'academic' : null,
        ytSetId: null,
        index: idx,
        question: list[idx]
      };
    }
  }
  // Also search saved YouTube Retell Lecture clips
  for (const set of (state.ytClipSets || [])) {
    const idx = (set.clips || []).findIndex(c => c.id === qId);
    if (idx !== -1) {
      return {
        workspaceMode: 'retell-lecture',
        writingSubmode: null,
        rlSourceMode: 'youtube',
        ytSetId: set.id,
        index: idx,
        question: set.clips[idx]
      };
    }
  }
  return null;
}

export function openQuestionById(qId) {
  if (typeof qId === 'string' && qId.startsWith('RP-')) {
    const slug = qId.slice(3).toLowerCase();
    const matchedPreset = ROLEPLAY_PRESETS.find(p => p.id === slug);
    if (matchedPreset) {
      state.rpPresetId = matchedPreset.id;
    }
    switchMode('roleplay');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const loc = findQuestionLocation(qId);
  if (!loc) return;
  if (loc.workspaceMode === 'writing') {
    if (state.mode !== 'writing') {
      switchMode('writing');
    }
    if (state.writingSubmode !== loc.writingSubmode) {
      switchWritingSubmode(loc.writingSubmode);
    }
    selectWritingQuestion(loc.index);
  } else {
    if (loc.workspaceMode === 'retell-lecture' && loc.rlSourceMode) {
      state.rlSourceMode = loc.rlSourceMode;
      if (loc.ytSetId) state.activeYtSetId = loc.ytSetId;
    }
    if (state.mode !== loc.workspaceMode) {
      switchMode(loc.workspaceMode);
    } else if (loc.workspaceMode === 'retell-lecture') {
      renderQuestionSelector();
    }
    selectQuestion(loc.index);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function updateReviewTabBadge() {
  const totalItems = (state.bookmarks?.length || 0) + (state.vocabList?.length || 0);
  if (el.tabReviewCount) {
    el.tabReviewCount.textContent = String(totalItems);
  }
  if (el.navLibraryCount) {
    el.navLibraryCount.textContent = String(totalItems);
  }
}

export function isBookmarked(qId) {
  return Array.isArray(state.bookmarks) && state.bookmarks.some(b => b.id === qId);
}

export function updateBookmarkButtonState(btnEl, qId) {
  if (!btnEl || !qId) return;
  const saved = isBookmarked(qId);
  btnEl.setAttribute('aria-pressed', String(saved));
  if (saved) {
    btnEl.textContent = '★ 오답 보관됨';
    btnEl.className = 'px-2.5 py-1 rounded-lg text-xs font-bold border border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200 transition cursor-pointer';
  } else {
    btnEl.textContent = '☆ 오답/복습 보관함';
    btnEl.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-200 bg-white hover:bg-amber-50 text-slate-600 transition cursor-pointer';
  }
}

export function renderSpeakingBookmarkBtn() {
  const q = getCurrentQuestion();
  if (q) updateBookmarkButtonState(el.btnBookmarkSpeaking, q.id);
}

export function renderWritingBookmarkBtn() {
  const q = getCurrentWritingQuestion();
  if (q) updateBookmarkButtonState(el.btnBookmarkWriting, q.id);
}

export function toggleBookmarkItem(q, sectionKey) {
  if (!q) return;
  const idx = state.bookmarks.findIndex(b => b.id === q.id);
  if (idx !== -1) {
    state.bookmarks.splice(idx, 1);
  } else {
    state.bookmarks.unshift({
      id: q.id,
      mode: sectionKey,
      title: q.title,
      topic: q.topic || '',
      addedAt: Date.now()
    });
  }
  saveStorage(STORAGE_KEYS.bookmarks, state.bookmarks);
  renderSpeakingBookmarkBtn();
  renderWritingBookmarkBtn();
  updateReviewTabBadge();
  if (state.mode === 'review') {
    renderReviewDashboard();
  }
}

export function recordPracticeLog(qId, sectionKey, title, aiScore = null) {
  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    qId,
    mode: sectionKey,
    title,
    date: getTodayDateKey(),
    timestamp: Date.now(),
    aiScore: typeof aiScore === 'number' ? aiScore : null
  };
  state.practiceLogs.unshift(entry);
  if (state.practiceLogs.length > 300) {
    state.practiceLogs.length = 300;
  }
  saveStorage(STORAGE_KEYS.practiceLogs, state.practiceLogs);
  if (state.mode === 'review') {
    renderReviewDashboard();
  }
  return entry.id;
}

export function attachAiScoreToPracticeLog(logId, qId, sectionKey, title, aiScore) {
  const numericScore = Number.isFinite(Number(aiScore)) ? Math.round(Number(aiScore)) : null;
  if (logId) {
    const existing = state.practiceLogs.find(item => item.id === logId);
    if (existing && existing.aiScore === null) {
      existing.aiScore = numericScore;
      existing.timestamp = Date.now();
      existing.date = getTodayDateKey();
      saveStorage(STORAGE_KEYS.practiceLogs, state.practiceLogs);
      if (state.mode === 'review') renderReviewDashboard();
      return existing.id;
    }
  }
  return recordPracticeLog(qId, sectionKey, title, numericScore);
}

export function addVocabItem(wordRaw, meaningRaw, exampleRaw = '') {
  const word = (wordRaw || '').trim();
  const meaning = (meaningRaw || '').trim();
  const example = (exampleRaw || '').trim();
  if (!word || !meaning) return null;

  const normalized = word.toLowerCase();
  const existingIdx = state.vocabList.findIndex(v => v.word.toLowerCase() === normalized);
  if (existingIdx !== -1) {
    const existing = state.vocabList[existingIdx];
    existing.meaning = meaning;
    if (example) existing.example = example;
    saveStorage(STORAGE_KEYS.vocabList, state.vocabList);
    updateReviewTabBadge();
    if (state.mode === 'review') renderReviewDashboard();
    return 'updated';
  }

  state.vocabList.unshift({
    id: `voc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    word,
    meaning,
    example,
    memorized: false,
    createdAt: Date.now()
  });
  saveStorage(STORAGE_KEYS.vocabList, state.vocabList);
  updateReviewTabBadge();
  if (state.mode === 'review') renderReviewDashboard();
  return 'added';
}

export function renderPracticeStatsAndLogs() {
  const logs = Array.isArray(state.practiceLogs) ? state.practiceLogs : [];
  const todayKey = getTodayDateKey();
  const todayCount = logs.filter(l => l.date === todayKey).length;
  const scoredLogs = logs.filter(l => typeof l.aiScore === 'number' && !Number.isNaN(l.aiScore));
  const avgAi = scoredLogs.length > 0
    ? Math.round(scoredLogs.reduce((acc, cur) => acc + cur.aiScore, 0) / scoredLogs.length)
    : null;

  el.statTodayCount.textContent = String(todayCount);
  el.statTotalCount.textContent = String(logs.length);
  el.statAvgAiScore.textContent = avgAi !== null ? `${avgAi} / 90` : '-';
  el.statBookmarkVocabSummary.textContent = `${state.bookmarks.length}개 / ${state.vocabList.length}단어`;

  // 6 Section Cards
  el.sectionStatsGrid.innerHTML = SECTION_CATALOG.map(sec => {
    const bank = sec.getList();
    const bankTotal = bank.length;
    const solvedInSec = bank.filter(item => isQuestionSolved(item.id)).length;
    const secLogs = logs.filter(l => l.mode === sec.key);
    const secScores = secLogs.filter(l => typeof l.aiScore === 'number');
    const secAvg = secScores.length > 0
      ? Math.round(secScores.reduce((a, b) => a + b.aiScore, 0) / secScores.length)
      : null;
    const pct = bankTotal > 0 ? Math.min(100, Math.round((solvedInSec / bankTotal) * 100)) : 0;

    return `
      <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${sec.badgeCls}">${escapeHtml(sec.label)}</span>
          <span class="text-xs font-bold text-slate-700 tabular-nums">연습 ${secLogs.length}회</span>
        </div>
        <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
          <div class="h-full ${sec.barCls} rounded-full transition-all" style="width: ${pct}%;"></div>
        </div>
        <div class="flex items-center justify-between text-[11px] text-slate-500">
          <span>진도: <strong class="text-slate-700">${solvedInSec} / ${bankTotal}</strong> (${pct}%)</span>
          <span>AI 평균: <strong class="text-slate-700">${secAvg !== null ? secAvg + '점' : '-'}</strong></span>
        </div>
      </div>
    `;
  }).join('');

  // Recent Logs List
  if (logs.length === 0) {
    el.practiceLogList.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
        아직 연습 기록이 없습니다. 스피킹 녹음을 완료하거나 Writing AI 채점을 실행하면 자동 기록됩니다.
      </div>
    `;
    return;
  }

  el.practiceLogList.innerHTML = logs.slice(0, 30).map(log => {
    const meta = getSectionMeta(log.mode);
    const scoreBadge = typeof log.aiScore === 'number'
      ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800">AI ${log.aiScore}/90</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">연습 완료</span>`;

    return `
      <div class="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <span class="shrink-0 px-2 py-0.5 rounded-md font-bold ${meta.badgeCls}">${escapeHtml(meta.short)}</span>
          <button type="button" data-jump-qid="${escapeHtml(log.qId)}" class="font-semibold text-slate-800 hover:text-pte-blue hover:underline truncate cursor-pointer text-left">
            [${escapeHtml(log.qId)}] ${escapeHtml(log.title)}
          </button>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${scoreBadge}
          <span class="text-[11px] text-slate-400 tabular-nums">${escapeHtml(formatLogTimestamp(log.timestamp))}</span>
        </div>
      </div>
    `;
  }).join('');
}

export function renderBookmarkList() {
  el.bookmarkCountBadge.textContent = String(state.bookmarks.length);

  const filterButtons = el.bookmarkFilterBar.querySelectorAll('.bm-filter-btn');
  filterButtons.forEach(btn => {
    const active = btn.dataset.filter === state.bookmarkFilter;
    btn.className = active
      ? 'bm-filter-btn px-2.5 py-1 rounded-lg text-xs font-bold bg-pte-blue text-white cursor-pointer'
      : 'bm-filter-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer';
  });

  const filtered = state.bookmarks.filter(b => {
    if (state.bookmarkFilter === 'all') return true;
    const meta = getSectionMeta(b.mode);
    return meta.filterGroup === state.bookmarkFilter;
  });

  if (filtered.length === 0) {
    el.bookmarkList.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-center text-xs text-slate-500 leading-relaxed">
        보관된 오답/복습 문제가 없습니다.<br />
        각 문제 상단의 <strong>☆ 오답/복습 보관함</strong> 버튼을 눌러 담아보세요.
      </div>
    `;
    return;
  }

  el.bookmarkList.innerHTML = filtered.map(b => {
    const meta = getSectionMeta(b.mode);
    return `
      <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex items-start justify-between gap-2.5">
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${meta.badgeCls}">${escapeHtml(meta.label)}</span>
            <span class="text-[11px] font-bold text-slate-500">${escapeHtml(b.id)}</span>
          </div>
          <p class="text-xs sm:text-sm font-bold text-slate-800 truncate">${escapeHtml(b.title)}</p>
          ${b.topic ? `<p class="text-[11px] text-slate-500 truncate">${escapeHtml(b.topic)}</p>` : ''}
        </div>
        <div class="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0">
          <button type="button" data-jump-qid="${escapeHtml(b.id)}"
            class="px-2.5 py-1.5 rounded-lg text-xs font-bold text-white bg-pte-blue hover:bg-sky-700 transition cursor-pointer">
            바로 풀기 →
          </button>
          <button type="button" data-remove-bm="${escapeHtml(b.id)}"
            class="px-2 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-700 text-slate-500 transition cursor-pointer">
            해제
          </button>
        </div>
      </div>
    `;
  }).join('');
}

export function renderVocabList() {
  const list = Array.isArray(state.vocabList) ? state.vocabList : [];
  const memorizedCount = list.filter(v => v.memorized).length;
  el.vocabProgressBadge.textContent = `암기 ${memorizedCount} / ${list.length}`;

  const query = state.vocabSearch.trim().toLowerCase();
  const filtered = list.filter(item => {
    if (state.vocabFilter === 'memorized' && !item.memorized) return false;
    if (state.vocabFilter === 'unmemorized' && item.memorized) return false;
    if (!query) return true;
    return (
      item.word.toLowerCase().includes(query) ||
      item.meaning.toLowerCase().includes(query) ||
      (item.example || '').toLowerCase().includes(query)
    );
  });

  if (filtered.length === 0) {
    el.vocabList.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-center text-xs text-slate-500 leading-relaxed">
        저장된 단어가 없습니다. 위 입력란이나 문제 카드의 <strong>➕ 단어 추가</strong>를 이용해 단어를 등록하세요.
      </div>
    `;
    return;
  }

  el.vocabList.innerHTML = filtered.map(item => {
    const cardCls = item.memorized
      ? 'rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 space-y-1.5'
      : 'rounded-xl border border-slate-200 bg-white p-3.5 space-y-1.5';
    const wordCls = item.memorized
      ? 'text-sm sm:text-base font-bold text-slate-400 line-through'
      : 'text-sm sm:text-base font-bold text-slate-900';

    return `
      <div class="${cardCls}">
        <div class="flex items-start justify-between gap-2">
          <label class="flex items-start gap-2.5 cursor-pointer min-w-0">
            <input type="checkbox" data-toggle-vocab="${escapeHtml(item.id)}" ${item.memorized ? 'checked' : ''}
              class="mt-1 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer" />
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="${wordCls}">${escapeHtml(item.word)}</span>
                <span class="text-xs sm:text-sm font-medium text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-100">${escapeHtml(item.meaning)}</span>
              </div>
              ${item.example ? `<p class="text-xs text-slate-600 italic mt-1">"${escapeHtml(item.example)}"</p>` : ''}
            </div>
          </label>
          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button" data-speak-vocab="${escapeHtml(item.word)}" title="발음 듣기"
              class="px-2 py-1 rounded-lg text-xs font-semibold border border-slate-200 bg-slate-50 hover:bg-sky-50 text-slate-700 cursor-pointer">
              🔊
            </button>
            <button type="button" data-delete-vocab="${escapeHtml(item.id)}"
              class="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-700 text-slate-500 cursor-pointer">
              삭제
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function renderReviewDashboard() {
  renderPracticeStatsAndLogs();
  renderWeaknessReport();
  renderBookmarkList();
  renderVocabList();
}

export function openQuickVocabModal() {
  const selected = (window.getSelection ? window.getSelection().toString().trim() : '') || '';
  el.qvWord.value = selected.length > 0 && selected.length <= 60 ? selected : '';
  el.qvMeaning.value = '';
  el.qvExample.value = '';
  el.quickVocabModal.classList.remove('hidden');
  setTimeout(() => {
    (el.qvWord.value ? el.qvMeaning : el.qvWord).focus();
  }, 20);
}

export function closeQuickVocabModal() {
  el.quickVocabModal.classList.add('hidden');
}

export function recordWeaknessEntry({ target, correction = '', category = 'pronunciation', sourceMode = 'speaking' }) {
  const cleanTarget = (target || '').trim();
  const cleanFix = (correction || '').trim();
  if (!cleanTarget) return;

  const normKey = `${category}::${cleanTarget.toLowerCase().replace(/\s+/g, ' ')}`;
  if (!Array.isArray(state.weaknessLogs)) state.weaknessLogs = [];

  const existing = state.weaknessLogs.find(w => w.key === normKey);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastSeen = Date.now();
    if (cleanFix) existing.correction = cleanFix;
    if (sourceMode) existing.sourceMode = sourceMode;
  } else {
    state.weaknessLogs.unshift({
      id: `wk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      key: normKey,
      target: cleanTarget,
      correction: cleanFix || '발음·억양 및 자연스러운 어휘 사용 주의',
      category,
      sourceMode,
      count: 1,
      lastSeen: Date.now()
    });
  }

  if (state.weaknessLogs.length > 150) {
    state.weaknessLogs.length = 150;
  }
  saveStorage(STORAGE_KEYS.weaknessLogs, state.weaknessLogs);
  if (state.mode === 'review') renderWeaknessReport();
}

export function extractAndRecordWeaknessesFromAi(data, sourceMode) {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data.omittedOrMispronounced)) {
    data.omittedOrMispronounced.forEach(item => {
      if (item && item.target) {
        recordWeaknessEntry({
          target: item.target,
          correction: item.issue || '발음 정확도 및 단어 누락 주의',
          category: 'pronunciation',
          sourceMode
        });
      }
    });
  }
  if (Array.isArray(data.expressionUpgrades)) {
    data.expressionUpgrades.forEach(up => {
      const raw = (up && (up.myExpression || up.original || '')).trim();
      const nat = (up && (up.nativeExpression || up.improved || '')).trim();
      if (raw || nat) {
        recordWeaknessEntry({
          target: raw || nat,
          correction: nat ? `${nat}${up.meaningKo ? ' — ' + up.meaningKo : ''}` : (up.explanationKo || ''),
          category: 'konglish',
          sourceMode
        });
      }
    });
  }
}

export function getTopWeaknesses(limit = 5) {
  const list = Array.isArray(state.weaknessLogs) ? [...state.weaknessLogs] : [];
  list.sort((a, b) => (b.count || 1) - (a.count || 1) || (b.lastSeen || 0) - (a.lastSeen || 0));
  return list.slice(0, limit);
}

export function renderWeaknessReport() {
  if (!el.weaknessTop5List || !el.weaknessDrillList) return;

  const logs = Array.isArray(state.weaknessLogs) ? state.weaknessLogs : [];
  const totalHits = logs.reduce((acc, cur) => acc + (cur.count || 1), 0);
  if (el.weaknessTotalBadge) {
    el.weaknessTotalBadge.textContent = `${logs.length}종 · ${totalHits}회 누적`;
  }

  const top5 = getTopWeaknesses(5);
  if (top5.length === 0) {
    el.weaknessTop5List.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center text-xs text-slate-500 leading-relaxed">
        아직 누적된 취약 발음·콩글리시 기록이 없습니다.<br />
        스피킹 AI 채점이나 롤플레이를 진행하면 자동 누적되며, 위 <strong>샘플 취약점 테스트</strong> 버튼으로도 바로 체험할 수 있습니다.
      </div>
    `;
  } else {
    el.weaknessTop5List.innerHTML = top5.map((w, idx) => {
      const isPron = w.category === 'pronunciation';
      const catBadge = isPron
        ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800">발음/누락</span>'
        : '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800">콩글리시/표현</span>';
      const inVocab = Array.isArray(state.vocabList)
        && state.vocabList.some(v => v.word.toLowerCase() === String(w.target || '').trim().toLowerCase());
      return `
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5 min-w-0">
              <span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-slate-800 text-white">TOP ${idx + 1}</span>
              ${catBadge}
              <span class="text-[11px] font-bold text-rose-700">${w.count || 1}회 누적</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" data-speak-weakness="${escapeHtml(w.target)}"
                class="px-2 py-0.5 rounded text-[11px] font-semibold bg-white border border-slate-200 hover:bg-sky-50 text-pte-blue cursor-pointer">
                🔊
              </button>
              <button type="button"
                ${inVocab ? 'disabled' : ''}
                data-ai-vocab-word="${escapeHtml(w.target)}"
                data-ai-vocab-meaning="${escapeHtml(w.correction || '')}"
                data-ai-vocab-example=""
                class="${inVocab
                  ? 'px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default'
                  : 'px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-600 hover:bg-teal-700 text-white cursor-pointer'}">
                ${inVocab ? '✓ 단어장 저장됨' : '+ 단어장'}
              </button>
              <button type="button" data-delete-weakness="${escapeHtml(w.id)}" title="삭제"
                class="px-1.5 py-0.5 rounded text-[11px] text-slate-400 hover:text-rose-600 cursor-pointer">
                ✕
              </button>
            </div>
          </div>
          <p class="text-xs sm:text-sm font-bold text-slate-900 break-words">${escapeHtml(w.target)}</p>
          ${w.correction ? `<p class="text-xs text-slate-600 leading-relaxed break-words">→ ${escapeHtml(w.correction)}</p>` : ''}
        </div>
      `;
    }).join('');
  }

  const drills = Array.isArray(state.weaknessDrills) ? state.weaknessDrills : [];
  if (drills.length === 0) {
    el.weaknessDrillList.innerHTML = `
      <div class="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-5 text-center text-xs text-slate-500 leading-relaxed">
        <strong>✨ 내 취약점 맞춤 5문장 생성</strong> 버튼을 누르면 TOP 5 약점을 집중 훈련할 수 있는 실전 문장 5개를 만들어 드립니다.
      </div>
    `;
  } else {
    el.weaknessDrillList.innerHTML = drills.map((d, idx) => {
      const isRec = state.drillRecordingIdx === idx;
      const blobUrl = state.drillBlobMap && state.drillBlobMap[idx] ? state.drillBlobMap[idx] : '';
      const drillWord = String(d.targetFocus || d.sentence || '').trim();
      const inVocab = Array.isArray(state.vocabList)
        && state.vocabList.some(v => v.word.toLowerCase() === drillWord.toLowerCase());
      return `
        <div class="rounded-xl border border-indigo-100 bg-white p-3.5 shadow-2xs space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-100 text-indigo-800">문장 ${idx + 1}</span>
              ${d.targetFocus ? `<span class="text-[11px] font-semibold text-rose-700 truncate">집중 포인트: ${escapeHtml(d.targetFocus)}</span>` : ''}
            </div>
            <div class="flex flex-wrap items-center gap-1.5 shrink-0">
              <button type="button" data-speak-drill="${idx}"
                class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-50 hover:bg-sky-100 text-pte-blue border border-sky-200 transition cursor-pointer">
                🔊 듣기
              </button>
              <button type="button" data-record-drill="${idx}"
                class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  isRec
                    ? 'bg-slate-900 text-white ring-2 ring-rose-400'
                    : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                }">
                ${isRec ? '⏹️ 녹음 정지' : '🎤 따라 말하기'}
              </button>
              <button type="button"
                ${inVocab ? 'disabled' : ''}
                data-ai-vocab-word="${escapeHtml(drillWord)}"
                data-ai-vocab-meaning="${escapeHtml(d.translationKo || d.chunkingTipKo || '취약점 집중 문장')}"
                data-ai-vocab-example="${escapeHtml(d.sentence)}"
                class="${inVocab
                  ? 'px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default'
                  : 'px-2 py-1 rounded-lg text-[11px] font-bold bg-teal-600 hover:bg-teal-700 text-white transition cursor-pointer'}">
                ${inVocab ? '✓ 단어장 저장됨' : '+ 단어장'}
              </button>
            </div>
          </div>
          <p class="text-sm font-semibold text-slate-900 leading-relaxed">${escapeHtml(d.sentence || '')}</p>
          ${d.chunkingTipKo ? `<p class="text-[11px] text-indigo-700">💡 ${escapeHtml(d.chunkingTipKo)}</p>` : ''}
          ${d.translationKo ? `<p class="text-xs text-slate-500">${escapeHtml(d.translationKo)}</p>` : ''}
          ${blobUrl ? `
            <audio controls preload="metadata" src="${escapeHtml(blobUrl)}" class="w-full h-8 mt-1 rounded-lg"></audio>
          ` : ''}
        </div>
      `;
    }).join('');
  }
}

export async function generateWeaknessDrillsWithAi() {
  if (state.weaknessGenerating) return;
  const top5 = getTopWeaknesses(5);
  if (top5.length === 0) {
    el.weaknessGenStatus.classList.remove('hidden');
    el.weaknessGenStatus.textContent = '먼저 AI 채점/롤플레이를 1회 이상 진행하거나 [샘플 취약점 테스트]를 눌러 취약점을 등록해주세요.';
    return;
  }

  state.weaknessGenerating = true;
  el.btnGenerateWeaknessSentences.disabled = true;
  el.btnGenerateWeaknessSentences.classList.add('opacity-60');
  el.weaknessGenStatus.classList.remove('hidden');
  el.weaknessGenStatus.textContent = '⏳ Gemini AI가 TOP 5 취약점을 반영한 맞춤 훈련 5문장을 생성 중입니다...';

  const weaknessSummary = top5.map((w, i) => {
    return `${i + 1}. [${w.category}] "${w.target}" -> "${w.correction}" (${w.count || 1}x)`;
  }).join('\n');

  const prompt = [
    `You are a PTE Academic & New Zealand English speaking coach.`,
    `Based on the learner's top recurring pronunciation/omission/Konglish weaknesses below, write EXACTLY 5 natural, high-utility practice sentences (10-18 words each) designed to drill those exact words/expressions in realistic PTE or New Zealand everyday/ECE contexts.`,
    `\nLearner Top Weaknesses:\n${weaknessSummary}`,
    `\nRespond strictly in JSON matching this schema:`,
    `{`,
    `  "drills": [`,
    `    {`,
    `      "sentence": "<10-18 word natural English practice sentence>",`,
    `      "targetFocus": "<specific word or expression drilled in this sentence>",`,
    `      "chunkingTipKo": "<short Korean pronunciation/stress/phrasing tip>",`,
    `      "translationKo": "<natural Korean translation>"`,
    `    }`,
    `  ]`,
    `}`
  ].join('\n');

  try {
    const res = await callGeminiApi([{ text: prompt }]);
    const drills = Array.isArray(res?.drills) ? res.drills.slice(0, 5) : [];
    if (drills.length === 0) {
      throw new Error('유효한 5문장을 생성하지 못했습니다. 다시 시도해주세요.');
    }
    state.weaknessDrills = drills;
    saveStorage(STORAGE_KEYS.weaknessDrills, state.weaknessDrills);
    el.weaknessGenStatus.textContent = '✅ 맞춤 교정 5문장이 생성되었습니다! 🔊 원어민 발음 듣기와 🎤 따라 말하기로 바로 연습하세요.';
    renderWeaknessReport();
  } catch (err) {
    if (err.isMissingKey) {
      el.weaknessGenStatus.classList.add('hidden');
    } else {
      el.weaknessGenStatus.textContent = '❌ ' + (err.message || '문장 생성 중 오류가 발생했습니다.');
    }
  } finally {
    state.weaknessGenerating = false;
    el.btnGenerateWeaknessSentences.disabled = false;
    el.btnGenerateWeaknessSentences.classList.remove('opacity-60');
  }
}

export function stopDrillRecording(discard = false) {
  if (state.drillMediaRecorder && state.drillMediaRecorder.state !== 'inactive') {
    state._drillDiscard = Boolean(discard);
    try {
      state.drillMediaRecorder.stop();
    } catch (e) {
      releaseMicrophoneStream();
      state.drillRecordingIdx = null;
    }
  } else {
    if (discard) releaseMicrophoneStream();
    state.drillRecordingIdx = null;
  }
}

export async function toggleDrillRecording(idx) {
  if (state.drillRecordingIdx === idx) {
    stopDrillRecording(false);
    return;
  }
  if (state.drillRecordingIdx !== null) {
    stopDrillRecording(true);
  }

  ensureAudioContext();
  cancelSpeech();
  const ok = await requestMicrophone();
  if (!ok || !state.micStream || state.mode !== 'review') {
    releaseMicrophoneStream();
    if (el.weaknessTtsStatus) el.weaknessTtsStatus.textContent = '마이크 권한이 없어 녹음할 수 없습니다.';
    return;
  }

  try {
    state.drillAudioChunks = [];
    state._drillDiscard = false;
    const mime = pickSupportedMimeType();
    const options = mime ? { mimeType: mime } : undefined;
    const recorder = new MediaRecorder(state.micStream, options);
    const actualMime = (recorder.mimeType || mime || 'audio/webm').split(';')[0];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) state.drillAudioChunks.push(ev.data);
    };

    recorder.onstop = () => {
      releaseMicrophoneStream();
      state.drillMediaRecorder = null;
      const prevIdx = state.drillRecordingIdx;
      state.drillRecordingIdx = null;
      const discard = state._drillDiscard;
      state._drillDiscard = false;

      if (!discard && prevIdx !== null && state.drillAudioChunks.length > 0) {
        const blob = new Blob(state.drillAudioChunks, { type: actualMime });
        if (state.drillBlobMap[prevIdx]) {
          try { URL.revokeObjectURL(state.drillBlobMap[prevIdx]); } catch (e) {}
        }
        state.drillBlobMap[prevIdx] = URL.createObjectURL(blob);
        if (el.weaknessTtsStatus) {
          el.weaknessTtsStatus.textContent = `문장 ${prevIdx + 1} 녹음 완료! 위 플레이어에서 내 발음을 들어보세요.`;
        }
      }
      state.drillAudioChunks = [];
      renderWeaknessReport();
    };

    state.drillMediaRecorder = recorder;
    state.drillRecordingIdx = idx;
    recorder.start();
    if (el.weaknessTtsStatus) {
      el.weaknessTtsStatus.textContent = `🔴 문장 ${idx + 1} 녹음 중... 완료되면 [⏹️ 녹음 정지]를 누르세요.`;
    }
    renderWeaknessReport();
  } catch (err) {
    releaseMicrophoneStream();
    state.drillRecordingIdx = null;
  }
}

export function initVocabFeature() {
  el.btnBookmarkSpeaking.addEventListener('click', () => {
    const q = getCurrentQuestion();
    if (q) toggleBookmarkItem(q, state.mode);
  });
  el.btnBookmarkWriting.addEventListener('click', () => {
    const q = getCurrentWritingQuestion();
    if (q) toggleBookmarkItem(q, state.writingSubmode);
  });
  el.btnQuickVocabSpeaking.addEventListener('click', openQuickVocabModal);
  el.btnQuickVocabWriting.addEventListener('click', openQuickVocabModal);
  el.btnCloseQuickVocab.addEventListener('click', closeQuickVocabModal);
  el.btnCancelQuickVocab.addEventListener('click', closeQuickVocabModal);
  el.quickVocabModal.addEventListener('click', (e) => {
    if (e.target === el.quickVocabModal) closeQuickVocabModal();
  });
  el.quickVocabForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (addVocabItem(el.qvWord.value, el.qvMeaning.value, el.qvExample.value)) {
      closeQuickVocabModal();
    }
  });

  el.vocabForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (addVocabItem(el.vocabWordInput.value, el.vocabMeaningInput.value, el.vocabExampleInput.value)) {
      el.vocabWordInput.value = '';
      el.vocabMeaningInput.value = '';
      el.vocabExampleInput.value = '';
      el.vocabWordInput.focus();
    }
  });
  el.vocabSearchInput.addEventListener('input', (e) => {
    state.vocabSearch = e.target.value;
    renderVocabList();
  });
  el.vocabFilterSelect.addEventListener('change', (e) => {
    state.vocabFilter = e.target.value;
    renderVocabList();
  });

  el.bookmarkFilterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.bm-filter-btn');
    if (!btn) return;
    state.bookmarkFilter = btn.dataset.filter || 'all';
    renderBookmarkList();
  });

  el.reviewWorkspace.addEventListener('click', (e) => {
    const jumpBtn = e.target.closest('[data-jump-qid]');
    if (jumpBtn) {
      openQuestionById(jumpBtn.dataset.jumpQid);
      return;
    }
    const removeBmBtn = e.target.closest('[data-remove-bm]');
    if (removeBmBtn) {
      const targetId = removeBmBtn.dataset.removeBm;
      state.bookmarks = state.bookmarks.filter(b => b.id !== targetId);
      saveStorage(STORAGE_KEYS.bookmarks, state.bookmarks);
      updateReviewTabBadge();
      renderSpeakingBookmarkBtn();
      renderWritingBookmarkBtn();
      renderReviewDashboard();
      return;
    }
    const speakVocabBtn = e.target.closest('[data-speak-vocab]');
    if (speakVocabBtn) {
      speakText(speakVocabBtn.dataset.speakVocab, { targetMode: 'repeat-sentence' });
      return;
    }
    const deleteVocabBtn = e.target.closest('[data-delete-vocab]');
    if (deleteVocabBtn) {
      const targetId = deleteVocabBtn.dataset.deleteVocab;
      state.vocabList = state.vocabList.filter(v => v.id !== targetId);
      saveStorage(STORAGE_KEYS.vocabList, state.vocabList);
      updateReviewTabBadge();
      renderReviewDashboard();
    }
  });

  el.reviewWorkspace.addEventListener('change', (e) => {
    const checkbox = e.target.closest('[data-toggle-vocab]');
    if (!checkbox) return;
    const targetId = checkbox.dataset.toggleVocab;
    const item = state.vocabList.find(v => v.id === targetId);
    if (item) {
      item.memorized = Boolean(checkbox.checked);
      saveStorage(STORAGE_KEYS.vocabList, state.vocabList);
      renderVocabList();
    }
  });

  el.btnClearLogs.addEventListener('click', () => {
    state.practiceLogs = [];
    state.lastSpeakingLogId = null;
    state.lastWritingLogId = null;
    saveStorage(STORAGE_KEYS.practiceLogs, []);
    renderReviewDashboard();
  });

  // Shared delegation for AI result, Roleplay, Weakness Drill, YouTube Shadowing, and Brain Pattern containers (+ 단어장 추가 / settings shortcut)
  [el.writingAiResult, el.speakingAiResult, el.roleplayWorkspace, el.weaknessReportCard, el.ytShadowingWorkspace, el.brainPatternWorkspace].filter(Boolean).forEach(container => {
    container.addEventListener('click', (e) => {
      const addBtn = e.target.closest('[data-ai-vocab-word]');
      if (addBtn) {
        const word = addBtn.dataset.aiVocabWord;
        const meaning = addBtn.dataset.aiVocabMeaning || '실전 추천 표현';
        const example = addBtn.dataset.aiVocabExample || '';
        if (addVocabItem(word, meaning, example)) {
          addBtn.textContent = '✓ 단어장 저장됨';
          addBtn.disabled = true;
          addBtn.className = 'shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default';
        }
        return;
      }
      if (e.target.closest('[data-open-ai-settings]')) {
        openAiSettingsModal();
      }
    });
  });

  // Weakness Report Event Listeners
  if (el.weaknessAddForm) {
    el.weaknessAddForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const target = (el.weaknessTargetInput?.value || '').trim();
      const fix = (el.weaknessFixInput?.value || '').trim();
      const cat = el.weaknessTypeSelect?.value || 'pronunciation';
      if (!target || !fix) return;
      recordWeaknessEntry({
        target,
        correction: fix,
        category: cat,
        sourceMode: 'manual'
      });
      el.weaknessTargetInput.value = '';
      el.weaknessFixInput.value = '';
      renderWeaknessReport();
    });
  }
  if (el.btnSeedSampleWeakness) {
    el.btnSeedSampleWeakness.addEventListener('click', () => {
      const samples = [
        { target: 'thoroughly', correction: '/ˈθʌrəli/ (th 무성음 + 강세 첫음절 주의)', category: 'pronunciation', sourceMode: 'read-aloud' },
        { target: 'curriculum', correction: '/kəˈrɪkjələm/ (두 번째 음절 강세, 커리큘럼 장모음 주의)', category: 'pronunciation', sourceMode: 'describe-image' },
        { target: 'play together with friends', correction: 'engage in collaborative play with peers (ECE 전문 표현)', category: 'konglish', sourceMode: 'impromptu' },
        { target: 'have a cold symptom', correction: 'have a runny nose and sore throat / coming down with a cold', category: 'konglish', sourceMode: 'roleplay' },
        { target: 'environment', correction: '/ɪnˈvaɪrənmənt/ (n 발음 누락 주의)', category: 'pronunciation', sourceMode: 'repeat-sentence' }
      ];
      samples.forEach(s => recordWeaknessEntry(s));
      renderWeaknessReport();
    });
  }
  if (el.btnClearWeakness) {
    el.btnClearWeakness.addEventListener('click', () => {
      state.weaknessLogs = [];
      state.weaknessDrills = [];
      saveStorage(STORAGE_KEYS.weaknessLogs, []);
      saveStorage(STORAGE_KEYS.weaknessDrills, []);
      if (el.weaknessGenStatus) el.weaknessGenStatus.classList.add('hidden');
      renderWeaknessReport();
    });
  }
  if (el.weaknessTop5List) {
    el.weaknessTop5List.addEventListener('click', (e) => {
      const speakBtn = e.target.closest('[data-speak-weakness]');
      if (speakBtn) {
        speakText(speakBtn.dataset.speakWeakness, { targetMode: 'weakness-drill' });
        return;
      }
      const delBtn = e.target.closest('[data-delete-weakness]');
      if (delBtn) {
        const id = delBtn.dataset.deleteWeakness;
        state.weaknessLogs = state.weaknessLogs.filter(w => w.id !== id);
        saveStorage(STORAGE_KEYS.weaknessLogs, state.weaknessLogs);
        renderWeaknessReport();
      }
    });
  }
  if (el.weaknessDrillList) {
    el.weaknessDrillList.addEventListener('click', (e) => {
      const speakBtn = e.target.closest('[data-speak-drill]');
      if (speakBtn) {
        const idx = parseInt(speakBtn.dataset.speakDrill, 10);
        const drill = state.weaknessDrills[idx];
        if (drill && drill.sentence) {
          speakText(drill.sentence, { targetMode: 'weakness-drill' });
        }
        return;
      }
      const recBtn = e.target.closest('[data-record-drill]');
      if (recBtn) {
        const idx = parseInt(recBtn.dataset.recordDrill, 10);
        if (!Number.isNaN(idx)) toggleDrillRecording(idx);
      }
    });
  }
  if (el.btnGenerateWeaknessSentences) {
    el.btnGenerateWeaknessSentences.addEventListener('click', generateWeaknessDrillsWithAi);
  }
}
