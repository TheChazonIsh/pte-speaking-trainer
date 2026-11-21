import { ROLEPLAY_PRESETS } from '../config/constants.js';
import { escapeHtml } from '../utils/security.js';
import { state, el } from '../state/store.js';
import {
  blobToBase64,
  callGeminiApi,
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
import { renderStudyStepper } from './speaking.js';
import { recordPracticeLog, recordWeaknessEntry } from './vocab.js';
import { renderRoleplayMissionBar, checkAndCompleteRoleplayMissions } from './brainPattern.js';

export function getActiveRoleplayPreset() {
  return ROLEPLAY_PRESETS.find(p => p.id === state.rpPresetId) || ROLEPLAY_PRESETS[0];
}

export function getRoleplayScenarioDescription() {
  const preset = getActiveRoleplayPreset();
  if (preset.id === 'custom') {
    const custom = (state.rpCustomContext || el.rpCustomInput?.value || '').trim();
    return custom || 'General everyday life and workplace communication in Auckland, New Zealand.';
  }
  return preset.contextEn;
}

export function setRoleplayRecordingUI(isRec, statusMsg = '') {
  state.rpIsRecording = Boolean(isRec);
  if (!el.btnRpRecord) return;

  const canRespond = state.rpActive && !state.rpBusy;
  el.btnRpRecord.disabled = !canRespond && !isRec;

  if (isRec) {
    el.btnRpRecord.className = 'min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-sm transition cursor-pointer flex items-center justify-center gap-2 ring-2 ring-rose-400';
    el.rpRecordDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping';
    el.rpRecordBtnLabel.textContent = '⏹️ 녹음 완료 및 AI에게 전송';
    el.btnRpCancelRecord.classList.remove('hidden');
    el.rpRecordTimer.classList.remove('hidden');
  } else {
    el.btnRpRecord.className = 'min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2';
    el.rpRecordDot.className = 'w-2.5 h-2.5 rounded-full bg-white/90';
    el.rpRecordBtnLabel.textContent = '🎤 내 답변 녹음하기';
    el.btnRpCancelRecord.classList.add('hidden');
    el.rpRecordTimer.classList.add('hidden');
    el.rpRecordTimer.textContent = '00:00';
  }

  if (el.rpTextInput) el.rpTextInput.disabled = !canRespond || isRec;
  if (el.btnRpSendText) el.btnRpSendText.disabled = !canRespond || isRec;
  if (el.btnRpEnd) el.btnRpEnd.disabled = !state.rpActive || isRec || state.rpBusy;

  if (statusMsg && el.rpRecordStatus) {
    el.rpRecordStatus.textContent = statusMsg;
  }
  renderStudyStepper();
}

export function renderRoleplayPresets() {
  if (!el.rpPresetGrid) return;
  const preset = getActiveRoleplayPreset();

  el.rpPresetGrid.innerHTML = ROLEPLAY_PRESETS.map(p => {
    const active = p.id === preset.id;
    return `
      <button type="button" data-rp-preset="${escapeHtml(p.id)}"
        class="text-left rounded-xl border p-3 transition cursor-pointer min-w-0 ${
          active
            ? 'border-indigo-400 bg-indigo-50/70 ring-1 ring-indigo-300 shadow-xs'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
        }">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${p.badgeCls}">${escapeHtml(p.badge)}</span>
          ${active ? '<span class="text-[11px] font-bold text-indigo-700">선택됨 ✓</span>' : ''}
        </div>
        <p class="text-xs sm:text-sm font-bold text-slate-900 leading-snug">${escapeHtml(p.title)}</p>
        <p class="text-[11px] text-slate-500 truncate mt-0.5">${escapeHtml(p.partnerName)}</p>
      </button>
    `;
  }).join('');

  if (el.rpCustomBox) {
    el.rpCustomBox.classList.toggle('hidden', preset.id !== 'custom');
  }
  if (el.rpActivePartner) {
    el.rpActivePartner.textContent = `AI 상대방: ${preset.partnerName}`;
  }
  if (el.rpActiveTitle) {
    el.rpActiveTitle.textContent = preset.id === 'custom' && state.rpCustomContext.trim()
      ? `(6) 자유 주제 · ${state.rpCustomContext.trim()}`
      : preset.title;
  }
}

export function renderRoleplayChatLog() {
  if (!el.rpChatLog) return;
  const msgs = state.rpMessages;

  if (!msgs || msgs.length === 0) {
    const preset = getActiveRoleplayPreset();
    el.rpChatLog.innerHTML = `
      <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center space-y-2 max-w-xl mx-auto my-6">
        <p class="text-sm font-bold text-slate-800">${escapeHtml(preset.title)} 준비 완료</p>
        <p class="text-xs text-slate-500 leading-relaxed">
          위 <strong>▶️ 대화 시작</strong> 버튼을 누르면 상대방(<strong>${escapeHtml(preset.partnerName)}</strong>)이 첫 질문을 음성으로 건넵니다.<br />
          마이크로 직접 말하거나 아래 입력창에 영어로 입력해 대화를 이어갈 수 있습니다.
        </p>
      </div>
    `;
    return;
  }

  el.rpChatLog.innerHTML = msgs.map((m, idx) => {
    if (m.role === 'partner') {
      return `
        <div class="flex justify-start">
          <div class="max-w-[92%] sm:max-w-[80%] rounded-2xl rounded-tl-sm border border-indigo-200 bg-white p-4 shadow-xs space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-[11px] font-bold text-indigo-700">${escapeHtml(m.speakerLabel || 'AI Partner')}</span>
              <button type="button" data-rp-speak="${idx}"
                class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition cursor-pointer">
                🔊 다시 듣기
              </button>
            </div>
            <p class="text-sm text-slate-900 font-medium leading-relaxed">${escapeHtml(m.textEn || '')}</p>
            ${m.textKo ? `<p class="text-xs text-slate-500 border-t border-slate-100 pt-1.5 leading-relaxed">${escapeHtml(m.textKo)}</p>` : ''}
          </div>
        </div>
      `;
    }

    const tip = m.oneLineTip;
    return `
      <div class="flex justify-end">
        <div class="max-w-[92%] sm:max-w-[82%] rounded-2xl rounded-tr-sm border border-sky-200 bg-sky-50/90 p-4 shadow-xs space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-bold text-sky-800">🎙️ 나의 답변</span>
            ${m.pending ? '<span class="text-[11px] font-semibold text-indigo-600 animate-pulse">AI 분석 중...</span>' : ''}
          </div>
          ${m.audioUrl ? `
            <audio controls preload="metadata" src="${escapeHtml(m.audioUrl)}" class="w-full h-9 rounded-lg"></audio>
          ` : ''}
          ${m.transcript ? `
            <p class="text-sm text-slate-900 leading-relaxed">${escapeHtml(m.transcript)}</p>
          ` : m.pending ? '' : '<p class="text-xs text-slate-500 italic">(전송된 음성 답변)</p>'}

          ${m.errorNote ? `
            <p class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">${escapeHtml(m.errorNote)}</p>
          ` : ''}

          ${tip && tip.betterExpression ? `
            <div class="rounded-xl border border-amber-200 bg-amber-50/90 p-3 space-y-1.5 text-xs">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-extrabold text-amber-900">💡 방금 내 답변의 더 자연스러운 표현 1줄 팁</span>
                <button type="button"
                  data-ai-vocab-word="${escapeHtml(tip.betterExpression)}"
                  data-ai-vocab-meaning="${escapeHtml(tip.meaningKo || tip.reasonKo || '롤플레이 추천 표현')}"
                  data-ai-vocab-example="${escapeHtml(tip.example || tip.betterExpression)}"
                  class="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-teal-600 hover:bg-teal-700 transition cursor-pointer">
                  + 단어장 추가
                </button>
              </div>
              ${tip.myPhrase ? `<p class="text-rose-700"><span class="font-semibold">내 표현:</span> ${escapeHtml(tip.myPhrase)}</p>` : ''}
              <p class="text-emerald-900 font-bold">→ ${escapeHtml(tip.betterExpression)}</p>
              ${tip.reasonKo ? `<p class="text-slate-600 leading-relaxed">${escapeHtml(tip.reasonKo)}</p>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  el.rpChatLog.scrollTop = el.rpChatLog.scrollHeight;
}

export function renderRoleplayWorkspace() {
  renderRoleplayPresets();
  renderRoleplayMissionBar();
  renderRoleplayChatLog();
  setRoleplayRecordingUI(
    state.rpIsRecording,
    state.rpActive
      ? '상대방 말을 들은 뒤 🎤 내 답변 녹음하기를 눌러 영어로 대답하세요.'
      : '대화를 시작하면 음성 녹음 답변 버튼이 활성화됩니다.'
  );
}

export function stopRoleplayRecording(discard = false) {
  if (state.rpRecordTimerId) {
    clearInterval(state.rpRecordTimerId);
    state.rpRecordTimerId = null;
  }
  if (state.rpMediaRecorder && state.rpMediaRecorder.state !== 'inactive') {
    state.rpRecordCancelFlag = Boolean(discard);
    try {
      state.rpMediaRecorder.stop();
    } catch (e) {
      releaseMicrophoneStream();
    }
  } else {
    if (discard) releaseMicrophoneStream();
    setRoleplayRecordingUI(false);
  }
}

export function resetRoleplaySession(keepPreset = true) {
  stopRoleplayRecording(true);
  cancelSpeech();
  releaseMicrophoneStream();
  if (Array.isArray(state.rpBlobUrls)) {
    state.rpBlobUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    });
    state.rpBlobUrls = [];
  }
  state.rpActive = false;
  state.rpBusy = false;
  state.rpMessages = [];
  if (!keepPreset) state.rpPresetId = 'ece-interview';
  if (el.rpSummaryBox) {
    el.rpSummaryBox.classList.add('hidden');
    el.rpSummaryBox.innerHTML = '';
  }
  if (el.rpStatusBadge) {
    el.rpStatusBadge.textContent = '대기 중';
    el.rpStatusBadge.className = 'px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-200 text-slate-700';
  }
  if (el.rpAudioStatus) {
    el.rpAudioStatus.textContent = "상황을 고른 뒤 '대화 시작'을 누르세요.";
  }
  renderRoleplayWorkspace();
}

export async function startRoleplayConversation() {
  if (state.rpBusy) return;
  ensureAudioContext();
  stopRoleplayRecording(true);
  cancelSpeech();
  releaseMicrophoneStream();

  const preset = getActiveRoleplayPreset();
  const scenarioDesc = getRoleplayScenarioDescription();

  if (Array.isArray(state.rpBlobUrls)) {
    state.rpBlobUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    });
    state.rpBlobUrls = [];
  }
  if (el.rpSummaryBox) {
    el.rpSummaryBox.classList.add('hidden');
    el.rpSummaryBox.innerHTML = '';
  }

  state.rpMessages = [];
  state.rpActive = true;
  state.rpBusy = true;

  if (el.rpStatusBadge) {
    el.rpStatusBadge.textContent = '대화 진행 중';
    el.rpStatusBadge.className = 'px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800';
  }
  setRoleplayRecordingUI(false, 'AI 상대방의 첫 질문을 준비하고 있습니다...');
  renderRoleplayChatLog();

  let openingEn = preset.openingEn;
  let openingKo = preset.openingKo;

  const hasApiKey = Boolean(state.geminiApiKey && state.geminiApiKey.trim());
  if (hasApiKey) {
    if (el.rpAudioStatus) el.rpAudioStatus.textContent = '✨ Gemini AI가 실전 오프닝 대사를 생성 중...';
    try {
      const prompt = [
        `You are playing the role of "${preset.partnerName}" (${preset.partnerVoiceHint}) in a New Zealand real-life English roleplay.`,
        `Scenario context: ${scenarioDesc}`,
        `Generate a natural, authentic New Zealand English opening line (2-3 sentences max) inviting the user to respond.`,
        `Respond strictly in JSON:`,
        `{ "partnerLineEn": "<opening line in natural NZ English>", "partnerLineKo": "<natural Korean translation>" }`
      ].join('\n');
      const aiOpening = await callGeminiApi([{ text: prompt }]);
      if (aiOpening && aiOpening.partnerLineEn) {
        openingEn = aiOpening.partnerLineEn;
        openingKo = aiOpening.partnerLineKo || '';
      }
    } catch (err) {
      // Fall back cleanly to built-in authentic Kiwi opening line
    }
  }

  state.rpBusy = false;
  state.rpMessages.push({
    role: 'partner',
    speakerLabel: preset.partnerName,
    textEn: openingEn,
    textKo: openingKo
  });
  renderRoleplayChatLog();
  setRoleplayRecordingUI(false, '상대방 말을 들은 뒤 🎤 내 답변 녹음하기를 눌러 대답하세요.');
  speakText(openingEn, { targetMode: 'roleplay' });
}

export async function startRoleplayRecording() {
  if (!state.rpActive || state.rpBusy) return;
  if (state.rpIsRecording) {
    stopRoleplayRecording(false);
    return;
  }

  ensureAudioContext();
  cancelSpeech();
  if (el.rpAudioStatus) el.rpAudioStatus.textContent = '마이크 연결 중...';

  const ok = await requestMicrophone();
  if (!ok || !state.micStream || state.mode !== 'roleplay' || !state.rpActive) {
    releaseMicrophoneStream();
    setRoleplayRecordingUI(false, '마이크 권한이 없거나 장치를 찾을 수 없습니다. 아래 텍스트 입력을 이용해보세요.');
    return;
  }

  try {
    state.rpAudioChunks = [];
    state.rpRecordCancelFlag = false;
    const mime = pickSupportedMimeType();
    const options = mime ? { mimeType: mime } : undefined;
    const recorder = new MediaRecorder(state.micStream, options);
    const actualMime = (recorder.mimeType || mime || 'audio/webm').split(';')[0];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        state.rpAudioChunks.push(ev.data);
      }
    };

    recorder.onstop = () => {
      // CRITICAL iOS compatibility: stop mic tracks IMMEDIATELY so AirPods return to Media mode before AI TTS
      releaseMicrophoneStream();
      state.rpMediaRecorder = null;
      if (state.rpRecordTimerId) {
        clearInterval(state.rpRecordTimerId);
        state.rpRecordTimerId = null;
      }

      const canceled = state.rpRecordCancelFlag;
      state.rpRecordCancelFlag = false;
      setRoleplayRecordingUI(false);

      if (canceled || state.rpAudioChunks.length === 0) {
        state.rpAudioChunks = [];
        if (el.rpRecordStatus) el.rpRecordStatus.textContent = '녹음이 취소되었습니다. 다시 녹음할 수 있습니다.';
        return;
      }

      const audioBlob = new Blob(state.rpAudioChunks, { type: actualMime });
      state.rpAudioChunks = [];
      const blobUrl = URL.createObjectURL(audioBlob);
      state.rpBlobUrls.push(blobUrl);

      submitRoleplayUserTurn({ audioBlob, mimeType: actualMime, blobUrl });
    };

    state.rpMediaRecorder = recorder;
    recorder.start();
    state.rpRecordStartMs = Date.now();
    setRoleplayRecordingUI(true, '🔴 녹음 중... 말씀이 끝나면 [녹음 완료 및 AI에게 전송]을 누르세요.');

    state.rpRecordTimerId = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - state.rpRecordStartMs) / 1000);
      const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const ss = String(elapsedSec % 60).padStart(2, '0');
      if (el.rpRecordTimer) el.rpRecordTimer.textContent = `${mm}:${ss}`;
    }, 250);
  } catch (err) {
    releaseMicrophoneStream();
    setRoleplayRecordingUI(false, '녹음 시작 중 오류가 발생했습니다: ' + (err.message || 'AudioError'));
  }
}

export async function submitRoleplayUserTurn({ audioBlob = null, mimeType = 'audio/webm', blobUrl = '', textFallback = '' }) {
  if (!state.rpActive || state.rpBusy) return;
  const preset = getActiveRoleplayPreset();
  const scenarioDesc = getRoleplayScenarioDescription();

  // Ensure mic is strictly closed before AI turn
  releaseMicrophoneStream();

  const userMsgIndex = state.rpMessages.length;
  state.rpMessages.push({
    role: 'user',
    audioUrl: blobUrl,
    transcript: textFallback || '',
    pending: true,
    oneLineTip: null,
    errorNote: ''
  });
  state.rpBusy = true;
  setRoleplayRecordingUI(false, 'AI가 방금 답변을 듣고 다음 질문과 1줄 표현 팁을 작성 중입니다...');
  if (el.rpAudioStatus) el.rpAudioStatus.textContent = '🤖 AI 응답 및 1줄 팁 생성 중...';
  if (textFallback) {
    checkAndCompleteRoleplayMissions(textFallback);
  }
  renderRoleplayChatLog();

  const historyLines = state.rpMessages.slice(0, userMsgIndex).map(m => {
    if (m.role === 'partner') return `${preset.partnerName}: ${m.textEn}`;
    return `User: ${m.transcript || '(voice reply)'}`;
  }).join('\n');

  const activeMissionList = (state.rpMissionTargets || []).filter(m => !m.completed).map(m => m.pattern).join(', ');

  const prompt = [
    `You are roleplaying as "${preset.partnerName}" (${preset.partnerVoiceHint}) in a New Zealand real-life scenario.`,
    `Scenario: ${scenarioDesc}`,
    activeMissionList ? `Target expressions the learner is practicing today: ${activeMissionList} (subtly steer conversation toward natural opportunities for these when appropriate).` : '',
    `\nConversation so far:\n${historyLines}`,
    audioBlob
      ? `\nListen carefully to the attached user audio reply, transcribe it verbatim, give ONE concise natural expression upgrade tip for how they phrased it, and reply naturally in-character to continue the conversation (2-3 sentences max).`
      : `\nThe user replied in text: "${textFallback}". Give ONE concise natural expression upgrade tip and reply naturally in-character (2-3 sentences max).`,
    `\nRespond strictly in JSON matching this schema:`,
    `{`,
    `  "userTranscript": "<exact English transcript of the user reply>",`,
    `  "oneLineTip": {`,
    `    "myPhrase": "<awkward/Konglish phrase or key snippet from user reply>",`,
    `    "betterExpression": "<1 more natural native NZ/English expression>",`,
    `    "meaningKo": "<short Korean meaning>",`,
    `    "reasonKo": "<1 concise Korean explanation of why this sounds better>",`,
    `    "example": "<short natural example sentence using betterExpression>"`,
    `  },`,
    `  "partnerReplyEn": "<natural in-character follow-up response + next question in NZ English>",`,
    `  "partnerReplyKo": "<Korean translation of partnerReplyEn>"`,
    `}`
  ].join('\n');

  try {
    const parts = [{ text: prompt }];
    if (audioBlob) {
      const base64Audio = await blobToBase64(audioBlob);
      parts.push({ inlineData: { mimeType, data: base64Audio } });
    }

    const result = await callGeminiApi(parts);
    const msg = state.rpMessages[userMsgIndex];
    msg.pending = false;
    msg.transcript = result.userTranscript || textFallback || '(인식된 발화)';
    msg.oneLineTip = result.oneLineTip || null;

    checkAndCompleteRoleplayMissions(msg.transcript);

    if (result.oneLineTip && result.oneLineTip.betterExpression) {
      recordWeaknessEntry({
        target: result.oneLineTip.myPhrase || result.oneLineTip.betterExpression,
        correction: `${result.oneLineTip.betterExpression}${result.oneLineTip.meaningKo ? ' (' + result.oneLineTip.meaningKo + ')' : ''}`,
        category: 'konglish',
        sourceMode: 'roleplay'
      });
    }

    const partnerReplyEn = result.partnerReplyEn || "Thanks for sharing that! Could you tell me a little more about what happened next?";
    const partnerReplyKo = result.partnerReplyKo || '';
    state.rpMessages.push({
      role: 'partner',
      speakerLabel: preset.partnerName,
      textEn: partnerReplyEn,
      textKo: partnerReplyKo
    });

    state.rpBusy = false;
    renderRoleplayChatLog();
    setRoleplayRecordingUI(false, '상대방 답변 재생 후 🎤 내 답변 녹음하기로 이어서 말하세요.');
    speakText(partnerReplyEn, { targetMode: 'roleplay' });
  } catch (err) {
    state.rpBusy = false;
    const msg = state.rpMessages[userMsgIndex];
    msg.pending = false;
    msg.errorNote = err.isMissingKey
      ? '⚙️ 상단 [AI 설정]에서 Google AI Studio API 키를 저장하면 음성 분석 및 대화가 이어집니다.'
      : (err.message || 'AI 응답 생성 중 오류가 발생했습니다.');
    if (el.rpAudioStatus) {
      el.rpAudioStatus.textContent = err.isMissingKey
        ? '⚙️ AI API 키 설정 후 다시 전송하거나 새로운 대화를 시작하세요.'
        : '⚠️ AI 응답 생성이 중단되었습니다. 다시 시도해주세요.';
    }
    renderRoleplayChatLog();
    setRoleplayRecordingUI(false, '다시 녹음하거나 텍스트로 답변을 보낼 수 있습니다.');
  }
}

export async function endRoleplayConversation() {
  if (!state.rpActive || state.rpBusy) return;
  stopRoleplayRecording(true);
  cancelSpeech();
  releaseMicrophoneStream();

  const preset = getActiveRoleplayPreset();
  const userTurns = state.rpMessages.filter(m => m.role === 'user');
  if (userTurns.length === 0) {
    el.rpSummaryBox.classList.remove('hidden');
    el.rpSummaryBox.innerHTML = `
      <div class="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-4">
        아직 내 답변 턴이 기록되지 않았습니다. 최소 1회 이상 영어로 답변한 뒤 종합 피드백을 받아보세요!
      </div>
    `;
    return;
  }

  const hasApiKey = Boolean(state.geminiApiKey && state.geminiApiKey.trim());
  state.rpBusy = true;
  setRoleplayRecordingUI(false, '종합 회화 피드백을 생성 중입니다...');
  el.rpSummaryBox.classList.remove('hidden');
  el.rpSummaryBox.innerHTML = `
    <div class="flex items-center gap-3 text-indigo-800 py-2">
      <span class="w-5 h-5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin shrink-0"></span>
      <p class="text-sm font-bold">대화 내용을 바탕으로 종합 피드백 리포트를 작성 중입니다...</p>
    </div>
  `;

  if (!hasApiKey) {
    state.rpBusy = false;
    state.rpActive = false;
    recordPracticeLog(`RP-${preset.id.toUpperCase()}`, 'roleplay', preset.title, null);
    el.rpStatusBadge.textContent = '대화 종료';
    el.rpStatusBadge.className = 'px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-200 text-slate-700';
    if (el.rpAudioStatus) {
      el.rpAudioStatus.textContent = '대화가 종료되었습니다. 새 대화를 시작하려면 ▶️ 대화 시작을 누르세요.';
    }
    setRoleplayRecordingUI(false, '대화가 종료되었습니다. 새 대화를 시작하려면 ▶️ 대화 시작을 누르세요.');
    el.rpSummaryBox.innerHTML = `
      <div class="space-y-2 text-xs">
        <h3 class="text-sm font-extrabold text-slate-900">🏁 롤플레이 연습 완료 (${escapeHtml(preset.title)})</h3>
        <p class="text-slate-600">총 ${userTurns.length}회의 답변을 연습하고 학습 기록에 저장했습니다. API 키를 설정하면 AI 종합 점수 및 핵심 표현 추천 리포트를 받을 수 있습니다.</p>
      </div>
    `;
    return;
  }

  const transcriptText = state.rpMessages.map(m => {
    return m.role === 'partner'
      ? `${preset.partnerName}: ${m.textEn}`
      : `User: ${m.transcript || '(voice reply)'}`;
  }).join('\n');

  const prompt = [
    `You are a New Zealand English & ECE/workplace communication coach.`,
    `Scenario: ${preset.title} — ${getRoleplayScenarioDescription()}`,
    `\nFull Roleplay Transcript:\n${transcriptText}`,
    `\nEvaluate the learner's overall fluency, naturalness, clarity, and cultural appropriateness in New Zealand.`,
    `Respond strictly in JSON (Korean feedback):`,
    `{`,
    `  "overallScore": <integer 10..90>,`,
    `  "strengthsKo": "<what the learner did well in Korean>",`,
    `  "improvementsKo": "<key points to improve in Korean>",`,
    `  "keyExpressions": [`,
    `    { "expression": "<useful NZ English expression>", "meaningKo": "<Korean meaning>", "example": "<example sentence>" }`,
    `  ]`,
    `}`
  ].join('\n');

  try {
    const summary = await callGeminiApi([{ text: prompt }]);
    const score = Math.max(10, Math.min(90, Math.round(Number(summary.overallScore) || 75)));
    recordPracticeLog(`RP-${preset.id.toUpperCase()}`, 'roleplay', preset.title, score);

    state.rpBusy = false;
    state.rpActive = false;
    el.rpStatusBadge.textContent = '종료 및 피드백 완료';
    el.rpStatusBadge.className = 'px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-800';
    if (el.rpAudioStatus) {
      el.rpAudioStatus.textContent = '대화가 종료되고 종합 피드백 리포트가 생성되었습니다.';
    }
    setRoleplayRecordingUI(false, '대화가 종료되었습니다. 다시 연습하려면 ▶️ 대화 시작을 누르세요.');

    el.rpSummaryBox.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-indigo-100">
        <div>
          <span class="text-xs font-bold uppercase tracking-wider text-indigo-700">Roleplay Summary</span>
          <h3 class="text-base font-extrabold text-slate-900">🏁 종합 회화 피드백 리포트</h3>
        </div>
        <div class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-pte-navy to-indigo-600 text-white text-center shadow-xs">
          <span class="block text-[10px] opacity-85">회화 점수</span>
          <span class="text-xl font-extrabold tabular-nums">${score}<span class="text-xs font-normal opacity-80">/90</span></span>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-1">
          <span class="font-bold text-emerald-900 block">👍 잘한 점</span>
          <p class="text-slate-700 leading-relaxed">${escapeHtml(summary.strengthsKo || '')}</p>
        </div>
        <div class="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-1">
          <span class="font-bold text-amber-900 block">📌 보완 포인트</span>
          <p class="text-slate-700 leading-relaxed">${escapeHtml(summary.improvementsKo || '')}</p>
        </div>
      </div>
      ${renderHighScoreExpressionsSection(summary.keyExpressions)}
    `;
  } catch (err) {
    state.rpBusy = false;
    setRoleplayRecordingUI(false);
    renderAiErrorCard(el.rpSummaryBox, err.message || '종합 피드백 생성 중 오류가 발생했습니다.');
  }
}

export function initRoleplayFeature() {
  // Roleplay Event Listeners
  if (el.rpPresetGrid) {
    el.rpPresetGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rp-preset]');
      if (!btn) return;
      const nextId = btn.dataset.rpPreset;
      if (!nextId || nextId === state.rpPresetId) return;
      state.rpPresetId = nextId;
      resetRoleplaySession(true);
    });
  }
  if (el.rpCustomInput) {
    el.rpCustomInput.addEventListener('input', (e) => {
      state.rpCustomContext = e.target.value;
      renderRoleplayPresets();
    });
  }
  if (el.btnRpStart) {
    el.btnRpStart.addEventListener('click', startRoleplayConversation);
  }
  if (el.btnRpReset) {
    el.btnRpReset.addEventListener('click', () => resetRoleplaySession(true));
  }
  if (el.btnRpEnd) {
    el.btnRpEnd.addEventListener('click', endRoleplayConversation);
  }
  if (el.btnRpRecord) {
    el.btnRpRecord.addEventListener('click', startRoleplayRecording);
  }
  if (el.btnRpCancelRecord) {
    el.btnRpCancelRecord.addEventListener('click', () => stopRoleplayRecording(true));
  }
  if (el.btnRpSendText) {
    el.btnRpSendText.addEventListener('click', () => {
      const txt = (el.rpTextInput?.value || '').trim();
      if (!txt || !state.rpActive || state.rpBusy) return;
      el.rpTextInput.value = '';
      submitRoleplayUserTurn({ textFallback: txt });
    });
  }
  if (el.rpTextInput) {
    el.rpTextInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.btnRpSendText?.click();
      }
    });
  }
  if (el.rpChatLog) {
    el.rpChatLog.addEventListener('click', (e) => {
      const speakBtn = e.target.closest('[data-rp-speak]');
      if (!speakBtn) return;
      const idx = parseInt(speakBtn.dataset.rpSpeak, 10);
      const msg = state.rpMessages[idx];
      if (msg && msg.textEn) {
        speakText(msg.textEn, { targetMode: 'roleplay' });
      }
    });
  }
}
