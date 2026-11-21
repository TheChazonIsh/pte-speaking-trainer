import { state, el } from './state/store.js';
import {
  stopMediaRecording,
  releaseMicrophoneStream,
  initAudioLifecycle,
} from './services/audio.js';
import {
  updateAiHeaderUI,
  closeAiSettingsModal,
  cancelPendingSpeakingGrade,
  cancelPendingWritingGrade,
  cancelPendingYtsGrade,
  initGeminiSettings,
} from './services/gemini.js';
import {
  syncVoiceDropdowns,
  cancelSpeech,
  stopShadowingCompare,
  initTtsEngine,
} from './services/tts.js';
import {
  applyToolsDrawerUI,
  renderTabs,
  renderWorkspaceVisibility,
  renderQuestionSelector,
  renderQuestionContent,
  clearTimerInterval,
  resetPractice,
  renderStudyStepper,
  updateRsBankSummaryUI,
  updateDiBankSummaryUI,
  initSpeakingFeature,
} from './features/speaking.js';
import { stopWritingTimer, initWritingFeature } from './features/writing.js';
import {
  updateReviewTabBadge,
  closeQuickVocabModal,
  renderWeaknessReport,
  stopDrillRecording,
  initVocabFeature,
} from './features/vocab.js';
import {
  stopYouTubeClipPlayback,
  renderYtsWorkspace,
  stopYtsComparePlayback,
  stopYtsRecording,
  stopYtsPlayback,
  initYoutubeFeature,
} from './features/youtube.js';
import {
  renderRoleplayWorkspace,
  stopRoleplayRecording,
  initRoleplayFeature,
} from './features/roleplay.js';
import {
  renderBpWorkspace,
  stopBpRecording,
  initBrainPatternFeature,
} from './features/brainPattern.js';
import { initSyncFeature } from './features/sync.js';

// Initialize all feature listeners and lifecycle handlers
initAudioLifecycle();
initTtsEngine();
initGeminiSettings();
initSpeakingFeature();
initWritingFeature();
initVocabFeature();
initYoutubeFeature();
initRoleplayFeature();
initBrainPatternFeature();
initSyncFeature();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!el.aiSettingsModal.classList.contains('hidden')) closeAiSettingsModal();
    if (!el.quickVocabModal.classList.contains('hidden')) closeQuickVocabModal();
  }
});

// Clean up resources on page unload
window.addEventListener('beforeunload', () => {
  clearTimerInterval();
  stopWritingTimer();
  cancelPendingSpeakingGrade();
  cancelPendingWritingGrade();
  cancelPendingYtsGrade();
  stopShadowingCompare(false);
  stopRoleplayRecording(true);
  stopDrillRecording(true);
  stopBpRecording(true);
  stopYtsComparePlayback(false);
  stopYtsRecording(true);
  stopYtsPlayback();
  cancelSpeech();
  stopYouTubeClipPlayback();
  stopMediaRecording();
  releaseMicrophoneStream();
  if (state.recordingUrl) {
    URL.revokeObjectURL(state.recordingUrl);
  }
  if (state.ytsRecordedUrl) {
    try { URL.revokeObjectURL(state.ytsRecordedUrl); } catch (e) {}
  }
  if (state.bpItemFeedbackMap) {
    Object.values(state.bpItemFeedbackMap).forEach(v => {
      if (v && v.audioUrl) { try { URL.revokeObjectURL(v.audioUrl); } catch (e) {} }
    });
  }
  if (Array.isArray(state.rpBlobUrls)) {
    state.rpBlobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  }
  if (state.drillBlobMap) {
    Object.values(state.drillBlobMap).forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  }
  if (state.ttsAudioCache) {
    state.ttsAudioCache.forEach(entry => {
      if (entry && entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    });
    state.ttsAudioCache.clear();
  }
});

// Register Service Worker for PWA offline caching
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('ServiceWorker registration failed:', err);
    });
  });
}

// Initial render
applyToolsDrawerUI();
updateAiHeaderUI();
updateReviewTabBadge();
updateRsBankSummaryUI();
updateDiBankSummaryUI();
renderRoleplayWorkspace();
renderYtsWorkspace();
renderBpWorkspace();
renderWeaknessReport();
syncVoiceDropdowns();
renderTabs();
renderWorkspaceVisibility();
renderQuestionSelector();
renderQuestionContent();
resetPractice(true);
renderStudyStepper();
