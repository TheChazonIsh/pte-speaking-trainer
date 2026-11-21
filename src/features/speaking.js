import {
  READ_ALOUD_QUESTIONS,
  DESCRIBE_IMAGE_QUESTIONS,
  REPEAT_SENTENCE_QUESTIONS,
  RETELL_LECTURE_QUESTIONS,
  IMPROMPTU_QUESTIONS,
} from '../data/questions.js';
import { STORAGE_KEYS, MODE_CONFIG, DI_COLOR_PALETTE } from '../config/constants.js';
import { escapeHtml, sanitizeHttpUrl } from '../utils/security.js';
import {
  isQuotaExceededError,
  showStorageQuotaToast,
  safeGetStorage,
  saveStorage,
} from '../utils/storage.js';
import { state, el } from '../state/store.js';
import { renderSvgChart } from '../charts/svgChart.js';
import {
  ensureAudioContext,
  playBeep,
  releaseMicrophoneStream,
  requestMicrophone,
  startMediaRecording,
  stopMediaRecording,
  clearPlayback,
} from '../services/audio.js';
import {
  blobToBase64,
  callGeminiApi,
  cancelPendingSpeakingGrade,
  cancelPendingWritingGrade,
  cancelPendingYtsGrade,
  setAiLoadingState,
  renderAiErrorCard,
  renderHighScoreExpressionsSection,
  syncGeminiTtsUI,
} from '../services/gemini.js';
import {
  cancelSpeech,
  stopShadowingCompare,
  startShadowingCompare,
  speakText,
  syncVoiceDropdowns,
} from '../services/tts.js';
import {
  countWords,
  formatMMSS,
  renderWritingSubtabs,
  renderWritingQuestionSelector,
  renderWritingContent,
  renderWritingTimerUI,
  stopWritingTimer,
} from './writing.js';
import {
  updateBookmarkButtonState,
  renderSpeakingBookmarkBtn,
  recordPracticeLog,
  attachAiScoreToPracticeLog,
  renderReviewDashboard,
  extractAndRecordWeaknessesFromAi,
  stopDrillRecording,
} from './vocab.js';
import {
  stopYouTubeClipPlayback,
  playYouTubeClipSegment,
  renderRetellLectureSourceUI,
  renderYtClipSetsAndClips,
  renderYtsWorkspace,
  stopYtsComparePlayback,
  stopYtsRecording,
  stopYtsPlayback,
} from './youtube.js';
import { renderRoleplayWorkspace, stopRoleplayRecording } from './roleplay.js';
import { renderBpWorkspace, stopBpRecording } from './brainPattern.js';

export function getRepeatSentenceList() {
  return [...REPEAT_SENTENCE_QUESTIONS, ...(Array.isArray(state.customRsQuestions) ? state.customRsQuestions : [])];
}

export function getActiveYtSet() {
  if (!Array.isArray(state.ytClipSets) || state.ytClipSets.length === 0) return null;
  return state.ytClipSets.find(s => s.id === state.activeYtSetId) || state.ytClipSets[0];
}

export function getRetellLectureQuestions() {
  if (state.rlSourceMode === 'youtube') {
    const activeSet = getActiveYtSet();
    if (!activeSet || !Array.isArray(activeSet.clips)) return [];
    return activeSet.clips.map(clip => ({
      id: clip.id,
      title: clip.title,
      topic: activeSet.title,
      script: clip.script || '',
      keywords: clip.keywords || [],
      modelAnswer: clip.modelAnswer || '',
      translation: clip.translation || '',
      videoId: activeSet.videoId,
      startSec: Number(clip.startSec) || 0,
      endSec: Number(clip.endSec) || 60,
      isYoutubeClip: true
    }));
  }
  return RETELL_LECTURE_QUESTIONS;
}

export function getDescribeImageList() {
  return [...DESCRIBE_IMAGE_QUESTIONS, ...(Array.isArray(state.customDiQuestions) ? state.customDiQuestions : [])];
}

export function getQuestionsForMode(mode = state.mode) {
  if (mode === 'read-aloud') return READ_ALOUD_QUESTIONS;
  if (mode === 'describe-image') return getDescribeImageList();
  if (mode === 'repeat-sentence') return getRepeatSentenceList();
  if (mode === 'retell-lecture') return getRetellLectureQuestions();
  if (mode === 'impromptu') return IMPROMPTU_QUESTIONS;
  return [];
}

export function getCurrentQuestion() {
  const list = getQuestionsForMode();
  if (list.length === 0) return null;
  const maxIdx = list.length - 1;
  if ((state.questionIndex[state.mode] || 0) > maxIdx) {
    state.questionIndex[state.mode] = 0;
  }
  return list[state.questionIndex[state.mode]] || list[0];
}

export function isQuestionSolved(id) {
  return Boolean(state.solvedMap && state.solvedMap[id]);
}

export function markQuestionSolved(id, solved = true) {
  if (!id) return;
  if (solved) {
    state.solvedMap[id] = true;
  } else {
    delete state.solvedMap[id];
  }
  saveStorage(STORAGE_KEYS.solved, state.solvedMap);
}

export function pickRandomIndex(list, currentIdx) {
  if (!list || list.length <= 1) return 0;
  const allOther = [];
  const unsolvedOther = [];
  for (let i = 0; i < list.length; i++) {
    if (i === currentIdx) continue;
    allOther.push(i);
    if (!isQuestionSolved(list[i].id)) {
      unsolvedOther.push(i);
    }
  }
  const pool = (state.unsolvedFirst && unsolvedOther.length > 0) ? unsolvedOther : allOther;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getCategoryForMode(mode = state.mode) {
  if (mode === 'impromptu' || mode === 'roleplay' || mode === 'yt-shadowing' || mode === 'brain-pattern') return 'practical';
  if (mode === 'review') return 'library';
  return 'pte';
}

export function applyToolsDrawerUI() {
  const open = Boolean(state.speakingToolsOpen);
  if (el.speakingToolsDrawer) el.speakingToolsDrawer.classList.toggle('hidden', !open);
  if (el.rsVoiceSettingsDrawer) el.rsVoiceSettingsDrawer.classList.toggle('hidden', !open);
  if (el.rlVoiceSettingsDrawer) el.rlVoiceSettingsDrawer.classList.toggle('hidden', !open);
  if (el.btnToggleSpeakingTools) {
    el.btnToggleSpeakingTools.setAttribute('aria-expanded', String(open));
    el.btnToggleSpeakingTools.innerHTML = open
      ? '<span>⚙️ 문제 선택 · 음성 설정 닫기</span>'
      : '<span>⚙️ 문제 선택 · 음성 설정 열기</span>';
  }
}

export function toggleSpeakingToolsDrawer() {
  state.speakingToolsOpen = !state.speakingToolsOpen;
  applyToolsDrawerUI();
}

export function toggleWritingToolsDrawer() {
  state.writingToolsOpen = !state.writingToolsOpen;
  const open = Boolean(state.writingToolsOpen);
  if (el.writingToolsDrawer) el.writingToolsDrawer.classList.toggle('hidden', !open);
  if (el.btnToggleWritingTools) {
    el.btnToggleWritingTools.setAttribute('aria-expanded', String(open));
    el.btnToggleWritingTools.textContent = open
      ? '⚙️ 문제 목록 · 필터 닫기'
      : '⚙️ 문제 목록 · 필터 열기';
  }
}

export function renderStudyStepper() {
  if (!el.studyStepperBar) return;
  const hideStepper = state.mode === 'review';
  el.studyStepperBar.classList.toggle('hidden', hideStepper);
  if (hideStepper) return;

  let activeStep = 1;
  let hintText = '다음 단계: 준비 및 내용을 먼저 확인하세요';

  if (MODE_CONFIG[state.mode]) {
    if (state.phase === 'recording') {
      activeStep = 2;
      hintText = '진행 중: 마이크에 또렷하게 말하세요 (조기 완료 버튼으로 바로 마칠 수 있어요)';
    } else if (state.phase === 'done') {
      activeStep = 3;
      hintText = '완료! 내 발음을 다시 듣고 ✨ AI 발음·유창성 채점을 받아보세요';
    } else if (state.phase === 'prep' || state.phase === 'playing-audio') {
      activeStep = 1;
      hintText = state.phase === 'playing-audio'
        ? '음성 듣는 중: 집중해서 들은 뒤 준비 카운트다운으로 이어집니다'
        : '준비 카운트다운 중: 핵심 키워드와 첫 문장을 떠올려 보세요';
    } else {
      activeStep = 1;
      hintText = '다음 할 일: 아래 [실전 연습 시작] 버튼을 눌러 연습을 시작하세요';
    }
  } else if (state.mode === 'yt-shadowing') {
    if (state.ytsIsRecording) {
      activeStep = 2;
      hintText = '진행 중: 문장을 소리 내어 따라 말한 뒤 [⏹️ 녹음 완료]를 누르세요';
    } else if (state.ytsRecordedBlob) {
      activeStep = 3;
      hintText = '완료! [🔄 유튜브 원어민 → 내 발음 비교] 및 ✨ AI 채점을 받아보세요';
    } else {
      activeStep = 1;
      hintText = '다음 할 일: ▶️ 구간 재생 또는 🔊 AI 성우 듣기 후 🎤 따라 말해보세요';
    }
  } else if (state.mode === 'roleplay') {
    const userCount = (state.rpMessages || []).filter(m => m.role === 'user').length;
    if (state.rpIsRecording) {
      activeStep = 2;
      hintText = '진행 중: 영어로 답변한 뒤 [⏹️ 녹음 완료 및 AI에게 전송]을 누르세요';
    } else if (!state.rpActive && userCount > 0) {
      activeStep = 3;
      hintText = '롤플레이 종료! 종합 피드백과 추천 표현을 단어장에 저장하세요';
    } else if (state.rpActive) {
      activeStep = 2;
      hintText = '다음 할 일: 상대방 질문을 들은 뒤 [🎤 내 답변 녹음하기]를 누르세요';
    } else {
      activeStep = 1;
      hintText = '다음 할 일: 뉴질랜드 상황을 고르고 [▶️ 대화 시작]을 누르세요';
    }
  } else if (state.mode === 'brain-pattern') {
    activeStep = state.bpActiveStep || 1;
    if (state.bpItemRecordingIdx !== null || state.bpMyoVoiceIdx !== null) {
      hintText = '녹음 중: 한국어 상황을 영어로 직접 말한 뒤 정지 버튼을 누르세요';
    } else if (activeStep === 3) {
      hintText = '3단계: 나만의 문장 응용 및 롤플레이 미션 표현으로 실전에 연결하세요';
    } else if (activeStep === 2) {
      hintText = '2단계: [👁️ 영어 가리기]를 켜고 1초 만에 입으로 인출해 보세요';
    } else {
      hintText = '1단계: 직역 vs 원어민 뉘앙스를 비교한 뒤 2단계로 넘어가세요';
    }
  } else if (state.mode === 'writing') {
    const hasResult = el.writingAiResult && !el.writingAiResult.classList.contains('hidden');
    const wordCount = countWords((el.writingTextarea?.value || '').trim());
    if (hasResult) {
      activeStep = 3;
      hintText = '채점 완료! 문장별 교정과 고득점 표현 3가지를 복습하세요';
    } else if (state.writingTimerRunning || wordCount >= 5) {
      activeStep = 2;
      hintText = '작성 중: 목표 단어 수에 맞춰 작성한 뒤 [✨ AI 채점 받기]를 누르세요';
    } else {
      activeStep = 1;
      hintText = '다음 할 일: 지문을 읽고 에디터에 바로 작성하거나 타이머를 시작하세요';
    }
  }

  const steps = [el.stepIndicator1, el.stepIndicator2, el.stepIndicator3];
  steps.forEach((stepEl, idx) => {
    if (!stepEl) return;
    const stepNum = idx + 1;
    if (stepNum < activeStep) {
      stepEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-200';
    } else if (stepNum === activeStep) {
      stepEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold bg-pte-blue text-white shadow-xs ring-2 ring-sky-200';
    } else {
      stepEl.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-medium bg-slate-100 text-slate-500';
    }
  });

  if (el.stepNextActionHint) {
    el.stepNextActionHint.textContent = hintText;
  }
}

export function renderTabs() {
  const activeCategory = getCategoryForMode(state.mode);
  state.lastModeByCategory[activeCategory] = state.mode;

  const categoryBtns = [
    { el: el.navGroupPte, cat: 'pte' },
    { el: el.navGroupPractical, cat: 'practical' },
    { el: el.navGroupLibrary, cat: 'library' }
  ];
  categoryBtns.forEach(({ el: btn, cat }) => {
    if (!btn) return;
    const active = activeCategory === cat;
    btn.setAttribute('aria-pressed', String(active));
    btn.className = active
      ? 'shrink-0 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold bg-white text-pte-navy shadow-xs transition cursor-pointer flex items-center gap-1.5'
      : 'shrink-0 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-200 hover:bg-white/10 transition cursor-pointer flex items-center gap-1.5';
  });

  const tabs = [
    { el: el.tabReadAloud, mode: 'read-aloud', cat: 'pte' },
    { el: el.tabDescribeImage, mode: 'describe-image', cat: 'pte' },
    { el: el.tabRepeatSentence, mode: 'repeat-sentence', cat: 'pte' },
    { el: el.tabRetellLecture, mode: 'retell-lecture', cat: 'pte' },
    { el: el.tabWriting, mode: 'writing', cat: 'pte' },
    { el: el.tabImpromptu, mode: 'impromptu', cat: 'practical' },
    { el: el.tabRoleplay, mode: 'roleplay', cat: 'practical' },
    { el: el.tabYtShadowing, mode: 'yt-shadowing', cat: 'practical' },
    { el: el.tabBrainPattern, mode: 'brain-pattern', cat: 'practical' },
    { el: el.tabReview, mode: 'review', cat: 'library' }
  ];

  tabs.forEach(({ el: btn, mode, cat }) => {
    if (!btn) return;
    const inGroup = cat === activeCategory;
    const active = state.mode === mode;
    btn.setAttribute('aria-selected', String(active));
    const visibilityCls = inGroup ? 'flex' : 'hidden';
    btn.className = active
      ? `tab-btn shrink-0 relative py-2 px-3 text-xs sm:text-sm font-semibold border-b-2 border-pte-blue text-pte-blue ${visibilityCls} items-center gap-1.5 transition cursor-pointer`
      : `tab-btn shrink-0 relative py-2 px-3 text-xs sm:text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-800 ${visibilityCls} items-center gap-1.5 transition cursor-pointer`;

    const badge = btn.querySelector('span:nth-child(2)');
    if (badge) {
      const badgeVisibility = mode === 'review' ? '' : 'hidden lg:inline-block ';
      badge.className = active
        ? `${badgeVisibility}text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-100 text-pte-blue`
        : `${badgeVisibility}text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600`;
    }
  });

  renderStudyStepper();
}

export function renderWorkspaceVisibility() {
  const isWriting = state.mode === 'writing';
  const isReview = state.mode === 'review';
  const isRoleplay = state.mode === 'roleplay';
  const isYtShadowing = state.mode === 'yt-shadowing';
  const isBrainPattern = state.mode === 'brain-pattern';
  const isSpeaking = !isWriting && !isReview && !isRoleplay && !isYtShadowing && !isBrainPattern;

  el.speakingSelectorBar.classList.toggle('hidden', !isSpeaking);
  el.speakingWorkspace.classList.toggle('hidden', !isSpeaking);
  if (el.roleplayWorkspace) {
    el.roleplayWorkspace.classList.toggle('hidden', !isRoleplay);
  }
  if (el.ytShadowingWorkspace) {
    el.ytShadowingWorkspace.classList.toggle('hidden', !isYtShadowing);
  }
  if (el.brainPatternWorkspace) {
    el.brainPatternWorkspace.classList.toggle('hidden', !isBrainPattern);
  }
  el.writingWorkspace.classList.toggle('hidden', !isWriting);
  el.reviewWorkspace.classList.toggle('hidden', !isReview);
}

export function renderQuestionSelector() {
  if (!MODE_CONFIG[state.mode]) return;
  const list = getQuestionsForMode();
  const currentIdx = state.questionIndex[state.mode];
  const currentQ = list[currentIdx];

  const solvedCount = list.filter(item => isQuestionSolved(item.id)).length;
  el.solvedProgressBadge.textContent = `풀이 완료: ${solvedCount} / ${list.length}`;

  const currentSolved = currentQ && isQuestionSolved(currentQ.id);
  el.btnToggleSolved.textContent = currentSolved ? '✓ 완료됨' : '✓ 완료 표시';
  el.btnToggleSolved.className = currentSolved
    ? 'px-2.5 py-1.5 rounded-lg text-xs font-bold border border-emerald-300 bg-emerald-50 text-emerald-700 transition cursor-pointer'
    : 'px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 bg-white hover:bg-emerald-50 text-slate-600 transition cursor-pointer';

  el.chkUnsolvedFirst.checked = state.unsolvedFirst;

  // Populate quick select dropdown
  el.questionSelect.innerHTML = '';
  list.forEach((item, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    const check = isQuestionSolved(item.id) ? '✓ ' : '';
    opt.textContent = `${check}${item.id}: ${item.title}`;
    el.questionSelect.appendChild(opt);
  });
  el.questionSelect.value = String(currentIdx);

  // Compact pills strip
  el.questionPills.innerHTML = '';
  list.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const solved = isQuestionSolved(item.id);
    btn.textContent = solved ? `${idx + 1}✓` : `${idx + 1}`;
    btn.title = `${item.id} - ${item.title}`;
    if (idx === currentIdx) {
      btn.className = 'shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold bg-pte-blue text-white shadow-xs transition cursor-pointer';
    } else if (solved) {
      btn.className = 'shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition cursor-pointer';
    } else {
      btn.className = 'shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer';
    }
    btn.addEventListener('click', () => selectQuestion(idx));
    el.questionPills.appendChild(btn);
  });

  el.btnPrevQ.disabled = currentIdx === 0;
  el.btnNextQ.disabled = currentIdx === list.length - 1;
}

export function renderRepeatSentenceScriptUI() {
  const canReveal = state.phase === 'done';
  el.btnRsToggleScript.disabled = !canReveal;
  el.rsScriptHint.textContent = canReveal ? '클릭하여 원문과 끊어 듣기를 확인하세요' : '녹음 완료 후 활성화됩니다';

  if (!canReveal) state.rsScriptVisible = false;

  el.btnRsToggleScript.setAttribute('aria-expanded', String(state.rsScriptVisible));
  if (state.rsScriptVisible && canReveal) {
    el.rsScriptContent.classList.remove('hidden');
    el.rsScriptMasked.classList.add('hidden');
    el.rsScriptBtnText.textContent = '원문 스크립트 숨기기';
  } else {
    el.rsScriptContent.classList.add('hidden');
    el.rsScriptMasked.classList.remove('hidden');
    el.rsScriptBtnText.textContent = '원문 스크립트 확인';
  }
}

export function renderRetellLectureRevealUI() {
  const canReveal = state.phase === 'done';
  el.btnRlToggleScript.disabled = !canReveal;
  el.btnRlToggleModel.disabled = !canReveal;
  el.rlRevealHint.textContent = canReveal ? '클릭하여 원문·키워드 및 모범 요약을 확인하세요' : '녹음 완료 후 활성화됩니다';

  if (!canReveal) {
    state.rlScriptVisible = false;
    state.rlModelVisible = false;
  }

  el.btnRlToggleScript.setAttribute('aria-expanded', String(state.rlScriptVisible));
  el.btnRlToggleModel.setAttribute('aria-expanded', String(state.rlModelVisible));

  if (state.rlScriptVisible && canReveal) {
    el.rlScriptBox.classList.remove('hidden');
  } else {
    el.rlScriptBox.classList.add('hidden');
  }

  if (state.rlModelVisible && canReveal) {
    el.rlModelBox.classList.remove('hidden');
  } else {
    el.rlModelBox.classList.add('hidden');
  }

  const isPlayingAudio = state.phase === 'playing-audio';
  el.btnRlSkipAudio.disabled = !isPlayingAudio;
  if (el.btnRlYtSkipAudio) {
    el.btnRlYtSkipAudio.disabled = !isPlayingAudio;
  }
}

export function getRlNotesKey(qId) {
  return `pte_rl_notes_${qId}`;
}

export function renderImpromptuModelBox() {
  if (!el.btnImpToggleModel || !el.impModelBox) return;
  el.btnImpToggleModel.setAttribute('aria-expanded', String(state.impModelVisible));
  el.impModelBox.classList.toggle('hidden', !state.impModelVisible);
  el.btnImpToggleModel.textContent = state.impModelVisible
    ? '✨ 1분 모범 답변 스크립트 숨기기'
    : '✨ 1분 모범 답변 스크립트 보기';
}

export function renderQuestionContent() {
  if (!MODE_CONFIG[state.mode]) return;

  const q = getCurrentQuestion();
  if (!q) return;
  const cfg = MODE_CONFIG[state.mode];

  el.qBadge.textContent = q.id;
  el.qTitle.textContent = q.title;
  el.instructionBox.innerHTML = cfg.instruction;
  renderSpeakingBookmarkBtn();

  // Update Shadowing Compare button & AI grading CTA label by mode
  if (el.btnShadowingCompare) {
    const allowShadowing = state.mode === 'read-aloud' || state.mode === 'repeat-sentence';
    el.btnShadowingCompare.classList.toggle('hidden', !allowShadowing);
  }
  if (el.btnAiGradeSpeakingLabel) {
    el.btnAiGradeSpeakingLabel.textContent = state.mode === 'impromptu'
      ? '✨ AI 원어민식 표현 교정'
      : '✨ AI 발음·유창성 채점';
  }

  el.panelReadAloud.classList.add('hidden');
  el.panelDescribeImage.classList.add('hidden');
  el.panelRepeatSentence.classList.add('hidden');
  el.panelRetellLecture.classList.add('hidden');
  el.panelImpromptu.classList.add('hidden');

  if (state.mode === 'read-aloud') {
    el.panelReadAloud.classList.remove('hidden');
    el.qMeta.textContent = q.topic;
    el.raPassage.textContent = q.passage;
    const words = q.passage.trim().split(/\s+/).length;
    el.raWordCount.textContent = `단어 수: ${words} words`;
    if (el.raAudioStatus) {
      el.raAudioStatus.textContent = '원어민 모범 읽기를 먼저 듣고 섀도잉으로 발음을 다듬어 보세요';
    }
  } else if (state.mode === 'describe-image') {
    el.panelDescribeImage.classList.remove('hidden');
    updateDiBankSummaryUI();
    const typeLabels = {
      bar: 'Bar Chart',
      'grouped-bar': 'Grouped Bar Chart',
      'horizontal-bar': 'Horizontal Bar Chart',
      line: 'Multi-Line Chart',
      'single-line': 'Line Chart',
      pie: 'Pie Chart',
      process: 'Process Diagram'
    };
    el.qMeta.textContent = typeLabels[q.chartType] || 'Chart';
    el.diChartContainer.innerHTML = renderSvgChart(q);
    el.diModelAnswer.textContent = q.modelAnswer;
    el.diKeyPoints.textContent = q.keyPoints;
  } else if (state.mode === 'repeat-sentence') {
    el.panelRepeatSentence.classList.remove('hidden');
    updateRsBankSummaryUI();
    const words = q.sentence.trim().split(/\s+/).length;
    el.qMeta.textContent = `${q.topic} · ${words} words`;
    el.rsWordCount.textContent = `${words} words`;
    el.rsSentenceText.textContent = q.sentence;
    el.rsChunkingText.textContent = `끊어 듣기: ${q.chunking}`;
    el.rsTranslationText.textContent = `해석: ${q.translation}`;
    el.rsAudioStatus.textContent = "오른쪽 '실전 연습 시작'을 누르면 원어민 음성이 재생됩니다";
    renderRepeatSentenceScriptUI();
  } else if (state.mode === 'retell-lecture') {
    el.panelRetellLecture.classList.remove('hidden');
    renderRetellLectureSourceUI();
    const words = q.script ? q.script.trim().split(/\s+/).length : 0;
    if (state.rlSourceMode === 'youtube') {
      const dur = Math.max(1, (q.endSec || 60) - (q.startSec || 0));
      el.qMeta.textContent = `YouTube 클립 · ${formatMMSS(q.startSec)}~${formatMMSS(q.endSec)} (${dur}초)`;
    } else {
      el.qMeta.textContent = `${q.topic} · ~${Math.round(words / 2.4)}초 분량`;
      el.rlAudioStatus.textContent = '실전 연습 시작을 누르면 45~60초 강의가 재생됩니다 (스크립트 숨김)';
      el.rlSlideTitle.textContent = q.slideTitle || q.title;
      el.rlSlideBullets.innerHTML = '';
      (q.slideBullets || []).forEach(b => {
        const li = document.createElement('li');
        li.textContent = b;
        el.rlSlideBullets.appendChild(li);
      });
    }

    // Restore scratchpad notes from localStorage
    const savedNotes = safeGetStorage(getRlNotesKey(q.id), '', false) || '';
    el.rlScratchpad.value = savedNotes;
    el.rlNotesStatus.textContent = savedNotes ? '저장된 메모 불러옴' : '자동 저장';

    // Populate post-recording script & model answer
    el.rlWordCount.textContent = `${words} words`;
    el.rlScriptText.textContent = q.script || '이 클립에는 스크립트 텍스트가 포함되어 있지 않습니다.';
    el.rlKeywordsList.innerHTML = '';
    (q.keywords || []).forEach(kw => {
      const span = document.createElement('span');
      span.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-indigo-800 border border-indigo-200';
      span.textContent = kw;
      el.rlKeywordsList.appendChild(span);
    });
    el.rlTranslationText.textContent = q.translation ? `요약 해석: ${q.translation}` : '';
    el.rlModelAnswer.textContent = q.modelAnswer || '';
    renderRetellLectureRevealUI();
  } else if (state.mode === 'impromptu') {
    el.panelImpromptu.classList.remove('hidden');
    el.qMeta.textContent = `${q.topic} · 15s / 60s`;
    el.impCategoryBadge.textContent = q.topic;
    el.impQuestionKo.textContent = q.questionKo;
    el.impQuestionEn.textContent = q.questionEn;

    el.impGuidePoints.innerHTML = '';
    (q.guidePoints || []).forEach(pt => {
      const li = document.createElement('li');
      li.textContent = pt;
      el.impGuidePoints.appendChild(li);
    });

    el.impSampleExpressions.innerHTML = '';
    (q.sampleExpressions || []).forEach(expr => {
      const li = document.createElement('li');
      li.className = 'rounded-lg bg-white border border-sky-200/80 px-2.5 py-1.5 font-medium text-sky-950';
      li.textContent = `“${expr}”`;
      el.impSampleExpressions.appendChild(li);
    });

    el.impModelAnswer.textContent = q.modelAnswer || '';
    if (el.impAudioStatus) el.impAudioStatus.textContent = '';
    state.impModelVisible = false;
    renderImpromptuModelBox();
  }
}

export function renderTimerUI() {
  if (!MODE_CONFIG[state.mode]) return;

  const cfg = MODE_CONFIG[state.mode];
  if (state.mode === 'repeat-sentence' || state.mode === 'retell-lecture') {
    el.phaseSequenceLabel.textContent = `음성 재생 → 준비 ${cfg.prepSeconds}초 → Beep → 녹음 ${cfg.speakSeconds}초`;
  } else {
    el.phaseSequenceLabel.textContent = `준비 ${cfg.prepSeconds}초 → 삐(Beep) → 녹음 ${cfg.speakSeconds}초`;
  }

  el.timerSeconds.textContent = state.remainingSeconds;
  el.timerFraction.textContent = `${state.remainingSeconds} / ${state.totalPhaseSeconds}s`;

  const pct = state.totalPhaseSeconds > 0
    ? Math.max(0, Math.min(100, (state.remainingSeconds / state.totalPhaseSeconds) * 100))
    : 0;
  el.timerProgressBar.style.width = pct + '%';

  if (state.phase === 'idle') {
    el.phaseBadge.textContent = '대기 중 (Ready)';
    el.phaseBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600';
    el.timerCard.className = 'rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5 text-center space-y-3 transition-colors';
    el.timerStatusText.textContent = (state.mode === 'repeat-sentence' || state.mode === 'retell-lecture')
      ? '시작 버튼을 누르면 원어민 음성이 재생됩니다'
      : (state.mode === 'impromptu'
        ? '15초 생각 시간 후 삐(Beep) 소리와 함께 60초 녹음이 시작됩니다'
        : '시작 버튼을 누르면 준비 시간 카운트다운이 시작됩니다');
    el.timerProgressBar.className = 'h-full bg-pte-blue transition-all duration-300 ease-linear rounded-full';
    el.recordingIndicator.classList.add('hidden');
    el.btnStart.disabled = false;
    el.btnStartText.textContent = '실전 연습 시작';
    el.btnSkipPrep.disabled = true;
    el.btnSkipPrep.textContent = '준비 건너뛰기 → Beep';
  } else if (state.phase === 'playing-audio') {
    el.phaseBadge.textContent = '음성 재생 중 (Playing Audio)';
    el.phaseBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-sky-100 text-pte-blue';
    el.timerCard.className = 'rounded-xl border border-sky-300 bg-sky-50/70 p-4 sm:p-5 text-center space-y-3 transition-colors';
    el.timerStatusText.textContent = state.mode === 'retell-lecture'
      ? '강의를 들으며 메모장에 필기하세요 (종료 후 10초 준비)'
      : '원어민 음성을 듣고 문장을 기억하세요 (종료 후 3초 준비)';
    el.timerProgressBar.className = 'h-full bg-pte-blue transition-all duration-300 ease-linear rounded-full';
    el.recordingIndicator.classList.add('hidden');
    el.btnStart.disabled = true;
    el.btnStartText.textContent = '음성 재생 중...';
    el.btnSkipPrep.disabled = false;
    el.btnSkipPrep.textContent = '음성/준비 건너뛰기 → Beep';
  } else if (state.phase === 'prep') {
    el.phaseBadge.textContent = '준비 시간 (Preparation)';
    el.phaseBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800';
    el.timerCard.className = 'rounded-xl border border-amber-300 bg-amber-50/70 p-4 sm:p-5 text-center space-y-3 transition-colors';
    el.timerStatusText.textContent = state.mode === 'retell-lecture'
      ? '필기한 메모를 보며 40초 요약을 구상하세요 — 곧 Beep'
      : (state.mode === 'repeat-sentence'
        ? '들은 문장을 머릿속으로 정리하세요 — 곧 Beep과 함께 녹음 시작'
        : (state.mode === 'impromptu'
          ? '1분 답변 핵심 구조와 오프닝 표현을 구상하세요 — 곧 Beep'
          : '지문/이미지를 파악하세요 — 곧 Beep 소리와 함께 녹음이 시작됩니다'));
    el.timerProgressBar.className = 'h-full bg-amber-500 transition-all duration-300 ease-linear rounded-full';
    el.recordingIndicator.classList.add('hidden');
    el.btnStart.disabled = true;
    el.btnStartText.textContent = '준비 중...';
    el.btnSkipPrep.disabled = false;
    el.btnSkipPrep.textContent = '준비 건너뛰기 → Beep';
  } else if (state.phase === 'recording') {
    el.phaseBadge.textContent = '녹음 중 (Recording)';
    el.phaseBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700';
    el.timerCard.className = 'rounded-xl border border-rose-300 bg-rose-50/70 p-4 sm:p-5 text-center space-y-3 transition-colors';
    el.timerStatusText.textContent = '지금 말하세요! (Recording in progress...)';
    el.timerProgressBar.className = 'h-full bg-rose-600 transition-all duration-300 ease-linear rounded-full';
    el.recordingIndicator.classList.remove('hidden');
    el.btnStart.disabled = false;
    el.btnStartText.textContent = '말하기 조기 완료 (Finish)';
    el.btnSkipPrep.disabled = true;
  } else if (state.phase === 'done') {
    el.phaseBadge.textContent = '완료 (Completed)';
    el.phaseBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700';
    el.timerCard.className = 'rounded-xl border border-emerald-300 bg-emerald-50/60 p-4 sm:p-5 text-center space-y-3 transition-colors';
    el.timerStatusText.textContent = state.mode === 'retell-lecture'
      ? '녹음 완료! 내 발음 듣기, 원문·키워드 및 모범 요약이 활성화되었습니다'
      : (state.mode === 'repeat-sentence'
        ? '녹음 완료! 원문 스크립트 확인 및 원어민·내 발음 비교가 활성화되었습니다'
        : (state.mode === 'impromptu'
          ? '1분 말하기 녹음 완료! 내 발음 듣기 및 ✨ AI 원어민식 표현 교정을 받아보세요'
          : (state.mode === 'read-aloud'
            ? '녹음 완료! 아래에서 원어민 → 내 발음 연속 비교 듣기를 해보세요'
            : '연습 완료! 아래에서 내 발음을 다시 들어보세요')));
    el.timerProgressBar.className = 'h-full bg-emerald-500 transition-all duration-300 ease-linear rounded-full';
    el.recordingIndicator.classList.add('hidden');
    el.btnStart.disabled = false;
    el.btnStartText.textContent = '다시 연습하기';
    el.btnSkipPrep.disabled = true;
  }

  if (state.mode === 'repeat-sentence') renderRepeatSentenceScriptUI();
  if (state.mode === 'retell-lecture') renderRetellLectureRevealUI();

  // Emphasize primary action button for current step
  if (el.btnStart) {
    el.btnStart.classList.toggle('ring-2', state.phase === 'idle');
    el.btnStart.classList.toggle('ring-sky-300', state.phase === 'idle');
  }
  if (el.btnAiGradeSpeaking) {
    el.btnAiGradeSpeaking.classList.toggle('ring-2', state.phase === 'done');
    el.btnAiGradeSpeaking.classList.toggle('ring-indigo-300', state.phase === 'done');
  }
  renderStudyStepper();
}

export function clearTimerInterval() {
  if (state.timerId !== null) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

export function resetPractice(clearAudio = true) {
  clearTimerInterval();
  stopShadowingCompare(clearAudio);
  cancelSpeech();
  stopYouTubeClipPlayback();
  stopMediaRecording();
  if (clearAudio) {
    cancelPendingSpeakingGrade();
  }
  if (MODE_CONFIG[state.mode]) {
    const cfg = MODE_CONFIG[state.mode];
    state.phase = 'idle';
    state.remainingSeconds = cfg.prepSeconds;
    state.totalPhaseSeconds = cfg.prepSeconds;
  }
  state.rsScriptVisible = false;
  state.rlScriptVisible = false;
  state.rlModelVisible = false;
  if (clearAudio) clearPlayback();
  renderTimerUI();
}

export function startPrepCountdown() {
  clearTimerInterval();
  cancelSpeech();
  stopYouTubeClipPlayback();
  // Keep mic stream closed during preparation so iOS earphones remain in Media mode
  releaseMicrophoneStream();
  const cfg = MODE_CONFIG[state.mode];
  state.phase = 'prep';
  state.remainingSeconds = cfg.prepSeconds;
  state.totalPhaseSeconds = cfg.prepSeconds;
  renderTimerUI();

  state.timerId = setInterval(() => {
    state.remainingSeconds -= 1;
    if (state.remainingSeconds <= 0) {
      clearTimerInterval();
      beginRecordingPhase();
    } else {
      renderTimerUI();
    }
  }, 1000);
}

export async function startPractice() {
  if (state.phase === 'recording') {
    finishRecordingPhase();
    return;
  }

  // iOS Safari/PWA: resume AudioContext inside user tap & do NOT open mic before audio playback
  ensureAudioContext();
  clearTimerInterval();
  stopShadowingCompare(true);
  cancelSpeech();
  stopYouTubeClipPlayback();
  releaseMicrophoneStream();
  clearPlayback();
  state.rsScriptVisible = false;
  state.rlScriptVisible = false;
  state.rlModelVisible = false;

  if (state.mode === 'retell-lecture' && state.rlSourceMode === 'youtube') {
    const cfg = MODE_CONFIG['retell-lecture'];
    const q = getCurrentQuestion();
    if (!q) {
      startPrepCountdown();
      return;
    }
    state.phase = 'playing-audio';
    state.remainingSeconds = cfg.prepSeconds;
    state.totalPhaseSeconds = cfg.prepSeconds;
    renderTimerUI();

    playYouTubeClipSegment(q, {
      previewOnly: false,
      onComplete: () => {
        if (state.mode === 'retell-lecture' && state.rlSourceMode === 'youtube' && state.phase === 'playing-audio') {
          startPrepCountdown();
        }
      }
    });
  } else if (state.mode === 'repeat-sentence' || state.mode === 'retell-lecture') {
    const cfg = MODE_CONFIG[state.mode];
    const q = getCurrentQuestion();
    if (!q) {
      startPrepCountdown();
      return;
    }
    state.phase = 'playing-audio';
    state.remainingSeconds = cfg.prepSeconds;
    state.totalPhaseSeconds = cfg.prepSeconds;
    renderTimerUI();

    const spokenText = state.mode === 'retell-lecture' ? q.script : q.sentence;
    const currentMode = state.mode;
    speakText(spokenText, {
      targetMode: currentMode,
      onComplete: () => {
        if (state.mode === currentMode && state.phase === 'playing-audio') {
          startPrepCountdown();
        }
      }
    });
  } else {
    startPrepCountdown();
  }
}

export async function beginRecordingPhase() {
  clearTimerInterval();
  cancelSpeech();
  stopYouTubeClipPlayback();
  ensureAudioContext();
  const cfg = MODE_CONFIG[state.mode];

  playBeep(980, 0.38);

  state.phase = 'recording';
  state.remainingSeconds = cfg.speakSeconds;
  state.totalPhaseSeconds = cfg.speakSeconds;
  renderTimerUI();

  // Lazy microphone activation ONLY when entering the recording phase
  const micOk = await requestMicrophone();
  if (state.phase !== 'recording') {
    releaseMicrophoneStream();
    return;
  }
  if (micOk) {
    startMediaRecording();
  }

  state.timerId = setInterval(() => {
    state.remainingSeconds -= 1;
    if (state.remainingSeconds <= 0) {
      finishRecordingPhase();
    } else {
      renderTimerUI();
    }
  }, 1000);
}

export function finishRecordingPhase() {
  clearTimerInterval();
  cancelSpeech();
  stopMediaRecording();
  playBeep(660, 0.18);

  state.phase = 'done';
  state.remainingSeconds = 0;

  // Auto-mark question as solved and record practice log when recording finishes
  const q = getCurrentQuestion();
  if (q) {
    markQuestionSolved(q.id, true);
    state.lastSpeakingLogId = recordPracticeLog(q.id, state.mode, q.title, null);
    renderQuestionSelector();
  }

  renderTimerUI();
}

export function selectQuestion(index) {
  if (!MODE_CONFIG[state.mode]) return;
  const list = getQuestionsForMode();
  if (index < 0 || index >= list.length) return;
  state.questionIndex[state.mode] = index;
  resetPractice(true);
  renderQuestionSelector();
  renderQuestionContent();
}

export function toggleTemplate() {
  state.templateVisible = !state.templateVisible;
  el.btnToggleTemplate.setAttribute('aria-expanded', String(state.templateVisible));
  if (state.templateVisible) {
    el.diTemplateBox.classList.remove('hidden');
    el.templateBtnText.textContent = '모범 답변 템플릿 숨기기';
    el.templateChevron.classList.add('rotate-180');
  } else {
    el.diTemplateBox.classList.add('hidden');
    el.templateBtnText.textContent = '모범 답변 템플릿 보기';
    el.templateChevron.classList.remove('rotate-180');
  }
}

export function switchMode(newMode) {
  if (state.mode === newMode) return;
  if (MODE_CONFIG[state.mode]) {
    resetPractice(true);
  } else if (state.mode === 'writing') {
    cancelPendingWritingGrade();
    stopWritingTimer();
    renderWritingTimerUI();
  } else if (state.mode === 'roleplay') {
    stopRoleplayRecording(true);
    cancelSpeech();
    releaseMicrophoneStream();
  } else if (state.mode === 'yt-shadowing') {
    cancelPendingYtsGrade();
    stopYtsComparePlayback(false);
    stopYtsRecording(true);
    stopYtsPlayback();
    cancelSpeech();
    releaseMicrophoneStream();
  } else if (state.mode === 'brain-pattern') {
    stopBpRecording(true);
    cancelSpeech();
    releaseMicrophoneStream();
  } else if (state.mode === 'review') {
    stopDrillRecording(true);
    cancelSpeech();
    releaseMicrophoneStream();
  }

  state.mode = newMode;
  renderTabs();
  renderWorkspaceVisibility();

  if (newMode === 'writing') {
    renderWritingSubtabs();
    renderWritingQuestionSelector();
    renderWritingContent();
    renderWritingTimerUI();
  } else if (newMode === 'roleplay') {
    renderRoleplayWorkspace();
  } else if (newMode === 'yt-shadowing') {
    renderYtsWorkspace();
  } else if (newMode === 'brain-pattern') {
    renderBpWorkspace();
  } else if (newMode === 'review') {
    renderReviewDashboard();
  } else {
    resetPractice(true);
    renderQuestionSelector();
    renderQuestionContent();
  }
}

export function handleAccentChange(newAccent) {
  state.ttsAccent = newAccent;
  state.ttsVoiceUri = ''; // reset specific pin to auto-pick top neural voice for that accent
  saveStorage(STORAGE_KEYS.ttsAccent, state.ttsAccent);
  saveStorage(STORAGE_KEYS.ttsVoiceUri, '');
  syncVoiceDropdowns();
}

export function handleVoiceChange(newUri) {
  if (newUri.startsWith('fallback:')) {
    const fallbackAccent = newUri.replace('fallback:', '');
    state.ttsAccent = fallbackAccent;
    saveStorage(STORAGE_KEYS.ttsAccent, state.ttsAccent);
  } else {
    state.ttsVoiceUri = newUri;
    saveStorage(STORAGE_KEYS.ttsVoiceUri, state.ttsVoiceUri);
  }
  syncVoiceDropdowns();
}

export function handleRateChange(newRate) {
  state.ttsRate = parseFloat(newRate) || 1.0;
  saveStorage(STORAGE_KEYS.ttsRate, String(state.ttsRate));
  syncVoiceDropdowns();
}

export function handleGeminiTtsToggle(enabled) {
  state.useGeminiTts = Boolean(enabled);
  saveStorage(STORAGE_KEYS.useGeminiTts, String(state.useGeminiTts));
  syncGeminiTtsUI();
}

export function renderSpeakingAiResult(data) {
  const overall = Math.max(10, Math.min(90, Math.round(Number(data.overallScore) || 0)));
  const subScores = [
    { label: '발음 (Pronunciation)', val: data.pronunciationScore },
    { label: '유창성 (Fluency)', val: data.fluencyScore },
    { label: '내용 충실도 (Content)', val: data.contentScore }
  ];
  const issues = Array.isArray(data.omittedOrMispronounced) ? data.omittedOrMispronounced : [];

  el.speakingAiResult.classList.remove('hidden');
  el.speakingAiResult.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-indigo-100">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-indigo-600">AI Speaking Assessment</span>
        <h3 class="text-sm sm:text-base font-extrabold text-slate-900">발음·유창성 분석 결과</h3>
      </div>
      <div class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-pte-blue text-white text-center shadow-xs">
        <span class="block text-[10px] opacity-85">예상 점수</span>
        <span class="text-xl font-extrabold tabular-nums">${overall}<span class="text-xs font-normal opacity-80">/90</span></span>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-2">
      ${subScores.map(s => `
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-center">
          <span class="block text-[11px] font-medium text-slate-500">${s.label}</span>
          <span class="text-sm font-extrabold text-indigo-800 tabular-nums">${escapeHtml(s.val ?? '-')}</span>
        </div>
      `).join('')}
    </div>

    ${data.transcript ? `
      <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1 text-xs">
        <span class="font-bold text-slate-700 block">🎙️ AI가 인식한 내 발화 (Transcript)</span>
        <p class="text-slate-700 leading-relaxed">${escapeHtml(data.transcript)}</p>
      </div>
    ` : ''}

    ${data.feedbackKo ? `
      <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 p-3 text-xs text-slate-800 leading-relaxed">
        <strong class="text-indigo-900">코칭 피드백:</strong> ${escapeHtml(data.feedbackKo)}
      </div>
    ` : ''}

    ${issues.length > 0 ? `
      <div class="space-y-1.5">
        <h4 class="text-xs font-bold text-rose-800">⚠️ 누락 · 교정 필요 단어/포인트</h4>
        <div class="space-y-1.5">
          ${issues.map(it => `
            <div class="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-xs">
              <span class="font-bold text-rose-900">${escapeHtml(it.target || '')}</span>
              ${it.issue ? `<span class="text-rose-700"> — ${escapeHtml(it.issue)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${renderHighScoreExpressionsSection(data.highScoreExpressions)}
  `;
}

export function renderImpromptuAiResult(data) {
  const overall = Math.max(10, Math.min(90, Math.round(Number(data.overallScore) || 0)));
  const subScores = [
    { label: '유창성 (Fluency)', val: data.fluencyScore },
    { label: '논리성 (Logic/Structure)', val: data.logicScore },
    { label: '원어민 자연스러움', val: data.naturalnessScore }
  ];
  const upgrades = Array.isArray(data.expressionUpgrades) ? data.expressionUpgrades.slice(0, 3) : [];

  el.speakingAiResult.classList.remove('hidden');
  el.speakingAiResult.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-indigo-100">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-emerald-700">AI Impromptu Coaching</span>
        <h3 class="text-sm sm:text-base font-extrabold text-slate-900">1분 말하기 원어민식 표현 교정</h3>
      </div>
      <div class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-pte-teal text-white text-center shadow-xs">
        <span class="block text-[10px] opacity-85">예상 점수</span>
        <span class="text-xl font-extrabold tabular-nums">${overall}<span class="text-xs font-normal opacity-80">/90</span></span>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-2">
      ${subScores.map(s => `
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-center">
          <span class="block text-[11px] font-medium text-slate-500">${s.label}</span>
          <span class="text-sm font-extrabold text-emerald-800 tabular-nums">${escapeHtml(s.val ?? '-')}</span>
        </div>
      `).join('')}
    </div>

    ${data.transcript ? `
      <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1 text-xs">
        <span class="font-bold text-slate-700 block">🎙️ 내가 말한 스크립트 (Transcript)</span>
        <p class="text-slate-700 leading-relaxed">${escapeHtml(data.transcript)}</p>
      </div>
    ` : ''}

    <div class="space-y-2">
      <h4 class="text-xs font-bold uppercase tracking-wider text-teal-800">💎 어색한/콩글리시 표현 → 원어민 자연스러운 대체 표현 3쌍</h4>
      ${upgrades.length === 0 ? `
        <p class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">전반적으로 자연스러운 원어민 표현을 구사하셨습니다!</p>
      ` : upgrades.map(up => `
        <div class="rounded-xl border border-teal-200 bg-teal-50/50 p-3.5 space-y-2 text-xs">
          <div class="space-y-1">
            <p class="text-rose-700"><span class="font-bold">내 표현:</span> ${escapeHtml(up.myExpression || up.original || '')}</p>
            <p class="text-emerald-800 font-bold text-sm">→ 원어민 표현: ${escapeHtml(up.nativeExpression || up.improved || '')}</p>
            ${up.explanationKo ? `<p class="text-slate-600 leading-relaxed">${escapeHtml(up.explanationKo)}</p>` : ''}
            ${up.example ? `<p class="text-slate-600 italic">"${escapeHtml(up.example)}"</p>` : ''}
          </div>
          <div class="flex justify-end">
            <button type="button"
              data-ai-vocab-word="${escapeHtml(up.nativeExpression || up.improved || '')}"
              data-ai-vocab-meaning="${escapeHtml(up.meaningKo || up.explanationKo || '')}"
              data-ai-vocab-example="${escapeHtml(up.example || '')}"
              class="px-2.5 py-1.5 rounded-lg text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition cursor-pointer">
              + 단어장 추가
            </button>
          </div>
        </div>
      `).join('')}
    </div>

    ${data.feedbackKo ? `
      <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 p-3 text-xs text-slate-800 leading-relaxed">
        <strong class="text-indigo-900">유창성·논리력 피드백:</strong> ${escapeHtml(data.feedbackKo)}
      </div>
    ` : ''}
  `;
}

export function buildSpeakingReferencePrompt(q, mode) {
  if (mode === 'read-aloud') {
    return `Task: Read Aloud\nOriginal Passage to read aloud:\n"${q.passage}"\nEvaluate pronunciation, oral fluency, and content omissions/insertions/hesitations against the passage.`;
  }
  if (mode === 'repeat-sentence') {
    return `Task: Repeat Sentence\nTarget Sentence:\n"${q.sentence}"\nEvaluate how accurately the candidate repeated the exact words, pronunciation, and fluency.`;
  }
  if (mode === 'describe-image') {
    const chartData = q.data || q.series || q.points || q.slices || q.steps || {};
    return `Task: Describe Image (${q.chartType || 'chart'})\nTitle: ${q.title}\nSubtitle: ${q.subtitle || ''}\nUnit: ${q.unit || ''}\nChart Data: ${JSON.stringify(chartData)}\nReference Answer: ${q.modelAnswer || ''}\nKey Points: ${q.keyPoints || ''}\nEvaluate whether the candidate clearly described key trends, highest/lowest values, pronunciation, and fluency without long pauses.`;
  }
  if (mode === 'impromptu') {
    return `Task: 1-Minute Impromptu Talk (${q.topic})\nQuestion (EN): ${q.questionEn}\nQuestion (KO): ${q.questionKo}`;
  }
  return `Task: Retell Lecture\nLecture Title: ${q.title}\nKeywords: ${(q.keywords || []).join(', ')}\nReference Lecture Script:\n${q.script || ''}\nModel Summary:\n${q.modelAnswer || ''}\nEvaluate keyword coverage, logical summary, pronunciation, and fluency.`;
}

export async function gradeSpeakingWithAi() {
  if (state.speakingGradingBusy) return;
  const q = getCurrentQuestion();
  if (!q || !MODE_CONFIG[state.mode]) return;

  if (!state.recordedBlob || state.recordedBlob.size === 0) {
    renderAiErrorCard(el.speakingAiResult, '녹음된 오디오 데이터를 찾을 수 없습니다. 먼저 연습 녹음을 완료해주세요.');
    return;
  }

  stopShadowingCompare(false);
  const reqMode = state.mode;
  const reqQId = q.id;
  const reqQTitle = q.title;
  const reqLogId = state.lastSpeakingLogId;
  const cleanMime = (state.recordingMime || state.recordedBlob.type || 'audio/webm').split(';')[0] || 'audio/webm';
  const refContext = buildSpeakingReferencePrompt(q, reqMode);
  const isImpromptu = reqMode === 'impromptu';

  const prompt = isImpromptu ? [
    `You are a native English speaking coach helping a Korean learner living in New Zealand.`,
    refContext,
    `\nListen carefully to the attached 1-minute impromptu speech recording and provide:`,
    `1. Exact English transcript of what the learner actually spoke.`,
    `2. Exactly 3 pairs comparing awkward/Konglish phrasing or missed opportunities in the learner's response with natural, idiomatic native English expressions actually used by Kiwis/native speakers.`,
    `3. Detailed Korean coaching feedback on oral fluency, pacing, and logical organization.`,
    `\nRespond strictly in JSON matching this schema:`,
    `{`,
    `  "overallScore": <integer 10..90>,`,
    `  "fluencyScore": "<e.g. 78/90>",`,
    `  "logicScore": "<e.g. 80/90>",`,
    `  "naturalnessScore": "<e.g. 74/90>",`,
    `  "transcript": "<exact English transcription of the audio>",`,
    `  "expressionUpgrades": [`,
    `    {`,
    `      "myExpression": "<what the speaker said or literal Konglish phrase>",`,
    `      "nativeExpression": "<natural native English expression>",`,
    `      "meaningKo": "<short Korean meaning of the native expression>",`,
    `      "explanationKo": "<why the native phrasing sounds better in Korean>",`,
    `      "example": "<short natural example sentence>"`,
    `    }`,
    `  ],`,
    `  "feedbackKo": "<detailed Korean feedback on fluency and logical structure>"`,
    `}`
  ].join('\n') : [
    `You are a strict official PTE Academic Speaking examiner.`,
    refContext,
    `\nListen carefully to the attached learner audio recording and evaluate:`,
    `1. Pronunciation (clarity of vowels/consonants, stress, intonation)`,
    `2. Oral Fluency (smooth rhythm, pace, minimal hesitations/self-corrections)`,
    `3. Content & Omissions (whether words/keywords/main points were missed or misread)`,
    `\nRespond strictly in JSON matching this schema (feedback in Korean):`,
    `{`,
    `  "overallScore": <integer 10..90>,`,
    `  "pronunciationScore": "<e.g. 78/90>",`,
    `  "fluencyScore": "<e.g. 75/90>",`,
    `  "contentScore": "<e.g. 82/90>",`,
    `  "transcript": "<exact English transcription of what you heard in the audio>",`,
    `  "feedbackKo": "<detailed coaching feedback in Korean covering pronunciation, fluency, and content>",`,
    `  "omittedOrMispronounced": [`,
    `    { "target": "<missed word or mispronounced phrase>", "issue": "<Korean explanation of omission or pronunciation tip>" }`,
    `  ],`,
    `  "highScoreExpressions": [`,
    `    { "expression": "<useful word/phrase from this question>", "meaningKo": "<Korean meaning>", "example": "<short example>" }`,
    `  ]`,
    `}`
  ].join('\n');

  if (state.speakingGradeAbort) {
    try { state.speakingGradeAbort.abort(); } catch (e) {}
  }
  const abortCtrl = new AbortController();
  state.speakingGradeAbort = abortCtrl;
  const reqSeq = ++state.speakingGradeSeq;
  state.speakingGradingBusy = true;
  const loadingMsg = isImpromptu
    ? '1분 즉흥 말하기를 분석하고 원어민식 표현 교정을 생성 중입니다...'
    : '녹음된 음성을 분석하여 발음·유창성 채점 중입니다...';
  setAiLoadingState(el.speakingAiResult, el.btnAiGradeSpeaking, loadingMsg);
  try {
    const base64Audio = await blobToBase64(state.recordedBlob);
    if (reqSeq !== state.speakingGradeSeq || state.mode !== reqMode || getCurrentQuestion()?.id !== reqQId) {
      return;
    }
    const result = await callGeminiApi([
      { text: prompt },
      { inlineData: { mimeType: cleanMime, data: base64Audio } }
    ], { timeoutMs: 25000, signal: abortCtrl.signal });
    if (reqSeq !== state.speakingGradeSeq || state.mode !== reqMode || getCurrentQuestion()?.id !== reqQId) {
      return;
    }
    if (isImpromptu) {
      renderImpromptuAiResult(result);
    } else {
      renderSpeakingAiResult(result);
    }
    extractAndRecordWeaknessesFromAi(result, reqMode);
    state.lastSpeakingLogId = attachAiScoreToPracticeLog(
      reqLogId,
      reqQId,
      reqMode,
      reqQTitle,
      result.overallScore
    );
  } catch (err) {
    if (err?.isAborted || reqSeq !== state.speakingGradeSeq) return;
    if (err.isMissingKey) {
      el.speakingAiResult.classList.add('hidden');
    } else {
      renderAiErrorCard(el.speakingAiResult, err.message || 'AI 음성 채점 중 오류가 발생했습니다.');
    }
  } finally {
    if (state.speakingGradeAbort === abortCtrl) {
      state.speakingGradeAbort = null;
    }
    if (reqSeq === state.speakingGradeSeq) {
      state.speakingGradingBusy = false;
      el.btnAiGradeSpeaking.disabled = false;
      el.btnAiGradeSpeaking.classList.remove('opacity-60');
    }
  }
}


export function showInlineStatus(elTarget, message, tone = 'info') {
  if (!elTarget) return;
  const styles = {
    info: 'text-xs font-semibold rounded-lg px-3 py-2 bg-sky-50 text-sky-800 border border-sky-200',
    success: 'text-xs font-semibold rounded-lg px-3 py-2 bg-emerald-50 text-emerald-800 border border-emerald-200',
    error: 'text-xs font-semibold rounded-lg px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200'
  };
  elTarget.textContent = message;
  elTarget.className = styles[tone] || styles.info;
  elTarget.classList.remove('hidden');
}

export function updateRsBankSummaryUI() {
  if (!el.rsBankSummaryBadge) return;
  const baseCount = REPEAT_SENTENCE_QUESTIONS.length;
  const customCount = Array.isArray(state.customRsQuestions) ? state.customRsQuestions.length : 0;
  el.rsBankSummaryBadge.textContent = `기본 ${baseCount}문항 + AI 추가 ${customCount}문항`;
}

export function updateDiBankSummaryUI() {
  if (!el.diBankSummaryBadge) return;
  const baseCount = DESCRIBE_IMAGE_QUESTIONS.length;
  const customCount = Array.isArray(state.customDiQuestions) ? state.customDiQuestions.length : 0;
  el.diBankSummaryBadge.textContent = `기본 ${baseCount}문항 + AI 추가 ${customCount}문항`;
}

export function normalizeDiQuestion(raw, id) {
  const pickSafeColor = (val, fallbackIdx = 0) => {
    const s = String(val ?? '').trim();
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
    if (/^(?:black|white|gray|grey|red|blue|green|yellow|orange|purple|pink|teal|cyan|indigo|navy|slate|emerald|amber|rose|sky|violet)$/i.test(s)) {
      return s;
    }
    return DI_COLOR_PALETTE[fallbackIdx % DI_COLOR_PALETTE.length];
  };
  const toNum = (v, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };

  let chartType = String(raw?.chartType || 'bar').toLowerCase().trim();
  if (chartType === 'multi-line' || chartType === 'multiline') chartType = 'line';
  const validTypes = ['bar', 'grouped-bar', 'line', 'single-line', 'pie', 'process', 'horizontal-bar'];
  if (!validTypes.includes(chartType)) chartType = 'bar';

  const labels = Array.isArray(raw?.labels) ? raw.labels.map(String) : [];
  const rawDatasets = Array.isArray(raw?.datasets) ? raw.datasets : [];
  const rawValues = Array.isArray(raw?.values)
    ? raw.values.map(v => toNum(v, 0))
    : (Array.isArray(rawDatasets[0]?.data) ? rawDatasets[0].data.map(v => toNum(v, 0)) : []);

  const base = {
    id: String(id || `DI-${Date.now()}`),
    title: String(raw?.title || `AI Chart ${id}`).trim(),
    chartType,
    subtitle: String(raw?.subtitle || 'Data Overview').trim(),
    unit: raw?.unit !== undefined && raw?.unit !== null ? String(raw.unit) : '',
    modelAnswer: String(raw?.modelAnswer || '').trim(),
    keyPoints: String(raw?.keyPoints || '').trim(),
    isCustomAi: true
  };

  if (chartType === 'pie') {
    let slices = Array.isArray(raw?.slices) ? raw.slices : [];
    if (slices.length === 0 && Array.isArray(raw?.data)) slices = raw.data;
    if (slices.length === 0 && labels.length > 0) {
      slices = labels.map((lbl, i) => ({ label: lbl, value: rawValues[i] ?? 10 }));
    }
    base.slices = slices.slice(0, 5).map((s, i) => ({
      label: String(s?.label || `Item ${i + 1}`),
      value: Math.max(1, toNum(s?.value, 0)),
      color: pickSafeColor(s?.color, i)
    }));
    if (base.slices.length === 0) {
      base.slices = [{ label: 'Category A', value: 60, color: DI_COLOR_PALETTE[0] }, { label: 'Category B', value: 40, color: DI_COLOR_PALETTE[1] }];
    }
    if (!base.unit) base.unit = '%';
  } else if (chartType === 'process') {
    let steps = Array.isArray(raw?.steps) ? raw.steps : [];
    if (steps.length === 0 && labels.length > 0) {
      steps = labels.map((lbl, i) => ({ step: String(i + 1), title: lbl, detail: 'Stage process' }));
    }
    base.steps = steps.slice(0, 5).map((st, i) => ({
      step: String(st?.step || i + 1),
      title: String(st?.title || `Stage ${i + 1}`).slice(0, 18),
      detail: String(st?.detail || '').slice(0, 26),
      color: pickSafeColor(st?.color, i)
    }));
    if (base.steps.length === 0) {
      base.steps = [{ step: '1', title: 'Input', detail: 'Collect materials', color: DI_COLOR_PALETTE[0] }, { step: '2', title: 'Output', detail: 'Final product', color: DI_COLOR_PALETTE[1] }];
    }
  } else if (chartType === 'grouped-bar') {
    const cats = Array.isArray(raw?.categories) && raw.categories.length > 0
      ? raw.categories.map(String)
      : (labels.length > 0 ? labels : ['Group A', 'Group B', 'Group C']);
    let series = Array.isArray(raw?.series) ? raw.series : [];
    if (series.length === 0 && rawDatasets.length > 0) {
      series = rawDatasets.map((ds, si) => ({
        name: String(ds?.name || ds?.label || `Series ${si + 1}`),
        color: pickSafeColor(ds?.color, si),
        values: (Array.isArray(ds?.data) ? ds.data : []).map(v => toNum(v, 0))
      }));
    }
    base.categories = cats.slice(0, 5);
    base.series = (series.length > 0 ? series : [{ name: 'Metric A', values: cats.map(() => 50) }, { name: 'Metric B', values: cats.map(() => 35) }])
      .slice(0, 3)
      .map((s, si) => ({
        name: String(s?.name || `Series ${si + 1}`),
        color: pickSafeColor(s?.color, si),
        values: base.categories.map((_, ci) => toNum((s?.values || s?.data || [])[ci], 0))
      }));
  } else if (chartType === 'line') {
    let series = Array.isArray(raw?.series) ? raw.series : [];
    if (series.length === 0 && rawDatasets.length > 0 && labels.length > 0) {
      series = rawDatasets.map((ds, si) => ({
        name: String(ds?.name || ds?.label || `Series ${si + 1}`),
        color: pickSafeColor(ds?.color, si),
        points: labels.map((lbl, idx) => ({ label: lbl, value: toNum((ds?.data || [])[idx], 0) }))
      }));
    }
    base.series = (series.length > 0 ? series : [
      { name: 'Trend A', color: DI_COLOR_PALETTE[0], points: [{ label: '2021', value: 20 }, { label: '2023', value: 45 }, { label: '2025', value: 70 }] },
      { name: 'Trend B', color: DI_COLOR_PALETTE[1], points: [{ label: '2021', value: 35 }, { label: '2023', value: 30 }, { label: '2025', value: 25 }] }
    ]).slice(0, 3).map((s, si) => ({
      name: String(s?.name || `Series ${si + 1}`),
      color: pickSafeColor(s?.color, si),
      points: (Array.isArray(s?.points) && s.points.length > 0
        ? s.points
        : labels.map((lbl, idx) => ({ label: lbl, value: toNum((s?.values || s?.data || [])[idx], 0) }))
      ).map(p => ({ label: String(p?.label ?? ''), value: toNum(p?.value, 0) }))
    }));
  } else if (chartType === 'single-line') {
    let pts = Array.isArray(raw?.points) ? raw.points : [];
    if (pts.length === 0 && labels.length > 0) {
      pts = labels.map((lbl, idx) => ({ label: lbl, value: rawValues[idx] ?? 0 }));
    }
    base.color = pickSafeColor(raw?.color, 0);
    base.points = (pts.length > 0 ? pts : [{ label: '2020', value: 20 }, { label: '2023', value: 45 }, { label: '2025', value: 65 }])
      .map(p => ({ label: String(p?.label ?? ''), value: toNum(p?.value, 0) }));
  } else {
    // 'bar' | 'horizontal-bar'
    let data = Array.isArray(raw?.data) ? raw.data : [];
    if (data.length === 0 && labels.length > 0) {
      data = labels.map((lbl, i) => ({ label: lbl, value: rawValues[i] ?? 0 }));
    }
    base.data = (data.length > 0 ? data : [{ label: 'A', value: 45 }, { label: 'B', value: 30 }, { label: 'C', value: 15 }])
      .slice(0, 6)
      .map((d, i) => ({
        label: String(d?.label || `Item ${i + 1}`),
        value: toNum(d?.value, 0),
        color: pickSafeColor(d?.color, i)
      }));
  }

  return base;
}

export async function generateMoreDiWithAi() {
  if (state.diAiGenerating) return;
  state.diAiGenerating = true;
  el.btnDiAiGenerate.disabled = true;
  el.btnDiAiGenerate.classList.add('opacity-60');
  showInlineStatus(el.diAiGenStatus, `Gemini AI (${state.geminiModel || 'gemini-4-hydrogen'})가 새 SVG 차트 문제 5개를 생성 중입니다...`, 'info');

  const existingTitles = getDescribeImageList().slice(-15).map(q => q.title).join('\n');
  const prompt = [
    `You are a PTE Academic Describe Image designer.`,
    `Generate exactly 5 NEW, realistic academic chart questions (1 bar, 1 grouped-bar, 1 line or single-line, 1 pie, 1 horizontal-bar or process) that do NOT duplicate these titles:\n${existingTitles}`,
    `\nUse realistic academic/NZ/global numbers and respond strictly in JSON matching this schema:`,
    `{`,
    `  "charts": [`,
    `    {`,
    `      "title": "<concise English chart title>",`,
    `      "chartType": "bar | grouped-bar | line | single-line | pie | horizontal-bar | process",`,
    `      "subtitle": "<measurement description>",`,
    `      "unit": "<e.g. %, k, M, B, or empty string>",`,
    `      "data": [{"label":"A","value":45}],`,
    `      "categories": ["Cat1","Cat2","Cat3","Cat4"],`,
    `      "series": [{"name":"Series 1","values":[10,20,30,40]}],`,
    `      "points": [{"label":"2020","value":12}],`,
    `      "slices": [{"label":"Share A","value":40}],`,
    `      "steps": [{"step":"1","title":"Step Name","detail":"Brief detail"}],`,
    `      "modelAnswer": "<4-5 sentences PTE Describe Image model answer in English (~70 words)>",`,
    `      "keyPoints": "핵심 포인트: <short Korean key-point summary>"`,
    `    }`,
    `  ]`,
    `}`
  ].join('\n');

  try {
    const result = await callGeminiApi([{ text: prompt }]);
    const items = Array.isArray(result.charts) ? result.charts : [];
    if (items.length === 0) {
      throw new Error('AI가 유효한 차트 목록을 반환하지 않았습니다.');
    }
    const startNumber = DESCRIBE_IMAGE_QUESTIONS.length + state.customDiQuestions.length + 1;
    const prevTotal = getDescribeImageList().length;
    const formatted = items.slice(0, 5).map((item, idx) =>
      normalizeDiQuestion(item, `DI-${startNumber + idx}`)
    );

    state.customDiQuestions = [...state.customDiQuestions, ...formatted];
    saveStorage(STORAGE_KEYS.customDiQuestions, state.customDiQuestions);
    updateDiBankSummaryUI();
    showInlineStatus(
      el.diAiGenStatus,
      `✅ 새 차트 ${formatted.length}개(DI-${startNumber}~DI-${startNumber + formatted.length - 1})가 추가되었습니다!`,
      'success'
    );
    if (state.mode === 'describe-image') {
      selectQuestion(prevTotal);
    }
  } catch (err) {
    if (err.isMissingKey) {
      el.diAiGenStatus.classList.add('hidden');
    } else {
      showInlineStatus(el.diAiGenStatus, `⚠️ 차트 생성 실패: ${err.message || '오류가 발생했습니다.'}`, 'error');
    }
  } finally {
    state.diAiGenerating = false;
    el.btnDiAiGenerate.disabled = false;
    el.btnDiAiGenerate.classList.remove('opacity-60');
  }
}

export async function generateMoreRsWithAi() {
  if (state.rsAiGenerating) return;
  state.rsAiGenerating = true;
  el.btnRsAiGenerate.disabled = true;
  el.btnRsAiGenerate.classList.add('opacity-60');
  showInlineStatus(el.rsAiGenStatus, `Gemini AI (${state.geminiModel || 'gemini-4-hydrogen'})가 새 실전 문장 10개를 생성 중입니다...`, 'info');

  const existingList = getRepeatSentenceList();
  const sampleExisting = existingList.slice(-15).map(q => q.sentence).join('\n');
  const prompt = [
    `You are a PTE Academic test designer.`,
    `Generate exactly 10 NEW, unique Repeat Sentence items that do NOT duplicate these existing examples:\n${sampleExisting}`,
    `\nBalance the 10 sentences evenly:`,
    `- 3 short foundational sentences (7 to 9 words)`,
    `- 4 medium exam-standard sentences (10 to 12 words)`,
    `- 3 long high-difficulty academic sentences (13 to 16 words)`,
    `\nRespond strictly in JSON matching this schema:`,
    `{`,
    `  "sentences": [`,
    `    {`,
    `      "title": "<short 2-4 word English title>",`,
    `      "topic": "<academic category e.g. Campus Life, Ecology, Economics>",`,
    `      "sentence": "<spoken English sentence ending with period>",`,
    `      "chunking": "<same sentence divided by slashes / into natural breath groups>",`,
    `      "translation": "<natural Korean translation>"`,
    `    }`,
    `  ]`,
    `}`
  ].join('\n');

  try {
    const result = await callGeminiApi([{ text: prompt }]);
    const items = Array.isArray(result.sentences) ? result.sentences : [];
    if (items.length === 0) {
      throw new Error('AI가 유효한 문장 목록을 반환하지 않았습니다.');
    }
    const startNumber = REPEAT_SENTENCE_QUESTIONS.length + state.customRsQuestions.length + 1;
    const prevTotal = getRepeatSentenceList().length;
    const formatted = items.slice(0, 10).map((item, idx) => ({
      id: `RS-${startNumber + idx}`,
      title: String(item.title || `AI Sentence ${startNumber + idx}`).trim(),
      topic: `${String(item.topic || 'Academic').trim()} · AI 생성`,
      sentence: String(item.sentence || '').trim(),
      chunking: String(item.chunking || item.sentence || '').trim(),
      translation: String(item.translation || '').trim(),
      isCustomAi: true
    })).filter(it => it.sentence.length > 0);

    if (formatted.length === 0) {
      throw new Error('생성된 문장 데이터가 비어 있습니다.');
    }

    state.customRsQuestions = [...state.customRsQuestions, ...formatted];
    saveStorage(STORAGE_KEYS.customRsQuestions, state.customRsQuestions);
    updateRsBankSummaryUI();
    showInlineStatus(
      el.rsAiGenStatus,
      `✅ 새 문장 ${formatted.length}개(RS-${startNumber}~RS-${startNumber + formatted.length - 1})가 추가되었습니다!`,
      'success'
    );
    if (state.mode === 'repeat-sentence') {
      selectQuestion(prevTotal);
    }
  } catch (err) {
    if (err.isMissingKey) {
      el.rsAiGenStatus.classList.add('hidden');
    } else {
      showInlineStatus(el.rsAiGenStatus, `⚠️ 생성 실패: ${err.message || '오류가 발생했습니다.'}`, 'error');
    }
  } finally {
    state.rsAiGenerating = false;
    el.btnRsAiGenerate.disabled = false;
    el.btnRsAiGenerate.classList.remove('opacity-60');
  }
}


export function initSpeakingFeature() {
  // Category group switcher
  [
    { el: el.navGroupPte, cat: 'pte', fallback: 'read-aloud' },
    { el: el.navGroupPractical, cat: 'practical', fallback: 'impromptu' },
    { el: el.navGroupLibrary, cat: 'library', fallback: 'review' }
  ].forEach(({ el: btn, cat, fallback }) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const targetMode = (state.lastModeByCategory && state.lastModeByCategory[cat]) || fallback;
      switchMode(targetMode);
    });
  });

  if (el.btnToggleSpeakingTools) {
    el.btnToggleSpeakingTools.addEventListener('click', toggleSpeakingToolsDrawer);
  }
  document.querySelectorAll('[data-toggle-speaking-tools]').forEach(btn => {
    btn.addEventListener('click', toggleSpeakingToolsDrawer);
  });

  // Tabs
  el.tabReadAloud.addEventListener('click', () => switchMode('read-aloud'));
  el.tabDescribeImage.addEventListener('click', () => switchMode('describe-image'));
  el.tabRepeatSentence.addEventListener('click', () => switchMode('repeat-sentence'));
  el.tabRetellLecture.addEventListener('click', () => switchMode('retell-lecture'));
  el.tabImpromptu.addEventListener('click', () => switchMode('impromptu'));
  el.tabRoleplay.addEventListener('click', () => switchMode('roleplay'));
  el.tabYtShadowing.addEventListener('click', () => switchMode('yt-shadowing'));
  if (el.tabBrainPattern) el.tabBrainPattern.addEventListener('click', () => switchMode('brain-pattern'));
  el.tabWriting.addEventListener('click', () => switchMode('writing'));
  el.tabReview.addEventListener('click', () => switchMode('review'));

  // Speaking Selector, Solved & Random Controls
  el.questionSelect.addEventListener('change', (e) => {
    selectQuestion(parseInt(e.target.value, 10) || 0);
  });
  el.btnToggleSolved.addEventListener('click', () => {
    const q = getCurrentQuestion();
    if (!q) return;
    markQuestionSolved(q.id, !isQuestionSolved(q.id));
    renderQuestionSelector();
  });
  el.chkUnsolvedFirst.addEventListener('change', (e) => {
    state.unsolvedFirst = Boolean(e.target.checked);
    el.chkWritingUnsolvedFirst.checked = state.unsolvedFirst;
    saveStorage(STORAGE_KEYS.unsolvedFirst, state.unsolvedFirst);
  });
  el.btnRandomQ.addEventListener('click', () => {
    const list = getQuestionsForMode();
    const nextIdx = pickRandomIndex(list, state.questionIndex[state.mode]);
    selectQuestion(nextIdx);
  });
  el.btnPrevQ.addEventListener('click', () => selectQuestion(state.questionIndex[state.mode] - 1));
  el.btnNextQ.addEventListener('click', () => selectQuestion(state.questionIndex[state.mode] + 1));

  // Describe Image Template
  el.btnToggleTemplate.addEventListener('click', toggleTemplate);


  el.rsAccentSelect.addEventListener('change', (e) => handleAccentChange(e.target.value));
  el.rlAccentSelect.addEventListener('change', (e) => handleAccentChange(e.target.value));
  el.rsVoiceSelect.addEventListener('change', (e) => handleVoiceChange(e.target.value));
  el.rlVoiceSelect.addEventListener('change', (e) => handleVoiceChange(e.target.value));
  el.rsRateSelect.addEventListener('change', (e) => handleRateChange(e.target.value));
  el.rlRateSelect.addEventListener('change', (e) => handleRateChange(e.target.value));
  el.chkRsGeminiTts.addEventListener('change', (e) => handleGeminiTtsToggle(e.target.checked));
  el.chkRlGeminiTts.addEventListener('change', (e) => handleGeminiTtsToggle(e.target.checked));

  el.btnRaListenModel.addEventListener('click', () => {
    if (state.mode !== 'read-aloud') return;
    const q = getCurrentQuestion();
    if (!q) return;
    stopShadowingCompare(false);
    speakText(q.passage, { targetMode: 'read-aloud' });
  });

  el.btnRsListenOnly.addEventListener('click', () => {
    if (state.mode !== 'repeat-sentence') return;
    const q = getCurrentQuestion();
    if (!q) return;
    stopShadowingCompare(false);
    speakText(q.sentence, { targetMode: 'repeat-sentence' });
  });

  el.btnImpToggleModel.addEventListener('click', () => {
    if (state.mode !== 'impromptu') return;
    state.impModelVisible = !state.impModelVisible;
    renderImpromptuModelBox();
  });

  el.btnImpListenModel.addEventListener('click', () => {
    if (state.mode !== 'impromptu') return;
    const q = getCurrentQuestion();
    if (!q) return;
    stopShadowingCompare(false);
    speakText(q.modelAnswer, { targetMode: 'impromptu' });
  });

  el.btnShadowingCompare.addEventListener('click', startShadowingCompare);

  el.btnRsToggleScript.addEventListener('click', () => {
    if (state.phase !== 'done') return;
    state.rsScriptVisible = !state.rsScriptVisible;
    renderRepeatSentenceScriptUI();
  });

  // Retell Lecture Controls
  el.btnRlListenOnly.addEventListener('click', () => {
    if (state.mode !== 'retell-lecture') return;
    const q = getCurrentQuestion();
    speakText(q.script, { targetMode: 'retell-lecture' });
  });

  el.btnRlSkipAudio.addEventListener('click', () => {
    if (state.mode === 'retell-lecture' && state.phase === 'playing-audio') {
      startPrepCountdown();
    }
  });

  el.btnRlYtSkipAudio.addEventListener('click', () => {
    if (state.mode === 'retell-lecture' && state.phase === 'playing-audio') {
      startPrepCountdown();
    }
  });

  el.rlScratchpad.addEventListener('input', () => {
    if (state.mode !== 'retell-lecture') return;
    const q = getCurrentQuestion();
    if (!q) return;
    try {
      localStorage.setItem(getRlNotesKey(q.id), el.rlScratchpad.value);
      el.rlNotesStatus.textContent = '메모 자동 저장됨';
    } catch (e) {
      if (isQuotaExceededError(e)) showStorageQuotaToast();
      el.rlNotesStatus.textContent = '저장 실패';
    }
  });

  el.btnRlClearNotes.addEventListener('click', () => {
    const q = getCurrentQuestion();
    el.rlScratchpad.value = '';
    if (q) {
      try { localStorage.removeItem(getRlNotesKey(q.id)); } catch (e) {}
    }
    el.rlNotesStatus.textContent = '메모 비워짐';
  });

  el.btnRlToggleScript.addEventListener('click', () => {
    if (state.phase !== 'done') return;
    state.rlScriptVisible = !state.rlScriptVisible;
    renderRetellLectureRevealUI();
  });

  el.btnRlToggleModel.addEventListener('click', () => {
    if (state.phase !== 'done') return;
    state.rlModelVisible = !state.rlModelVisible;
    renderRetellLectureRevealUI();
  });

  // Speaking Timer Controls
  el.btnStart.addEventListener('click', startPractice);
  el.btnSkipPrep.addEventListener('click', () => {
    if (state.phase === 'prep' || state.phase === 'playing-audio') {
      beginRecordingPhase();
    }
  });
  el.btnReset.addEventListener('click', () => resetPractice(true));

  el.btnTestBeep.addEventListener('click', () => {
    ensureAudioContext();
    playBeep(980, 0.35);
  });

  el.btnMicConnect.addEventListener('click', async () => {
    ensureAudioContext();
    const ok = await requestMicrophone();
    // Release track shortly after permission check so iOS AirPods/earphones return to Media mode
    if (ok && state.phase !== 'recording') {
      setTimeout(() => {
        if (state.phase !== 'recording') {
          releaseMicrophoneStream();
        }
      }, 450);
    }
  });


  el.btnAiGradeSpeaking.addEventListener('click', gradeSpeakingWithAi);

  el.btnRsAiGenerate.addEventListener('click', generateMoreRsWithAi);
  el.btnDiAiGenerate.addEventListener('click', generateMoreDiWithAi);

  document.querySelectorAll('[data-toggle-ios-guide]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.iosAudioGuideBox.classList.toggle('hidden');
    });
  });
  if (el.btnCloseIosGuide) {
    el.btnCloseIosGuide.addEventListener('click', () => {
      el.iosAudioGuideBox.classList.add('hidden');
    });
  }
}
