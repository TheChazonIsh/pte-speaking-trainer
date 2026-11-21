import {
  STORAGE_KEYS,
  DEFAULT_LIVE_ACADEMY_SETS,
  DEFAULT_YT_SHADOWING_SETS,
  DEFAULT_YT_CLIP_SETS,
} from '../config/constants.js';
import {
  safeGetStorage,
  loadJsonStorage,
  loadObjectArrayStorage,
  loadRawStorage,
} from '../utils/storage.js';

export const state = {
  mode: 'read-aloud', // 'read-aloud' | 'describe-image' | 'repeat-sentence' | 'retell-lecture' | 'impromptu' | 'writing' | 'review'
  questionIndex: {
    'read-aloud': 0,
    'describe-image': 0,
    'repeat-sentence': 0,
    'retell-lecture': 0,
    impromptu: 0
  },
  phase: 'idle', // 'idle' | 'playing-audio' | 'prep' | 'recording' | 'done'
  remainingSeconds: 35,
  totalPhaseSeconds: 35,
  timerId: null,
  templateVisible: false,

  // Solved & Filter state
  solvedMap: loadJsonStorage(STORAGE_KEYS.solved, {}),
  unsolvedFirst: loadJsonStorage(STORAGE_KEYS.unsolvedFirst, true),

  // Neural TTS state (shared between RS & RL)
  ttsAccent: safeGetStorage(STORAGE_KEYS.ttsAccent, 'en-AU', false) || 'en-AU',
  ttsVoiceUri: safeGetStorage(STORAGE_KEYS.ttsVoiceUri, '', false) || '',
  ttsRate: (() => {
    const parsed = parseFloat(safeGetStorage(STORAGE_KEYS.ttsRate, '1.0', false));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0;
  })(),
  allVoices: [],
  speechSessionId: 0,
  ttsSafetyTimerId: null,
  ttsFetchAbortController: null,

  // RS / RL / Impromptu Reveal & Shadowing Compare State
  rsScriptVisible: false,
  rlScriptVisible: false,
  rlModelVisible: false,
  impModelVisible: false,
  shadowingSessionId: 0,
  shadowingDelayTimerId: null,
  shadowingRunning: false,

  // Writing state
  writingSubmode: 'swt',
  writingIndex: { swt: 0, essay: 0 },
  writingTimerRemaining: 600,
  writingTimerRunning: false,
  writingTimerId: null,
  writingModelVisible: false,

  // Audio / Beep
  audioCtx: null,

  // Microphone / MediaRecorder
  micStream: null,
  micStatus: 'unknown',
  mediaRecorder: null,
  recordedChunks: [],
  recordedBlob: null,
  recordingUrl: null,
  recordingMime: 'audio/webm',
  micSourceNode: null,
  analyser: null,
  meterRafId: null,

  // Gemini AI, Bookmarks, Vocabulary, Logs, Custom RS & YouTube RL
  geminiApiKey: loadRawStorage(STORAGE_KEYS.geminiApiKey, ''),
  geminiModel: loadRawStorage(STORAGE_KEYS.geminiModel, 'gemini-4-hydrogen') || 'gemini-4-hydrogen',
  useGeminiTts: loadRawStorage(STORAGE_KEYS.useGeminiTts, 'true') !== 'false',
  ttsAudioCache: new Map(),
  bookmarks: loadObjectArrayStorage(STORAGE_KEYS.bookmarks),
  vocabList: loadObjectArrayStorage(STORAGE_KEYS.vocabList, v => typeof v.word === 'string'),
  practiceLogs: loadObjectArrayStorage(STORAGE_KEYS.practiceLogs),
  customRsQuestions: loadObjectArrayStorage(STORAGE_KEYS.customRsQuestions, q => typeof q.sentence === 'string'),
  customDiQuestions: loadObjectArrayStorage(STORAGE_KEYS.customDiQuestions, q => typeof q.id === 'string'),
  bookmarkFilter: 'all',
  vocabSearch: '',
  vocabFilter: 'all',
  lastSpeakingLogId: null,
  lastWritingLogId: null,
  speakingGradingBusy: false,
  speakingGradeSeq: 0,
  speakingGradeAbort: null,
  writingGradingBusy: false,
  writingGradeSeq: 0,
  writingGradeAbort: null,
  ytsGradeSeq: 0,
  ytsGradeAbort: null,
  bpEvalSeqMap: {},
  bpMyoSeqMap: {},
  rsAiGenerating: false,
  diAiGenerating: false,
  ttsKeepAliveTimerId: null,

  // Retell Lecture YouTube Clip Mode
  rlSourceMode: 'academic', // 'academic' | 'youtube'
  ytClipSets: (() => {
    const loaded = loadJsonStorage(STORAGE_KEYS.ytClipSets, null);
    const valid = Array.isArray(loaded) ? loaded.filter(s => s && typeof s === 'object' && s.id) : [];
    return valid.length > 0 ? valid : DEFAULT_YT_CLIP_SETS;
  })(),
  activeYtSetId: '',
  activeYtClipIndex: 0,
  ytBlindMode: false,
  ytPlayer: null,
  ytWatchTimerId: null,
  ytExtracting: false,

  // Real-life NZ AI Roleplay State
  rpPresetId: 'ece-interview',
  rpCustomContext: '',
  rpActive: false,
  rpBusy: false,
  rpIsRecording: false,
  rpMediaRecorder: null,
  rpAudioChunks: [],
  rpRecordStartMs: 0,
  rpRecordTimerId: null,
  rpRecordCancelFlag: false,
  rpBlobUrls: [],
  rpMessages: [],

  // Weakness Pronunciation & Konglish Tracker
  weaknessLogs: loadObjectArrayStorage(STORAGE_KEYS.weaknessLogs),
  weaknessDrills: loadObjectArrayStorage(STORAGE_KEYS.weaknessDrills),
  weaknessGenerating: false,
  drillRecordingIdx: null,
  drillMediaRecorder: null,
  drillAudioChunks: [],
  drillBlobMap: {},

  // YouTube Sentence Shadowing Studio
  ytShadowingSets: (() => {
    const loaded = loadJsonStorage(STORAGE_KEYS.ytShadowingSets, null);
    const valid = Array.isArray(loaded) ? loaded.filter(s => s && typeof s === 'object' && s.id && Array.isArray(s.sentences)) : [];
    if (valid.length === 0) return DEFAULT_YT_SHADOWING_SETS;
    const defSet = DEFAULT_YT_SHADOWING_SETS[0];
    return valid.map(set => {
      if (!set || set.id !== defSet.id || !Array.isArray(set.sentences)) return set;
      const merged = set.sentences.map((s, i) => {
        const defItem = defSet.sentences[i];
        return (s && !s.situationTag && defItem?.situationTag)
          ? { ...s, situationTag: defItem.situationTag }
          : s;
      });
      for (let i = merged.length; i < defSet.sentences.length; i += 1) {
        merged.push(defSet.sentences[i]);
      }
      return { ...set, sentences: merged };
    });
  })(),
  ytsActiveSetId: '',
  ytsSentenceIndex: 0,
  ytsRate: 1.0,
  ytsLoop: false,
  ytsPlayer: null,
  ytsLoadedVideoId: '',
  ytsWatchTimerId: null,
  ytsExtracting: false,
  ytsIsRecording: false,
  ytsMediaRecorder: null,
  ytsAudioChunks: [],
  ytsRecordStartMs: 0,
  ytsRecordTimerId: null,
  ytsRecordCancelFlag: false,
  ytsRecordedBlob: null,
  ytsRecordedMime: 'audio/webm',
  ytsRecordedUrl: '',
  ytsAiGrading: false,
  ytsCompareActive: false,

  // Study-Focused UI Controls
  speakingToolsOpen: false,
  writingToolsOpen: false,
  lastModeByCategory: {
    pte: 'read-aloud',
    practical: 'impromptu',
    library: 'review'
  },

  // Roleplay Mission Integration (from Brain Pattern Training)
  rpMissionTargets: [],

  // Live Academy Brain Pattern Training
  liveAcademySets: (() => {
    const loaded = loadJsonStorage(STORAGE_KEYS.liveAcademySets, null);
    const valid = Array.isArray(loaded) ? loaded.filter(s => s && typeof s === 'object' && s.id) : [];
    return valid.length > 0 ? valid : DEFAULT_LIVE_ACADEMY_SETS;
  })(),
  bpActiveSetId: '',
  bpProgress: (() => {
    const loaded = loadJsonStorage(STORAGE_KEYS.liveAcademyProgress, null);
    return (loaded && typeof loaded === 'object' && !Array.isArray(loaded))
      ? {
          checks: loaded.checks && typeof loaded.checks === 'object' ? loaded.checks : {},
          myoDrafts: loaded.myoDrafts && typeof loaded.myoDrafts === 'object' ? loaded.myoDrafts : {},
          selectedMissions: loaded.selectedMissions && typeof loaded.selectedMissions === 'object' ? loaded.selectedMissions : {}
        }
      : { checks: {}, myoDrafts: {}, selectedMissions: {} };
  })(),
  bpBlindMode: false,
  bpNuanceOpen: true,
  bpActiveStep: 1,
  bpRevealedItems: {},
  bpItemFeedbackMap: {},
  bpItemRecordingIdx: null,
  bpMyoVoiceIdx: null,
  bpMediaRecorder: null,
  bpAudioChunks: [],
  bpGenerating: false
};
if (state.liveAcademySets.length > 0 && !state.bpActiveSetId) {
  state.bpActiveSetId = state.liveAcademySets[0].id;
}
if (state.ytShadowingSets.length > 0 && !state.ytsActiveSetId) {
  state.ytsActiveSetId = state.ytShadowingSets[0].id;
}
if (state.ytClipSets.length > 0 && !state.activeYtSetId) {
  state.activeYtSetId = state.ytClipSets[0].id;
}

// ==========================================
// 2. DOM References
// ==========================================
export const el = {
  navGroupPte: document.getElementById('nav-group-pte'),
  navGroupPractical: document.getElementById('nav-group-practical'),
  navGroupLibrary: document.getElementById('nav-group-library'),
  navLibraryCount: document.getElementById('nav-library-count'),

  studyStepperBar: document.getElementById('study-stepper-bar'),
  stepIndicator1: document.getElementById('step-indicator-1'),
  stepIndicator2: document.getElementById('step-indicator-2'),
  stepIndicator3: document.getElementById('step-indicator-3'),
  stepNextActionHint: document.getElementById('step-next-action-hint'),

  btnToggleSpeakingTools: document.getElementById('btn-toggle-speaking-tools'),
  speakingToolsDrawer: document.getElementById('speaking-tools-drawer'),
  rsVoiceSettingsDrawer: document.getElementById('rs-voice-settings-drawer'),
  rlVoiceSettingsDrawer: document.getElementById('rl-voice-settings-drawer'),
  btnToggleWritingTools: document.getElementById('btn-toggle-writing-tools'),
  writingToolsDrawer: document.getElementById('writing-tools-drawer'),

  tabReadAloud: document.getElementById('tab-read-aloud'),
  tabDescribeImage: document.getElementById('tab-describe-image'),
  tabRepeatSentence: document.getElementById('tab-repeat-sentence'),
  tabRetellLecture: document.getElementById('tab-retell-lecture'),
  tabImpromptu: document.getElementById('tab-impromptu'),
  tabRoleplay: document.getElementById('tab-roleplay'),
  tabYtShadowing: document.getElementById('tab-yt-shadowing'),
  tabBrainPattern: document.getElementById('tab-brain-pattern'),
  tabWriting: document.getElementById('tab-writing'),
  tabReview: document.getElementById('tab-review'),
  tabReviewCount: document.getElementById('tab-review-count'),

  btnAiSettings: document.getElementById('btn-ai-settings'),
  headerAiDot: document.getElementById('header-ai-dot'),
  headerAiLabel: document.getElementById('header-ai-label'),

  speakingSelectorBar: document.getElementById('speaking-selector-bar'),
  speakingWorkspace: document.getElementById('speaking-workspace'),
  writingWorkspace: document.getElementById('writing-workspace'),
  roleplayWorkspace: document.getElementById('roleplay-workspace'),
  ytShadowingWorkspace: document.getElementById('yt-shadowing-workspace'),
  brainPatternWorkspace: document.getElementById('brain-pattern-workspace'),
  reviewWorkspace: document.getElementById('review-workspace'),

  btnBookmarkSpeaking: document.getElementById('btn-bookmark-speaking'),
  btnQuickVocabSpeaking: document.getElementById('btn-quick-vocab-speaking'),
  btnBookmarkWriting: document.getElementById('btn-bookmark-writing'),
  btnQuickVocabWriting: document.getElementById('btn-quick-vocab-writing'),

  // iOS Audio Guide
  iosAudioGuideBox: document.getElementById('ios-audio-guide-box'),
  btnCloseIosGuide: document.getElementById('btn-close-ios-guide'),

  // Repeat Sentence Bank / AI Gen
  rsBankSummaryBadge: document.getElementById('rs-bank-summary-badge'),
  btnRsAiGenerate: document.getElementById('btn-rs-ai-generate'),
  rsAiGenStatus: document.getElementById('rs-ai-gen-status'),

  // Retell Lecture Source Switcher & YouTube Mode
  btnRlModeAcademic: document.getElementById('btn-rl-mode-academic'),
  btnRlModeYoutube: document.getElementById('btn-rl-mode-youtube'),
  rlAcademicModeBox: document.getElementById('rl-academic-mode-box'),
  rlYoutubeModeBox: document.getElementById('rl-youtube-mode-box'),
  rlYtUrlInput: document.getElementById('rl-yt-url-input'),
  rlYtTopicInput: document.getElementById('rl-yt-topic-input'),
  rlYtTranscriptInput: document.getElementById('rl-yt-transcript-input'),
  btnRlYtExtract: document.getElementById('btn-rl-yt-extract'),
  rlYtExtractStatus: document.getElementById('rl-yt-extract-status'),
  rlYtSetsSelect: document.getElementById('rl-yt-sets-select'),
  btnRlYtDeleteSet: document.getElementById('btn-rl-yt-delete-set'),
  rlYtOverallSummary: document.getElementById('rl-yt-overall-summary'),
  rlYtClipsList: document.getElementById('rl-yt-clips-list'),
  rlYtActiveClipLabel: document.getElementById('rl-yt-active-clip-label'),
  rlYtAudioStatus: document.getElementById('rl-yt-audio-status'),
  btnRlYtPreviewClip: document.getElementById('btn-rl-yt-preview-clip'),
  btnRlYtBlindToggle: document.getElementById('btn-rl-yt-blind-toggle'),
  btnRlYtSkipAudio: document.getElementById('btn-rl-yt-skip-audio'),
  rlYtPlayerHost: document.getElementById('rl-yt-player'),
  rlYtBlindOverlay: document.getElementById('rl-yt-blind-overlay'),

  solvedProgressBadge: document.getElementById('solved-progress-badge'),
  questionSelect: document.getElementById('question-select'),
  btnToggleSolved: document.getElementById('btn-toggle-solved'),
  chkUnsolvedFirst: document.getElementById('chk-unsolved-first'),
  btnRandomQ: document.getElementById('btn-random-q'),
  questionPills: document.getElementById('question-pills'),
  btnPrevQ: document.getElementById('btn-prev-q'),
  btnNextQ: document.getElementById('btn-next-q'),

  qBadge: document.getElementById('q-badge'),
  qTitle: document.getElementById('q-title'),
  qMeta: document.getElementById('q-meta'),
  instructionBox: document.getElementById('instruction-box'),

  panelReadAloud: document.getElementById('panel-read-aloud'),
  raPassage: document.getElementById('ra-passage'),
  raWordCount: document.getElementById('ra-word-count'),
  btnRaListenModel: document.getElementById('btn-ra-listen-model'),
  raWaveBars: document.getElementById('ra-wave-bars'),
  raAudioStatus: document.getElementById('ra-audio-status'),

  panelDescribeImage: document.getElementById('panel-describe-image'),
  diBankSummaryBadge: document.getElementById('di-bank-summary-badge'),
  btnDiAiGenerate: document.getElementById('btn-di-ai-generate'),
  diAiGenStatus: document.getElementById('di-ai-gen-status'),
  diChartContainer: document.getElementById('di-chart-container'),
  btnToggleTemplate: document.getElementById('btn-toggle-template'),
  templateBtnText: document.getElementById('template-btn-text'),
  templateChevron: document.getElementById('template-chevron'),
  diTemplateBox: document.getElementById('di-template-box'),
  diModelAnswer: document.getElementById('di-model-answer'),
  diKeyPoints: document.getElementById('di-key-points'),

  // Repeat Sentence DOM
  panelRepeatSentence: document.getElementById('panel-repeat-sentence'),
  chkRsGeminiTts: document.getElementById('chk-rs-gemini-tts'),
  rsGeminiTtsBadge: document.getElementById('rs-gemini-tts-badge'),
  rsTtsCacheBadge: document.getElementById('rs-tts-cache-badge'),
  rsVoiceQualityBadge: document.getElementById('rs-voice-quality-badge'),
  rsAccentSelect: document.getElementById('rs-accent-select'),
  rsVoiceSelect: document.getElementById('rs-voice-select'),
  rsRateSelect: document.getElementById('rs-rate-select'),
  btnRsListenOnly: document.getElementById('btn-rs-listen-only'),
  rsWaveBars: document.getElementById('rs-wave-bars'),
  rsAudioStatus: document.getElementById('rs-audio-status'),
  rsTtsFallbackNote: document.getElementById('rs-tts-fallback-note'),
  rsScriptMasked: document.getElementById('rs-script-masked'),
  btnRsToggleScript: document.getElementById('btn-rs-toggle-script'),
  rsScriptBtnText: document.getElementById('rs-script-btn-text'),
  rsScriptHint: document.getElementById('rs-script-hint'),
  rsScriptContent: document.getElementById('rs-script-content'),
  rsWordCount: document.getElementById('rs-word-count'),
  rsSentenceText: document.getElementById('rs-sentence-text'),
  rsChunkingText: document.getElementById('rs-chunking-text'),
  rsTranslationText: document.getElementById('rs-translation-text'),

  // Retell Lecture DOM
  panelRetellLecture: document.getElementById('panel-retell-lecture'),
  chkRlGeminiTts: document.getElementById('chk-rl-gemini-tts'),
  rlGeminiTtsBadge: document.getElementById('rl-gemini-tts-badge'),
  rlTtsCacheBadge: document.getElementById('rl-tts-cache-badge'),
  geminiTtsAudio: document.getElementById('gemini-tts-audio'),
  rlVoiceQualityBadge: document.getElementById('rl-voice-quality-badge'),
  rlAccentSelect: document.getElementById('rl-accent-select'),
  rlVoiceSelect: document.getElementById('rl-voice-select'),
  rlRateSelect: document.getElementById('rl-rate-select'),
  btnRlListenOnly: document.getElementById('btn-rl-listen-only'),
  rlWaveBars: document.getElementById('rl-wave-bars'),
  rlAudioStatus: document.getElementById('rl-audio-status'),
  btnRlSkipAudio: document.getElementById('btn-rl-skip-audio'),
  rlSlideTitle: document.getElementById('rl-slide-title'),
  rlSlideBullets: document.getElementById('rl-slide-bullets'),
  rlScratchpad: document.getElementById('rl-scratchpad'),
  rlNotesStatus: document.getElementById('rl-notes-status'),
  btnRlClearNotes: document.getElementById('btn-rl-clear-notes'),
  btnRlToggleScript: document.getElementById('btn-rl-toggle-script'),
  btnRlToggleModel: document.getElementById('btn-rl-toggle-model'),
  rlRevealHint: document.getElementById('rl-reveal-hint'),
  rlScriptBox: document.getElementById('rl-script-box'),
  rlWordCount: document.getElementById('rl-word-count'),
  rlScriptText: document.getElementById('rl-script-text'),
  rlKeywordsList: document.getElementById('rl-keywords-list'),
  rlTranslationText: document.getElementById('rl-translation-text'),
  rlModelBox: document.getElementById('rl-model-box'),
  rlModelAnswer: document.getElementById('rl-model-answer'),

  // 1-Minute Impromptu Talk DOM
  panelImpromptu: document.getElementById('panel-impromptu'),
  impCategoryBadge: document.getElementById('imp-category-badge'),
  impQuestionKo: document.getElementById('imp-question-ko'),
  impQuestionEn: document.getElementById('imp-question-en'),
  impGuidePoints: document.getElementById('imp-guide-points'),
  impSampleExpressions: document.getElementById('imp-sample-expressions'),
  btnImpToggleModel: document.getElementById('btn-imp-toggle-model'),
  btnImpListenModel: document.getElementById('btn-imp-listen-model'),
  impWaveBars: document.getElementById('imp-wave-bars'),
  impAudioStatus: document.getElementById('imp-audio-status'),
  impModelBox: document.getElementById('imp-model-box'),
  impModelAnswer: document.getElementById('imp-model-answer'),

  // Speaking Timer DOM
  phaseBadge: document.getElementById('phase-badge'),
  timerCard: document.getElementById('timer-card'),
  recordingIndicator: document.getElementById('recording-indicator'),
  timerStatusText: document.getElementById('timer-status-text'),
  timerSeconds: document.getElementById('timer-seconds'),
  timerProgressBar: document.getElementById('timer-progress-bar'),
  phaseSequenceLabel: document.getElementById('phase-sequence-label'),
  timerFraction: document.getElementById('timer-fraction'),

  btnStart: document.getElementById('btn-start'),
  btnStartText: document.getElementById('btn-start-text'),
  btnSkipPrep: document.getElementById('btn-skip-prep'),
  btnReset: document.getElementById('btn-reset'),
  btnTestBeep: document.getElementById('btn-test-beep'),

  btnMicConnect: document.getElementById('btn-mic-connect'),
  headerMicDot: document.getElementById('header-mic-dot'),
  headerMicLabel: document.getElementById('header-mic-label'),
  micStatusDetail: document.getElementById('mic-status-detail'),
  micLevelBar: document.getElementById('mic-level-bar'),
  micWarningBox: document.getElementById('mic-warning-box'),

  playbackBadge: document.getElementById('playback-badge'),
  playbackEmpty: document.getElementById('playback-empty'),
  playbackReady: document.getElementById('playback-ready'),
  audioPlayback: document.getElementById('audio-playback'),
  playbackInfo: document.getElementById('playback-info'),
  btnDownloadAudio: document.getElementById('btn-download-audio'),
  btnShadowingCompare: document.getElementById('btn-shadowing-compare'),
  shadowingCompareStatus: document.getElementById('shadowing-compare-status'),
  btnAiGradeSpeaking: document.getElementById('btn-ai-grade-speaking'),
  btnAiGradeSpeakingLabel: document.getElementById('btn-ai-grade-speaking-label'),
  speakingAiResult: document.getElementById('speaking-ai-result'),

  // Writing DOM
  subtabSwt: document.getElementById('subtab-swt'),
  subtabEssay: document.getElementById('subtab-essay'),
  writingSolvedBadge: document.getElementById('writing-solved-badge'),
  btnWritingToggleSolved: document.getElementById('btn-writing-toggle-solved'),
  chkWritingUnsolvedFirst: document.getElementById('chk-writing-unsolved-first'),
  btnWritingRandomQ: document.getElementById('btn-writing-random-q'),
  writingQuestionPills: document.getElementById('writing-question-pills'),
  btnWritingPrevQ: document.getElementById('btn-writing-prev-q'),
  btnWritingNextQ: document.getElementById('btn-writing-next-q'),
  wQBadge: document.getElementById('w-q-badge'),
  wQTitle: document.getElementById('w-q-title'),
  wQMeta: document.getElementById('w-q-meta'),
  wInstructionBox: document.getElementById('w-instruction-box'),
  wPromptText: document.getElementById('w-prompt-text'),
  btnToggleWritingModel: document.getElementById('btn-toggle-writing-model'),
  writingModelChevron: document.getElementById('writing-model-chevron'),
  writingModelBtnText: document.getElementById('writing-model-btn-text'),
  writingModelBox: document.getElementById('writing-model-box'),
  wModelWordCount: document.getElementById('w-model-word-count'),
  wModelAnswer: document.getElementById('w-model-answer'),
  wModelTip: document.getElementById('w-model-tip'),
  writingTimerDisplay: document.getElementById('writing-timer-display'),
  writingTimerStatus: document.getElementById('writing-timer-status'),
  writingTimerSub: document.getElementById('writing-timer-sub'),
  btnWritingTimerToggle: document.getElementById('btn-writing-timer-toggle'),
  btnWritingTimerReset: document.getElementById('btn-writing-timer-reset'),
  writingTextarea: document.getElementById('writing-textarea'),
  writingSaveStatus: document.getElementById('writing-save-status'),
  writingWordCount: document.getElementById('writing-word-count'),
  writingRangeBadge: document.getElementById('writing-range-badge'),
  btnCopyWriting: document.getElementById('btn-copy-writing'),
  btnClearWriting: document.getElementById('btn-clear-writing'),
  btnAiGradeWriting: document.getElementById('btn-ai-grade-writing'),
  writingAiResult: document.getElementById('writing-ai-result'),
  swtSentenceCheck: document.getElementById('swt-sentence-check'),

  // Review, Vocabulary & Analytics Elements
  btnClearLogs: document.getElementById('btn-clear-logs'),
  weaknessReportCard: document.getElementById('weakness-report-card'),
  weaknessTotalBadge: document.getElementById('weakness-total-badge'),
  btnSeedSampleWeakness: document.getElementById('btn-seed-sample-weakness'),
  btnClearWeakness: document.getElementById('btn-clear-weakness'),
  weaknessAddForm: document.getElementById('weakness-add-form'),
  weaknessTypeSelect: document.getElementById('weakness-type-select'),
  weaknessTargetInput: document.getElementById('weakness-target-input'),
  weaknessFixInput: document.getElementById('weakness-fix-input'),
  weaknessTop5List: document.getElementById('weakness-top5-list'),
  weaknessWaveBars: document.getElementById('weakness-wave-bars'),
  weaknessTtsStatus: document.getElementById('weakness-tts-status'),
  btnGenerateWeaknessSentences: document.getElementById('btn-generate-weakness-sentences'),
  weaknessGenStatus: document.getElementById('weakness-gen-status'),
  weaknessDrillList: document.getElementById('weakness-drill-list'),

  // Roleplay Elements
  rpPresetGrid: document.getElementById('rp-preset-grid'),
  rpCustomBox: document.getElementById('rp-custom-box'),
  rpCustomInput: document.getElementById('rp-custom-input'),
  rpActivePartner: document.getElementById('rp-active-partner'),
  rpStatusBadge: document.getElementById('rp-status-badge'),
  rpActiveTitle: document.getElementById('rp-active-title'),
  rpWaveBars: document.getElementById('rp-wave-bars'),
  rpAudioStatus: document.getElementById('rp-audio-status'),
  btnRpStart: document.getElementById('btn-rp-start'),
  btnRpEnd: document.getElementById('btn-rp-end'),
  btnRpReset: document.getElementById('btn-rp-reset'),
  rpChatLog: document.getElementById('rp-chat-log'),
  btnRpRecord: document.getElementById('btn-rp-record'),
  rpRecordDot: document.getElementById('rp-record-dot'),
  rpRecordBtnLabel: document.getElementById('rp-record-btn-label'),
  btnRpCancelRecord: document.getElementById('btn-rp-cancel-record'),
  rpRecordTimer: document.getElementById('rp-record-timer'),
  rpRecordStatus: document.getElementById('rp-record-status'),
  rpTextInput: document.getElementById('rp-text-input'),
  btnRpSendText: document.getElementById('btn-rp-send-text'),
  rpSummaryBox: document.getElementById('rp-summary-box'),
  rpMissionBar: document.getElementById('rp-mission-bar'),
  rpMissionChips: document.getElementById('rp-mission-chips'),
  btnRpClearMission: document.getElementById('btn-rp-clear-mission'),

  // Brain Pattern Training Elements
  btnBpStep1: document.getElementById('btn-bp-step-1'),
  btnBpStep2: document.getElementById('btn-bp-step-2'),
  btnBpStep3: document.getElementById('btn-bp-step-3'),
  bpStage1: document.getElementById('bp-stage-1'),
  bpStage2: document.getElementById('bp-stage-2'),
  bpStage3: document.getElementById('bp-stage-3'),
  bpWaveBars: document.getElementById('bp-wave-bars'),
  bpTtsStatus: document.getElementById('bp-tts-status'),
  btnBpOpenGenerator: document.getElementById('btn-bp-open-generator'),
  bpSetSelect: document.getElementById('bp-set-select'),
  bpYtLink: document.getElementById('bp-yt-link'),
  btnBpDeleteSet: document.getElementById('btn-bp-delete-set'),
  bpGeneratorBox: document.getElementById('bp-generator-box'),
  bpGenUrlInput: document.getElementById('bp-gen-url-input'),
  bpGenNotesInput: document.getElementById('bp-gen-notes-input'),
  bpGenStatus: document.getElementById('bp-gen-status'),
  btnBpGenerateSet: document.getElementById('btn-bp-generate-set'),
  btnBpToggleNuance: document.getElementById('btn-bp-toggle-nuance'),
  bpNuanceList: document.getElementById('bp-nuance-list'),
  bpProgressBadge: document.getElementById('bp-progress-badge'),
  btnBpBlindToggle: document.getElementById('btn-bp-blind-toggle'),
  bpItemList: document.getElementById('bp-item-list'),
  bpMyoList: document.getElementById('bp-myo-list'),
  bpMissionCountBadge: document.getElementById('bp-mission-count-badge'),
  bpMissionList: document.getElementById('bp-mission-list'),
  bpMissionStatus: document.getElementById('bp-mission-status'),
  btnBpStartMission: document.getElementById('btn-bp-start-mission'),

  // YouTube Shadowing Studio Elements
  btnYtsToggleExtractor: document.getElementById('btn-yts-toggle-extractor'),
  ytsSetSelect: document.getElementById('yts-set-select'),
  btnYtsDeleteSet: document.getElementById('btn-yts-delete-set'),
  ytsExtractorBox: document.getElementById('yts-extractor-box'),
  ytsUrlInput: document.getElementById('yts-url-input'),
  ytsTranscriptInput: document.getElementById('yts-transcript-input'),
  ytsExtractStatus: document.getElementById('yts-extract-status'),
  btnYtsExtract: document.getElementById('btn-yts-extract'),
  ytsSentenceCountBadge: document.getElementById('yts-sentence-count-badge'),
  ytsSentenceList: document.getElementById('yts-sentence-list'),
  ytsWaveBars: document.getElementById('yts-wave-bars'),
  ytsPlayerStatus: document.getElementById('yts-player-status'),
  ytsTimeSaveBadge: document.getElementById('yts-time-save-badge'),
  btnYtsPlay: document.getElementById('btn-yts-play'),
  btnYtsTtsPlay: document.getElementById('btn-yts-tts-play'),
  btnYtsPause: document.getElementById('btn-yts-pause'),
  btnYtsLoop: document.getElementById('btn-yts-loop'),
  btnYtsRate08: document.getElementById('btn-yts-rate-08'),
  btnYtsRate10: document.getElementById('btn-yts-rate-10'),
  ytsStartTimeLabel: document.getElementById('yts-start-time-label'),
  btnYtsStartMinus: document.getElementById('btn-yts-start-minus'),
  btnYtsStartPlus: document.getElementById('btn-yts-start-plus'),
  ytsEndTimeLabel: document.getElementById('yts-end-time-label'),
  btnYtsEndMinus: document.getElementById('btn-yts-end-minus'),
  btnYtsEndPlus: document.getElementById('btn-yts-end-plus'),
  ytsActiveBadge: document.getElementById('yts-active-badge'),
  ytsActiveSituationBadge: document.getElementById('yts-active-situation-badge'),
  btnYtsPrev: document.getElementById('btn-yts-prev'),
  btnYtsNext: document.getElementById('btn-yts-next'),
  btnYtsVocab: document.getElementById('btn-yts-vocab'),
  ytsActiveEn: document.getElementById('yts-active-en'),
  ytsActiveKo: document.getElementById('yts-active-ko'),
  ytsActiveTip: document.getElementById('yts-active-tip'),
  btnYtsRecord: document.getElementById('btn-yts-record'),
  ytsRecordDot: document.getElementById('yts-record-dot'),
  ytsRecordBtnLabel: document.getElementById('yts-record-btn-label'),
  btnYtsCancelRecord: document.getElementById('btn-yts-cancel-record'),
  ytsRecordTimer: document.getElementById('yts-record-timer'),
  ytsRecordStatus: document.getElementById('yts-record-status'),
  ytsPlaybackBox: document.getElementById('yts-playback-box'),
  ytsCompareStatus: document.getElementById('yts-compare-status'),
  ytsAudioPlayback: document.getElementById('yts-audio-playback'),
  btnYtsCompare: document.getElementById('btn-yts-compare'),
  btnYtsAiGrade: document.getElementById('btn-yts-ai-grade'),
  btnYtsPostVocab: document.getElementById('btn-yts-post-vocab'),
  ytsAiResult: document.getElementById('yts-ai-result'),

  statTodayCount: document.getElementById('stat-today-count'),
  statTotalCount: document.getElementById('stat-total-count'),
  statAvgAiScore: document.getElementById('stat-avg-ai-score'),
  statBookmarkVocabSummary: document.getElementById('stat-bookmark-vocab-summary'),
  sectionStatsGrid: document.getElementById('section-stats-grid'),
  practiceLogList: document.getElementById('practice-log-list'),
  bookmarkCountBadge: document.getElementById('bookmark-count-badge'),
  bookmarkFilterBar: document.getElementById('bookmark-filter-bar'),
  bookmarkList: document.getElementById('bookmark-list'),
  vocabProgressBadge: document.getElementById('vocab-progress-badge'),
  vocabForm: document.getElementById('vocab-form'),
  vocabWordInput: document.getElementById('vocab-word-input'),
  vocabMeaningInput: document.getElementById('vocab-meaning-input'),
  vocabExampleInput: document.getElementById('vocab-example-input'),
  vocabSearchInput: document.getElementById('vocab-search-input'),
  vocabFilterSelect: document.getElementById('vocab-filter-select'),
  vocabList: document.getElementById('vocab-list'),

  // Modals
  aiSettingsModal: document.getElementById('ai-settings-modal'),
  btnCloseAiModal: document.getElementById('btn-close-ai-modal'),
  btnCancelAiModal: document.getElementById('btn-cancel-ai-modal'),
  inputGeminiApiKey: document.getElementById('input-gemini-api-key'),
  btnToggleKeyVisibility: document.getElementById('btn-toggle-key-visibility'),
  inputGeminiModel: document.getElementById('input-gemini-model'),
  previewModelName: document.getElementById('preview-model-name'),
  aiSettingsFeedback: document.getElementById('ai-settings-feedback'),
  btnClearApiKey: document.getElementById('btn-clear-api-key'),
  btnSaveApiKey: document.getElementById('btn-save-api-key'),

  quickVocabModal: document.getElementById('quick-vocab-modal'),
  btnCloseQuickVocab: document.getElementById('btn-close-quick-vocab'),
  btnCancelQuickVocab: document.getElementById('btn-cancel-quick-vocab'),
  quickVocabForm: document.getElementById('quick-vocab-form'),
  qvWord: document.getElementById('qv-word'),
  qvMeaning: document.getElementById('qv-meaning'),
  qvExample: document.getElementById('qv-example'),

  // Cross-Device Data Sync Modal Elements
  btnDataSync: document.getElementById('btn-data-sync'),
  btnReviewDataSync: document.getElementById('btn-review-data-sync'),
  dataSyncModal: document.getElementById('data-sync-modal'),
  btnCloseSyncModal: document.getElementById('btn-close-sync-modal'),
  syncExportSummary: document.getElementById('sync-export-summary'),
  btnExportYtCopy: document.getElementById('btn-export-yt-copy'),
  btnExportAllDownload: document.getElementById('btn-export-all-download'),
  btnExportAllCopy: document.getElementById('btn-export-all-copy'),
  syncExportTextarea: document.getElementById('sync-export-textarea'),
  syncImportFile: document.getElementById('sync-import-file'),
  syncImportTextarea: document.getElementById('sync-import-textarea'),
  btnImportMerge: document.getElementById('btn-import-merge'),
  syncFeedbackBox: document.getElementById('sync-feedback-box')
};
