import { MODE_CONFIG } from '../config/constants.js';
import { state, el } from '../state/store.js';
import { stopShadowingCompare } from './tts.js';
import { getCurrentQuestion } from '../features/speaking.js';

export function ensureAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!state.audioCtx) {
    state.audioCtx = new AudioCtx();
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume().catch(() => {});
  }
  return state.audioCtx;
}

export function playBeep(frequency = 980, durationSec = 0.38) {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
    gain.gain.setValueAtTime(0.28, now + durationSec - 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = () => {
      try { osc.disconnect(); } catch (e) {}
      try { gain.disconnect(); } catch (e) {}
    };

    osc.start(now);
    osc.stop(now + durationSec);
  } catch (err) {
    console.warn('Web Audio Beep error:', err);
  }
}

export function updateMicUI(message, warning = '') {
  const micLive = Boolean(state.micStream && state.micStream.active);
  if (state.micStatus === 'ready') {
    el.headerMicDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    el.headerMicLabel.textContent = micLive ? '마이크 켜짐' : '마이크 준비';
    el.micStatusDetail.textContent = message || (micLive ? '마이크 입력 활성 중' : '녹음 대기 중');
    el.micStatusDetail.className = 'text-emerald-600 font-medium';
  } else if (state.micStatus === 'denied' || state.micStatus === 'unsupported') {
    el.headerMicDot.className = 'w-2 h-2 rounded-full bg-rose-400';
    el.headerMicLabel.textContent = state.micStatus === 'unsupported' ? '마이크 미지원' : '마이크 권한 없음';
    el.micStatusDetail.textContent = message || '타이머 전용 모드로 실행됩니다';
    el.micStatusDetail.className = 'text-amber-600 font-medium';
  } else {
    el.headerMicDot.className = 'w-2 h-2 rounded-full bg-amber-400';
    el.headerMicLabel.textContent = '마이크';
    el.micStatusDetail.textContent = message || '대기 중';
    el.micStatusDetail.className = 'text-slate-500';
  }

  if (warning) {
    el.micWarningBox.textContent = warning;
    el.micWarningBox.classList.remove('hidden');
  } else {
    el.micWarningBox.classList.add('hidden');
  }
}

export function disconnectMicAnalyserNodes() {
  if (state.micSourceNode) {
    try { state.micSourceNode.disconnect(); } catch (e) {}
    state.micSourceNode = null;
  }
  if (state.analyser) {
    try { state.analyser.disconnect(); } catch (e) {}
    state.analyser = null;
  }
}

export function isMicLevelBarVisible() {
  if (!el.micLevelBar || document.hidden) return false;
  if (!MODE_CONFIG[state.mode]) return false;
  return el.micLevelBar.offsetParent !== null;
}

export function stopLevelMeter() {
  if (state.meterRafId !== null) {
    cancelAnimationFrame(state.meterRafId);
    state.meterRafId = null;
  }
  if (el.micLevelBar) {
    el.micLevelBar.style.width = '0%';
    el.micLevelBar.className = 'h-full w-0 bg-emerald-500 transition-all duration-75 rounded-full';
  }
}

export function releaseMicrophoneStream() {
  stopLevelMeter();
  disconnectMicAnalyserNodes();
  if (state.micStream) {
    try {
      state.micStream.getTracks().forEach(track => track.stop());
    } catch (e) {
      // ignore
    }
    state.micStream = null;
  }
  if (state.micStatus === 'ready') {
    updateMicUI('대기 중');
  }
}

export async function requestMicrophone() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    state.micStatus = 'unsupported';
    updateMicUI(
      '브라우저가 마이크 녹음을 지원하지 않습니다',
      '현재 환경에서는 마이크 녹음 없이 실전 타이머와 Beep 알림만 동작합니다.'
    );
    return false;
  }

  if (state.micStream && state.micStream.active) {
    state.micStatus = 'ready';
    updateMicUI('마이크 연결됨 (음성 입력 대기)');
    return true;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    state.micStream = stream;
    state.micStatus = 'ready';
    setupMicAnalyser(stream);
    updateMicUI('마이크 연결됨 (녹음 중 활성화)');
    return true;
  } catch (err) {
    state.micStatus = 'denied';
    updateMicUI(
      '마이크 접근 불가 — 타이머 모드로 진행',
      '마이크 장치 또는 권한이 없어 음성 녹음은 건너뛰고 실전 타이머만 진행됩니다. (' + (err.name || 'PermissionError') + ')'
    );
    return false;
  }
}

export function setupMicAnalyser(stream) {
  try {
    disconnectMicAnalyserNodes();
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    state.micSourceNode = source;
    state.analyser = analyser;
    if (isMicLevelBarVisible()) {
      startLevelMeter();
    } else {
      stopLevelMeter();
    }
  } catch (e) {
    disconnectMicAnalyserNodes();
  }
}

export function startLevelMeter() {
  stopLevelMeter();
  if (!state.analyser || !state.micStream || !state.micStream.active || !isMicLevelBarVisible()) {
    return;
  }
  const dataArray = new Uint8Array(state.analyser.frequencyBinCount);
  let lastPct = -1;
  let lastIsRecording = null;

  const tick = () => {
    if (!state.analyser || !state.micStream || !state.micStream.active || !isMicLevelBarVisible()) {
      stopLevelMeter();
      return;
    }
    state.analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length;
    const pct = Math.min(100, Math.round((avg / 90) * 100));
    const isRecording = state.phase === 'recording';
    if (pct !== lastPct) {
      el.micLevelBar.style.width = pct + '%';
      lastPct = pct;
    }
    if (isRecording !== lastIsRecording) {
      el.micLevelBar.className = isRecording
        ? 'h-full bg-rose-500 transition-all duration-75 rounded-full'
        : 'h-full bg-emerald-500 transition-all duration-75 rounded-full';
      lastIsRecording = isRecording;
    }
    state.meterRafId = requestAnimationFrame(tick);
  };
  state.meterRafId = requestAnimationFrame(tick);
}

export function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export function startMediaRecording() {
  if (!state.micStream || !state.micStream.active || typeof MediaRecorder === 'undefined') {
    return;
  }

  try {
    state.recordedChunks = [];
    const mime = pickSupportedMimeType();
    const options = mime ? { mimeType: mime } : undefined;
    const recorder = new MediaRecorder(state.micStream, options);
    state.recordingMime = recorder.mimeType || mime || 'audio/webm';

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        state.recordedChunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      try {
        if (state.recordedChunks.length === 0) {
          state.recordedBlob = null;
          return;
        }
        const blob = new Blob(state.recordedChunks, { type: state.recordingMime });
        state.recordedBlob = blob;
        if (state.recordingUrl) {
          URL.revokeObjectURL(state.recordingUrl);
        }
        state.recordingUrl = URL.createObjectURL(blob);

        el.audioPlayback.src = state.recordingUrl;
        const ext = state.recordingMime.includes('mp4') ? 'm4a' : (state.recordingMime.includes('ogg') ? 'ogg' : 'webm');
        const q = getCurrentQuestion();
        el.btnDownloadAudio.href = state.recordingUrl;
        el.btnDownloadAudio.download = `${q ? q.id : 'pte'}-recording.${ext}`;

        const kb = Math.max(1, Math.round(blob.size / 1024));
        el.playbackInfo.textContent = `${q ? q.id : 'PTE'} 녹음 완료 (${kb} KB)`;
        el.playbackBadge.textContent = '재생 가능';
        el.playbackBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700';
        el.playbackEmpty.classList.add('hidden');
        el.playbackReady.classList.remove('hidden');
      } finally {
        state.mediaRecorder = null;
        releaseMicrophoneStream();
      }
    };

    recorder.start(250);
    state.mediaRecorder = recorder;
    if (state.analyser && isMicLevelBarVisible() && state.meterRafId === null) {
      startLevelMeter();
    }
  } catch (err) {
    console.warn('MediaRecorder start failed:', err);
    releaseMicrophoneStream();
  }
}

export function stopMediaRecording() {
  stopLevelMeter();
  const rec = state.mediaRecorder;
  if (rec && rec.state !== 'inactive') {
    try {
      rec.stop();
    } catch (e) {
      releaseMicrophoneStream();
    }
    setTimeout(() => {
      if (state.phase !== 'recording') {
        releaseMicrophoneStream();
      }
    }, 250);
  } else {
    releaseMicrophoneStream();
  }
}

export function clearPlayback() {
  stopShadowingCompare(true);
  if (state.recordingUrl) {
    URL.revokeObjectURL(state.recordingUrl);
    state.recordingUrl = null;
  }
  state.recordedBlob = null;
  state.lastSpeakingLogId = null;
  el.audioPlayback.removeAttribute('src');
  el.audioPlayback.load();
  el.playbackEmpty.classList.remove('hidden');
  el.playbackReady.classList.add('hidden');
  el.playbackBadge.textContent = '녹음 대기';
  el.playbackBadge.className = 'text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500';
  if (el.speakingAiResult) {
    el.speakingAiResult.classList.add('hidden');
    el.speakingAiResult.innerHTML = '';
  }
}

export function initAudioLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLevelMeter();
    } else if (state.phase === 'recording' && state.analyser && state.micStream && state.micStream.active && isMicLevelBarVisible()) {
      startLevelMeter();
    }
  });
}
