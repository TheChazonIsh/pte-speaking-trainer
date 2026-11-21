import {
  STORAGE_KEYS,
  MODE_CONFIG,
  DEFAULT_YT_CLIP_SETS,
  DEFAULT_YT_SHADOWING_SETS,
  DEFAULT_LIVE_ACADEMY_SETS,
} from '../config/constants.js';
import { isSafeObjKey, stripDangerousKeys, sanitizeHttpUrl } from '../utils/security.js';
import { isQuotaExceededError, showStorageQuotaToast, saveStorage } from '../utils/storage.js';
import { state, el } from '../state/store.js';
import {
  renderQuestionSelector,
  renderQuestionContent,
  updateRsBankSummaryUI,
  updateDiBankSummaryUI,
  normalizeDiQuestion,
} from './speaking.js';
import {
  getTodayDateKey,
  updateReviewTabBadge,
  renderReviewDashboard,
} from './vocab.js';
import { renderYtClipSetsAndClips, renderYtsWorkspace } from './youtube.js';
import { renderBpWorkspace } from './brainPattern.js';

export function updateSyncSummaryBadge() {
  if (!el.syncExportSummary) return;
  const rlCount = (state.ytClipSets || []).length;
  const ytsCount = (state.ytShadowingSets || []).length;
  const vocabCount = (state.vocabList || []).length;
  const logCount = (state.practiceLogs || []).length;
  const aiQCount = (state.customRsQuestions || []).length + (state.customDiQuestions || []).length;
  el.syncExportSummary.textContent = `YT ${rlCount + ytsCount}세트 · 단어 ${vocabCount} · AI문제 ${aiQCount} · 기록 ${logCount}`;
}

export function showSyncFeedback(msg, isError = false) {
  if (!el.syncFeedbackBox) return;
  el.syncFeedbackBox.textContent = msg;
  el.syncFeedbackBox.className = isError
    ? 'text-xs font-semibold rounded-xl px-3.5 py-2.5 leading-relaxed bg-rose-50 text-rose-800 border border-rose-200'
    : 'text-xs font-semibold rounded-xl px-3.5 py-2.5 leading-relaxed bg-emerald-50 text-emerald-800 border border-emerald-200';
}

export function openDataSyncModal() {
  if (!el.dataSyncModal) return;
  updateSyncSummaryBadge();
  if (el.syncFeedbackBox) el.syncFeedbackBox.className = 'hidden';
  el.dataSyncModal.classList.remove('hidden');
}

export function closeDataSyncModal() {
  if (!el.dataSyncModal) return;
  el.dataSyncModal.classList.add('hidden');
}

export function collectLocalDraftsByPrefix(prefix) {
  const result = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      if (/api.?key/i.test(k)) continue;
      const v = localStorage.getItem(k);
      if (v) result[k] = v;
    }
  } catch (e) {
    // ignore storage errors
  }
  return result;
}

export function buildExportPayload(exportMode = 'all') {
  const ytOnly = {
    pte_rl_yt_clip_sets: Array.isArray(state.ytClipSets) ? state.ytClipSets : [],
    pte_yt_shadowing_sets: Array.isArray(state.ytShadowingSets) ? state.ytShadowingSets : []
  };

  const dataObj = exportMode === 'youtube'
    ? ytOnly
    : {
        ...ytOnly,
        pte_vocab_list: Array.isArray(state.vocabList) ? state.vocabList : [],
        pte_bookmarks: Array.isArray(state.bookmarks) ? state.bookmarks : [],
        pte_practice_logs: Array.isArray(state.practiceLogs) ? state.practiceLogs : [],
        pte_solved_ids: state.solvedMap && typeof state.solvedMap === 'object' ? state.solvedMap : {},
        pte_custom_rs_questions: Array.isArray(state.customRsQuestions) ? state.customRsQuestions : [],
        pte_custom_di_questions: Array.isArray(state.customDiQuestions) ? state.customDiQuestions : [],
        pte_weakness_logs: Array.isArray(state.weaknessLogs) ? state.weaknessLogs : [],
        pte_weakness_drills: Array.isArray(state.weaknessDrills) ? state.weaknessDrills : [],
        pte_live_academy_sets: Array.isArray(state.liveAcademySets) ? state.liveAcademySets : [],
        pte_live_academy_progress: state.bpProgress && typeof state.bpProgress === 'object' ? state.bpProgress : { checks: {}, myoDrafts: {}, selectedMissions: {} },
        writingDrafts: collectLocalDraftsByPrefix('pte_writing_'),
        rlNotes: collectLocalDraftsByPrefix('pte_rl_notes_')
      };

  // Hard security guarantee: strip API key if any object ever contained it
  delete dataObj.pte_gemini_api_key;
  delete dataObj.geminiApiKey;

  return {
    app: 'nz-pte-trainer',
    exportType: exportMode === 'youtube' ? 'youtube-clips' : 'full-learning-data',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: dataObj
  };
}

export async function copyExportJson(text) {
  if (el.syncExportTextarea) {
    el.syncExportTextarea.value = text;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // Fallback to manual selection copy
  }
  if (el.syncExportTextarea) {
    el.syncExportTextarea.focus();
    el.syncExportTextarea.select();
    try {
      return document.execCommand('copy');
    } catch (err) {
      return false;
    }
  }
  return false;
}

export function generateUniqueSyncId(prefix, existingSet) {
  let candidate = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  while (existingSet.has(candidate)) {
    candidate = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
  existingSet.add(candidate);
  return candidate;
}

export function mergeImportedData(rawText) {
  let parsed;
  try {
    parsed = JSON.parse((rawText || '').trim());
  } catch (e) {
    showSyncFeedback('❌ 올바른 JSON 형식이 아닙니다. 파일이나 복사한 텍스트 전체를 다시 확인해주세요.', true);
    return false;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    showSyncFeedback('❌ 가져올 수 있는 데이터 객체가 아닙니다.', true);
    return false;
  }

  parsed = stripDangerousKeys(parsed);
  const src = (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) ? parsed.data : parsed;
  const stats = {
    ytRlSets: 0,
    ytShadowSets: 0,
    vocab: 0,
    bookmarks: 0,
    logs: 0,
    customQ: 0,
    weaknesses: 0,
    solved: 0
  };

  // 1. Merge Retell Lecture YouTube Clip Sets (pte_rl_yt_clip_sets)
  const inRlSets = src.pte_rl_yt_clip_sets || src.ytClipSets;
  if (Array.isArray(inRlSets)) {
    if (!Array.isArray(state.ytClipSets)) state.ytClipSets = [];
    const setIds = new Set(state.ytClipSets.map(s => s.id));
    const toCleanClip = (c, idx) => {
      const startSec = Math.max(0, Math.round(Number(c?.startSec) || 0));
      const rawEnd = Math.round(Number(c?.endSec) || (startSec + 15));
      return {
        id: String(c?.id || `yt-clip-${idx + 1}`).trim().slice(0, 80),
        title: String(c?.title || `Clip ${idx + 1}`).trim().slice(0, 160),
        startSec,
        endSec: rawEnd > startSec ? rawEnd : startSec + 15,
        keywords: Array.isArray(c?.keywords) ? c.keywords.map(k => String(k).trim()).filter(Boolean).slice(0, 20) : [],
        script: String(c?.script || '').trim(),
        modelAnswer: String(c?.modelAnswer || '').trim(),
        translation: String(c?.translation || '').trim()
      };
    };
    inRlSets.forEach(inSet => {
      if (!inSet || typeof inSet !== 'object' || !Array.isArray(inSet.clips)) return;
      const cleanClips = inSet.clips.filter(c => c && typeof c === 'object').map(toCleanClip);
      const sameSet = state.ytClipSets.find(s => s.id === inSet.id);
      if (sameSet && sameSet.videoId === inSet.videoId) {
        const clipKeys = new Set((sameSet.clips || []).map(c => `${c.id}::${c.title}::${c.startSec}`));
        cleanClips.forEach(c => {
          const k = `${c.id}::${c.title}::${c.startSec}`;
          if (!clipKeys.has(k)) {
            sameSet.clips.push(c);
            clipKeys.add(k);
            stats.ytRlSets += 1;
          }
        });
      } else {
        const safeUrl = sanitizeHttpUrl(inSet.url);
        const setId = (!inSet.id || typeof inSet.id !== 'string' || setIds.has(inSet.id))
          ? generateUniqueSyncId('yt-imp', setIds)
          : (setIds.add(inSet.id), inSet.id);
        state.ytClipSets.push({
          id: setId,
          title: String(inSet.title || 'YouTube Clip Set').trim().slice(0, 160),
          videoId: String(inSet.videoId || '').trim().slice(0, 32),
          url: safeUrl === '#' ? '' : safeUrl,
          overallSummary: String(inSet.overallSummary || '').trim(),
          createdAt: Number.isFinite(Number(inSet.createdAt)) ? Number(inSet.createdAt) : Date.now(),
          clips: cleanClips
        });
        stats.ytRlSets += 1;
      }
    });
    saveStorage(STORAGE_KEYS.ytClipSets, state.ytClipSets);
  }

  // 2. Merge YouTube Shadowing Sets (pte_yt_shadowing_sets)
  const inYtsSets = src.pte_yt_shadowing_sets || src.ytShadowingSets;
  if (Array.isArray(inYtsSets)) {
    if (!Array.isArray(state.ytShadowingSets)) state.ytShadowingSets = [];
    const setIds = new Set(state.ytShadowingSets.map(s => s.id));
    const toCleanSentence = (s) => {
      const startSec = Math.max(0, Math.round(Number(s?.startSec) || 0));
      const rawEnd = Math.round(Number(s?.endSec) || (startSec + 5));
      return {
        startSec,
        endSec: Math.max(startSec + 1, rawEnd),
        situationTag: String(s?.situationTag || '실전회화').trim().slice(0, 60),
        enText: String(s?.enText || '').trim(),
        koMeaning: String(s?.koMeaning || '').trim(),
        stressAndLinkingTip: String(s?.stressAndLinkingTip || '').trim()
      };
    };
    inYtsSets.forEach(inSet => {
      if (!inSet || typeof inSet !== 'object' || !Array.isArray(inSet.sentences)) return;
      const cleanSentences = inSet.sentences.filter(s => s && typeof s === 'object' && String(s.enText || '').trim()).map(toCleanSentence);
      const sameSet = state.ytShadowingSets.find(s => s.id === inSet.id);
      if (sameSet && sameSet.videoId === inSet.videoId) {
        const sentKeys = new Set((sameSet.sentences || []).map(x => String(x.enText || '').trim().toLowerCase()));
        cleanSentences.forEach(s => {
          const k = s.enText.toLowerCase();
          if (k && !sentKeys.has(k)) {
            sameSet.sentences.push(s);
            sentKeys.add(k);
            stats.ytShadowSets += 1;
          }
        });
      } else {
        const safeUrl = sanitizeHttpUrl(inSet.url);
        const setId = (!inSet.id || typeof inSet.id !== 'string' || setIds.has(inSet.id))
          ? generateUniqueSyncId('yts-imp', setIds)
          : (setIds.add(inSet.id), inSet.id);
        state.ytShadowingSets.push({
          id: setId,
          title: String(inSet.title || 'YouTube 쉐도잉').trim().slice(0, 160),
          videoId: String(inSet.videoId || '').trim().slice(0, 32),
          url: safeUrl === '#' ? '' : safeUrl,
          createdAt: Number.isFinite(Number(inSet.createdAt)) ? Number(inSet.createdAt) : Date.now(),
          sentences: cleanSentences
        });
        stats.ytShadowSets += 1;
      }
    });
    saveStorage(STORAGE_KEYS.ytShadowingSets, state.ytShadowingSets);
  }

  // 3. Merge Vocabulary Bank (pte_vocab_list)
  const inVocab = src.pte_vocab_list || src.vocabList;
  if (Array.isArray(inVocab)) {
    if (!Array.isArray(state.vocabList)) state.vocabList = [];
    const existingIds = new Set(state.vocabList.map(v => v.id));
    const wordMap = new Map(state.vocabList.map(v => [String(v.word || '').trim().toLowerCase(), v]));
    inVocab.forEach(item => {
      if (!item || typeof item !== 'object' || !item.word) return;
      const normWord = String(item.word).trim().toLowerCase();
      if (!normWord) return;
      const cur = wordMap.get(normWord);
      if (cur) {
        if (!cur.example && item.example) cur.example = String(item.example).trim();
        return;
      }
      const newId = (!item.id || typeof item.id !== 'string' || existingIds.has(item.id))
        ? generateUniqueSyncId('voc', existingIds)
        : (existingIds.add(item.id), item.id);
      const entry = {
        id: newId,
        word: String(item.word).trim(),
        meaning: String(item.meaning || '').trim() || '불러온 단어',
        example: String(item.example || '').trim(),
        memorized: Boolean(item.memorized),
        createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now()
      };
      state.vocabList.push(entry);
      wordMap.set(normWord, entry);
      stats.vocab += 1;
    });
    saveStorage(STORAGE_KEYS.vocabList, state.vocabList);
  }

  // 4. Merge Bookmarks (pte_bookmarks)
  const inBookmarks = src.pte_bookmarks || src.bookmarks;
  if (Array.isArray(inBookmarks)) {
    if (!Array.isArray(state.bookmarks)) state.bookmarks = [];
    const bmIds = new Set(state.bookmarks.map(b => b.id));
    inBookmarks.forEach(bm => {
      if (!bm || typeof bm !== 'object' || typeof bm.id !== 'string' || !bm.id || bmIds.has(bm.id)) return;
      bmIds.add(bm.id);
      state.bookmarks.push({
        id: bm.id.trim().slice(0, 80),
        mode: String(bm.mode || 'read-aloud').trim().slice(0, 40),
        title: String(bm.title || bm.id).trim().slice(0, 160),
        topic: String(bm.topic || '').trim().slice(0, 120),
        addedAt: Number.isFinite(Number(bm.addedAt)) ? Number(bm.addedAt) : Date.now()
      });
      stats.bookmarks += 1;
    });
    saveStorage(STORAGE_KEYS.bookmarks, state.bookmarks);
  }

  // 5. Merge Practice Logs (pte_practice_logs)
  const inLogs = src.pte_practice_logs || src.practiceLogs;
  if (Array.isArray(inLogs)) {
    if (!Array.isArray(state.practiceLogs)) state.practiceLogs = [];
    const logKeys = new Set(state.practiceLogs.map(l => l.id || `${l.qId}::${l.timestamp}`));
    inLogs.forEach(lg => {
      if (!lg || typeof lg !== 'object' || !lg.qId) return;
      const cleanQId = String(lg.qId).trim().slice(0, 80);
      const ts = Number.isFinite(Number(lg.timestamp)) ? Number(lg.timestamp) : Date.now();
      const cleanId = (typeof lg.id === 'string' && lg.id.trim()) ? lg.id.trim().slice(0, 80) : `log-imp-${cleanQId}-${ts}`;
      const key = (typeof lg.id === 'string' && lg.id.trim()) ? cleanId : `${cleanQId}::${ts}`;
      if (!cleanQId || logKeys.has(key)) return;
      logKeys.add(key);
      const rawScore = Number(lg.aiScore);
      state.practiceLogs.push({
        id: cleanId,
        qId: cleanQId,
        mode: String(lg.mode || 'read-aloud').trim().slice(0, 40),
        title: String(lg.title || cleanQId).trim().slice(0, 160),
        date: String(lg.date || '').trim().slice(0, 20),
        timestamp: ts,
        aiScore: (lg.aiScore !== null && lg.aiScore !== undefined && Number.isFinite(rawScore)) ? Math.round(rawScore) : null
      });
      stats.logs += 1;
    });
    state.practiceLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (state.practiceLogs.length > 300) state.practiceLogs.length = 300;
    saveStorage(STORAGE_KEYS.practiceLogs, state.practiceLogs);
  }

  // 6. Merge Solved IDs (pte_solved_ids)
  const inSolved = src.pte_solved_ids || src.solvedMap;
  if (inSolved && typeof inSolved === 'object' && !Array.isArray(inSolved)) {
    if (!state.solvedMap || typeof state.solvedMap !== 'object') state.solvedMap = {};
    Object.keys(inSolved).forEach(qId => {
      if (!isSafeObjKey(qId)) return;
      if (inSolved[qId] === true && !state.solvedMap[qId]) {
        state.solvedMap[qId] = true;
        stats.solved += 1;
      }
    });
    saveStorage(STORAGE_KEYS.solved, state.solvedMap);
  }

  // 7. Merge AI Custom Repeat Sentence Questions (pte_custom_rs_questions)
  const inRs = src.pte_custom_rs_questions || src.customRsQuestions;
  if (Array.isArray(inRs)) {
    if (!Array.isArray(state.customRsQuestions)) state.customRsQuestions = [];
    const existingIds = new Set(state.customRsQuestions.map(q => q.id));
    const getRsText = (q) => String(q?.sentence ?? q?.text ?? '').trim();
    const textSet = new Set(
      state.customRsQuestions
        .map(q => getRsText(q).toLowerCase())
        .filter(Boolean)
    );
    inRs.forEach(q => {
      if (!q || typeof q !== 'object') return;
      const rawSentence = getRsText(q);
      const normText = rawSentence.toLowerCase();
      if (!normText || textSet.has(normText)) return;
      const id = (!q.id || typeof q.id !== 'string' || existingIds.has(q.id))
        ? generateUniqueSyncId('RS-IMP', existingIds)
        : (existingIds.add(q.id), q.id.trim().slice(0, 60));
      state.customRsQuestions.push({
        id,
        title: String(q.title || `AI Sentence ${id}`).trim().slice(0, 120),
        topic: String(q.topic || 'Academic · AI 생성').trim().slice(0, 80),
        sentence: rawSentence.slice(0, 600),
        chunking: String(q.chunking || rawSentence).trim().slice(0, 700),
        translation: String(q.translation || '').trim().slice(0, 600),
        isCustomAi: true
      });
      textSet.add(normText);
      stats.customQ += 1;
    });
    saveStorage(STORAGE_KEYS.customRsQuestions, state.customRsQuestions);
  }

  // 8. Merge AI Custom Describe Image Questions (pte_custom_di_questions)
  const inDi = src.pte_custom_di_questions || src.customDiQuestions;
  if (Array.isArray(inDi)) {
    if (!Array.isArray(state.customDiQuestions)) state.customDiQuestions = [];
    const existingIds = new Set(state.customDiQuestions.map(q => q.id));
    const sigSet = new Set(state.customDiQuestions.map(q => `${q.title || ''}::${q.chartType || ''}`.toLowerCase()));
    inDi.forEach(q => {
      if (!q || typeof q !== 'object' || !q.title || !q.chartType) return;
      const cleanCandidate = normalizeDiQuestion(q, '__tmp__');
      const sig = `${cleanCandidate.title}::${cleanCandidate.chartType}`.toLowerCase();
      if (sigSet.has(sig)) return;
      const id = (!q.id || typeof q.id !== 'string' || existingIds.has(q.id))
        ? generateUniqueSyncId('DI-IMP', existingIds)
        : (existingIds.add(q.id), q.id.trim().slice(0, 60));
      cleanCandidate.id = id;
      state.customDiQuestions.push(cleanCandidate);
      sigSet.add(sig);
      stats.customQ += 1;
    });
    saveStorage(STORAGE_KEYS.customDiQuestions, state.customDiQuestions);
  }

  // 9. Merge Weakness Logs & Drills (pte_weakness_logs, pte_weakness_drills)
  const inWeak = src.pte_weakness_logs || src.weaknessLogs;
  if (Array.isArray(inWeak)) {
    if (!Array.isArray(state.weaknessLogs)) state.weaknessLogs = [];
    const wkIds = new Set(state.weaknessLogs.map(w => w.id));
    const keyMap = new Map(state.weaknessLogs.map(w => [w.key, w]));
    inWeak.forEach(w => {
      if (!w || typeof w !== 'object' || !w.target) return;
      const cleanTarget = String(w.target).trim().slice(0, 160);
      const cleanCategory = String(w.category || 'pronunciation').trim().slice(0, 40);
      if (!cleanTarget) return;
      const k = (typeof w.key === 'string' && w.key.trim())
        ? w.key.trim().slice(0, 200)
        : `${cleanCategory}::${cleanTarget.toLowerCase()}`;
      const cur = keyMap.get(k);
      const wCount = Number.isFinite(Number(w.count)) ? Math.max(1, Math.round(Number(w.count))) : 1;
      const wLastSeen = Number.isFinite(Number(w.lastSeen)) ? Number(w.lastSeen) : 0;
      if (cur) {
        cur.count = Math.max(cur.count || 1, wCount);
        cur.lastSeen = Math.max(cur.lastSeen || 0, wLastSeen);
      } else {
        const id = (!w.id || typeof w.id !== 'string' || wkIds.has(w.id))
          ? generateUniqueSyncId('wk', wkIds)
          : (wkIds.add(w.id), w.id.trim().slice(0, 80));
        const entry = {
          id,
          key: k,
          target: cleanTarget,
          correction: String(w.correction || '').trim().slice(0, 240),
          category: cleanCategory,
          sourceMode: String(w.sourceMode || 'speaking').trim().slice(0, 40),
          count: wCount,
          lastSeen: wLastSeen || Date.now()
        };
        state.weaknessLogs.push(entry);
        keyMap.set(k, entry);
        stats.weaknesses += 1;
      }
    });
    saveStorage(STORAGE_KEYS.weaknessLogs, state.weaknessLogs);
  }

  const inDrills = src.pte_weakness_drills || src.weaknessDrills;
  if (Array.isArray(inDrills)) {
    if (!Array.isArray(state.weaknessDrills)) state.weaknessDrills = [];
    const drillSet = new Set(state.weaknessDrills.map(d => String(d.sentence || '').trim().toLowerCase()));
    inDrills.forEach(d => {
      if (!d || typeof d !== 'object') return;
      const cleanSent = String(d.sentence || '').trim();
      const norm = cleanSent.toLowerCase();
      if (!norm || drillSet.has(norm)) return;
      state.weaknessDrills.push({
        sentence: cleanSent.slice(0, 400),
        targetFocus: String(d.targetFocus || '').trim().slice(0, 120),
        chunkingTipKo: String(d.chunkingTipKo || '').trim().slice(0, 240),
        translationKo: String(d.translationKo || '').trim().slice(0, 300)
      });
      drillSet.add(norm);
    });
    saveStorage(STORAGE_KEYS.weaknessDrills, state.weaknessDrills);
  }

  // 9.5 Merge Brain Pattern Sets & Progress (pte_live_academy_sets, pte_live_academy_progress)
  const inLaSets = src.pte_live_academy_sets || src.liveAcademySets;
  if (Array.isArray(inLaSets)) {
    if (!Array.isArray(state.liveAcademySets)) state.liveAcademySets = [];
    const laIds = new Set(state.liveAcademySets.map(s => s.id));
    inLaSets.forEach(s => {
      if (!s || typeof s !== 'object' || !s.title || !Array.isArray(s.items)) return;
      if (!s.id || typeof s.id !== 'string' || laIds.has(s.id)) return;
      const safeYt = sanitizeHttpUrl(s.youtubeUrl);
      const cleanSetId = s.id.trim().slice(0, 80);
      laIds.add(cleanSetId);
      state.liveAcademySets.push({
        id: cleanSetId,
        title: String(s.title).trim().slice(0, 160),
        youtubeUrl: safeYt === '#' ? '' : safeYt,
        createdAt: Number.isFinite(Number(s.createdAt)) ? Number(s.createdAt) : Date.now(),
        nuanceComparisons: (Array.isArray(s.nuanceComparisons) ? s.nuanceComparisons : [])
          .filter(n => n && typeof n === 'object')
          .map(n => ({
            literal: String(n.literal || '').trim(),
            native: String(n.native || '').trim(),
            noteKo: String(n.noteKo || '').trim()
          })),
        items: s.items
          .filter(it => it && typeof it === 'object' && it.kr && it.en)
          .map((it, idx) => ({
            id: String(it.id || `${cleanSetId}-q${idx + 1}`).trim().slice(0, 80),
            pattern: String(it.pattern || '').trim(),
            kr: String(it.kr || '').trim(),
            en: String(it.en || '').trim(),
            variants: Array.isArray(it.variants) ? it.variants.map(v => String(v).trim()).filter(Boolean) : []
          })),
        makeYourOwnPrompts: (Array.isArray(s.makeYourOwnPrompts) ? s.makeYourOwnPrompts : [])
          .filter(p => p && typeof p === 'object')
          .map((p, idx) => ({
            id: String(p.id || `${cleanSetId}-myo-${idx + 1}`).trim().slice(0, 80),
            pattern: String(p.pattern || '').trim(),
            promptKo: String(p.promptKo || '').trim()
          }))
      });
    });
    saveStorage(STORAGE_KEYS.liveAcademySets, state.liveAcademySets);
  }

  const inLaProg = src.pte_live_academy_progress || src.bpProgress;
  if (inLaProg && typeof inLaProg === 'object' && !Array.isArray(inLaProg)) {
    if (!state.bpProgress) state.bpProgress = { checks: {}, myoDrafts: {}, selectedMissions: {} };
    if (inLaProg.checks && typeof inLaProg.checks === 'object' && !Array.isArray(inLaProg.checks)) {
      Object.entries(inLaProg.checks).forEach(([k, v]) => {
        if (!isSafeObjKey(k) || !v || typeof v !== 'object') return;
        const cur = state.bpProgress.checks[k] || {};
        state.bpProgress.checks[k] = {
          s1: Boolean(cur.s1 || v.s1),
          s2: Boolean(cur.s2 || v.s2),
          s3: Boolean(cur.s3 || v.s3)
        };
      });
    }
    if (inLaProg.myoDrafts && typeof inLaProg.myoDrafts === 'object' && !Array.isArray(inLaProg.myoDrafts)) {
      Object.entries(inLaProg.myoDrafts).forEach(([k, v]) => {
        if (!isSafeObjKey(k) || state.bpProgress.myoDrafts[k] || !v || typeof v !== 'object') return;
        const cleanDraft = {
          userText: typeof v.userText === 'string' ? v.userText : ''
        };
        if (v.aiResult && typeof v.aiResult === 'object') {
          cleanDraft.aiResult = {
            correctedEn: String(v.aiResult.correctedEn || '').trim(),
            meaningKo: String(v.aiResult.meaningKo || '').trim(),
            explanationKo: String(v.aiResult.explanationKo || '').trim()
          };
        }
        state.bpProgress.myoDrafts[k] = cleanDraft;
      });
    }
    if (inLaProg.selectedMissions && typeof inLaProg.selectedMissions === 'object' && !Array.isArray(inLaProg.selectedMissions)) {
      Object.entries(inLaProg.selectedMissions).forEach(([k, v]) => {
        if (!isSafeObjKey(k) || state.bpProgress.selectedMissions[k] || !Array.isArray(v)) return;
        state.bpProgress.selectedMissions[k] = v.map(x => String(x || '').trim()).filter(Boolean).slice(0, 10);
      });
    }
    saveStorage(STORAGE_KEYS.liveAcademyProgress, state.bpProgress);
  }

  // 10. Non-destructive Writing Drafts & Retell Notes
  if (src.writingDrafts && typeof src.writingDrafts === 'object' && !Array.isArray(src.writingDrafts)) {
    Object.entries(src.writingDrafts).forEach(([k, v]) => {
      if (!isSafeObjKey(k)) return;
      if (k.startsWith('pte_writing_') && typeof v === 'string' && v.trim()) {
        try {
          if (!localStorage.getItem(k)) localStorage.setItem(k, v);
        } catch (e) {
          if (isQuotaExceededError(e)) showStorageQuotaToast();
        }
      }
    });
  }
  if (src.rlNotes && typeof src.rlNotes === 'object' && !Array.isArray(src.rlNotes)) {
    Object.entries(src.rlNotes).forEach(([k, v]) => {
      if (!isSafeObjKey(k)) return;
      if (k.startsWith('pte_rl_notes_') && typeof v === 'string' && v.trim()) {
        try {
          if (!localStorage.getItem(k)) localStorage.setItem(k, v);
        } catch (e) {
          if (isQuotaExceededError(e)) showStorageQuotaToast();
        }
      }
    });
  }

  // Refresh all UI views immediately
  updateReviewTabBadge();
  updateRsBankSummaryUI();
  updateDiBankSummaryUI();
  renderYtClipSetsAndClips();
  renderYtsWorkspace();
  renderBpWorkspace();
  renderReviewDashboard();
  if (MODE_CONFIG[state.mode]) {
    renderQuestionSelector();
    renderQuestionContent();
  }
  updateSyncSummaryBadge();

  const addedSummary = [
    stats.ytRlSets > 0 ? `강의유튜브 ${stats.ytRlSets}` : '',
    stats.ytShadowSets > 0 ? `쉐도잉세트 ${stats.ytShadowSets}` : '',
    stats.vocab > 0 ? `단어 ${stats.vocab}` : '',
    stats.bookmarks > 0 ? `오답 ${stats.bookmarks}` : '',
    stats.customQ > 0 ? `AI문제 ${stats.customQ}` : '',
    stats.logs > 0 ? `기록 ${stats.logs}` : '',
    stats.weaknesses > 0 ? `약점 ${stats.weaknesses}` : '',
    stats.solved > 0 ? `완료문제 ${stats.solved}` : ''
  ].filter(Boolean).join(' · ');

  showSyncFeedback(
    addedSummary
      ? `✅ 기존 데이터를 보존한 채 안전하게 병합 완료! 추가됨: ${addedSummary}`
      : '✅ 병합 완료! 이미 동일한 항목이 모두 기기에 저장되어 있어 기존 데이터를 그대로 유지했습니다.'
  );
  return true;
}


export function initSyncFeature() {
  if (el.btnDataSync) el.btnDataSync.addEventListener('click', openDataSyncModal);
  if (el.btnReviewDataSync) el.btnReviewDataSync.addEventListener('click', openDataSyncModal);
  if (el.btnCloseSyncModal) el.btnCloseSyncModal.addEventListener('click', closeDataSyncModal);
  if (el.dataSyncModal) {
    el.dataSyncModal.addEventListener('click', (e) => {
      if (e.target === el.dataSyncModal) closeDataSyncModal();
    });
  }
  if (el.btnExportYtCopy) {
    el.btnExportYtCopy.addEventListener('click', async () => {
      const payload = buildExportPayload('youtube');
      const jsonText = JSON.stringify(payload, null, 2);
      const copied = await copyExportJson(jsonText);
      showSyncFeedback(
        copied
          ? '🎬 유튜브 클립/쉐도잉 데이터만 복사했습니다 (API 키 제외). 다른 기기에 붙여넣기 해주세요!'
          : '🎬 유튜브 클립 JSON이 아래에 생성되었습니다. 전체 선택 후 복사해주세요 (API 키 제외).'
      );
    });
  }
  if (el.btnExportAllCopy) {
    el.btnExportAllCopy.addEventListener('click', async () => {
      const payload = buildExportPayload('all');
      const jsonText = JSON.stringify(payload, null, 2);
      const copied = await copyExportJson(jsonText);
      showSyncFeedback(
        copied
          ? '📋 전체 학습 데이터 JSON을 클립보드에 복사했습니다 (API 키 제외)!'
          : '📋 전체 학습 데이터 JSON이 아래에 생성되었습니다. 전체 선택 후 복사해주세요 (API 키 제외).'
      );
    });
  }
  if (el.btnExportAllDownload) {
    el.btnExportAllDownload.addEventListener('click', () => {
      const payload = buildExportPayload('all');
      const jsonText = JSON.stringify(payload, null, 2);
      if (el.syncExportTextarea) el.syncExportTextarea.value = jsonText;

      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateTag = getTodayDateKey();
      a.href = url;
      a.download = `pte-trainer-backup-${dateTag}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showSyncFeedback(`💾 pte-trainer-backup-${dateTag}.json 파일을 다운로드했습니다 (API 키 제외)!`);
    });
  }
  if (el.syncImportFile) {
    el.syncImportFile.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (el.syncImportTextarea) {
          el.syncImportTextarea.value = String(reader.result || '');
        }
        showSyncFeedback(`📂 "${file.name}" 파일을 불러왔습니다. 아래 [가져오기 (합치기)]를 누르세요.`);
      };
      reader.onerror = () => {
        showSyncFeedback('❌ 파일을 읽는 중 오류가 발생했습니다.', true);
      };
      reader.readAsText(file, 'utf-8');
    });
  }
  if (el.btnImportMerge) {
    el.btnImportMerge.addEventListener('click', () => {
      const raw = (el.syncImportTextarea?.value || '').trim();
      if (!raw) {
        showSyncFeedback('⚠️ 먼저 가져올 JSON 텍스트를 붙여넣거나 .json 파일을 선택해주세요.', true);
        return;
      }
      mergeImportedData(raw);
    });
  }
}
