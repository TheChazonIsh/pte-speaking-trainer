import { SWT_QUESTIONS, ESSAY_QUESTIONS } from '../data/questions.js';
import { STORAGE_KEYS, WRITING_CONFIG } from '../config/constants.js';
import { escapeHtml } from '../utils/security.js';
import {
  isQuotaExceededError,
  showStorageQuotaToast,
  safeGetStorage,
  saveStorage,
} from '../utils/storage.js';
import { state, el } from '../state/store.js';
import { ensureAudioContext, playBeep } from '../services/audio.js';
import {
  callGeminiApi,
  cancelPendingWritingGrade,
  setAiLoadingState,
  renderAiErrorCard,
  renderHighScoreExpressionsSection,
} from '../services/gemini.js';
import {
  isQuestionSolved,
  markQuestionSolved,
  pickRandomIndex,
  renderStudyStepper,
  toggleWritingToolsDrawer,
} from './speaking.js';
import {
  renderWritingBookmarkBtn,
  recordPracticeLog,
  attachAiScoreToPracticeLog,
} from './vocab.js';

export function getWritingQuestions() {
  return state.writingSubmode === 'swt' ? SWT_QUESTIONS : ESSAY_QUESTIONS;
}

export function getCurrentWritingQuestion() {
  const list = getWritingQuestions();
  return list[state.writingIndex[state.writingSubmode]] || list[0];
}

export function getWritingStorageKey(questionId) {
  return `pte_writing_draft_${questionId}`;
}

export function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function formatMMSS(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function stopWritingTimer() {
  if (state.writingTimerId !== null) {
    clearInterval(state.writingTimerId);
    state.writingTimerId = null;
  }
  state.writingTimerRunning = false;
}

export function resetWritingTimer() {
  stopWritingTimer();
  state.writingTimerRemaining = WRITING_CONFIG[state.writingSubmode].durationSeconds;
  renderWritingTimerUI();
}

export function toggleWritingTimer() {
  ensureAudioContext();
  if (state.writingTimerRunning) {
    stopWritingTimer();
    renderWritingTimerUI();
    return;
  }

  if (state.writingTimerRemaining <= 0) {
    state.writingTimerRemaining = WRITING_CONFIG[state.writingSubmode].durationSeconds;
  }

  state.writingTimerRunning = true;
  renderWritingTimerUI();

  state.writingTimerId = setInterval(() => {
    state.writingTimerRemaining -= 1;
    if (state.writingTimerRemaining <= 0) {
      state.writingTimerRemaining = 0;
      stopWritingTimer();
      playBeep(660, 0.25);
    }
    renderWritingTimerUI();
  }, 1000);
}

export function renderWritingTimerUI() {
  el.writingTimerDisplay.textContent = formatMMSS(state.writingTimerRemaining);

  if (state.writingTimerRemaining === 0) {
    el.writingTimerStatus.textContent = '시간 종료 (Time Up!)';
    el.writingTimerStatus.className = 'text-xs sm:text-sm font-bold text-rose-700';
    el.writingTimerSub.textContent = '초기화 버튼을 눌러 다시 시작할 수 있습니다';
    el.btnWritingTimerToggle.textContent = '다시 시작';
    el.btnWritingTimerToggle.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-pte-blue hover:bg-sky-700 transition cursor-pointer';
  } else if (state.writingTimerRunning) {
    el.writingTimerStatus.textContent = '작성 타이머 진행 중...';
    el.writingTimerStatus.className = 'text-xs sm:text-sm font-bold text-pte-blue';
    el.writingTimerSub.textContent = state.writingSubmode === 'swt' ? 'SWT 제한 시간: 10분' : 'Essay 제한 시간: 20분';
    el.btnWritingTimerToggle.textContent = '일시정지';
    el.btnWritingTimerToggle.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 transition cursor-pointer';
  } else {
    el.writingTimerStatus.textContent = '타이머 일시정지 / 대기 중';
    el.writingTimerStatus.className = 'text-xs sm:text-sm font-bold text-slate-800';
    el.writingTimerSub.textContent = '타이머 시작 없이도 바로 작성할 수 있습니다';
    el.btnWritingTimerToggle.textContent = '타이머 시작';
    el.btnWritingTimerToggle.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white bg-pte-blue hover:bg-sky-700 transition cursor-pointer';
  }
  renderStudyStepper();
}

export function validateAndUpdateWritingStats() {
  const text = el.writingTextarea.value;
  const words = countWords(text);
  const cfg = WRITING_CONFIG[state.writingSubmode];

  el.writingWordCount.textContent = `${words} words`;

  if (state.writingSubmode === 'swt') {
    if (words === 0) {
      el.writingRangeBadge.textContent = '권장: 5~75 words (작성 대기)';
      el.writingRangeBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600';
    } else if (words >= cfg.minWords && words <= cfg.maxWords) {
      el.writingRangeBadge.textContent = `적정 범위 (${cfg.minWords}~${cfg.maxWords} words)`;
      el.writingRangeBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700';
    } else if (words < cfg.minWords) {
      el.writingRangeBadge.textContent = `단어 부족 (최소 ${cfg.minWords} words)`;
      el.writingRangeBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700';
    } else {
      el.writingRangeBadge.textContent = `단어 초과 (최대 ${cfg.maxWords} words)`;
      el.writingRangeBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700';
    }

    el.swtSentenceCheck.classList.remove('hidden');
    const trimmed = text.trim();
    if (!trimmed) {
      el.swtSentenceCheck.innerHTML = '💡 SWT 규칙: 반드시 <strong>5~75단어 이내의 한 문장(1 sentence)</strong>으로 작성하고, 마침표(<code>.</code>)는 맨 끝에만 한 번 찍어야 합니다.';
      el.swtSentenceCheck.className = 'rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-600';
    } else {
      const endPunctMatches = trimmed.match(/[.!?]+(?=\s|$)/g) || [];
      const endsWithPeriod = /\.$/.test(trimmed);

      if (endPunctMatches.length > 1) {
        el.swtSentenceCheck.textContent = `⚠️ 문장 종결 부호가 ${endPunctMatches.length}개 감지되었습니다 — SWT는 반드시 1개의 문장으로 작성해야 합니다.`;
        el.swtSentenceCheck.className = 'rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700';
      } else if (!endsWithPeriod) {
        el.swtSentenceCheck.textContent = '⚠️ 문장 마지막을 마침표(.)로 끝내주세요.';
        el.swtSentenceCheck.className = 'rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-800';
      } else {
        el.swtSentenceCheck.textContent = '✅ 한 문장 & 마지막 마침표(.) 조건을 충족했습니다.';
        el.swtSentenceCheck.className = 'rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-700';
      }
    }
  } else {
    el.swtSentenceCheck.classList.add('hidden');
    if (words === 0) {
      el.writingRangeBadge.textContent = '권장: 200~300 words (작성 대기)';
      el.writingRangeBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600';
    } else if (words < cfg.minWords) {
      el.writingRangeBadge.textContent = `단어 수 부족 (권장 200~300 words · ${cfg.minWords - words}단어 더 필요)`;
      el.writingRangeBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800';
    } else if (words <= cfg.maxWords) {
      el.writingRangeBadge.textContent = '권장 범위 충족 (200~300 words)';
      el.writingRangeBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700';
    } else {
      el.writingRangeBadge.textContent = `권장 범위 초과 (최대 300 words · ${words - cfg.maxWords}단어 초과)`;
      el.writingRangeBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700';
    }
  }
}

export function renderWritingSubtabs() {
  const isSwt = state.writingSubmode === 'swt';
  el.subtabSwt.className = isSwt
    ? 'px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold bg-pte-blue text-white shadow-xs transition cursor-pointer'
    : 'px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer';
  el.subtabEssay.className = !isSwt
    ? 'px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold bg-pte-blue text-white shadow-xs transition cursor-pointer'
    : 'px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer';
}

export function renderWritingQuestionSelector() {
  const list = getWritingQuestions();
  const currentIdx = state.writingIndex[state.writingSubmode];
  const currentQ = list[currentIdx];

  const solvedCount = list.filter(item => isQuestionSolved(item.id)).length;
  el.writingSolvedBadge.textContent = `풀이 완료: ${solvedCount} / ${list.length}`;

  const currentSolved = currentQ && isQuestionSolved(currentQ.id);
  el.btnWritingToggleSolved.textContent = currentSolved ? '✓ 완료됨' : '✓ 완료 표시';
  el.btnWritingToggleSolved.className = currentSolved
    ? 'px-2.5 py-1.5 rounded-lg text-xs font-bold border border-emerald-300 bg-emerald-50 text-emerald-700 transition cursor-pointer'
    : 'px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 bg-white hover:bg-emerald-50 text-slate-600 transition cursor-pointer';

  el.chkWritingUnsolvedFirst.checked = state.unsolvedFirst;

  el.writingQuestionPills.innerHTML = '';
  list.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const solved = isQuestionSolved(item.id);
    btn.textContent = solved ? `문제 ${idx + 1} ✓` : `문제 ${idx + 1}`;
    if (idx === currentIdx) {
      btn.className = 'shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-pte-blue text-white shadow-xs transition cursor-pointer';
    } else if (solved) {
      btn.className = 'shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition cursor-pointer';
    } else {
      btn.className = 'shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer';
    }
    btn.addEventListener('click', () => selectWritingQuestion(idx));
    el.writingQuestionPills.appendChild(btn);
  });

  el.btnWritingPrevQ.disabled = currentIdx === 0;
  el.btnWritingNextQ.disabled = currentIdx === list.length - 1;
}

export function renderWritingModelBox() {
  el.btnToggleWritingModel.setAttribute('aria-expanded', String(state.writingModelVisible));
  if (state.writingModelVisible) {
    el.writingModelBox.classList.remove('hidden');
    el.writingModelBtnText.textContent = '모범 답안 예시 숨기기';
    el.writingModelChevron.classList.add('rotate-180');
  } else {
    el.writingModelBox.classList.add('hidden');
    el.writingModelBtnText.textContent = '모범 답안 예시 보기';
    el.writingModelChevron.classList.remove('rotate-180');
  }
}

export function renderWritingContent() {
  const q = getCurrentWritingQuestion();
  if (!q) return;
  const cfg = WRITING_CONFIG[state.writingSubmode];

  el.wQBadge.textContent = q.id;
  el.wQTitle.textContent = q.title;
  el.wQMeta.textContent = `${cfg.minWords}~${cfg.maxWords} words · ${q.topic}`;
  el.wInstructionBox.innerHTML = cfg.instruction;
  el.wPromptText.textContent = q.passage;
  renderWritingBookmarkBtn();

  state.lastWritingLogId = null;
  if (el.writingAiResult) {
    el.writingAiResult.classList.add('hidden');
    el.writingAiResult.innerHTML = '';
  }

  el.wModelAnswer.textContent = q.modelAnswer;
  el.wModelWordCount.textContent = `${countWords(q.modelAnswer)} words`;
  el.wModelTip.textContent = q.tip;
  renderWritingModelBox();

  const saved = safeGetStorage(getWritingStorageKey(q.id), '', false) || '';
  el.writingTextarea.value = saved;
  el.writingSaveStatus.textContent = saved
    ? '저장된 답안 불러옴'
    : '자동 저장 대기';

  validateAndUpdateWritingStats();
}

export function switchWritingSubmode(submode) {
  if (state.writingSubmode === submode) return;
  cancelPendingWritingGrade();
  state.writingSubmode = submode;
  state.writingModelVisible = false;
  resetWritingTimer();
  renderWritingSubtabs();
  renderWritingQuestionSelector();
  renderWritingContent();
}

export function selectWritingQuestion(index) {
  const list = getWritingQuestions();
  if (index < 0 || index >= list.length) return;
  cancelPendingWritingGrade();
  state.writingIndex[state.writingSubmode] = index;
  state.writingModelVisible = false;
  renderWritingQuestionSelector();
  renderWritingContent();
}

export function renderWritingAiResult(data) {
  const overall = Math.max(10, Math.min(90, Math.round(Number(data.overallScore) || 0)));
  const criteria = data.criteria || {};
  const criteriaItems = [
    { key: 'content', label: 'Content (내용)' },
    { key: 'form', label: 'Form (형식/단어수)' },
    { key: 'grammar', label: 'Grammar (문법)' },
    { key: 'vocabulary', label: 'Vocabulary (어휘)' },
    { key: 'spelling', label: 'Spelling (철자)' }
  ];
  const corrections = Array.isArray(data.corrections) ? data.corrections : [];

  el.writingAiResult.classList.remove('hidden');
  el.writingAiResult.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-indigo-100">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-indigo-600">Gemini AI Writing Assessment</span>
        <h3 class="text-base sm:text-lg font-extrabold text-slate-900">PTE Academic AI 채점 리포트</h3>
      </div>
      <div class="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-pte-blue text-white text-center shadow-xs">
        <span class="block text-[10px] font-medium opacity-85">90점 만점 환산 예상점수</span>
        <span class="text-2xl font-extrabold tabular-nums">${overall} <span class="text-xs font-normal opacity-80">/ 90</span></span>
      </div>
    </div>

    ${data.overallFeedback ? `
      <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 p-3.5 text-xs sm:text-sm text-slate-800 leading-relaxed">
        <strong class="text-indigo-900">총평:</strong> ${escapeHtml(data.overallFeedback)}
      </div>
    ` : ''}

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
      ${criteriaItems.map(c => {
        const info = criteria[c.key] || {};
        return `
          <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-bold text-slate-700">${c.label}</span>
              <span class="px-2 py-0.5 rounded-md text-xs font-bold bg-indigo-100 text-indigo-800">${escapeHtml(info.score || '-')}</span>
            </div>
            <p class="text-[11px] text-slate-600 leading-relaxed">${escapeHtml(info.comment || '')}</p>
          </div>
        `;
      }).join('')}
    </div>

    <div class="space-y-2">
      <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">✍️ 문장별 첨삭 교정</h4>
      ${corrections.length === 0 ? `
        <p class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">치명적인 문법/표현 오류가 발견되지 않았습니다. 훌륭합니다!</p>
      ` : corrections.map(cor => `
        <div class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-1.5 text-xs">
          <p class="text-rose-700 line-through">${escapeHtml(cor.original || '')}</p>
          <p class="text-emerald-800 font-bold">→ ${escapeHtml(cor.corrected || '')}</p>
          ${cor.reason ? `<p class="text-slate-600">${escapeHtml(cor.reason)}</p>` : ''}
        </div>
      `).join('')}
    </div>

    ${renderHighScoreExpressionsSection(data.highScoreExpressions)}
  `;
}

export async function gradeWritingWithAi() {
  if (state.writingGradingBusy) return;
  const q = getCurrentWritingQuestion();
  if (!q) return;

  const reqSubmode = state.writingSubmode;
  const reqQId = q.id;
  const reqQTitle = q.title;
  const userText = (el.writingTextarea.value || '').trim();
  const words = countWords(userText);
  if (words < 3) {
    renderAiErrorCard(el.writingAiResult, '최소 3단어 이상 작성한 뒤 AI 채점을 요청해주세요.');
    return;
  }

  const cfg = WRITING_CONFIG[reqSubmode];
  const taskLabel = reqSubmode === 'swt' ? 'Summarize Written Text (SWT, 1 sentence, 5-75 words)' : 'Write Essay (200-300 words)';
  const prompt = [
    `You are a strict official PTE Academic Writing examiner.`,
    `Task Type: ${taskLabel}`,
    `Question ID: ${reqQId} (${reqQTitle})`,
    `Source Prompt / Passage:\n${q.passage}`,
    `\nCandidate Response (${words} words):\n${userText}`,
    `\nEvaluate Content, Form (${cfg.minWords}-${cfg.maxWords} words${reqSubmode === 'swt' ? ', strictly ONE single sentence with one ending period' : ''}), Grammar, Vocabulary, and Spelling.`,
    `Respond strictly in JSON matching this schema (all explanations/feedback in Korean):`,
    `{`,
    `  "overallScore": <integer 10..90>,`,
    `  "overallFeedback": "<2-3 sentences summary in Korean>",`,
    `  "criteria": {`,
    `    "content": { "score": "<e.g. 2/2 or 2/3>", "comment": "<Korean comment>" },`,
    `    "form": { "score": "<e.g. 1/1 or 2/2>", "comment": "<Korean comment>" },`,
    `    "grammar": { "score": "<e.g. 2/2>", "comment": "<Korean comment>" },`,
    `    "vocabulary": { "score": "<e.g. 2/2>", "comment": "<Korean comment>" },`,
    `    "spelling": { "score": "<e.g. 2/2>", "comment": "<Korean comment>" }`,
    `  },`,
    `  "corrections": [`,
    `    { "original": "<sentence or phrase from response>", "corrected": "<improved English>", "reason": "<Korean explanation>" }`,
    `  ],`,
    `  "highScoreExpressions": [`,
    `    { "expression": "<advanced English phrase>", "meaningKo": "<Korean meaning>", "example": "<short academic sentence>" }`,
    `  ]`,
    `}`
  ].join('\n');

  if (state.writingGradeAbort) {
    try { state.writingGradeAbort.abort(); } catch (e) {}
  }
  const abortCtrl = new AbortController();
  state.writingGradeAbort = abortCtrl;
  const reqSeq = ++state.writingGradeSeq;
  state.writingGradingBusy = true;
  setAiLoadingState(el.writingAiResult, el.btnAiGradeWriting, 'Writing 답안을 분석하고 첨삭 중입니다...');
  try {
    const result = await callGeminiApi([{ text: prompt }], { timeoutMs: 25000, signal: abortCtrl.signal });
    const isStale = (
      reqSeq !== state.writingGradeSeq ||
      state.mode !== 'writing' ||
      state.writingSubmode !== reqSubmode ||
      getCurrentWritingQuestion()?.id !== reqQId
    );
    if (isStale) return;

    renderWritingAiResult(result);
    markQuestionSolved(reqQId, true);
    renderWritingQuestionSelector();
    state.lastWritingLogId = attachAiScoreToPracticeLog(
      state.lastWritingLogId,
      reqQId,
      reqSubmode,
      reqQTitle,
      result.overallScore
    );
  } catch (err) {
    if (err?.isAborted || reqSeq !== state.writingGradeSeq) return;
    if (err.isMissingKey) {
      el.writingAiResult.classList.add('hidden');
    } else {
      renderAiErrorCard(el.writingAiResult, err.message || 'AI 채점 중 오류가 발생했습니다.');
    }
  } finally {
    if (state.writingGradeAbort === abortCtrl) {
      state.writingGradeAbort = null;
    }
    if (reqSeq === state.writingGradeSeq) {
      state.writingGradingBusy = false;
      el.btnAiGradeWriting.disabled = false;
      el.btnAiGradeWriting.classList.remove('opacity-60');
    }
  }
}

export function initWritingFeature() {
  if (el.btnToggleWritingTools) {
    el.btnToggleWritingTools.addEventListener('click', toggleWritingToolsDrawer);
  }

  el.subtabSwt.addEventListener('click', () => switchWritingSubmode('swt'));
  el.subtabEssay.addEventListener('click', () => switchWritingSubmode('essay'));
  el.btnWritingToggleSolved.addEventListener('click', () => {
    const q = getCurrentWritingQuestion();
    if (!q) return;
    const nextSolved = !isQuestionSolved(q.id);
    markQuestionSolved(q.id, nextSolved);
    if (nextSolved && !state.lastWritingLogId) {
      state.lastWritingLogId = recordPracticeLog(q.id, state.writingSubmode, q.title, null);
    }
    renderWritingQuestionSelector();
  });
  el.chkWritingUnsolvedFirst.addEventListener('change', (e) => {
    state.unsolvedFirst = Boolean(e.target.checked);
    el.chkUnsolvedFirst.checked = state.unsolvedFirst;
    saveStorage(STORAGE_KEYS.unsolvedFirst, state.unsolvedFirst);
  });
  el.btnWritingRandomQ.addEventListener('click', () => {
    const list = getWritingQuestions();
    const nextIdx = pickRandomIndex(list, state.writingIndex[state.writingSubmode]);
    selectWritingQuestion(nextIdx);
  });
  el.btnWritingPrevQ.addEventListener('click', () => selectWritingQuestion(state.writingIndex[state.writingSubmode] - 1));
  el.btnWritingNextQ.addEventListener('click', () => selectWritingQuestion(state.writingIndex[state.writingSubmode] + 1));

  el.btnWritingTimerToggle.addEventListener('click', toggleWritingTimer);
  el.btnWritingTimerReset.addEventListener('click', resetWritingTimer);

  el.btnToggleWritingModel.addEventListener('click', () => {
    state.writingModelVisible = !state.writingModelVisible;
    renderWritingModelBox();
  });

  el.writingTextarea.addEventListener('input', () => {
    const q = getCurrentWritingQuestion();
    if (!q) return;
    try {
      localStorage.setItem(getWritingStorageKey(q.id), el.writingTextarea.value);
      el.writingSaveStatus.textContent = '자동 저장됨';
    } catch (e) {
      if (isQuotaExceededError(e)) showStorageQuotaToast();
      el.writingSaveStatus.textContent = '저장 공간 부족';
    }
    validateAndUpdateWritingStats();
  });

  el.btnCopyWriting.addEventListener('click', async () => {
    const text = el.writingTextarea.value;
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        el.writingTextarea.select();
        document.execCommand('copy');
      }
      const orig = el.btnCopyWriting.textContent;
      el.btnCopyWriting.textContent = '✅ 복사 완료!';
      setTimeout(() => {
        el.btnCopyWriting.textContent = orig;
      }, 1600);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  });

  el.btnClearWriting.addEventListener('click', () => {
    const q = getCurrentWritingQuestion();
    el.writingTextarea.value = '';
    if (q) {
      try { localStorage.removeItem(getWritingStorageKey(q.id)); } catch (e) {}
    }
    el.writingSaveStatus.textContent = '초안 삭제됨';
    validateAndUpdateWritingStats();
  });

  el.btnAiGradeWriting.addEventListener('click', gradeWritingWithAi);
}
