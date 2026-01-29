// Core app state
const state = {
  subtitles: [],
  currentIndex: -1,
  loop: false,
  loopCount: 2,  // 循环次数：1, 2, 3, 5, -1(无限)
  loopRemaining: 0,
  loopPause: 0.2,  // 循环间隔：0, 0.1, 0.2, 0.33, 0.5 (句长倍数)
  autoPause: false,
  autoPlay: true,  // 自动播放：仅用于上下句切换时自动开始播放
  mediaTitle: "",
  playlist: [],  // 单一播放列表
  currentPlaylistIndex: -1,  // 当前播放项索引
  selectedPlaylistIndices: [],  // 多选的播放列表项索引
  lastClickedIndex: -1,  // 上次点击的索引（用于 Shift 选择）
  recording: {
    mediaRecorder: null,
    chunks: [],
    blobUrl: null,
    isRecording: false,  // 录音状态
  },
  vocabBooks: [],  // 生词本集合 [{id, name, words: [...]}, ...]
  currentVocabBookId: null,  // 当前活跃生词本ID
  // 为向后兼容，保留旧的 vocab 引用，指向当前活跃生词本的 words
  get vocab() {
    if (!this.currentVocabBookId) return [];
    const vb = this.vocabBooks.find(v => v.id === this.currentVocabBookId);
    return vb ? vb.words : [];
  },
  set vocab(value) {
    if (!this.currentVocabBookId) return;
    const vb = this.vocabBooks.find(v => v.id === this.currentVocabBookId);
    if (vb) vb.words = value;
  },
  // 撤销/重做历史（字幕）
  history: [],
  historyIndex: -1,
  maxHistory: 50,
  // 播放列表历史
  playlistHistory: [],
  playlistHistoryIndex: -1,
  maxPlaylistHistory: 50,
  folderExpandedStates: {}, // 文件夹展开状态
  // 操作取消标志
  cancelOperation: false,
  settings: {
    collapsed: {}, // 各功能区折叠状态
    commonDefaultVocab: true, // 听力和阅读是否使用通用默认生词本
    // 播放默认偏好（用于初始化 state.autoPause/autoPlay）
    defaultAutoPause: false,
    defaultAutoPlay: true,
    // 侧栏状态
    sidebar: {
      listening: {
        collapsed: false,
        currentModule: 'control'
      },
      reading: {
        collapsed: false,
        currentModule: 'reading-dictionary'
      }
    }
  },
  // 右键菜单状态
  contextMenu: {
    visible: false,
    target: null,
    targetType: null,  // 'playlist-file', 'playlist-folder', 'playlist-root', 'documents-file', 'documents-folder', 'documents-root'
    nodeData: null
  }
};

const persistSettings = async () => {
  try {
    await fetch('/api/settings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: state.settings })
    });
    console.log('✓ 设置已保存到服务器');
  } catch (e) {
    console.warn('设置保存失败', e);
  }
};

const loadSettings = async () => {
  try {
    const response = await fetch('/api/settings/load');
    const data = await response.json();
    if (data.status === 'success' && data.settings) {
      state.settings = {
        collapsed: data.settings.collapsed || {},
        commonDefaultVocab: data.settings.commonDefaultVocab !== undefined ? data.settings.commonDefaultVocab : true,
        defaultAutoPause: data.settings.defaultAutoPause !== undefined ? !!data.settings.defaultAutoPause : false,
        defaultAutoPlay: data.settings.defaultAutoPlay !== undefined ? !!data.settings.defaultAutoPlay : true,
        sidebar: data.settings.sidebar || {
          listening: {
            collapsed: false,
            currentModule: 'control'
          },
          reading: {
            collapsed: false,
            currentModule: 'reading-dictionary'
          }
        }
      };
      console.log('✓ 设置已从服务器加载');
    }
  } catch (e) {
    console.warn("加载设置失败，使用默认值", e);
  }
};

const grammarLabelMap = {
  pos: {
    'NOUN': '名词',
    'VERB': '动词',
    'ADJF': '形容词',
    'ADJS': '形容词短尾',
    'COMP': '比较级',
    'PRTF': '形动词',
    'PRTS': '形动词短尾',
    'GRND': '副动词',
    'NUMR': '数词',
    'ADVB': '副词',
    'NPRO': '代词',
    'PRED': '谓语副词',
    'PREP': '前置词',
    'CONJ': '连接词',
    'PRCL': '语气词',
    'INTJ': '感叹词'
  },
  case: {
    'nomn': '主格',
    'gent': '属格',
    'datv': '与格',
    'accs': '宾格',
    'ablt': '工具格',
    'loct': '前置格'
  },
  gender: {
    'masc': '阳性',
    'femn': '阴性',
    'neut': '中性',
    'Ms-f': '通性'
  },
  number: {
    'sing': '单数',
    'plur': '复数'
  },
  tense: {
    'pres': '现在时',
    'past': '过去时',
    'futr': '将来时'
  },
  person: {
    '1per': '一',
    '2per': '二',
    '3per': '三'
  },
  voice: {
    'actv': '主动语态',
    'pssv': '被动语态'
  },
  mood: {
    'indc': '陈述式',
    'impr': '命令式'
  },
  aspect: {
    'impf': '未完成体',
    'perf': '完成体'
  },
  animacy: {
    'anim': '有生命',
    'inan': '无生命'
  },
  transitivity: {
    'tran': '及物',
    'intr': '不及物'
  },
  involvement: {
    'Infr': '非正式',
    'Slng': '俚语',
    'Arch': '古语',
    'Litr': '文学',
    'Coll': '口语',
    'Vulg': '粗俗',
    'excl': '例外'
  }
};

const translateGrammarLabel = (category, value) => {
  if (!value) return null;
  if (grammarLabelMap[category] && grammarLabelMap[category][value]) {
    return grammarLabelMap[category][value];
  }
  return value;
};

const persistPlaylist = async () => {
  console.log('播放列表已从真实文件夹加载，无需保存');
};

const loadPlaylist = async () => {
  try {
    const response = await fetch('/api/playlist/scan');
    const data = await response.json();
    if (data.status === 'success') {
      state.playlist = data.playlist || [];
      state.currentPlaylistIndex = -1;
      console.log(`✓ 播放列表已从服务器加载 (${state.playlist.length} 项)`);
      
      // 保存初始状态到历史记录
      if (state.playlistHistory.length === 0) {
        const snapshot = JSON.parse(JSON.stringify(state.playlist));
        state.playlistHistory.push(snapshot);
        state.playlistHistoryIndex = 0;
        console.log('[loadPlaylist] 保存初始播放列表状态到历史');
      }
      
      renderPlaylist();
    }
  } catch (e) {
    console.warn("加载播放列表失败，使用空列表", e);
  }
};

// --- Model management (frontend) -----------------------------------------
const fetchModels = async () => {
  try {
    const res = await fetch('/api/models/list');
    return await res.json();
  } catch (e) {
    console.warn('⚠ 模型列表获取失败', e);
    return { status: 'error' };
  }
};

const downloadModel = async (name) => {
  try {
    const res = await fetch('/api/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.status === 'success') {
      alert(`✅ 模型 ${data.filename} 已下载`);
      renderModelSettings();
    } else {
      alert(`✗ 下载失败：${data.message || '未知错误'}`);
    }
  } catch (e) {
    alert('✗ 下载失败，网络或服务器错误');
  }
};

const setActiveModel = async (filename) => {
  try {
    const res = await fetch('/api/models/set_active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    });
    const data = await res.json();
    if (data.status === 'success') {
      alert(`✅ 已切换到模型：${data.active}`);
    } else {
      alert(`✗ 切换失败：${data.message || '未知错误'}`);
    }
  } catch (e) {
    alert('✗ 切换失败，网络或服务器错误');
  }
};

const renderModelSettings = async () => {
  const container = document.getElementById('model-settings');
  if (!container) return;
  container.innerHTML = '<div style="font-size:12px;color:var(--muted)">加载中...</div>';
  const info = await fetchModels();
  if (info.status !== 'success') {
    container.innerHTML = '<div style="color:#ef4444">无法获取模型信息</div>';
    return;
  }
  const local = info.local || [];
  const current = info.current || null;
  
  let html = '';
  
  // 显示本地模型和切换选项
  if (local.length > 0) {
    const options = local.map(m => `<option value="${m.filename}" ${m.filename===current?'selected':''}>${m.filename} (${m.size_mb}MB)</option>`).join('');
    html += `
      <div style="margin-bottom:16px">
        <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px">📊 当前模型：</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="model-select" style="flex:1">${options}</select>
          <button id="btn-set-model" class="primary">设置为当前</button>
        </div>
      </div>
    `;
  } else {
    html += `<div style="margin-bottom:16px;padding:8px;background:#fee;border-radius:4px;font-size:12px;color:#c33">⚠️ 未检测到本地模型</div>`;
  }
  
  // 显示手动下载选项
  const modelsList = [
    { name: 'tiny', label: 'Tiny', size: '75MB', title: '最快，精度较低' },
    { name: 'base', label: 'Base', size: '142MB', title: '推荐开发测试' },
    { name: 'small', label: 'Small', size: '466MB', title: '推荐生产' },
    { name: 'medium', label: 'Medium', size: '1.5GB', title: '高精度' },
    { name: 'large', label: 'Large', size: '2.9GB', title: '最高精度' }
  ];
  
  // 检查已下载的模型名称
  const downloadedModels = new Set(local.map(m => {
    // 从 "base.pt" 提取 "base"
    return m.filename.replace(/\.pt$/, '');
  }));
  
  const buttonHtml = modelsList.map(m => {
    const isDownloaded = downloadedModels.has(m.name);
    if (isDownloaded) {
      return `<button class="primary" data-model="${m.name}" disabled style="opacity:0.6;cursor:default" title="${m.title}">✅ ${m.label} (${m.size})</button>`;
    } else {
      return `<button class="primary" data-model="${m.name}" title="${m.title}">${m.label} (${m.size})</button>`;
    }
  }).join('');
  
  html += `
    <div>
      <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px">📥 下载其他模型：</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${buttonHtml}
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:8px">💡 提示：可同时保留多个模型，下载后可在上方选择切换。首次下载耗时较长，请耐心等待。</p>
    </div>
  `;
  
  container.innerHTML = html;
  
  // 绑定事件
  if (local.length > 0) {
    const select = document.getElementById('model-select');
    const btnSet = document.getElementById('btn-set-model');
    if (select && btnSet) {
      btnSet.addEventListener('click', () => setActiveModel(select.value));
    }
  }
  
  // 只为未下载的模型绑定下载事件
  container.querySelectorAll('button[data-model]:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => downloadModel(btn.getAttribute('data-model')));
  });
};

// 播放列表拖拽源索引
let playlistDragIndex = null;
let playlistDragIndices = [];
let isPlaylistDragging = false;

// Utility helpers -----------------------------------------------------------

const $ = (selector) => document.querySelector(selector);
const createEl = (tag, className) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
};

// 简单日志输出，便于排查播放/循环/暂停问题
const logEvent = (event, payload = {}) => {
  const ts = new Date().toISOString();
  console.log(`[LOG ${ts}] ${event}`, payload);
};

const formatTime = (seconds) => {
  if (Number.isNaN(seconds)) return "0:00:00.000";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

// 更新当前媒体文件名显示
const updateMediaName = () => {
  const el = $("#current-media-name");
  if (!el) return;
  el.textContent = state.mediaTitle || "未选择";
};

// 根据媒体类型调整播放器样式与布局
const updatePlayerMediaMode = (isAudio) => {
  const player = $("#player");
  const playbackBody = $("#playback-body");
  const waveform = $("#player-waveform");
  if (!player) return;
  // 音频模式：视频高度压缩、取消并排布局
  player.classList.toggle('audio-mode', !!isAudio);

  if (playbackBody && waveform) {
    if (!isAudio) {
      // 视频模式：启用并排布局，右侧波形高度匹配播放器高度
      playbackBody.classList.add('video-split');
      syncWaveformHeight();
    } else {
      // 音频模式：关闭并排布局，恢复默认高度
      playbackBody.classList.remove('video-split');
      waveform.style.height = '';
      // 重置 WaveSurfer 的高度选项为默认值 80px
      try {
        if (playerWavesurfer && typeof playerWavesurfer.setOptions === 'function') {
          playerWavesurfer.setOptions({ height: 80, fillParent: true });
        }
      } catch (e) {
        // 忽略不支持的情况
      }
    }
  }
};

// 同步并排布局下的波形容器与波形图高度
const syncWaveformHeight = () => {
  const player = document.querySelector('#player');
  const playbackBody = document.querySelector('#playback-body');
  const waveform = document.querySelector('#player-waveform');
  if (!player || !playbackBody || !waveform) return;
  if (!playbackBody.classList.contains('video-split')) return;
  const base = player.clientHeight || 240;
  const h = Math.max(80, Math.floor(base / 2));
  waveform.style.height = `${h}px`;
  try {
    if (playerWavesurfer && typeof playerWavesurfer.setOptions === 'function') {
      playerWavesurfer.setOptions({ height: h, fillParent: true });
    }
  } catch (e) {
    // 忽略不支持的情况
  }
};

const guessIsAudio = (name = "") => {
  const audioExt = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff", ".alac"];
  const lower = name.toLowerCase();
  return audioExt.some(ext => lower.endsWith(ext));
};

const storageKey = (suffix) => `lr-${state.mediaTitle || "default"}-${suffix}`;

// 撤销/重做功能
const saveHistory = () => {
  // 删除当前索引之后的所有历史记录
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }
  
  // 添加新的历史记录
  const snapshot = JSON.parse(JSON.stringify(state.subtitles));
  state.history.push(snapshot);
  
  // 限制历史记录数量
  if (state.history.length > state.maxHistory) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }
  
  updateHistoryButtons();
  logEvent('historySaved', { index: state.historyIndex, total: state.history.length });
};

const savePlaylistHistory = () => {
  // 删除当前索引之后的所有历史记录
  if (state.playlistHistoryIndex < state.playlistHistory.length - 1) {
    state.playlistHistory = state.playlistHistory.slice(0, state.playlistHistoryIndex + 1);
  }
  
  // 添加新的历史记录
  const snapshot = JSON.parse(JSON.stringify(state.playlist));
  state.playlistHistory.push(snapshot);
  
  // 限制历史记录数量
  if (state.playlistHistory.length > state.maxPlaylistHistory) {
    state.playlistHistory.shift();
  } else {
    state.playlistHistoryIndex++;
  }
  
  console.log(`[savePlaylistHistory] 保存播放列表历史，索引: ${state.playlistHistoryIndex}, 总数: ${state.playlistHistory.length}`);
};

const undoPlaylist = () => {
  if (state.playlistHistoryIndex > 0) {
    state.playlistHistoryIndex--;
    state.playlist = JSON.parse(JSON.stringify(state.playlistHistory[state.playlistHistoryIndex]));
    state.currentPlaylistIndex = -1;
    state.selectedPlaylistIndices = [];
    state.lastClickedIndex = -1;
    renderPlaylist();
    console.log(`[undoPlaylist] 撤销到索引: ${state.playlistHistoryIndex}`);
  } else {
    console.log('[undoPlaylist] 无法撤销，已经是第一个状态');
  }
};

const redoPlaylist = () => {
  if (state.playlistHistoryIndex < state.playlistHistory.length - 1) {
    state.playlistHistoryIndex++;
    state.playlist = JSON.parse(JSON.stringify(state.playlistHistory[state.playlistHistoryIndex]));
    state.currentPlaylistIndex = -1;
    state.selectedPlaylistIndices = [];
    state.lastClickedIndex = -1;
    renderPlaylist();
    console.log(`[redoPlaylist] 重做到索引: ${state.playlistHistoryIndex}`);
  } else {
    console.log('[redoPlaylist] 无法重做，已经是最新状态');
  }
};

const undo = () => {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    state.subtitles = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
    renderSubtitles();
    renderEditors();
    renderWaveformRegions();
    persistSubtitles();
    updateHistoryButtons();
    logEvent('undo', { index: state.historyIndex });
  }
};

const redo = () => {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    state.subtitles = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
    renderSubtitles();
    renderEditors();
    renderWaveformRegions();
    persistSubtitles();
    updateHistoryButtons();
    logEvent('redo', { index: state.historyIndex });
  }
};

const updateHistoryButtons = () => {
  // 按钮已移除，仅保留快捷键功能 (Ctrl+Z / Ctrl+Y)
  // 函数保留以兼容现有代码调用
};

const persistSubtitles = async () => {
  // 同时保存到 localStorage 和服务器
  localStorage.setItem(storageKey("subs"), JSON.stringify(state.subtitles));
  
  // 异步保存到服务器（即使字幕为空数组也要保存，以覆盖服务器上的旧数据）
  if (state.mediaTitle) {
    try {
      await fetch('/api/subtitles/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaName: state.mediaTitle,
          subtitles: state.subtitles
        })
      });
      console.log(`✓ 字幕已同步到服务器 (${state.subtitles.length} 条)`);
    } catch (e) {
      console.warn('服务器同步失败，已保存到本地', e);
    }
  }
};

const loadPersistedSubtitles = () => {
  const key = storageKey("subs");
  const raw = localStorage.getItem(key);
  if (!raw) return;
  
  // 检查数据大小，如果太大给出警告并限制加载
  const rawSize = raw.length;
  const sizeInMB = rawSize / (1024 * 1024);
  
  if (sizeInMB > 50) { // 如果字幕数据超过50MB，可能有问题
    console.warn(`字幕数据过大: ${sizeInMB.toFixed(2)} MB，可能损坏或异常，跳过加载`);
    // 可选：询问用户是否尝试清理损坏的数据
    if (confirm(`检测到过大的字幕数据（${sizeInMB.toFixed(2)} MB），可能已损坏。是否清除此数据？`)) {
      localStorage.removeItem(key);
    }
    return;
  }
  
  try {
    const saved = JSON.parse(raw);
    
    // 验证数据格式
    if (!Array.isArray(saved)) {
      console.warn("字幕数据格式错误：不是数组");
      return;
    }
    
    // 检查数组长度是否合理（假设最多10000条字幕）
    if (saved.length > 10000) {
      console.warn(`字幕数量异常：${saved.length} 条，可能损坏`);
      if (confirm(`检测到异常数量的字幕（${saved.length} 条），可能已损坏。是否清除此数据？`)) {
        localStorage.removeItem(key);
      }
      return;
    }
    
    // 验证每条字幕的基本结构
    for (let i = 0; i < Math.min(saved.length, 100); i++) { // 只检查前100条
      const sub = saved[i];
      if (sub && typeof sub === 'object') {
        // 检查必要的字段
        if (typeof sub.start !== 'number' || typeof sub.end !== 'number') {
          console.warn(`字幕 ${i} 缺少时间字段，数据可能损坏`);
          if (confirm("检测到损坏的字幕数据。是否清除此数据？")) {
            localStorage.removeItem(key);
            return;
          }
        }
      }
    }
    
    state.subtitles = saved;
    console.log(`✓ 从 localStorage 加载 ${saved.length} 条字幕，大小: ${sizeInMB.toFixed(2)} MB`);
  } catch (e) {
    console.warn("解析保存的字幕失败:", e);
    // 尝试修复常见问题
    try {
      // 尝试清理可能的问题字符
      const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      const saved = JSON.parse(cleaned);
      if (Array.isArray(saved)) {
        state.subtitles = saved;
        console.log(`✓ 修复后加载 ${saved.length} 条字幕`);
        // 保存修复后的数据
        localStorage.setItem(key, JSON.stringify(saved));
      }
    } catch (e2) {
      console.error("无法修复损坏的字幕数据:", e2);
      // 询问用户是否清除损坏的数据
      if (confirm("字幕数据损坏无法修复。是否清除此数据？")) {
        localStorage.removeItem(key);
      }
    }
  }
};

const persistVocab = async () => {
  const toSave = state.vocabBooks.map(vb => ({
    id: vb.id,
    name: vb.name,
    words: vb.words,
  }));
  
  try {
    await fetch('/api/vocabbooks/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vocabBooks: toSave,
        currentVocabBookId: state.currentVocabBookId
      })
    });
    console.log('✓ 生词本已保存到服务器');
  } catch (e) {
    console.warn('生词本保存失败', e);
  }
};

const loadVocab = async () => {
  try {
    // 尝试加载新格式的多生词本数据
    const response = await fetch('/api/vocabbooks/load');
    const data = await response.json();
    
    if (data.status === 'success' && data.vocabBooks && data.vocabBooks.length > 0) {
      // 成功加载新格式数据
      state.vocabBooks = data.vocabBooks;
      const currentId = data.currentVocabBookId;
      
      // 恢复当前生词本
      if (currentId && state.vocabBooks.find(v => v.id === currentId)) {
        state.currentVocabBookId = currentId;
      } else if (state.vocabBooks.length > 0) {
        state.currentVocabBookId = state.vocabBooks[0].id;
      }
      
      console.log(`✓ 已恢复 ${state.vocabBooks.length} 个生词本`);
      return;
    }
    
    // 如果新格式没有数据，尝试从旧格式迁移
    console.log('尝试从旧版生词本迁移数据...');
    const oldResponse = await fetch('/api/vocab/load');
    const oldData = await oldResponse.json();
    
    if (oldData.status === 'success' && oldData.vocab && oldData.vocab.length > 0) {
      // 迁移旧数据到新格式
      const id = generateVocabBookId();
      state.vocabBooks = [{
        id: id,
        name: "默认生词本",
        words: oldData.vocab
      }];
      state.currentVocabBookId = id;
      
      // 保存迁移后的数据
      await persistVocab();
      console.log(`✓ 已从旧版迁移 ${oldData.vocab.length} 个生词到新格式`);
      return;
    }
    
    // 如果都没有数据，创建默认生词本
    state.vocabBooks = [];
    const id = generateVocabBookId();
    state.vocabBooks.push({ id, name: "默认生词本", words: [] });
    state.currentVocabBookId = id;
    console.log('✓ 已创建默认生词本');
    
  } catch (e) {
    console.warn("加载生词本失败，使用默认值", e);
    state.vocabBooks = [];
    const id = generateVocabBookId();
    state.vocabBooks.push({ id, name: "默认生词本", words: [] });
    state.currentVocabBookId = id;
  }
};

// 如果禁用通用默认生词本，为阅读模块创建独立的默认生词本
// 确保默认生词本的正确配置（根据模式）
const ensureDefaultVocabBooks = async () => {
  const commonDefault = state.vocabBooks.find(v => v.name === "默认生词本（通用）");
  const listeningDefault = state.vocabBooks.find(v => v.name === "默认生词本（听力）");
  const readingDefault = state.vocabBooks.find(v => v.name === "默认生词本（阅读）");
  const oldDefault = state.vocabBooks.find(v => v.name === "默认生词本");
  const oldReadingDefault = state.vocabBooks.find(v => v.name === "默认生词本(阅读)");
  
  if (state.settings.commonDefaultVocab) {
    // 公用模式：确保有"默认生词本（通用）"
    if (!commonDefault) {
      // 如果不存在，创建一个新的，并合并旧的数据
      const id = generateVocabBookId();
      const allWords = [];
      const wordMap = new Map(); // 用于跟踪词汇及其来源
      
      // 合并听力和阅读的默认生词本数据
      if (listeningDefault) {
        for (const word of listeningDefault.words) {
          const key = word.word.toLowerCase();
          if (!wordMap.has(key)) {
            wordMap.set(key, []);
          }
          wordMap.get(key).push({ ...word, source: word.source || 'listening' });
        }
      }
      if (readingDefault) {
        for (const word of readingDefault.words) {
          const key = word.word.toLowerCase();
          if (!wordMap.has(key)) {
            wordMap.set(key, []);
          }
          wordMap.get(key).push({ ...word, source: word.source || 'reading' });
        }
      }
      if (oldDefault) {
        for (const word of oldDefault.words) {
          const key = word.word.toLowerCase();
          if (!wordMap.has(key)) {
            wordMap.set(key, []);
          }
          wordMap.get(key).push({ ...word, source: word.source || 'listening' });
        }
      }
      if (oldReadingDefault) {
        for (const word of oldReadingDefault.words) {
          const key = word.word.toLowerCase();
          if (!wordMap.has(key)) {
            wordMap.set(key, []);
          }
          wordMap.get(key).push({ ...word, source: word.source || 'reading' });
        }
      }
      
      // 构建最终的词汇列表，保留源信息
      for (const [wordKey, wordVariants] of wordMap) {
        // 如果有多个来源的同一个词，保留最新的、或合并源信息
        let finalWord = wordVariants[0];
        
        // 如果同一个词来自多个来源，记录所有来源
        if (wordVariants.length > 1) {
          const sources = new Set(wordVariants.map(w => w.source).filter(Boolean));
          finalWord.sourceMultiple = Array.from(sources).join(','); // 记录所有来源
        }
        
        allWords.push(finalWord);
      }
      
      state.vocabBooks.push({
        id,
        name: "默认生词本（通用）",
        words: allWords
      });
      
      // 删除旧的默认生词本
      state.vocabBooks = state.vocabBooks.filter(v => 
        v.name !== "默认生词本（听力）" && 
        v.name !== "默认生词本(阅读)" &&
        v.name !== "默认生词本" &&
        v.name !== "默认生词本(阅读)" &&
        v.id !== listeningDefault?.id &&
        v.id !== readingDefault?.id &&
        v.id !== oldDefault?.id &&
        v.id !== oldReadingDefault?.id
      );
      
      state.currentVocabBookId = id;
      readingState.currentVocabBookId = id;
    } else {
      // 已存在，同步两个模块的选择
      state.currentVocabBookId = commonDefault.id;
      readingState.currentVocabBookId = commonDefault.id;
    }
    
    // 删除分离模式的生词本
    state.vocabBooks = state.vocabBooks.filter(v => 
      v.name !== "默认生词本（听力）" && 
      v.name !== "默认生词本(阅读)" &&
      v.name !== "默认生词本(阅读)"
    );
  } else {
    // 分离模式：确保有"默认生词本（听力）"和"默认生词本（阅读）"
    
    // 如果存在通用，进行数据分离
    if (commonDefault) {
      const listeningId = generateVocabBookId();
      const readingId = generateVocabBookId();
      
      // 智能分离：根据source字段分配词汇
      const listeningWords = [];
      const readingWords = [];
      
      for (const word of commonDefault.words) {
        // 如果有sourceMultiple（多来源）或者source为specific，拆分处理
        if (word.sourceMultiple) {
          const sources = word.sourceMultiple.split(',');
          if (sources.includes('listening')) {
            // 创建一份副本给听力
            listeningWords.push({
              ...JSON.parse(JSON.stringify(word)),
              source: 'listening'
            });
          }
          if (sources.includes('reading')) {
            // 创建一份副本给阅读
            readingWords.push({
              ...JSON.parse(JSON.stringify(word)),
              source: 'reading'
            });
          }
        } else if (word.source === 'reading') {
          readingWords.push(JSON.parse(JSON.stringify(word)));
        } else {
          // 默认分配给听力（包括source为'listening'或没有source的）
          listeningWords.push(JSON.parse(JSON.stringify(word)));
          if (!word.source) word.source = 'listening'; // 为缺失source的词汇赋予默认值
        }
      }
      
      state.vocabBooks.push({
        id: listeningId,
        name: "默认生词本（听力）",
        words: listeningWords
      });
      
      state.vocabBooks.push({
        id: readingId,
        name: "默认生词本（阅读）",
        words: readingWords
      });
      
      // 删除通用生词本
      state.vocabBooks = state.vocabBooks.filter(v => v.id !== commonDefault.id);
      
      state.currentVocabBookId = listeningId;
      readingState.currentVocabBookId = readingId;
    } else {
      // 不存在通用，创建分离的默认生词本（如果不存在）
      if (!listeningDefault) {
        const id = generateVocabBookId();
        const words = (oldDefault?.words || []).map(w => ({
          ...w,
          source: w.source || 'listening'
        }));
        state.vocabBooks.push({
          id,
          name: "默认生词本（听力）",
          words: words
        });
        state.currentVocabBookId = id;
      }
      
      if (!readingDefault) {
        const id = generateVocabBookId();
        const words = (oldReadingDefault?.words || []).map(w => ({
          ...w,
          source: w.source || 'reading'
        }));
        state.vocabBooks.push({
          id,
          name: "默认生词本（阅读）",
          words: words
        });
        readingState.currentVocabBookId = id;
      }
      
      // 删除旧格式的生词本
      state.vocabBooks = state.vocabBooks.filter(v => 
        v.name !== "默认生词本" &&
        v.name !== "默认生词本(阅读)"
      );
    }
  }
  
  await persistVocab();
};

const ensureReadingDefaultVocab = () => {
  // 这个函数已被ensureDefaultVocabBooks替代，但保留向后兼容性
};

// VocabBook management ------------------------------------------------------

// 生成唯一ID
const generateVocabBookId = () => {
  return "vb_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
};

// 创建新生词本
const createVocabBook = (name = "新生词本") => {
  const id = generateVocabBookId();
  const newVocabBook = { id, name, words: [] };
  state.vocabBooks.push(newVocabBook);
  // 自动切换到新生词本
  switchVocabBook(id);
  persistVocab();
  renderVocabBookSelector();
  renderVocab();
  
  // 立即弹出重命名对话框（与播放列表逻辑一致）
  setTimeout(() => {
    renameVocabBook(id);
  }, 100);
  
  return id;
};

// 删除生词本
const deleteVocabBook = (id) => {
  if (state.vocabBooks.length <= 1) {
    alert("至少需要保留一个生词本");
    return;
  }
  if (!confirm("确定要删除此生词本吗？")) return;
  
  const index = state.vocabBooks.findIndex(v => v.id === id);
  if (index > -1) {
    state.vocabBooks.splice(index, 1);
    
    // 如果删除的是当前生词本，切换到第一个
    if (state.currentVocabBookId === id) {
      if (state.vocabBooks.length > 0) {
        switchVocabBook(state.vocabBooks[0].id);
      } else {
        createVocabBook("默认生词本");
      }
    }
    
    persistVocab();
    renderVocabBookSelector();
    renderVocab();
    renderSubtitles(); // 重新渲染字幕以更新下划线
  }
};

// 切换生词本
const switchVocabBook = (id) => {
  const vocabBook = state.vocabBooks.find(v => v.id === id);
  if (vocabBook) {
    state.currentVocabBookId = id;
    persistVocab();
    
    // 如果启用了公用模式，同步到阅读模块
    if (state.settings.commonDefaultVocab) {
      readingState.currentVocabBookId = id;
      renderReadingVocabBookSelector();
      renderReadingVocab();
    }
    
    renderVocabBookSelector();
    renderVocab();
    renderSubtitles(); // 重新渲染字幕以更新下划线
  }
};

// 重命名生词本
const renameVocabBook = (id) => {
  const vocabBook = state.vocabBooks.find(v => v.id === id);
  if (!vocabBook) return;
  const newName = prompt("新的生词本名称:", vocabBook.name);
  if (newName && newName.trim()) {
    vocabBook.name = newName.trim();
    persistVocab();
    renderVocabBookSelector();
  }
};

// 渲染生词本选择器
const renderVocabBookSelector = () => {
  const selector = $("#vocabbook-selector");
  if (!selector) return;
  
  selector.innerHTML = "";
  
  // 根据模式过滤显示的生词本
  const filteredBooks = state.vocabBooks.filter(vb => {
    if (state.settings.commonDefaultVocab) {
      // 公用模式：只显示通用默认生词本和自定义生词本
      return vb.name === "默认生词本（通用）" || 
             (!vb.name.includes("（听力）") && !vb.name.includes("（阅读）") && !vb.name.includes("(阅读)"));
    } else {
      // 分离模式：显示听力默认生词本和自定义生词本（不显示阅读和通用）
      return vb.name === "默认生词本（听力）" || 
             (!vb.name.includes("（通用）") && !vb.name.includes("（阅读）") && !vb.name.includes("(阅读)"));
    }
  });
  
  filteredBooks.forEach(vb => {
    const option = document.createElement("option");
    option.value = vb.id;
    option.textContent = `${vb.name} (${vb.words.length})`;
    if (vb.id === state.currentVocabBookId) {
      option.selected = true;
    }
    selector.appendChild(option);
  });
  
  // 绑定切换事件
  selector.onchange = (e) => {
    switchVocabBook(e.target.value);
  };
  
  // 绑定管理按钮
  const btnNew = $("#btn-vocabbook-new");
  const btnRename = $("#btn-vocabbook-rename");
  const btnDelete = $("#btn-vocabbook-delete");
  
  if (btnNew) {
    btnNew.onclick = () => createVocabBook();
  }
  
  if (btnRename) {
    btnRename.onclick = () => {
      if (state.currentVocabBookId) {
        renameVocabBook(state.currentVocabBookId);
      }
    };
  }
  
  if (btnDelete) {
    btnDelete.onclick = () => {
      if (state.currentVocabBookId) {
        deleteVocabBook(state.currentVocabBookId);
      }
    };
  }
};// Playlist management -------------------------------------------------------



const setCollapsedState = (targetId, collapsed) => {
  const body = targetId ? document.getElementById(targetId) : null;
  if (!body) return;
  body.classList.toggle('collapsed', !!collapsed);
  const btn = document.querySelector(`.collapse-btn[data-target="${targetId}"]`);
  if (btn) {
    btn.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
  }
  state.settings.collapsed[targetId] = !!collapsed;
  persistSettings();
};

// 展开/折叠词法分析
window.toggleAnalyses = () => {
  const btn = document.getElementById('toggle-text');
  const allAnalyses = document.querySelectorAll('[id^="analysis-"]');
  const isExpanded = btn.textContent === '收起';
  
  allAnalyses.forEach((el, index) => {
    if (index < 2) return;
    el.style.display = isExpanded ? 'none' : 'block';
  });
  
  btn.textContent = isExpanded ? '显示更多' : '收起';
};

// 折叠/展开面板
const bindCollapsibles = () => {
  document.querySelectorAll('.collapse-btn').forEach(btn => {
    const targetId = btn.dataset.target;
    if (!targetId) return;
    const saved = state.settings.collapsed?.[targetId];
    setCollapsedState(targetId, !!saved);
    btn.addEventListener('click', () => {
      const body = document.getElementById(targetId);
      if (!body) return;
      const next = !body.classList.contains('collapsed');
      setCollapsedState(targetId, next);
    });
  });
};

// 词典搜索功能
function initDictionarySearch() {
  // 主要词典模块
  const mainSearchInput = document.getElementById('dictionary-search-input');
  const mainSearchBtn = document.getElementById('btn-dictionary-search');
  const mainResults = document.getElementById('dictionary-results');
  const mainStats = document.getElementById('dictionary-stats');
  const mainClearBtn = document.getElementById('btn-dictionary-clear');
  
  // 阅读模式词典模块
  const readingSearchInput = document.getElementById('reading-dictionary-search-input');
  const readingSearchBtn = document.getElementById('btn-reading-dictionary-search');
  const readingResults = document.getElementById('reading-dictionary-results');
  const readingStats = document.getElementById('reading-dictionary-stats');
  const readingClearBtn = document.getElementById('btn-reading-dictionary-clear');
  
  // 搜索函数
  async function performSearch(word, resultsEl, statsEl) {
    if (!word.trim()) {
      resultsEl.innerHTML = '<p style="color: var(--muted);">请输入要搜索的单词或短语</p>';
      statsEl.innerHTML = '';
      return;
    }
    
    try {
      resultsEl.innerHTML = '<p style="color: var(--muted);">正在搜索...</p>';
      
      const response = await fetch('/api/dictionary/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ word: word.trim(), analyze: true })
      });
      
      const data = await response.json();
      
      if (data.status === 'success') {
        displaySearchResults(data, resultsEl, statsEl);
      } else {
        resultsEl.innerHTML = `<p style="color: var(--error);">搜索失败: ${data.error}</p>`;
        statsEl.innerHTML = '';
      }
    } catch (error) {
      resultsEl.innerHTML = `<p style="color: var(--error);">搜索出错: ${error.message}</p>`;
      statsEl.innerHTML = '';
    }
  }
  
  // 显示搜索结果
  function displaySearchResults(data, resultsEl, statsEl) {
    let html = '';
    
    const inputWord = data.morphology?.word || '';
    
    if (data.morphology && data.morphology.analyses && data.morphology.analyses.length > 0) {
      html += '<div class="dictionary-analysis" style="margin-bottom: 15px; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 4px;">';
      html += '<strong style="font-size: 14px; margin-bottom: 10px; display: block;">📊 词法分析</strong>';
      
      html += '<div class="morphology-grid" style="display: grid; gap: 12px; max-height: 150px; overflow-x: auto; padding-right: 4px; scrollbar-width: thin; scrollbar-color: rgba(100, 150, 255, 0.5) rgba(255,255,255,0.1);">';
      
      data.morphology.analyses.forEach((analysis, index) => {
        html += '<div style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">';
        html += `<div style="margin-bottom: 6px;">`;
        
        if (inputWord && inputWord.toLowerCase() !== analysis.normal_form.toLowerCase()) {
          html += `<span style="color: var(--text); font-size: 14px; font-weight: bold;">${inputWord}</span>`;
          html += ` <span style="color: var(--muted); font-size: 12px;">→</span> `;
        }
        
        html += `<span style="color: var(--primary); font-size: 14px; font-weight: bold;">${analysis.normal_form}</span>`;
        if (analysis.pos) {
          const translatedPos = translateGrammarLabel('pos', analysis.pos);
          html += ` <span style="color: var(--accent); font-size: 11px; padding: 1px 5px; background: rgba(255,165,0,0.2); border-radius: 3px;">${translatedPos}</span>`;
        }
        html += ` <span style="color: var(--muted); font-size: 10px;">(置信度: ${(analysis.score * 100).toFixed(1)}%)</span>`;
        html += `</div>`;
        
        const attributes = [];
        if (analysis.case) attributes.push(`<span style="color: var(--secondary);">格: ${translateGrammarLabel('case', analysis.case)}</span>`);
        if (analysis.gender) attributes.push(`<span style="color: var(--secondary);">性: ${translateGrammarLabel('gender', analysis.gender)}</span>`);
        if (analysis.number) attributes.push(`<span style="color: var(--secondary);">数: ${translateGrammarLabel('number', analysis.number)}</span>`);
        if (analysis.tense) attributes.push(`<span style="color: var(--secondary);">时态: ${translateGrammarLabel('tense', analysis.tense)}</span>`);
        if (analysis.person) attributes.push(`<span style="color: var(--secondary);">人称: ${translateGrammarLabel('person', analysis.person)}</span>`);
        if (analysis.voice) attributes.push(`<span style="color: var(--secondary);">语态: ${translateGrammarLabel('voice', analysis.voice)}</span>`);
        if (analysis.mood) attributes.push(`<span style="color: var(--secondary);">式: ${translateGrammarLabel('mood', analysis.mood)}</span>`);
        if (analysis.aspect) attributes.push(`<span style="color: var(--secondary);">体: ${translateGrammarLabel('aspect', analysis.aspect)}</span>`);
        if (analysis.animacy) attributes.push(`<span style="color: var(--secondary);">有生命性: ${translateGrammarLabel('animacy', analysis.animacy)}</span>`);
        if (analysis.transitivity) attributes.push(`<span style="color: var(--secondary);">及物性: ${translateGrammarLabel('transitivity', analysis.transitivity)}</span>`);
        if (analysis.involvement) attributes.push(`<span style="color: var(--secondary);">参与性: ${translateGrammarLabel('involvement', analysis.involvement)}</span>`);
        
        if (attributes.length > 0) {
          html += '<div style="font-size: 11px; line-height: 1.5;">';
          html += attributes.join('<br>');
          html += '</div>';
        }
        
        html += '</div>';
      });
      
      html += '</div>';
      html += '</div>';
    }
    
    // 显示变格形式
    if (data.inflections && data.inflections.inflections && Object.keys(data.inflections.inflections).length > 0) {
      html += '<div class="dictionary-inflections" style="margin-bottom: 15px; padding: 15px; background: rgba(100, 150, 255, 0.08); border-radius: 4px;">';
      
      const inflections = data.inflections.inflections;
      const posKeys = Object.keys(inflections);
      
      posKeys.forEach(posKey => {
        const posData = inflections[posKey];
        const posInflections = posData.inflections;
        const posLabel = translateGrammarLabel('pos', posKey);
        
        html += `<div style="margin-bottom: 15px;">`;
        html += `<strong style="font-size: 13px; margin-bottom: 8px; display: block; color: var(--accent);">${posLabel}</strong>`;
        
        if (posKey === 'NOUN') {
          html += renderNounInflections(posInflections);
        } else if (posKey === 'VERB') {
          html += renderVerbInflections(posInflections);
        } else if (posKey === 'ADJF' || posKey === 'ADJS') {
          html += renderAdjectiveInflections(posInflections);
        } else if (posKey === 'NUMR' || posKey === 'NPRO') {
          html += renderGenericInflections(posInflections);
        } else {
          html += renderGenericInflections(posInflections);
        }
        
        html += '</div>';
      });
      
      html += '</div>';
    }
    
    // 显示词典释义
    if (data.dictionary && data.dictionary.length > 0) {
      html += '<div class="dictionary-entries">';
      html += `<h4 style="margin-bottom: 10px;">📚 词典释义 (${data.dictionary.length} 个结果)</h4>`;
      
      data.dictionary.forEach((entry, index) => {
        html += `<div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 4px; border-left: 3px solid var(--primary);">`;
        html += `<strong>${entry.word}</strong>`;
        if (entry.pos) {
          html += ` <span style="color: var(--muted); font-size: 11px;">(${entry.pos})</span>`;
        }
        if (entry.source) {
          html += ` <span style="color: var(--secondary); font-size: 10px;">[${entry.source}]</span>`;
        }
        html += '<br>';
        if (entry.translation) {
          let translationText = entry.translation;
          translationText = translationText.replace(/\\n/g, '\n');
          const translationLines = translationText.split('\n');
          html += '<div style="margin: 5px 0; color: var(--text); line-height: 1.8;">';
          translationLines.forEach((line, lineIndex) => {
            if (line.trim()) {
              const trimmedLine = line.trim();
              if (/^\d+\)/.test(trimmedLine)) {
                html += `<div style="margin-top: 8px;">${trimmedLine}</div>`;
              } else if (/^\s+\S/.test(line)) {
                html += `<div style="margin-left: 20px;">${trimmedLine}</div>`;
              } else {
                html += `<div>${trimmedLine}</div>`;
              }
            }
          });
          html += '</div>';
        }
        if (entry.examples && entry.examples.length > 0) {
          html += '<div style="margin: 5px 0; font-size: 13px; color: var(--muted);">';
          html += '<strong>例句：</strong><br>';
          entry.examples.forEach(example => {
            html += `• ${example}<br>`;
          });
          html += '</div>';
        }
        if (entry.notes) {
          html += `<div style="margin: 5px 0; font-size: 13px; color: var(--secondary);">${entry.notes}</div>`;
        }
        html += '</div>';
      });
      
      html += '</div>';
    } else {
      html += '<p style="color: var(--muted);">未找到匹配的词典条目</p>';
    }
    
    // 显示生词本记录
    if (data.vocab) {
      html += '<div style="margin-top: 15px; padding: 10px; background: rgba(100, 255, 100, 0.1); border-radius: 4px; border-left: 3px solid #4CAF50;">';
      html += '<strong>📖 生词本记录：</strong><br>';
      html += `<div><strong>释义：</strong>${data.vocab.meaning || '无'}</div>`;
      if (data.vocab.note) {
        html += `<div><strong>批注：</strong>${data.vocab.note}</div>`;
      }
      html += '</div>';
    }
    
    resultsEl.innerHTML = html;
    statsEl.innerHTML = `<p style="color: var(--muted); font-size: 12px;">搜索完成: ${new Date().toLocaleString()}</p>`;
  }
  
  // 渲染名词变格形式
  function renderNounInflections(inflections) {
    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
    
    const numbers = Object.keys(inflections);
    const cases = ['主格', '属格', '与格', '宾格', '工具格', '前置格'];
    
    html += '<tr style="background: rgba(255,255,255,0.1);">';
    html += '<th style="padding: 6px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">格</th>';
    numbers.forEach(num => {
      html += `<th style="padding: 6px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">${num}</th>`;
    });
    html += '</tr>';
    
    cases.forEach(caseName => {
      html += '<tr>';
      html += `<td style="padding: 6px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
      numbers.forEach(num => {
        const value = inflections[num][caseName] || '-';
        html += `<td style="padding: 6px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${value}</td>`;
      });
      html += '</tr>';
    });
    
    html += '</table>';
    return html;
  }
  
  // 渲染动词变格形式
  function renderVerbInflections(inflections) {
    let html = '';
    
    // 不定式
    if (inflections['不定式']) {
      html += `<div style="margin-bottom: 12px;">`;
      html += `<strong style="color: var(--accent);">不定式:</strong> `;
      html += `<span style="color: var(--primary);">${inflections['不定式']}</span>`;
      html += `</div>`;
    }
    
    // 主动语态
    if (inflections['主动语态']) {
      html += `<div style="margin-bottom: 12px;">`;
      html += `<strong style="color: var(--accent);">主动语态</strong>`;
      
      const active = inflections['主动语态'];
      
      // 现在/将来时
      if (active['现在/将来时']) {
        html += `<div style="margin-left: 10px; margin-top: 8px;">`;
        html += `<span style="font-size: 12px; color: var(--secondary); font-weight: bold;">现在/将来时</span>`;
        html += `</div>`;
        html += '<div style="overflow-x: auto; margin-top: 4px;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
        html += '<tr style="background: rgba(255,255,255,0.1);">';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">人称</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">单数</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
        html += '</tr>';
        
        const persons = ['一', '二', '三'];
        const presentFuture = active['现在/将来时'];
        
        // 获取有数据的时态
        const tenses = Object.keys(presentFuture).filter(tense => 
          presentFuture[tense] && 
          (presentFuture[tense]['单数'] || presentFuture[tense]['复数'])
        );
        
        persons.forEach(person => {
          html += '<tr>';
          html += `<td style="padding: 4px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${person}</td>`;
          
          // 合并所有时态的单数和复数数据
          let singValue = '-';
          let plurValue = '-';
          
          for (const tense of tenses) {
            const tenseData = presentFuture[tense];
            if (tenseData && tenseData['单数'] && tenseData['单数'][person]) {
              singValue = tenseData['单数'][person];
            }
            if (tenseData && tenseData['复数'] && tenseData['复数'][person]) {
              plurValue = tenseData['复数'][person];
            }
          }
          
          html += `<td style="padding: 4px; text-align: left; border:1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${singValue}</td>`;
          html += `<td style="padding: 4px; text-align: left; border:1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${plurValue}</td>`;
          html += '</tr>';
        });
        
        html += '</table>';
        html += '</div>';
      }
      
      // 过去时
      if (active['过去时']) {
        html += `<div style="margin-left: 10px; margin-top: 8px;">`;
        html += `<span style="font-size: 12px; color: var(--secondary); font-weight: bold;">过去时</span>`;
        html += `</div>`;
        html += '<div style="overflow-x: auto; margin-top: 4px;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
        html += '<tr style="background: rgba(255,255,255,0.1);">';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">阳性</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">阴性</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">中性</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
        html += '</tr>';
        
        html += '<tr>';
        const past = active['过去时'];
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${past['阳性'] || '-'}</td>`;
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${past['阴性'] || '-'}</td>`;
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${past['中性'] || '-'}</td>`;
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${past['复数'] || '-'}</td>`;
        html += '</tr>';
        
        html += '</table>';
        html += '</div>';
      }
      
      // 副动词
      if (active['副动词']) {
        html += `<div style="margin-left: 10px; margin-top: 8px;">`;
        html += `<span style="font-size: 12px; color: var(--secondary); font-weight: bold;">副动词</span>`;
        html += `</div>`;
        html += `<div style="margin-left: 10px; margin-top: 4px;">`;
        html += `<span style="color: var(--primary); font-size: 14px;">${active['副动词']}</span>`;
        html += `</div>`;
      }
      
      // 命令式
      if (active['命令式']) {
        html += `<div style="margin-left: 10px; margin-top: 8px;">`;
        html += `<span style="font-size: 12px; color: var(--secondary); font-weight: bold;">命令式</span>`;
        html += `</div>`;
        html += '<div style="overflow-x: auto; margin-top: 4px;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
        html += '<tr style="background: rgba(255,255,255,0.1);">';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">单数</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
        html += '</tr>';
        
        html += '<tr>';
        const imperative = active['命令式'];
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${imperative['单数'] || '-'}</td>`;
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${imperative['复数'] || '-'}</td>`;
        html += '</tr>';
        
        html += '</table>';
        html += '</div>';
      }
      
      // 过去时主动形动词
      if (active['过去时主动形动词']) {
        html += `<div style="margin-left: 10px; margin-top: 8px;">`;
        html += `<span style="font-size: 12px; color: var(--secondary); font-weight: bold;">过去时主动形动词</span>`;
        html += `</div>`;
        
        const participle = active['过去时主动形动词'];
        const cases = ['一格', '二格', '三格', '四格', '五格', '六格'];
        const genders = ['阳性', '阴性', '中性'];
        
        html += '<div style="overflow-x: auto; margin-top: 4px;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 10px;">';
        html += '<tr style="background: rgba(255,255,255,0.1);">';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">格</th>';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">阳性</th>';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">阴性</th>';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">中性</th>';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
        html += '</tr>';
        
        cases.forEach(caseName => {
          html += '<tr>';
          html += `<td style="padding: 3px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
          
          const caseData = participle[caseName];
          genders.forEach(gender => {
            const value = caseData ? caseData[gender] || '-' : '-';
            html += `<td style="padding: 3px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${value}</td>`;
          });
          
          const plurValue = caseData ? caseData['复数'] || '-' : '-';
          html += `<td style="padding: 3px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${plurValue}</td>`;
          html += '</tr>';
        });
        
        html += '</table>';
        html += '</div>';
      }
      
      html += `</div>`;
    }
    
    // 被动语态
    if (inflections['被动语态']) {
      html += `<div style="margin-bottom: 12px;">`;
      html += `<strong style="color: var(--accent);">被动语态</strong>`;
      
      const passive = inflections['被动语态'];
      
      // 过去时被动形动词
      if (passive['过去时被动形动词']) {
        html += `<div style="margin-left: 10px; margin-top: 8px;">`;
        html += `<span style="font-size: 12px; color: var(--secondary); font-weight: bold;">过去时被动形动词</span>`;
        html += `</div>`;
        
        const participle = passive['过去时被动形动词'];
        const cases = ['一格', '二格', '三格', '四格', '五格', '六格'];
        const genders = ['阳性', '阴性', '中性'];
        
        html += '<div style="overflow-x: auto; margin-top: 4px;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 10px;">';
        html += '<tr style="background: rgba(255,255,255,0.1);">';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">格</th>';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">阳性</th>';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">阴性</th>';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">中性</th>';
        html += '<th style="padding: 3px; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
        html += '</tr>';
        
        cases.forEach(caseName => {
          html += '<tr>';
          html += `<td style="padding: 3px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
          
          const caseData = participle[caseName];
          genders.forEach(gender => {
            const value = caseData ? caseData[gender] || '-' : '-';
            html += `<td style="padding: 3px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${value}</td>`;
          });
          
          const plurValue = caseData ? caseData['复数'] || '-' : '-';
          html += `<td style="padding: 3px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${plurValue}</td>`;
          html += '</tr>';
        });
        
        html += '</table>';
        html += '</div>';
      }
      
      // 简略形式
      if (passive['简略形式']) {
        html += `<div style="margin-left: 10px; margin-top: 8px;">`;
        html += `<span style="font-size: 12px; color: var(--secondary); font-weight: bold;">简略形式</span>`;
        html += `</div>`;
        html += '<div style="overflow-x: auto; margin-top: 4px;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
        html += '<tr style="background: rgba(255,255,255,0.1);">';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">阳性</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">阴性</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">中性</th>';
        html += '<th style="padding: 4px; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
        html += '</tr>';
        
        html += '<tr>';
        const shortForm = passive['简略形式'];
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${shortForm['阳性'] || '-'}</td>`;
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${shortForm['阴性'] || '-'}</td>`;
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${shortForm['中性'] || '-'}</td>`;
        html += `<td style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${shortForm['复数'] || '-'}</td>`;
        html += '</tr>';
        
        html += '</table>';
        html += '</div>';
      }
      
      html += `</div>`;
    }
    
    return html;
  }
  
  // 渲染形容词变格形式
  function renderAdjectiveInflections(inflections) {
    let html = '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
    
    const numbers = Object.keys(inflections);
    const cases = ['主格', '属格', '与格', '宾格', '工具格', '前置格'];
    
    if (numbers.includes('单数')) {
      const genders = Object.keys(inflections['单数']);
      
      html += '<tr style="background: rgba(255,255,255,0.1);">';
      html += '<th style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">格</th>';
      genders.forEach(gender => {
        html += `<th style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">${gender}</th>`;
      });
      if (numbers.includes('复数')) {
        html += '<th style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
      }
      html += '</tr>';
      
      cases.forEach(caseName => {
        html += '<tr>';
        html += `<td style="padding: 4px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
        genders.forEach(gender => {
          const value = inflections['单数'][gender][caseName] || '-';
          html += `<td style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${value}</td>`;
        });
        if (numbers.includes('复数')) {
          const value = inflections['复数'][caseName] || '-';
          html += `<td style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${value}</td>`;
        }
        html += '</tr>';
      });
    } else if (numbers.includes('复数')) {
      html += '<tr style="background: rgba(255,255,255,0.1);">';
      html += '<th style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">格</th>';
      html += '<th style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
      html += '</tr>';
      
      cases.forEach(caseName => {
        html += '<tr>';
        html += `<td style="padding: 4px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
        const value = inflections['复数'][caseName] || '-';
        html += `<td style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${value}</td>`;
        html += '</tr>';
      });
    }
    
    html += '</table>';
    html += '</div>';
    
    // 短尾形式
    if (inflections['短尾形式']) {
      html += '<div style="margin-top: 12px;">';
      html += '<strong style="font-size: 12px; color: var(--secondary);">短尾形式</strong>';
      html += '<div style="overflow-x: auto; margin-top: 4px;">';
      html += '<table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
      html += '<tr style="background: rgba(255,255,255,0.1);">';
      
      const shortForms = inflections['短尾形式'];
      const shortGenders = Object.keys(shortForms);
      shortGenders.forEach(gender => {
        html += `<th style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">${gender}</th>`;
      });
      html += '</tr>';
      
      html += '<tr>';
      shortGenders.forEach(gender => {
        const value = shortForms[gender] || '-';
        html += `<td style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${value}</td>`;
      });
      html += '</tr>';
      
      html += '</table>';
      html += '</div>';
      html += '</div>';
    }
    
    // 比较级
    if (inflections['比较级']) {
      html += '<div style="margin-top: 12px;">';
      html += '<strong style="font-size: 12px; color: var(--secondary);">比较级</strong>';
      html += `<div style="padding: 4px; margin-top: 4px; color: var(--primary); font-size: 14px;">${inflections['比较级']}</div>`;
      html += '</div>';
    }
    
    return html;
  }
  
  // 渲染通用变格形式
  function renderGenericInflections(inflections) {
    let html = '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">';
    
    const numbers = Object.keys(inflections);
    
    if (numbers.includes('单数') || numbers.includes('复数')) {
      const cases = ['主格', '属格', '与格', '宾格', '工具格', '前置格'];
      
      html += '<tr style="background: rgba(255,255,255,0.1);">';
      html += '<th style="padding: 6px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">格</th>';
      numbers.forEach(num => {
        html += `<th style="padding: 6px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">${num}</th>`;
      });
      html += '</tr>';
      
      cases.forEach(caseName => {
        html += '<tr>';
        html += `<td style="padding: 6px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
        numbers.forEach(num => {
          const value = inflections[num][caseName] || '-';
          html += `<td style="padding: 6px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${value}</td>`;
        });
        html += '</tr>';
      });
    } else {
      const keys = Object.keys(inflections);
      keys.forEach(key => {
        html += '<tr>';
        html += `<td style="padding: 6px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${key}</td>`;
        html += `<td style="padding: 6px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: var(--primary); font-size: 14px;">${inflections[key]}</td>`;
        html += '</tr>';
      });
    }
    
    html += '</table>';
    return html;
  }
  
  // 绑定主要词典模块事件
  if (mainSearchInput && mainSearchBtn) {
    mainSearchBtn.addEventListener('click', () => {
      performSearch(mainSearchInput.value, mainResults, mainStats);
    });
    
    mainSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performSearch(mainSearchInput.value, mainResults, mainStats);
      }
    });
    
    if (mainClearBtn) {
      mainClearBtn.addEventListener('click', () => {
        mainSearchInput.value = '';
        mainResults.innerHTML = '<p style="color: var(--muted);">请输入要搜索的单词或短语</p>';
        mainStats.innerHTML = '';
        mainSearchInput.focus();
      });
    }
  }
  
  // 绑定阅读模式词典模块事件
  if (readingSearchInput && readingSearchBtn) {
    readingSearchBtn.addEventListener('click', () => {
      performSearch(readingSearchInput.value, readingResults, readingStats);
    });
    
    readingSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performSearch(readingSearchInput.value, readingResults, readingStats);
      }
    });
    
    if (readingClearBtn) {
      readingClearBtn.addEventListener('click', () => {
        readingSearchInput.value = '';
        readingResults.innerHTML = '<p style="color: var(--muted);">请输入要搜索的单词或短语</p>';
        readingStats.innerHTML = '';
        readingSearchInput.focus();
      });
    }
  }
}

// 页面加载完成后初始化词典搜索
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDictionarySearch);
} else {
  initDictionarySearch();
}

// 本地文件系统同步功能
let lastScanTime = 0;
const SCAN_INTERVAL = 30000; // 30秒扫描一次

// 扫描本地文件系统变化
const scanLocalFiles = async () => {
  try {
    const response = await fetch('/api/media/scan');
    
    if (!response.ok) {
      console.warn('扫描本地文件失败:', response.status, response.statusText);
      return;
    }
    
    const data = await response.json();
    
    if (data.status === 'success') {
      const now = Date.now();
      
      // 比较扫描结果与当前播放列表
      await syncPlaylistWithFileSystem(data.files, data.folders);
      
      lastScanTime = now;
    }
  } catch (e) {
    console.warn('扫描本地文件失败:', e);
  }
};

// 同步播放列表与文件系统
const syncPlaylistWithFileSystem = async (files, folders) => {
  // 构建当前播放列表中的文件和文件夹映射
  const currentItems = new Map();
  state.playlist.forEach((item, index) => {
    currentItems.set(item.name, { ...item, index });
  });
  
  // 构建文件系统中的文件和文件夹映射
  const fsItems = new Map();
  
  // 添加文件夹
  folders.forEach(folder => {
    fsItems.set(folder, { type: 'folder', path: folder });
  });
  
  // 添加文件
  files.forEach(file => {
    fsItems.set(file.path, { type: 'file', path: file.path, size: file.size, mtime: file.mtime });
  });
  
  // 检查需要添加的项目
  const itemsToAdd = [];
  for (const [path, item] of fsItems) {
    if (!currentItems.has(path)) {
      itemsToAdd.push(item);
    }
  }
  
  // 检查需要删除的项目
  const itemsToRemove = [];
  for (const [name, item] of currentItems) {
    if (!fsItems.has(name) && item.serverPath) {
      itemsToRemove.push(item.index);
    }
  }
  
  // 处理删除操作（从后往前删除，避免索引变化）
  itemsToRemove.sort((a, b) => b - a).forEach(index => {
    if (state.playlist[index]) {
      if (state.playlist[index].url) {
        URL.revokeObjectURL(state.playlist[index].url);
      }
      state.playlist.splice(index, 1);
      
      // 调整当前播放索引
      if (state.currentPlaylistIndex === index) {
        state.currentPlaylistIndex = -1;
        $("#player").src = "";
      } else if (state.currentPlaylistIndex > index) {
        state.currentPlaylistIndex -= 1;
      }
    }
  });
  
  // 处理添加操作
  for (const item of itemsToAdd) {
    if (item.type === 'folder') {
      // 添加文件夹
      state.playlist.push({
        name: item.path,
        url: null,
        file: null,
        type: 'folder',
        serverPath: item.path
      });
    } else if (item.type === 'file') {
      // 添加文件
      // 直接添加文件路径，不在同步时加载文件内容
      // 播放时再通过serverPath请求文件
      state.playlist.push({
        name: item.path,
        url: `/api/media/load/${item.path}`,
        file: null,
        serverPath: item.path
      });
      
      console.log(`文件 ${item.path} 已添加到播放列表`);
    }
  }
  
  // 如果有变化，保存并重新渲染
  if (itemsToAdd.length > 0 || itemsToRemove.length > 0) {
    renderPlaylist();
  }
};

// 启动定期扫描
const startFileScanInterval = () => {
  // 立即执行一次扫描
  scanLocalFiles();
  
  // 设置定期扫描
  setInterval(scanLocalFiles, SCAN_INTERVAL);
};

// 启动文件扫描
startFileScanInterval();

const addToPlaylist = async (files, basePath = '') => {
  for (const file of files) {
    if (file.isDirectory) {
      // 处理文件夹
      const folderName = basePath + file.name + '/';
      
      // 在服务器创建真实文件夹
      try {
        const response = await fetch('/api/playlist/create-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_name: basePath + file.name })
        });
        const data = await response.json();
        
        if (data.status === 'success') {
          // 创建成功后，重新从真实文件夹加载播放列表
          await loadPlaylist();
        } else {
          alert(`创建文件夹失败: ${data.error || '未知错误'}`);
        }
      } catch (e) {
        console.error('创建文件夹失败:', e);
        alert(`创建文件夹失败: ${e.message || '网络错误'}`);
      }
      
      // 递归处理文件夹内容
      if (file.webkitGetAsEntry) {
        const entry = file.webkitGetAsEntry();
        await processDirectoryEntry(entry, folderName);
      }
    } else {
      // 处理文件
      const fileName = basePath + file.name;
      const url = URL.createObjectURL(file);
      let serverPath = null;

      // 先添加到播放列表并渲染，让用户立即看到
      state.playlist.push({
        name: fileName,
        url: url,
        file: file,
        serverPath: null
      });
      
      renderPlaylist();

      // 上传文件到服务器（失败会提示刷新后丢失）
      try {
        const formData = new FormData();
        formData.append('media', file);
        formData.append('path', basePath);
        const response = await fetch('/api/media/upload', {
          method: 'POST',
          body: formData
        });
        // 尝试解析 JSON，失败则回退文本
        let data = null;
        let errText = "";
        try {
          data = await response.json();
        } catch (e) {
          errText = await response.text();
        }

        if (!response.ok || !data || data.status !== 'success') {
          const msg = (data && data.error) || errText || `上传失败 (HTTP ${response.status})`;
          alert(`上传失败，刷新后会丢失：${fileName}\n原因：${msg}`);
          console.warn(`⚠ 上传失败: ${fileName} — ${msg}`);
        } else {
          serverPath = data.filename || fileName;
          console.log(`✓ 文件已上传到服务器: ${fileName}`);
          
          // 更新播放列表中的 serverPath
          const item = state.playlist.find(item => item.name === fileName);
          if (item) {
            item.serverPath = serverPath;
          }
          
          // 上传成功后，重新从真实文件夹加载播放列表
          await loadPlaylist();
        }
      } catch (e) {
        alert(`上传失败，刷新后会丢失：${fileName}`);
        console.error(`✗ 上传失败: ${fileName}`, e);
      }
    }
  }
};

// 处理目录条目
const processDirectoryEntry = async (entry, basePath) => {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader();
    const readEntries = () => {
      reader.readEntries(async (entries) => {
        if (entries.length === 0) {
          resolve();
        } else {
          for (const entry of entries) {
            if (entry.isDirectory) {
              const folderName = basePath + entry.name + '/';
              
              // 在服务器创建真实文件夹
              try {
                const response = await fetch('/api/playlist/create-folder', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ folder_name: basePath + entry.name })
                });
                const data = await response.json();
                
                if (data.status === 'success') {
                  // 创建成功后，重新从真实文件夹加载播放列表
                  await loadPlaylist();
                } else {
                  console.warn(`创建文件夹失败: ${data.error}`);
                }
              } catch (e) {
                console.error('创建文件夹失败:', e);
              }
              
              await processDirectoryEntry(entry, folderName);
            } else {
              await new Promise((resolveFile) => {
                entry.file(async (file) => {
                  const fileName = basePath + file.name;
                  const url = URL.createObjectURL(file);
                  let serverPath = null;

                  // 先添加到播放列表并渲染
                  state.playlist.push({
                    name: fileName,
                    url: url,
                    file: file,
                    serverPath: null
                  });
                  
                  renderPlaylist();

                  // 上传文件到服务器
                  try {
                    const formData = new FormData();
                    formData.append('media', file);
                    formData.append('path', basePath);
                    const response = await fetch('/api/media/upload', {
                      method: 'POST',
                      body: formData
                    });
                    let data = null;
                    try {
                      data = await response.json();
                    } catch (e) {
                      // 忽略解析错误
                    }

                    if (response.ok && data && data.status === 'success') {
                      serverPath = data.filename || fileName;
                      console.log(`✓ 文件已上传到服务器: ${fileName}`);
                      
                      // 上传成功后，重新从真实文件夹加载播放列表
                      await loadPlaylist();
                    }
                  } catch (e) {
                    console.error(`✗ 上传失败: ${fileName}`, e);
                  }

                  resolveFile();
                });
              });
            }
          }
          readEntries();
        }
      }, reject);
    };
    readEntries();
  });
};

const removeFromPlaylist = async (index) => {
  if (state.playlist[index]) {
    // 保存历史状态
    savePlaylistHistory();
    
    const item = state.playlist[index];
    
    try {
      const response = await fetch('/api/media/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.name })
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        URL.revokeObjectURL(item.url);
        state.playlist.splice(index, 1);
        
        if (state.currentPlaylistIndex === index) {
          state.currentPlaylistIndex = -1;
          $("#player").src = "";
        } else if (state.currentPlaylistIndex > index) {
          state.currentPlaylistIndex -= 1;
        }
        
        await loadPlaylist();
      } else {
        alert(`删除失败: ${data.error || '未知错误'}`);
      }
    } catch (e) {
      console.error('删除失败:', e);
      alert(`删除失败: ${e.message || '网络错误'}`);
    }
  }
};

const clearPlaylist = async () => {
  if (confirm("确定要清空播放列表吗？")) {
    try {
      const response = await fetch('/api/media/clear', {
        method: 'POST'
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        state.playlist = [];
        state.currentPlaylistIndex = -1;
        $("#player").src = "";
        state.mediaTitle = "";
        updateMediaName();
        renderPlaylist();
      } else {
        alert(`清空播放列表失败: ${data.error || '未知错误'}`);
      }
    } catch (e) {
      console.error('清空播放列表失败:', e);
      alert(`清空播放列表失败: ${e.message || '网络错误'}`);
    }
  }
};

const reorderPlaylist = (from, to, insertBefore = false) => {
  if (from === to) return;
  if (from < 0 || to < 0) return;
  if (from >= state.playlist.length || to >= state.playlist.length) return;

  // 保存历史状态
  savePlaylistHistory();

  const [moved] = state.playlist.splice(from, 1);
  
  // 根据插入位置调整目标索引
  let targetIndex = to;
  if (insertBefore) {
    // 如果是从后往前拖，插入到目标位置之前
    if (from < to) {
      targetIndex = to - 1;
    }
  } else {
    // 如果是从前往后拖，插入到目标位置之后
    if (from > to) {
      targetIndex = to + 1;
    }
  }
  
  // 确保目标索引在有效范围内
  targetIndex = Math.max(0, Math.min(targetIndex, state.playlist.length));
  
  state.playlist.splice(targetIndex, 0, moved);

  // 调整当前播放索引，保证当前播放项随位置变化
  if (state.currentPlaylistIndex === from) {
    state.currentPlaylistIndex = targetIndex;
  } else if (state.currentPlaylistIndex > from && state.currentPlaylistIndex <= targetIndex) {
    state.currentPlaylistIndex -= 1;
  } else if (state.currentPlaylistIndex < from && state.currentPlaylistIndex >= targetIndex) {
    state.currentPlaylistIndex += 1;
  }

  renderPlaylist();
};

const reorderMultiplePlaylistItems = (indices, to, insertBefore = false) => {
  if (!indices || indices.length === 0) return;
  
  // 保存历史状态
  savePlaylistHistory();
  
  // 排序索引，从大到小处理，避免索引变化
  const sortedIndices = [...indices].sort((a, b) => b - a);
  
  // 提取所有要移动的项目
  const items = sortedIndices.map(idx => state.playlist[idx]);
  
  // 从原位置移除
  sortedIndices.forEach(idx => {
    state.playlist.splice(idx, 1);
  });
  
  // 计算目标索引
  let targetIndex = to;
  if (insertBefore) {
    targetIndex = Math.max(0, to - indices.length);
  }
  
  // 确保目标索引在有效范围内
  targetIndex = Math.max(0, Math.min(targetIndex, state.playlist.length));
  
  // 插入到目标位置
  items.reverse().forEach(item => {
    state.playlist.splice(targetIndex, 0, item);
  });
  
  // 清除选择
  state.selectedPlaylistIndices = [];
  
  renderPlaylist();
};

const playlistItem = async (index) => {
  const item = state.playlist[index];
  if (item) {
    state.currentPlaylistIndex = index;
    state.mediaTitle = item.name;
    updateMediaName();
    updatePlayerMediaMode(guessIsAudio(item.name));
    const player = $("#player");
    
    // 如果有本地 URL，直接使用
    if (item.url) {
      player.src = item.url;
    } else if (item.serverPath) {
      // 否则从服务器加载
      player.src = `/api/media/load/${encodeURIComponent(item.serverPath)}`;
    }
    
    // 手动加载波形图
    if (playerWavesurfer) {
      try {
        await playerWavesurfer.load(player.src);
        logEvent("waveformLoaded", { file: item.name });
      } catch (e) {
        console.error("波形图加载失败:", e);
      }
    }
    
    // 先清空当前字幕
    state.subtitles = [];
    state.currentIndex = -1;
    
    // 尝试自动匹配字幕（优先服务器）
    if (item.file) {
      await autoMatchSubtitles(item.file);
    } else {
      // 服务器恢复的文件没有 file 对象，使用文件名匹配
      await autoMatchSubtitles({ name: item.name });
    }
    
    // 如果还是没有字幕，尝试从 localStorage 加载
    if (state.subtitles.length === 0) {
      loadPersistedSubtitles();
    }
    
    renderSubtitles();
    renderWaveformRegions();
    renderPlaylist();
  }
};



const renderPlaylist = () => {
  const playlistEl = $("#playlist");
  if (!playlistEl) return;
  
  if (state.playlist.length === 0) {
    playlistEl.innerHTML = '<div style="color: var(--muted); padding: 12px; text-align: center;">列表为空 - 批量添加文件开始</div>';
    return;
  }
  
  // 更新播放列表标题，显示长度
  const playlistTitle = document.querySelector("#playlist-title");
  if (playlistTitle) {
    playlistTitle.textContent = `播放列表 (${state.playlist.length})`;
  }
  
  // 构建树形结构
  const treeData = buildPlaylistTree(state.playlist);
  
  // 渲染树形结构
  playlistEl.innerHTML = "";
  renderTreeNode(playlistEl, treeData, "playlist");
  
  // 绑定拖放事件
  bindPlaylistDragDrop(playlistEl);
  
  // 绑定右键菜单事件
  bindPlaylistContextMenu(playlistEl);
};

const buildPlaylistTree = (items) => {
  const tree = { children: [], name: "root", type: "folder" };
  
  // 支持的文件格式
  const audioExts = ["mp3", "wav", "ogg", "flac", "aac", "m4a"];
  const videoExts = ["mp4", "avi", "mkv", "mov", "wmv", "flv"];
  const supportedExts = [...audioExts, ...videoExts];
  
  // 过滤只显示支持的格式
  const filteredItems = items.filter(item => {
    if (item.type === "folder") return true;
    const ext = item.name.split(".").pop().toLowerCase();
    return supportedExts.includes(ext);
  });
  
  // 按名称排序（文件夹在前，文件在后）
  const sortedItems = [...filteredItems].sort((a, b) => {
    const aIsFolder = a.type === "folder";
    const bIsFolder = b.type === "folder";
    
    // 文件夹在前
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    
    // 同类型按名称排序
    const aName = (a.name || "").toLowerCase();
    const bName = (b.name || "").toLowerCase();
    return aName.localeCompare(bName);
  });
  
  sortedItems.forEach((item, idx) => {
    const name = item.name || "";
    const parts = name.split(/[\\/]/).filter(part => part !== "");
    
    if (parts.length === 0) return;
    
    let currentNode = tree;
    let currentPath = "";
    
    parts.forEach((part, partIndex) => {
      const isFile = partIndex === parts.length - 1 && item.type !== "folder";
      
      if (isFile) {
        currentNode.children.push({
          name: part,
          type: "file",
          index: items.indexOf(item),
          item: item
        });
      } else {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        let folderNode = currentNode.children.find(
          child => child.type === "folder" && child.name === part
        );
        
        if (!folderNode) {
          folderNode = {
            name: part,
            type: "folder",
            path: currentPath,
            children: [],
            expanded: state.folderExpandedStates[currentPath] || false
          };
          currentNode.children.push(folderNode);
        }
        
        currentNode = folderNode;
      }
    });
  });
  
  return tree.children;
};

const renderTreeNode = (container, nodes, type, level = 0) => {
  nodes.forEach(node => {
    const nodeEl = createEl("div", "tree-node");
    nodeEl.style.marginLeft = `${level * 16}px`;
    
    const contentEl = createEl("div", "tree-node-content");
    contentEl.draggable = true;
    
    if (node.type === "folder") {
      const toggleEl = createEl("span", `tree-toggle ${node.expanded ? "expanded" : ""}`);
      toggleEl.textContent = "▶";
      toggleEl.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFolder(node, toggleEl, childrenEl);
      });
      
      const dragHandleEl = createEl("span", "tree-drag-handle");
      dragHandleEl.textContent = "⋮⋮";
      dragHandleEl.title = "拖拽排序";
      dragHandleEl.draggable = true;
      
      const iconEl = createEl("span", "tree-node-icon");
      iconEl.textContent = "📁";
      
      const labelEl = createEl("span", "tree-node-label");
      labelEl.textContent = node.name;
      
      const metaEl = createEl("span", "tree-node-meta");
      const fileCount = countFiles(node);
      metaEl.textContent = `(${fileCount})`;
      
      contentEl.appendChild(toggleEl);
      contentEl.appendChild(dragHandleEl);
      contentEl.appendChild(iconEl);
      contentEl.appendChild(labelEl);
      contentEl.appendChild(metaEl);
      
      nodeEl.appendChild(contentEl);
      nodeEl.dataset.folderName = node.name;
      
      // 检查是否需要固定标题栏（子项目数量超过10个）
      const childCount = countFiles(node);
      const needsStickyHeader = childCount > 10;
      
      // 如果需要固定标题栏，创建一个独立的容器
      let childrenEl;
      if (needsStickyHeader) {
        nodeEl.classList.add("sticky-header");
        const stickyContainer = createEl("div", "tree-node-sticky-container");
        stickyContainer.appendChild(contentEl);
        nodeEl.appendChild(stickyContainer);
        
        childrenEl = createEl("div", `tree-node-children ${node.expanded ? "expanded" : "collapsed"} has-sticky-header`);
        renderTreeNode(childrenEl, node.children, type, level + 1);
        nodeEl.appendChild(childrenEl);
      } else {
        nodeEl.appendChild(contentEl);
        
        childrenEl = createEl("div", `tree-node-children ${node.expanded ? "expanded" : "collapsed"}`);
        renderTreeNode(childrenEl, node.children, type, level + 1);
        nodeEl.appendChild(childrenEl);
      }
      
      contentEl.addEventListener("click", () => {
        toggleFolder(node, toggleEl, childrenEl);
      });
    } else {
      const toggleEl = createEl("span", "tree-toggle invisible");
      toggleEl.textContent = "▶";
      
      const dragHandleEl = createEl("span", "tree-drag-handle");
      dragHandleEl.textContent = "⋮⋮";
      dragHandleEl.title = "拖拽排序";
      
      const iconEl = createEl("span", "tree-node-icon");
      iconEl.textContent = getFileIcon(node.name);
      
      const labelEl = createEl("span", "tree-node-label");
      labelEl.textContent = node.name;
      labelEl.title = node.name;
      
      let isActive = false;
      let isSelected = false;
      if (type === "playlist") {
        isActive = node.index === state.currentPlaylistIndex;
        isSelected = state.selectedPlaylistIndices.includes(node.index);
        contentEl.dataset.index = node.index;
      } else if (type === "documents") {
        isActive = node.docId === readingState.currentDocId;
        contentEl.dataset.docId = node.docId;
        
        const metaEl = createEl("span", "tree-node-meta");
        const doc = node.doc;
        metaEl.textContent = `${doc.totalWords || doc.charCount || 0} 词 · ${doc.charCount || 0} 字`;
        contentEl.appendChild(metaEl);
        
        const progressPercent = doc.readProgress?.pagePercent || doc.readProgress?.scrollPercent || 0;
        if (progressPercent > 0) {
          const progressText = createEl("span", "tree-node-meta");
          progressText.textContent = ` · 进度 ${Math.round(progressPercent)}%`;
          contentEl.appendChild(progressText);
          
          const progressBar = createEl("div", "tree-progress-bar");
          progressBar.style.width = `${progressPercent}%`;
          contentEl.appendChild(progressBar);
        }
      }
      
      contentEl.classList.toggle("active", isActive);
      contentEl.classList.toggle("selected", isSelected);
      contentEl.appendChild(toggleEl);
      contentEl.appendChild(dragHandleEl);
      contentEl.appendChild(iconEl);
      contentEl.appendChild(labelEl);
      
      nodeEl.appendChild(contentEl);
      
      contentEl.addEventListener("click", (e) => {
        if (type === "playlist") {
          handlePlaylistItemClick(e, node.index);
        } else if (type === "documents") {
          loadReadingDocument(node.docId);
        }
      });
    }
    
    container.appendChild(nodeEl);
  });
};

const handlePlaylistItemClick = (e, index) => {
  if (e.ctrlKey || e.metaKey) {
    e.stopPropagation();
    
    if (state.selectedPlaylistIndices.includes(index)) {
      state.selectedPlaylistIndices = state.selectedPlaylistIndices.filter(i => i !== index);
    } else {
      state.selectedPlaylistIndices.push(index);
    }
    
    state.lastClickedIndex = index;
    renderPlaylist();
  } else if (e.shiftKey) {
    e.stopPropagation();
    
    const start = Math.min(state.lastClickedIndex, index);
    const end = Math.max(state.lastClickedIndex, index);
    
    state.selectedPlaylistIndices = [];
    for (let i = start; i <= end; i++) {
      if (state.playlist[i]) {
        state.selectedPlaylistIndices.push(i);
      }
    }
    
    state.lastClickedIndex = index;
    renderPlaylist();
  } else {
    state.selectedPlaylistIndices = [];
    state.lastClickedIndex = index;
    playlistItem(index);
  }
};

const toggleFolder = (node, toggleEl, childrenEl) => {
  node.expanded = !node.expanded;
  toggleEl.classList.toggle("expanded", node.expanded);
  childrenEl.classList.toggle("expanded", node.expanded);
  childrenEl.classList.toggle("collapsed", !node.expanded);
  
  // 保存文件夹展开状态
  if (node.path) {
    state.folderExpandedStates[node.path] = node.expanded;
  }
};

const countFiles = (node) => {
  if (node.type === "file") return 1;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
};

const getFileIcon = (filename) => {
  const ext = filename.split(".").pop().toLowerCase();
  const audioExts = ["mp3", "wav", "ogg", "flac", "aac", "m4a"];
  const videoExts = ["mp4", "avi", "mkv", "mov", "wmv", "flv"];
  const docExts = ["pdf", "epub", "txt", "doc", "docx", "md"];
  
  if (audioExts.includes(ext)) return "🎵";
  if (videoExts.includes(ext)) return "🎬";
  if (docExts.includes(ext)) return "📄";
  return "📄";
};

const bindPlaylistDragDrop = (playlistEl) => {
  if (playlistEl.dataset.treeDragBound) return;
  
  // 内部拖拽排序
  playlistEl.addEventListener("dragstart", (e) => {
    const contentEl = e.target.closest(".tree-node-content");
    if (!contentEl) return;
    
    const idx = contentEl?.dataset.index;
    if (idx === undefined || idx === null) return;
    
    // 检查是否有选中的项目
    if (state.selectedPlaylistIndices.length > 0 && state.selectedPlaylistIndices.includes(parseInt(idx))) {
      // 拖拽所有选中的项目
      playlistDragIndices = [...state.selectedPlaylistIndices];
    } else {
      // 只拖拽当前点击的项目
      playlistDragIndices = [parseInt(idx)];
    }
    
    playlistDragIndex = parseInt(idx);
    isPlaylistDragging = true;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.dropEffect = "move";
    
    // 设置拖拽数据（包含所有选中的索引）
    e.dataTransfer.setData("application/x-playlist-drag", JSON.stringify(playlistDragIndices));
    e.dataTransfer.setData("text/plain", idx);
    
    // 为所有拖拽的项目添加样式
    playlistDragIndices.forEach(dragIdx => {
      const dragContentEl = playlistEl.querySelector(`.tree-node-content[data-index="${dragIdx}"]`);
      if (dragContentEl) {
        const dragNodeEl = dragContentEl.closest(".tree-node");
        if (dragNodeEl) {
          dragNodeEl.classList.add("dragging");
        }
      }
    });
    
    playlistEl.classList.add("dragging-active");
  });
  
  // 外部文件/文件夹拖拽导入
  playlistEl.addEventListener("dragover", (e) => {
    // 检查是否是外部文件拖拽
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      playlistEl.classList.add("drag-over-drop");
      return;
    }
    
    // 内部拖拽处理
    if (playlistDragIndices.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    
    // 清除所有拖拽高亮
    playlistEl.querySelectorAll(".drag-over-before").forEach(el => el.classList.remove("drag-over-before"));
    playlistEl.querySelectorAll(".drag-over-after").forEach(el => el.classList.remove("drag-over-after"));
    playlistEl.querySelectorAll(".drag-over-folder").forEach(el => el.classList.remove("drag-over-folder"));
    
    const targetContent = e.target.closest(".tree-node-content");
    const targetNode = e.target.closest(".tree-node");
    
    // 检查是否拖到文件夹上
    if (targetNode && targetNode.dataset.folderName) {
      targetContent.classList.add("drag-over-folder");
      return;
    }
    
    if (targetContent && targetContent.dataset.index !== undefined) {
      const targetIndex = parseInt(targetContent.dataset.index);
      
      // 不允许拖拽到自己身上（单选或多选）
      if (playlistDragIndices.includes(targetIndex)) return;
      
      // 计算鼠标在目标元素上的相对位置
      const rect = targetContent.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const isUpperHalf = relativeY < rect.height / 2;
      
      // 根据位置添加相应的样式类
      if (isUpperHalf) {
        targetContent.classList.add("drag-over-before");
      } else {
        targetContent.classList.add("drag-over-after");
      }
    }
  });
  
  playlistEl.addEventListener("dragenter", (e) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      playlistEl.classList.add("drag-over-drop");
    } else if (playlistDragIndex === null) {
      return;
    } else {
      e.preventDefault();
    }
  });
  
  playlistEl.addEventListener("dragleave", (e) => {
    playlistEl.classList.remove("drag-over-drop");
    playlistEl.querySelectorAll(".drag-over-before").forEach(el => el.classList.remove("drag-over-before"));
    playlistEl.querySelectorAll(".drag-over-after").forEach(el => el.classList.remove("drag-over-after"));
  });
  
  playlistEl.addEventListener("drop", async (e) => {
    // 处理外部文件/文件夹拖拽
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      playlistEl.classList.remove("drag-over-drop");
      
      // 检查是否拖到了文件夹上
      const targetNode = e.target.closest(".tree-node");
      let basePath = "";
      if (targetNode && targetNode.dataset.folderName) {
        basePath = targetNode.dataset.folderName + "/";
      }
      
      // 检查是否包含文件夹
      const items = e.dataTransfer.items;
      const files = [];
      
      // 处理 DataTransferItemList
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            if (entry.isDirectory) {
              // 处理文件夹
              const file = new File([], entry.name);
              file.isDirectory = true;
              file.webkitGetAsEntry = () => entry;
              files.push(file);
            } else {
              // 处理文件
              item.getAsFile((file) => {
                if (file) {
                  files.push(file);
                }
              });
            }
          } else {
            // 回退到普通文件处理
            const file = e.dataTransfer.files[i];
            files.push(file);
          }
        }
      }
      
      // 处理普通文件
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (!files.some(f => f.name === file.name)) {
          files.push(file);
        }
      }
      
      if (files.length > 0) {
        await addToPlaylist(files, basePath);
      }
      return;
    }
    
    // 内部拖拽处理
    if (playlistDragIndices.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sourceIndex = playlistDragIndex;
    const targetContent = e.target.closest(".tree-node-content");
    const targetNode = e.target.closest(".tree-node");
    
    // 检查是否拖到文件夹上
    if (targetNode && targetNode.dataset.folderName) {
      const folderName = targetNode.dataset.folderName;
      
      // 保存历史状态
      savePlaylistHistory();
      
      // 检查是否是多选拖拽
      if (playlistDragIndices.length > 1) {
        // 多选拖拽到文件夹
        for (const idx of playlistDragIndices) {
          const sourceItem = state.playlist[idx];
          if (sourceItem) {
            const sourceName = sourceItem.name;
            
            try {
              const response = await fetch('/api/playlist/move-item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  source_name: sourceName,
                  target_folder: folderName
                })
              });
              const data = await response.json();
              
              if (data.status !== 'success') {
                alert(`移动文件失败: ${data.error || '未知错误'}`);
                break;
              }
            } catch (e) {
              console.error('移动文件失败:', e);
              alert(`移动文件失败: ${e.message || '网络错误'}`);
              break;
            }
          }
        }
        
        // 移动成功后，重新从真实文件夹加载播放列表
        await loadPlaylist();
        
        // 清除所有拖拽高亮
        playlistEl.querySelectorAll(".drag-over-before").forEach(el => el.classList.remove("drag-over-before"));
        playlistEl.querySelectorAll(".drag-over-after").forEach(el => el.classList.remove("drag-over-after"));
        playlistEl.querySelectorAll(".drag-over-folder").forEach(el => el.classList.remove("drag-over-folder"));
        playlistDragIndex = null;
        playlistDragIndices = [];
        isPlaylistDragging = false;
        
        return;
      } else {
        // 单选拖拽到文件夹
        const sourceItem = state.playlist[sourceIndex];
        
        if (sourceItem) {
          // 调用后端API移动文件
          const sourceName = sourceItem.name;
          const oldName = sourceName.replace(/^[^\/]+\//, "");
          
          try {
            const response = await fetch('/api/playlist/move-item', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_name: sourceName,
                target_folder: folderName
              })
            });
            const data = await response.json();
            
            if (data.status === 'success') {
              // 移动成功后，重新从真实文件夹加载播放列表
              await loadPlaylist();
              
              // 清除所有拖拽高亮
              playlistEl.querySelectorAll(".drag-over-before").forEach(el => el.classList.remove("drag-over-before"));
              playlistEl.querySelectorAll(".drag-over-after").forEach(el => el.classList.remove("drag-over-after"));
              playlistEl.querySelectorAll(".drag-over-folder").forEach(el => el.classList.remove("drag-over-folder"));
              playlistDragIndex = null;
              playlistDragIndices = [];
              isPlaylistDragging = false;
              
              return;
            } else {
              alert(`移动文件失败: ${data.error || '未知错误'}`);
            }
          } catch (e) {
            console.error('移动文件失败:', e);
            alert(`移动文件失败: ${e.message || '网络错误'}`);
          }
        }
      }
    }
    
    let targetIndex = state.playlist.length - 1;
    let insertBefore = false;
    
    if (targetContent && targetContent.dataset.index !== undefined) {
      targetIndex = parseInt(targetContent.dataset.index);
      
      // 计算鼠标在目标元素上的相对位置
      const rect = targetContent.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const isUpperHalf = relativeY < rect.height / 2;
      
      // 根据位置确定插入位置
      if (isUpperHalf) {
        insertBefore = true;
      }
    }
    
    // 清除所有拖拽高亮
    playlistEl.querySelectorAll(".drag-over-before").forEach(el => el.classList.remove("drag-over-before"));
    playlistEl.querySelectorAll(".drag-over-after").forEach(el => el.classList.remove("drag-over-after"));
    playlistEl.querySelectorAll(".drag-over-folder").forEach(el => el.classList.remove("drag-over-folder"));
    playlistDragIndex = null;
    playlistDragIndices = [];
    isPlaylistDragging = false;
    
    if (Number.isInteger(sourceIndex) && Number.isInteger(targetIndex)) {
      if (playlistDragIndices.length > 1) {
        // 多选拖拽
        reorderMultiplePlaylistItems(playlistDragIndices, targetIndex, insertBefore);
      } else {
        // 单选拖拽
        reorderPlaylist(sourceIndex, targetIndex, insertBefore);
      }
    }
  });
  
  playlistEl.addEventListener("dragend", (e) => {
    playlistDragIndex = null;
    playlistDragIndices = [];
    isPlaylistDragging = false;
    playlistEl.classList.remove("drag-over-drop");
    playlistEl.classList.remove("dragging-active");
    playlistEl.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
    playlistEl.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    playlistEl.querySelectorAll(".drag-over-folder").forEach(el => el.classList.remove("drag-over-folder"));
  });
  
  playlistEl.dataset.treeDragBound = "1";
};

const bindPlaylistContextMenu = (playlistEl) => {
  if (playlistEl.dataset.contextMenuBound) return;
  
  playlistEl.addEventListener("contextmenu", (e) => {
    const contentEl = e.target.closest(".tree-node-content");
    const nodeEl = e.target.closest(".tree-node");
    
    if (nodeEl) {
      const idx = contentEl?.dataset.index;
      const docId = nodeEl.dataset.docId;
      const folderName = nodeEl.dataset.folderName;
      
      if (idx !== undefined && idx !== null) {
        const index = parseInt(idx);
        const item = state.playlist[index];
        
        if (state.selectedPlaylistIndices.length > 1) {
          showContextMenu(e, "playlist-multi", { index: index });
        } else if (state.selectedPlaylistIndices.length === 1 && state.selectedPlaylistIndices[0] === index) {
          showContextMenu(e, "playlist-file", { index: index });
        } else if (item && item.name && item.name.endsWith("/")) {
          showContextMenu(e, "playlist-folder", { name: item.name.replace(/\/$/, "") });
        } else if (item) {
          showContextMenu(e, "playlist-file", { index: index });
        } else {
          showContextMenu(e, "playlist-root", null);
        }
      } else if (folderName) {
        if (state.selectedPlaylistIndices.length > 1) {
          showContextMenu(e, "playlist-multi", { index: null });
        } else {
          showContextMenu(e, "playlist-folder", { name: folderName });
        }
      } else {
        showContextMenu(e, "playlist-root", null);
      }
    } else {
      showContextMenu(e, "playlist-root", null);
    }
  });
  
  playlistEl.dataset.contextMenuBound = "1";
};

// Context Menu ---------------------------------------------------------------

const showContextMenu = (e, targetType, nodeData) => {
  e.preventDefault();
  e.stopPropagation();
  
  const menu = $("#context-menu");
  if (!menu) return;
  
  state.contextMenu.visible = true;
  state.contextMenu.target = e.target;
  state.contextMenu.targetType = targetType;
  state.contextMenu.nodeData = nodeData;
  
  let menuItems = [];
  
  if (targetType === "playlist-root") {
    menuItems = [
      { icon: "📁", label: "新建文件夹", action: "create-folder" },
      { separator: true },
      { icon: "🗑️", label: "清空列表", action: "clear-playlist", danger: true }
    ];
  } else if (targetType === "playlist-multi") {
    menuItems = [
      { icon: "🗑️", label: `删除选中 (${state.selectedPlaylistIndices.length} 项)`, action: "delete-selected-files", danger: true }
    ];
  } else if (targetType === "playlist-folder") {
    menuItems = [
      { icon: "✏️", label: "重命名", action: "rename-folder" },
      { icon: "🗑️", label: "删除文件夹", action: "delete-folder", danger: true }
    ];
  } else if (targetType === "playlist-file") {
    menuItems = [
      { icon: "🗑️", label: "删除", action: "delete-file", danger: true }
    ];
  } else if (targetType === "documents-root") {
    menuItems = [
      { icon: "📁", label: "新建文件夹", action: "create-folder" },
      { separator: true },
      { icon: "🗑️", label: "清空列表", action: "clear-documents", danger: true }
    ];
  } else if (targetType === "documents-folder") {
    menuItems = [
      { icon: "✏️", label: "重命名", action: "rename-folder" },
      { icon: "🗑️", label: "删除文件夹", action: "delete-folder", danger: true }
    ];
  } else if (targetType === "documents-file") {
    menuItems = [
      { icon: "🗑️", label: "删除", action: "delete-file", danger: true }
    ];
  }
  
  menu.innerHTML = menuItems.map(item => {
    if (item.separator) {
      return '<div class="context-menu-separator"></div>';
    }
    const dangerClass = item.danger ? "danger" : "";
    return `<div class="context-menu-item ${dangerClass}" data-action="${item.action}">
      <span class="context-menu-item-icon">${item.icon}</span>
      <span>${item.label}</span>
    </div>`;
  }).join("");
  
  menu.style.display = "block";
  
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  let x = e.clientX;
  let y = e.clientY;
  
  if (x + menuWidth > windowWidth) {
    x = windowWidth - menuWidth - 8;
  }
  if (y + menuHeight > windowHeight) {
    y = windowHeight - menuHeight - 8;
  }
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  
  menu.querySelectorAll(".context-menu-item").forEach(item => {
    item.addEventListener("click", handleContextMenuAction);
  });
};

const hideContextMenu = () => {
  const menu = $("#context-menu");
  if (menu) {
    menu.style.display = "none";
  }
  state.contextMenu.visible = false;
  state.contextMenu.target = null;
  state.contextMenu.targetType = null;
  state.contextMenu.nodeData = null;
};

const handleContextMenuAction = async (e) => {
  const action = e.currentTarget.dataset.action;
  const targetType = state.contextMenu.targetType;
  const nodeData = state.contextMenu.nodeData;
  
  hideContextMenu();
  
  switch (action) {
    case "create-folder":
      createFolder(targetType);
      break;
    case "rename-folder":
      renameFolder(targetType, nodeData);
      break;
    case "delete-folder":
      deleteFolder(targetType, nodeData);
      break;
    case "delete-file":
      if (targetType === "playlist-file") {
        removeFromPlaylist(nodeData.index);
      } else if (targetType === "documents-file") {
        deleteReadingDocument(nodeData.docId);
      }
      break;
    case "delete-selected-files":
      if (state.selectedPlaylistIndices.length > 0) {
        if (confirm(`确定要删除选中的 ${state.selectedPlaylistIndices.length} 项吗？`)) {
          savePlaylistHistory();
          
          const indices = [...state.selectedPlaylistIndices].sort((a, b) => b - a);
          const itemsToDelete = indices.map(index => state.playlist[index]);
          
          for (const item of itemsToDelete) {
            try {
              const response = await fetch('/api/media/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: item.name })
              });
              const data = await response.json();
              
              if (data.status !== 'success') {
                console.error(`删除 ${item.name} 失败:`, data.error);
              }
            } catch (e) {
              console.error(`删除 ${item.name} 失败:`, e);
            }
          }
          
          for (const index of indices) {
            if (state.playlist[index]) {
              URL.revokeObjectURL(state.playlist[index].url);
              state.playlist.splice(index, 1);
              
              if (state.currentPlaylistIndex === index) {
                state.currentPlaylistIndex = -1;
                $("#player").src = "";
              } else if (state.currentPlaylistIndex > index) {
                state.currentPlaylistIndex -= 1;
              }
            }
          }
          
          state.selectedPlaylistIndices = [];
          await loadPlaylist();
        }
      }
      break;
    case "clear-playlist":
      clearPlaylist();
      break;
    case "clear-documents":
      clearDocuments();
      break;
  }
};

const createFolder = async (targetType) => {
  const folderName = prompt("请输入文件夹名称:", "新建文件夹");
  if (!folderName || !folderName.trim()) return;
  
  const name = folderName.trim();
  
  if (targetType === "playlist-root") {
    try {
      const payload = { folder_name: name };
      console.log("[createFolder] 准备发送的数据:", payload);
      console.log("[createFolder] JSON.stringify 后:", JSON.stringify(payload));
      
      const response = await fetch('/api/playlist/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      
      console.log("[createFolder] 服务器响应:", data);
      
      if (data.status === 'success') {
        // 创建成功后，重新从真实文件夹加载播放列表
        await loadPlaylist();
      } else {
        alert(`创建文件夹失败: ${data.error || '未知错误'}`);
      }
    } catch (e) {
      console.error('创建文件夹失败:', e);
      alert(`创建文件夹失败: ${e.message || '网络错误'}`);
    }
  } else if (targetType === "documents-root") {
    createReadingFolder(name);
  }
};

const renameFolder = async (targetType, nodeData) => {
  const newName = prompt("请输入新的文件夹名称:", nodeData.name);
  if (!newName || !newName.trim()) return;
  
  if (targetType === "playlist-folder") {
    const oldName = nodeData.name;
    const name = newName.trim();
    
    try {
      const response = await fetch('/api/playlist/rename-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_name: oldName,
          new_name: name
        })
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        // 重命名成功后，重新从真实文件夹加载播放列表
        await loadPlaylist();
      } else {
        alert(`重命名文件夹失败: ${data.error || '未知错误'}`);
      }
    } catch (e) {
      console.error('重命名文件夹失败:', e);
      alert(`重命名文件夹失败: ${e.message || '网络错误'}`);
    }
  } else if (targetType === "documents-folder") {
    renameReadingFolder(nodeData.name, newName.trim());
  }
};

const deleteFolder = async (targetType, nodeData) => {
  if (targetType === "playlist-folder") {
    const folderName = nodeData.name;
    const folderPath = folderName + "/";
    const count = state.playlist.filter(item => item.name && item.name.startsWith(folderPath)).length;
    
    if (!confirm(`确定要删除文件夹 "${folderName}" 及其 ${count} 个项目吗？`)) return;
    
    try {
      const response = await fetch('/api/playlist/delete-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_name: folderName })
      });
      const data = await response.json();
      
      if (data.status === 'success') {
        // 删除成功后，重新从真实文件夹加载播放列表
        await loadPlaylist();
      } else {
        alert(`删除文件夹失败: ${data.error || '未知错误'}`);
      }
    } catch (e) {
      console.error('删除文件夹失败:', e);
      alert(`删除文件夹失败: ${e.message || '网络错误'}`);
    }
  } else if (targetType === "documents-folder") {
    deleteReadingFolder(nodeData.name);
  }
};

const clearDocuments = () => {
  if (!confirm("确定要清空所有文档吗？")) return;
  readingState.documents = [];
  readingState.currentDocId = null;
  readingState.text = "";
  $('#reading-content').innerHTML = '<p style="color: var(--muted); text-align: center; padding: 20px;">请从文档列表中选择文档</p>';
  $('#reading-current-file').textContent = '未选择';
  updateReadingProgress();
  localStorage.setItem("readingDocuments", JSON.stringify([]));
  renderReadingDocumentsList();
};

// File loading --------------------------------------------------------------

const loadMediaFile = (file) => {
  const url = URL.createObjectURL(file);
  const player = $("#player");
  player.src = url;
  state.mediaTitle = file.name;
  updateMediaName();
  updatePlayerMediaMode(file.type.startsWith('audio') || guessIsAudio(file.name));
  
  // 手动加载波形图
  if (playerWavesurfer) {
    playerWavesurfer.load(url).then(() => {
      logEvent("waveformLoaded", { file: file.name });
    }).catch(e => {
      console.error("波形图加载失败:", e);
    });
  }
  
  loadPersistedSubtitles();
  renderSubtitles();
  
  // 初始化历史记录
  if (state.subtitles.length > 0) {
    state.history = [JSON.parse(JSON.stringify(state.subtitles))];
    state.historyIndex = 0;
  }
  updateHistoryButtons();
  
  // 加载波形图后会自动触发ready事件，在ready事件中渲染区域
};

const autoMatchSubtitles = async (mediaFile) => {
  const baseName = mediaFile.name.replace(/\.[^.]+$/, '');
  
  // 1. 优先尝试从服务器加载 JSON 字幕文件
  try {
    const response = await fetch(`/api/subtitles/load/${encodeURIComponent(mediaFile.name)}`);
    
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const sizeInMB = parseInt(contentLength) / (1024 * 1024);
      if (sizeInMB > 50) {
        console.warn(`服务器字幕数据过大: ${sizeInMB.toFixed(2)} MB，跳过加载以避免OOM`);
        if (!confirm(`检测到较大的字幕数据（${sizeInMB.toFixed(2)} MB），可能已损坏。是否继续加载？`)) {
          return;
        }
      }
    }
    
    const data = await response.json();
    
    if (data.status === 'success' && data.subtitles && data.subtitles.length > 0) {
      if (data.subtitles.length > 10000) {
        console.warn(`服务器字幕数量异常: ${data.subtitles.length} 条，可能损坏，跳过加载`);
        if (confirm(`检测到异常数量的字幕（${data.subtitles.length} 条），可能已损坏。是否继续加载？`)) {
          state.subtitles = data.subtitles.slice(0, 10000);
        } else {
          return;
        }
      } else {
        state.subtitles = data.subtitles;
      }
      
      const dataSize = JSON.stringify(data.subtitles).length;
      const sizeInMB = dataSize / (1024 * 1024);
      console.log(`✓ 从服务器加载字幕: ${baseName}, ${data.subtitles.length} 条, ${sizeInMB.toFixed(2)} MB`);
      
      state.history = [JSON.parse(JSON.stringify(state.subtitles))];
      state.historyIndex = 0;
      renderSubtitles();
      updateHistoryButtons();
      return;
    }
  } catch (e) {
    console.log('服务器 JSON 字幕不存在或加载失败，尝试扫描 subtitle 文件夹:', e);
  }
  
  // 2. 尝试扫描 subtitle 文件夹中的字幕文件
  try {
    const scanResponse = await fetch(`/api/subtitles/scan?media=${encodeURIComponent(mediaFile.name)}`);
    const scanData = await scanResponse.json();
    
    if (scanData.status === 'success' && scanData.files && scanData.files.length > 0) {
      let subtitleFile = scanData.files[0];
      
      if (scanData.files.length > 1) {
        const jsonFile = scanData.files.find(f => f.format === 'json');
        if (jsonFile) {
          subtitleFile = jsonFile;
        }
      }
      
      console.log(`✓ 找到字幕文件: ${subtitleFile.filename} (${subtitleFile.format})`);
      
      const loadResponse = await fetch(`/api/subtitles/load-file/${encodeURIComponent(subtitleFile.filename)}`);
      const loadData = await loadResponse.json();
      
      if (loadData.status === 'success' && loadData.subtitles && loadData.subtitles.length > 0) {
        state.subtitles = loadData.subtitles;
        
        const dataSize = JSON.stringify(loadData.subtitles).length;
        const sizeInMB = dataSize / (1024 * 1024);
        console.log(`✓ 从 subtitle 文件夹加载字幕: ${baseName}, ${loadData.subtitles.length} 条, ${sizeInMB.toFixed(2)} MB`);
        
        state.history = [JSON.parse(JSON.stringify(state.subtitles))];
        state.historyIndex = 0;
        renderSubtitles();
        updateHistoryButtons();
        return;
      }
    }
  } catch (e) {
    console.log('subtitle 文件夹扫描失败:', e);
  }
  
  // 3. 回退到 localStorage
  const subtitleKey = `lr-${baseName}-subs`;
  const saved = localStorage.getItem(subtitleKey);
  if (saved) {
    try {
      const savedSize = saved.length;
      const sizeInMB = savedSize / (1024 * 1024);
      
      if (sizeInMB > 50) {
        console.warn(`localStorage字幕数据过大: ${sizeInMB.toFixed(2)} MB，可能损坏`);
        if (!confirm(`检测到较大的本地字幕数据（${sizeInMB.toFixed(2)} MB），可能已损坏。是否继续加载？`)) {
          return;
        }
      }
      
      const subs = JSON.parse(saved);
      
      if (!Array.isArray(subs)) {
        console.warn('localStorage字幕数据格式错误：不是数组');
        return;
      }
      
      if (subs.length > 10000) {
        console.warn(`localStorage字幕数量异常: ${subs.length} 条，可能损坏`);
        if (confirm(`检测到异常数量的字幕（${subs.length} 条），可能已损坏。是否继续加载？`)) {
          state.subtitles = subs.slice(0, 10000);
        } else {
          return;
        }
      } else if (subs.length > 0) {
        state.subtitles = subs;
      } else {
        return;
      }
      
      state.history = [JSON.parse(JSON.stringify(state.subtitles))];
      state.historyIndex = 0;
      renderSubtitles();
      updateHistoryButtons();
      console.log(`✓ 从 localStorage 加载字幕: ${baseName}, ${subs.length} 条, ${sizeInMB.toFixed(2)} MB`);
    } catch (e) {
      console.warn('字幕加载失败', e);
      try {
        const cleaned = saved.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        const subs = JSON.parse(cleaned);
        if (Array.isArray(subs) && subs.length > 0) {
          state.subtitles = subs;
          state.history = [JSON.parse(JSON.stringify(subs))];
          state.historyIndex = 0;
          renderSubtitles();
          updateHistoryButtons();
          console.log(`✓ 修复后从 localStorage 加载字幕: ${baseName}`);
          localStorage.setItem(subtitleKey, JSON.stringify(subs));
        }
      } catch (e2) {
        console.error('无法修复损坏的字幕数据:', e2);
        if (confirm("字幕数据损坏无法修复。是否清除此数据？")) {
          localStorage.removeItem(subtitleKey);
        }
      }
    }
  }
};

const parseSrt = (text) => {
  const blocks = text.split(/\n\n+/);
  const subs = [];
  blocks.forEach((block) => {
    const lines = block.trim().split(/\n/);
    if (lines.length >= 2) {
      const timeLine = lines[1];
      const match = timeLine.match(/(\d\d:\d\d:\d\d[,\.]\d\d\d) --> (\d\d:\d\d:\d\d[,\.]\d\d\d)/);
      if (!match) return;
      const toSeconds = (t) => {
        const [h, m, rest] = t.replace(",", ".").split(":");
        const [s, ms] = rest.split(".");
        return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${ms}`);
      };
      const start = toSeconds(match[1]);
      const end = toSeconds(match[2]);
      const en = lines.slice(2).join(" ");
      subs.push({ start, end, en, zh: "", userEn: "", userZh: "", note: "" });
    }
  });
  return subs;
};

const parseLrc = (text) => {
  const subs = [];
  const lines = text.split(/\r?\n/);
  
  lines.forEach((line) => {
    // 匹配LRC格式: [mm:ss.xx] 或 [mm:ss.xxx] 或 [mm:ss]
    const match = line.match(/^\[(\d+):(\d+)(?:\.(\d+))?\](.*)$/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0, 3), 10) : 0;
      const text = match[4].trim();
      
      if (text) {
        const start = minutes * 60 + seconds + milliseconds / 1000;
        // LRC通常只有开始时间，结束时间设为开始时间+5秒（可调整）
        const end = start + 5.0;
        subs.push({ start, end, en: text, zh: "", userEn: "", userZh: "", note: "" });
      }
    }
  });
  
  // 按时间排序
  subs.sort((a, b) => a.start - b.start);
  
  // 调整结束时间：下一句的开始时间或当前句开始+5秒
  for (let i = 0; i < subs.length; i++) {
    if (i < subs.length - 1) {
      subs[i].end = subs[i + 1].start - 0.05; // 留50ms间隔
    } else {
      // 最后一句保持默认5秒
      subs[i].end = subs[i].start + 5.0;
    }
    
    // 确保结束时间大于开始时间
    if (subs[i].end <= subs[i].start) {
      subs[i].end = subs[i].start + 1.0;
    }
  }
  
  return subs;
};

const loadSubtitleFile = async (file) => {
  const text = await file.text();
  let parsed = [];
  
  // 检测文件类型并选择合适的解析器
  const fileName = file.name.toLowerCase();
  
  if (fileName.endsWith('.lrc')) {
    // LRC 格式
    parsed = parseLrc(text);
    if (parsed.length === 0) {
      alert('LRC 文件解析失败或内容为空');
      return;
    }
  } else if (fileName.endsWith('.json')) {
    // JSON 格式
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      alert('JSON 文件解析失败：' + e.message);
      return;
    }
  } else {
    // SRT 或其他文本格式
    parsed = parseSrt(text);
    if (parsed.length === 0) {
      alert('字幕文件解析失败或内容为空');
      return;
    }
  }
  
  state.subtitles = parsed;
  // 初始化历史记录
  state.history = [JSON.parse(JSON.stringify(parsed))];
  state.historyIndex = 0;
  persistSubtitles();
  renderSubtitles();
  renderWaveformRegions(); // 渲染波形图字幕区域
  updateHistoryButtons();
  
  console.log(`✓ 成功导入 ${parsed.length} 条字幕 (${fileName.endsWith('.lrc') ? 'LRC' : fileName.endsWith('.json') ? 'JSON' : 'SRT'} 格式)`);
};

// Rendering -----------------------------------------------------------------

// 渲染波形图上的字幕区域
const renderWaveformRegions = () => {
  if (!playerRegions || !playerWavesurfer) return;
  
  // 清除所有现有区域
  playerRegions.clearRegions();
  
  // 为每个字幕创建区域
  state.subtitles.forEach((sub, idx) => {
    // 为不同的字幕生成不同的颜色
    const hue = (idx * 137.5) % 360; // 黄金角分割
    const color = `hsla(${hue}, 70%, 60%, 0.3)`;
    const borderColor = `hsl(${hue}, 70%, 50%)`;
    
    // 辅助函数：彻底移除HTML标签（递归清理）
    const stripHtml = (html) => {
      if (!html) return '';
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      let text = tmp.textContent || tmp.innerText || '';
      // 如果提取的文本中仍包含HTML标签，再次清理
      if (text.includes('<') && text.includes('>')) {
        tmp.innerHTML = text;
        text = tmp.textContent || tmp.innerText || '';
      }
      return text.trim();
    };
    
    // 获取字幕内容（优先显示用户编辑版本，与字幕列表保持一致）
    const rawText = sub.userEn || sub.en || sub.userZh || sub.zh || `字幕 ${idx + 1}`;
    const plainText = stripHtml(rawText);
    const displayText = plainText.length > 30 ? plainText.substring(0, 30) + '...' : plainText;
    
    // 创建label元素并使用textContent（避免HTML注入）
    const labelDiv = document.createElement('div');
    labelDiv.className = 'region-label';
    labelDiv.style.borderColor = borderColor;
    labelDiv.title = plainText;
    labelDiv.textContent = displayText;
    
    playerRegions.addRegion({
      id: `subtitle-${idx}`,
      start: Math.max(0, sub.start),
      end: Math.min(playerWavesurfer.getDuration(), sub.end),
      color: color,
      drag: true,
      resize: true,
      content: labelDiv,
    });
  });
  
  logEvent('waveformRegionsRendered', { count: state.subtitles.length });
};

// 显示词典查询结果
const showDictionaryResult = (bubble, word, data) => {
  let html = `<div class="bubble-word">${word}</div>`;
  
  const inputWord = data.morphology?.word || '';
  
  if (data.morphology && data.morphology.analyses && data.morphology.analyses.length > 0) {
    html += `<div class="dict-section">
      <strong>📖 词法分析：</strong><br>`;
    
    const analysis = data.morphology.analyses[0];
    
    if (inputWord && inputWord.toLowerCase() !== analysis.normal_form.toLowerCase()) {
      html += `<span style="color: var(--text)">输入词：${inputWord}</span><br>`;
    }
    
    if (analysis.normal_form) {
      html += `<span style="color: var(--accent)">原形：${analysis.normal_form}</span><br>`;
    }
    if (analysis.pos) {
      html += `词性：${translateGrammarLabel('pos', analysis.pos)}<br>`;
    }
    if (analysis.case) html += `格：${translateGrammarLabel('case', analysis.case)} `;
    if (analysis.gender) html += `性：${translateGrammarLabel('gender', analysis.gender)} `;
    if (analysis.number) html += `数：${translateGrammarLabel('number', analysis.number)}<br>`;
    if (analysis.tense) html += `时态：${translateGrammarLabel('tense', analysis.tense)} `;
    if (analysis.person) html += `人称：${translateGrammarLabel('person', analysis.person)} `;
    if (analysis.voice) html += `语态：${translateGrammarLabel('voice', analysis.voice)}<br>`;
    if (analysis.mood) html += `式：${translateGrammarLabel('mood', analysis.mood)} `;
    if (analysis.aspect) html += `体：${translateGrammarLabel('aspect', analysis.aspect)}<br>`;
    html += `</div>`;
  }
  
  // 变格形式
  if (data.inflections && data.inflections.inflections && Object.keys(data.inflections.inflections).length > 0) {
    html += `<div class="dict-section">
      <strong>🔄 变格形式 (${data.inflections.pos || '未知词性'})：</strong><br>`;
    
    const inflections = data.inflections.inflections;
    const pos = data.inflections.pos;
    
    if (pos === 'NOUN') {
      html += renderNounInflectionsCompact(inflections);
    } else if (pos === 'VERB') {
      html += renderVerbInflectionsCompact(inflections);
    } else if (pos === 'ADJF' || pos === 'ADJS') {
      html += renderAdjectiveInflectionsCompact(inflections);
    } else {
      html += renderGenericInflectionsCompact(inflections);
    }
    
    html += `</div>`;
  }
  
  // 词典查询结果
  if (data.dictionary && data.dictionary.length > 0) {
    html += `<div class="dict-section">
      <strong>📚 词典释义：</strong><br>`;
    data.dictionary.forEach(entry => {
      html += `<div style="margin: 8px 0; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">`;
      html += `<strong>${entry.word}</strong>`;
      if (entry.pos) html += ` <span style="color: var(--muted); font-size: 11px;">(${entry.pos})</span>`;
      html += `<br>`;
      if (entry.translation) {
        let translationText = entry.translation;
        translationText = translationText.replace(/\\n/g, '\n');
        const translationLines = translationText.split('\n');
        html += '<div style="line-height: 1.8;">';
        translationLines.forEach((line, lineIndex) => {
          if (line.trim()) {
            const trimmedLine = line.trim();
            if (/^\d+\)/.test(trimmedLine)) {
              html += `<div style="margin-top: 8px;">${trimmedLine}</div>`;
            } else if (/^\s+\S/.test(line)) {
              html += `<div style="margin-left: 20px;">${trimmedLine}</div>`;
            } else {
              html += `<div>${trimmedLine}</div>`;
            }
          }
        });
        html += '</div>';
      }
      if (entry.examples && entry.examples.length > 0) {
        html += `<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">`;
        entry.examples.forEach(ex => html += `• ${ex}<br>`);
        html += `</div>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="dict-section" style="color: var(--muted)">
      暂无词典释义（请导入词库文件）
    </div>`;
  }
  
  // 生词本记录
  if (data.vocab) {
    html += `<div class="dict-section">
      <strong>📝 生词本记录：</strong><br>`;
    if (data.vocab.meaning) html += `释义：${data.vocab.meaning}<br>`;
    if (data.vocab.note) html += `批注：${data.vocab.note}<br>`;
    html += `</div>`;
  }
  
  html += `<div class="bubble-buttons">
    <button class="bubble-back-btn">← 返回</button>
    <button class="bubble-note-btn">📝 添加到生词本</button>
  </div>`;
  
  bubble.innerHTML = html;
  
  // 返回按钮
  const backBtn = bubble.querySelector('.bubble-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bubble.remove();
      window.getSelection().removeAllRanges();
    });
  }
  
  // 添加到生词本按钮
  const noteBtn = bubble.querySelector('.bubble-note-btn');
  if (noteBtn) {
    noteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 获取词法分析的原形作为默认释义
      let defaultMeaning = '';
      if (data.morphology && data.morphology.analyses && data.morphology.analyses.length > 0) {
        const analysis = data.morphology.analyses[0];
        if (analysis.normal_form && analysis.normal_form !== word.toLowerCase()) {
          defaultMeaning = `原形：${analysis.normal_form}`;
        }
      }
      
      // 如果有词典释义，追加
      if (data.dictionary && data.dictionary.length > 0) {
        if (defaultMeaning) defaultMeaning += ' | ';
        defaultMeaning += data.dictionary[0].translation || '';
      }
      
      const vocabItem = data.vocab || { meaning: defaultMeaning, note: '' };
      const subtitleItem = state.subtitles[state.currentIndex] || {};
      showBubbleEditMode(bubble, word, vocabItem, subtitleItem);
    });
  }
};

// 渲染名词变格形式（紧凑版）
const renderNounInflectionsCompact = (inflections) => {
  let html = '<div style="overflow-x: auto;">';
  html += '<table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
  
  const numbers = Object.keys(inflections);
  const cases = ['主格', '属格', '与格', '宾格', '工具格', '前置格'];
  
  html += '<tr style="background: rgba(255,255,255,0.1);">';
  html += '<th style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">格</th>';
  numbers.forEach(num => {
    html += `<th style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">${num}</th>`;
  });
  html += '</tr>';
  
  cases.forEach(caseName => {
    html += '<tr>';
    html += `<td style="padding: 4px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
    numbers.forEach(num => {
      const value = inflections[num][caseName] || '-';
      html += `<td style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${value}</td>`;
    });
    html += '</tr>';
  });
  
  html += '</table>';
  html += '</div>';
  
  // 短尾形式
  if (inflections['短尾形式']) {
    html += '<div style="margin-top: 8px;">';
    html += '<strong style="font-size: 10px; color: var(--secondary);">短尾形式</strong>';
    html += '<div style="overflow-x: auto; margin-top: 4px;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 10px;">';
    html += '<tr style="background: rgba(255,255,255,0.1);">';
    
    const shortForms = inflections['短尾形式'];
    const shortGenders = Object.keys(shortForms);
    shortGenders.forEach(gender => {
      html += `<th style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">${gender}</th>`;
    });
    html += '</tr>';
    
    html += '<tr>';
    shortGenders.forEach(gender => {
      const value = shortForms[gender] || '-';
      html += `<td style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${value}</td>`;
    });
    html += '</tr>';
    
    html += '</table>';
    html += '</div>';
    html += '</div>';
  }
  
  // 比较级
  if (inflections['比较级']) {
    html += '<div style="margin-top: 8px;">';
    html += '<strong style="font-size: 10px; color: var(--secondary);">比较级</strong>';
    html += `<div style="padding: 2px; margin-top: 4px; color: var(--primary); font-size: 10px;">${inflections['比较级']}</div>`;
    html += '</div>';
  }
  
  return html;
};

// 渲染动词变格形式（紧凑版）
const renderVerbInflectionsCompact = (inflections) => {
  let html = '';
  
  const moods = Object.keys(inflections);
  
  moods.forEach(mood => {
    html += `<div style="margin-bottom: 8px;">`;
    html += `<strong style="color: var(--accent); font-size: 11px;">${mood}</strong>`;
    
    if (mood === '陈述式') {
      const tenses = Object.keys(inflections[mood]);
      tenses.forEach(tense => {
        html += `<div style="margin-left: 8px; margin-top: 4px;">`;
        html += `<span style="font-size: 10px; color: var(--secondary);">${tense}</span>`;
        html += '<div style="overflow-x: auto;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 10px;">';
        html += '<tr style="background: rgba(255,255,255,0.1);">';
        html += '<th style="padding: 2px; border: 1px solid rgba(255,255,255,0.2);">人称</th>';
        html += '<th style="padding: 2px; border: 1px solid rgba(255,255,255,0.2);">单数</th>';
        html += '<th style="padding: 2px; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
        html += '</tr>';
        
        const persons = ['一', '二', '三'];
        persons.forEach(person => {
          html += '<tr>';
          html += `<td style="padding: 2px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${person}</td>`;
          const singValue = inflections[mood][tense]['单数'] ? inflections[mood][tense]['单数'][person] || '-' : '-';
          const plurValue = inflections[mood][tense]['复数'] ? inflections[mood][tense]['复数'][person] || '-' : '-';
          html += `<td style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${singValue}</td>`;
          html += `<td style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${plurValue}</td>`;
          html += '</tr>';
        });
        
        html += '</table>';
        html += '</div>';
        html += `</div>`;
      });
    } else if (mood === '命令式') {
      html += '<div style="overflow-x: auto;">';
      html += '<table style="width: 100%; border-collapse: collapse; font-size: 10px;">';
      html += '<tr style="background: rgba(255,255,255,0.1);">';
      html += '<th style="padding: 2px; border: 1px solid rgba(255,255,255,0.2);">数</th>';
      html += '<th style="padding: 2px; border: 1px solid rgba(255,255,255,0.2);">形式</th>';
      html += '</tr>';
      
      const numbers = Object.keys(inflections[mood]['命令式']);
      numbers.forEach(num => {
        html += '<tr>';
        html += `<td style="padding: 2px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${num}</td>`;
        html += `<td style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${inflections[mood]['命令式'][num]}</td>`;
        html += '</tr>';
      });
      
      html += '</table>';
      html += '</div>';
    }
    
    html += `</div>`;
  });
  
  return html;
};

// 渲染形容词变格形式（紧凑版）
const renderAdjectiveInflectionsCompact = (inflections) => {
  let html = '<div style="overflow-x: auto;">';
  html += '<table style="width: 100%; border-collapse: collapse; font-size: 10px;">';
  
  const numbers = Object.keys(inflections);
  const cases = ['主格', '属格', '与格', '宾格', '工具格', '前置格'];
  
  if (numbers.includes('单数')) {
    const genders = Object.keys(inflections['单数']);
    
    html += '<tr style="background: rgba(255,255,255,0.1);">';
    html += '<th style="padding: 2px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">格</th>';
    genders.forEach(gender => {
      html += `<th style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">${gender}</th>`;
    });
    if (numbers.includes('复数')) {
      html += '<th style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
    }
    html += '</tr>';
    
    cases.forEach(caseName => {
      html += '<tr>';
      html += `<td style="padding: 2px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
      genders.forEach(gender => {
        const value = inflections['单数'][gender][caseName] || '-';
        html += `<td style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${value}</td>`;
      });
      if (numbers.includes('复数')) {
        const value = inflections['复数'][caseName] || '-';
        html += `<td style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${value}</td>`;
      }
      html += '</tr>';
    });
  } else if (numbers.includes('复数')) {
    html += '<tr style="background: rgba(255,255,255,0.1);">';
    html += '<th style="padding: 2px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">格</th>';
    html += '<th style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">复数</th>';
    html += '</tr>';
    
    cases.forEach(caseName => {
      html += '<tr>';
      html += `<td style="padding: 2px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
      const value = inflections['复数'][caseName] || '-';
      html += `<td style="padding: 2px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${value}</td>`;
      html += '</tr>';
    });
  }
  
  html += '</table>';
  html += '</div>';
  return html;
};

// 渲染通用变格形式（紧凑版）
const renderGenericInflectionsCompact = (inflections) => {
  let html = '<div style="overflow-x: auto;">';
  html += '<table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
  
  const numbers = Object.keys(inflections);
  
  if (numbers.includes('单数') || numbers.includes('复数')) {
    const cases = ['主格', '属格', '与格', '宾格', '工具格', '前置格'];
    
    html += '<tr style="background: rgba(255,255,255,0.1);">';
    html += '<th style="padding: 4px; text-align: left; border: 1px solid rgba(255,255,255,0.2);">格</th>';
    numbers.forEach(num => {
      html += `<th style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2);">${num}</th>`;
    });
    html += '</tr>';
    
    cases.forEach(caseName => {
      html += '<tr>';
      html += `<td style="padding: 4px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${caseName}</td>`;
      numbers.forEach(num => {
        const value = inflections[num][caseName] || '-';
        html += `<td style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${value}</td>`;
      });
      html += '</tr>';
    });
  } else {
    const keys = Object.keys(inflections);
    keys.forEach(key => {
      html += '<tr>';
      html += `<td style="padding: 4px; font-weight: bold; border: 1px solid rgba(255,255,255,0.2);">${key}</td>`;
      html += `<td style="padding: 4px; text-align: center; border: 1px solid rgba(255,255,255,0.2); color: var(--primary);">${inflections[key]}</td>`;
      html += '</tr>';
    });
  }
  
  html += '</table>';
  html += '</div>';
  return html;
};

// 气泡编辑模式
const showBubbleEditMode = (bubble, word, vocabItem, subtitleItem) => {
  // 替换气泡内容为编辑表单
  bubble.innerHTML = `
    <div class="bubble-word">${word}</div>
    <div class="bubble-edit-form">
      <div class="bubble-form-group">
        <label>释义：</label>
        <input type="text" class="bubble-input" id="bubble-meaning" placeholder="输入释义..." value="${vocabItem?.meaning || ''}" />
      </div>
      <div class="bubble-form-group">
        <label>批注：</label>
        <textarea class="bubble-textarea" id="bubble-note" placeholder="输入批注（Shift+回车换行）..." rows="2">${vocabItem?.note || ''}</textarea>
      </div>
      <div class="bubble-buttons">
        <button class="bubble-cancel-btn">✖ 取消</button>
        <button class="bubble-save-btn">💾 保存</button>
      </div>
    </div>
  `;
  
  // 保存功能
  const performSave = () => {
    const meaning = bubble.querySelector('#bubble-meaning').value.trim();
    const note = bubble.querySelector('#bubble-note').value.trim();
    
    // 查找或创建词汇
    let vocabIdx = state.vocab.findIndex(v => v.word.toLowerCase() === word.toLowerCase());
    
    if (vocabIdx >= 0) {
      // 更新已存在的词汇
      state.vocab[vocabIdx].meaning = meaning;
      state.vocab[vocabIdx].note = note;
      
      // 在合并模式中，如果该词汇还没有source标记为来自多个来源，需要检查
      if (state.settings.commonDefaultVocab && !state.vocab[vocabIdx].sourceMultiple) {
        // 检查是否在其他生词本中也存在
        // 通常在合并模式下，同一个词可能来自听力和阅读
        // 这里只需要确保source字段存在
        if (!state.vocab[vocabIdx].source) {
          state.vocab[vocabIdx].source = 'listening';
        }
      }
    } else {
      // 添加新词汇，标注来源为"听力"
      const newWord = {
        word: word,
        meaning: meaning,
        note: note,
        sentence: `${subtitleItem.userEn || subtitleItem.en || ''} | ${subtitleItem.userZh || subtitleItem.zh || ''}`,
        source: 'listening'  // 标注为听力模块添加
      };
      
      // 在合并模式中检查其他生词本是否已存在该词
      if (state.settings.commonDefaultVocab) {
        // 检查读力模块的生词本是否有该词
        const readingDefault = state.vocabBooks.find(v => v.name === "默认生词本（阅读）");
        if (readingDefault) {
          const existsInReading = readingDefault.words.find(w => w.word.toLowerCase() === word.toLowerCase());
          if (existsInReading) {
            // 如果在阅读生词本中也存在，标记为多来源
            newWord.sourceMultiple = 'listening,reading';
            newWord.source = 'listening'; // 默认source为此时添加的来源
          }
        }
      }
      
      state.vocab.push(newWord);
    }
    
    persistVocab();
    renderVocab();
    renderVocabBookSelector(); // 更新生词本计数
    renderSubtitles(); // 重新渲染以显示/更新下划线
    
    // 关闭气泡
    bubble.remove();
    window.getSelection().removeAllRanges();
  };
  
  // 自动聚焦到释义输入框
  setTimeout(() => {
    const meaningInput = bubble.querySelector('#bubble-meaning');
    if (meaningInput) {
      meaningInput.focus();
      
      // 释义输入框：回车保存
      meaningInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          performSave();
        }
      });
    }
    
    // 批注文本框：Shift+回车换行，回车保存
    const noteInput = bubble.querySelector('#bubble-note');
    if (noteInput) {
      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.shiftKey) {
            // Shift+回车：换行，不保存
            return;
          } else {
            // 回车：保存
            e.preventDefault();
            performSave();
          }
        }
      });
    }
  }, 0);
  
  // 保存按钮
  const saveBtn = bubble.querySelector('.bubble-save-btn');
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    performSave();
  }, true);
  
  // 取消按钮
  const cancelBtn = bubble.querySelector('.bubble-cancel-btn');
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    bubble.remove();
    window.getSelection().removeAllRanges();
  }, true);
};

const renderSubtitles = () => {
  const list = $("#subtitle-list");
  list.innerHTML = "";
  state.subtitles.forEach((item, idx) => {
    const row = createEl("div", "subtitle-row");
    if (idx === state.currentIndex) row.classList.add("active");
    row.dataset.index = idx;

    // 点击整行选中该字幕（不自动播放）
    row.addEventListener('click', (e) => {
      // 如果用户正在“划词/选择文本”，不要触发行点击（否则会重新渲染导致选区丢失）
      try {
        const selected = window.getSelection?.()?.toString?.().trim?.() || "";
        if (selected) return;
      } catch (_) {}

      state.currentIndex = idx;
      renderSubtitles();
      renderEditors?.();
      renderWaveformRegions();
      updateHistoryButtons();
    });

    // 序号
    const idxLabel = createEl("div", "subtitle-idx");
    idxLabel.textContent = idx + 1;

    // 添加播放按钮区域
    const playButton = createEl("div", "play-btn");
    playButton.innerHTML = '▶';
    playButton.title = "播放此字幕";
    playButton.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToSubtitle(idx, false, true); // 播放按钮强制播放当前句
    });

    const time = createEl("div", "time");
    time.innerHTML = `<div>${formatTime(item.start)}</div><div>${formatTime(item.end)}</div>`;

    const text = createEl("div", "text");
    
    // 高亮生词本中的词汇
    let enText = item.userEn || item.en || "(空)";
    let zhText = item.userZh || item.zh || "";
    
    // 为生词本中的词汇添加高亮标记
    if (state.vocab && state.vocab.length > 0) {
      state.vocab.forEach(vocabItem => {
        const word = vocabItem.word;
        if (!word) return;
        
        // 转义特殊字符
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // 使用 Unicode 边界匹配，支持俄语等非 ASCII 字符
        const regex = new RegExp(`(?<=^|\\s|[^\\p{L}])(${escapedWord})(?=$|\\s|[^\\p{L}])`, 'giu');
        
        enText = enText.replace(regex, (match) => {
          return `<span class="vocab-highlight" data-word="${word.toLowerCase()}">${match}</span>`;
        });
      });
    }
    
    text.innerHTML = `<strong>${enText}</strong><br>${zhText}`;

    // 文本区域的点击/拖拽主要用于划词，不应触发行点击导致重渲染
    text.addEventListener('mousedown', (e) => {
      // 允许选区正常建立，但阻止冒泡到 row 的 click 链路
      e.stopPropagation();
    }, false);
    text.addEventListener('click', (e) => {
      // 如果这是一次文本选择后的 click（常见于 mouseup 后），阻止行点击
      try {
        const selected = window.getSelection?.()?.toString?.().trim?.() || "";
        if (selected) e.stopPropagation();
      } catch (_) {}
    }, false);
    
    // 为高亮词汇添加悬停气泡
    const highlights = text.querySelectorAll('.vocab-highlight');
    
    highlights.forEach(span => {
      const word = span.dataset.word;
      const vocabItem = state.vocab.find(v => v.word.toLowerCase() === word);
      
      if (vocabItem) {
        span.addEventListener('mouseenter', (e) => {
          // 移除已存在的悬停气泡
          document.querySelectorAll('.vocab-hover-bubble').forEach(b => b.remove());
          
          // 创建悬停气泡
          const hoverBubble = createEl("div", "vocab-hover-bubble");
          hoverBubble.innerHTML = `
            <div class="bubble-word">${vocabItem.word}</div>
            ${vocabItem.meaning ? `<div class="bubble-meaning">${vocabItem.meaning}</div>` : ''}
            ${vocabItem.note ? `<div class="bubble-note"><strong>批注：</strong>${vocabItem.note}</div>` : ''}
            <div class="bubble-buttons">
              <button class="bubble-edit-btn">📝 编辑</button>
            </div>
          `;
          
          document.body.appendChild(hoverBubble);
          
          // 添加编辑按钮的点击事件
          const editBtn = hoverBubble.querySelector('.bubble-edit-btn');
          if (editBtn) {
            editBtn.addEventListener('click', (evt) => {
              evt.stopPropagation();
              evt.preventDefault();
              
              // 查找该词的索引
              const vocabIdx = state.vocab.findIndex(v => v.word.toLowerCase() === word);
              if (vocabIdx >= 0) {
                // 使用气泡编辑模式
                const currentSubtitle = state.subtitles[state.currentIndex];
                showBubbleEditMode(hoverBubble, vocabItem.word, state.vocab[vocabIdx], currentSubtitle);
              }
            }, true);
          }
          
          // 定位气泡
          const rect = span.getBoundingClientRect();
          let left = rect.left + window.scrollX + rect.width / 2 - hoverBubble.offsetWidth / 2;
          let top = rect.top + window.scrollY - hoverBubble.offsetHeight;
          
          const minLeft = 10;
          const maxLeft = window.innerWidth - hoverBubble.offsetWidth - 10;
          left = Math.max(minLeft, Math.min(left, maxLeft));
          
          if (top < 10) {
            top = rect.bottom + window.scrollY;
          }
          
          hoverBubble.style.left = left + 'px';
          hoverBubble.style.top = top + 'px';
          
          // 让气泡自己也能处理鼠标离开事件
          hoverBubble.addEventListener('mouseleave', () => {
            setTimeout(() => {
              if (!span.matches(':hover')) {
                hoverBubble.remove();
              }
            }, 100);
          });
        });
        
        span.addEventListener('mouseleave', () => {
          setTimeout(() => {
            const hoverBubble = document.querySelector('.vocab-hover-bubble');
            if (hoverBubble && !hoverBubble.matches(':hover')) {
              hoverBubble.remove();
            }
          }, 100);
        });
      }
    });
    
    // 为文本添加划词功能
    text.addEventListener('mouseup', (e) => {
      // 添加短延迟确保选择已完成
      setTimeout(() => {
        const selection = window.getSelection().toString().trim();
        if (!selection || selection.length === 0) return;
        
        // 检查选择是否在这个文本元素内
        try {
          const range = window.getSelection().getRangeAt(0);
          if (!text.contains(range.commonAncestorContainer)) return;
        } catch (e) {
          return;
        }
        
        // 移除已存在的气泡框
        document.querySelectorAll('.vocab-bubble').forEach(b => b.remove());
        
        // 获取选中词在生词本中的信息
        const vocabItem = state.vocab.find(v => v.word.toLowerCase() === selection.toLowerCase());
        
        // 创建气泡框
        const bubble = createEl("div", "vocab-bubble");
        bubble.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div class="bubble-word">${selection}</div>
            <button class="bubble-lookup-btn" style="background: none; border: none; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 3px; transition: background 0.2s;">
              🔍
            </button>
          </div>
          ${vocabItem ? `<div class="bubble-meaning">${vocabItem.meaning || '未设置释义'}</div>` : ''}
          ${vocabItem && vocabItem.note ? `<div class="bubble-note"><strong>批注：</strong>${vocabItem.note}</div>` : ''}
          <div class="bubble-buttons">
            <button class="bubble-note-btn">📝 添加释义和批注</button>
          </div>
        `;
        
        // 查词典功能
        const lookupBtn = bubble.querySelector('.bubble-lookup-btn');
        if (lookupBtn) {
          lookupBtn.addEventListener('click', async (evt) => {
            evt.stopPropagation();
            evt.preventDefault();
            
            // 跳转到词典模块并搜索
            bubble.remove();
            window.getSelection().removeAllRanges();
            
            // 确保词典模块展开
            const dictionaryBody = document.getElementById('dictionary-body');
            if (dictionaryBody) {
              dictionaryBody.style.display = 'block';
            }
            
            // 在词典搜索框中填入单词
            const searchInput = document.getElementById('dictionary-search-input');
            if (searchInput) {
              searchInput.value = selection;
              searchInput.focus();
              
              // 触发搜索
              const searchBtn = document.getElementById('btn-dictionary-search');
              if (searchBtn) {
                searchBtn.click();
              }
            }
            
            // 滚动到词典模块
            const dictionarySection = document.querySelector('#dictionary-body').closest('.collapsible');
            if (dictionarySection) {
              dictionarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, true);
        }
        
        // 编辑/添加功能
        const noteBtn = bubble.querySelector('.bubble-note-btn');
        if (noteBtn) {
          noteBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            evt.preventDefault();
            
            // 切换到编辑模式
            showBubbleEditMode(bubble, selection, vocabItem, item);
          }, true);
        }
        
        // 定位气泡框
        try {
          const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
          document.body.appendChild(bubble);
          
          // 计算位置（在选中文本上方）
          let left = rect.left + window.scrollX + rect.width / 2 - bubble.offsetWidth / 2;
          let top = rect.top + window.scrollY - bubble.offsetHeight - 3;
          
          // 防止气泡框超出边界
          const minLeft = 10;
          const maxLeft = window.innerWidth - bubble.offsetWidth - 10;
          left = Math.max(minLeft, Math.min(left, maxLeft));
          
          if (top < 10) {
            // 如果上方空间不足，放在下方
            top = rect.bottom + window.scrollY + 3;
          }
          
          bubble.style.left = left + 'px';
          bubble.style.top = top + 'px';
        } catch (e) {
          console.error('气泡框定位失败:', e);
          return;
        }
        
        // 点击其他地方关闭气泡框（防止事件冒泡干扰）
        const closeHandler = (e) => {
          if (e.target === bubble || bubble.contains(e.target)) return;
          bubble.remove();
          document.removeEventListener('click', closeHandler, true);
        };
        // 使用 capture 阶段确保优先捕获
        document.addEventListener('click', closeHandler, true);
      }, 50); // 50ms 延迟确保选择完成
    }, false);

    const note = createEl("div", "note");
    note.textContent = item.note;

    // include row index before controls for easier scanning
    row.append(idxLabel, playButton, time, text, note);
    // 取消整个行的点击事件，只保留播放按钮的功能
    row.style.cursor = "default";
    list.appendChild(row);
  });
  
  // 自动滚动：让当前句显示在第二行，保留上一句在第一行
  if (state.currentIndex >= 0) {
    // 使用 setTimeout 确保 DOM 完全渲染后再滚动
    setTimeout(() => {
      const activeRow = list.querySelector(`[data-index="${state.currentIndex}"]`);
      if (!activeRow) return;
      
      if (state.currentIndex === 0) {
        // 第一句：滚动到顶部
        list.scrollTop = 0;
      } else {
        // 其他句子：让上一句显示在顶部，当前句在第二行
        const prevRow = list.querySelector(`[data-index="${state.currentIndex - 1}"]`);
        if (prevRow) {
          // 获取容器和上一句的位置
          const listRect = list.getBoundingClientRect();
          const prevRect = prevRow.getBoundingClientRect();
          
          // 计算需要滚动的距离：上一句顶部到容器顶部的距离
          const scrollOffset = prevRect.top - listRect.top;
          list.scrollTop += scrollOffset;
        }
      }
    }, 0);
  }
};

const renderEditors = () => {
  const current = state.subtitles[state.currentIndex];
  if (!current) {
    // 未选择字幕时清空输入框
    $("#edit-en").value = "";
    $("#edit-zh").value = "";
    $("#edit-note").value = "";
    
    // 立即调整文本框高度
    autoResizeTextarea($("#edit-en"));
    autoResizeTextarea($("#edit-zh"));
    autoResizeTextarea($("#edit-note"));
    return;
  }
  $("#edit-en").value = current.userEn || current.en || "";
  $("#edit-zh").value = current.userZh || current.zh || "";
  $("#edit-note").value = current.note || "";
  
  // 立即调整文本框高度
  autoResizeTextarea($("#edit-en"));
  autoResizeTextarea($("#edit-zh"));
  autoResizeTextarea($("#edit-note"));
};

const renderVocab = () => {
  const container = $("#vocab-list");
  container.innerHTML = "";
  // 反向遍历数组，使最新添加的词显示在最前面
  const reversedVocab = [...state.vocab].reverse();
  reversedVocab.forEach((item, reversedIdx) => {
    // 映射回原始数组的索引
    const idx = state.vocab.length - 1 - reversedIdx;
    const row = createEl("div", "vocab-item");
    
    // 创建词条内容容器
    const contentWrapper = createEl("div", "vocab-content");
    // 当处于合并模式时，显示来源标注（便于用户区分词汇来源）
    const sourceTag = state.settings.commonDefaultVocab && item.source ? 
      `<span style="font-size: 10px; color: #999; margin-left: 8px; padding: 2px 6px; background: rgba(255,255,255,0.1); border-radius: 3px;">${item.source === 'listening' ? '听力' : '阅读'}</span>` : '';
    
    contentWrapper.innerHTML = `
      <div class="vocab-word"><strong>${item.word}</strong>${sourceTag}</div>
      <div class="vocab-meaning-wrapper">
        <label>释义：</label>
        <div class="vocab-meaning" contenteditable="true" data-idx="${idx}" class="vocab-meaning-edit">${item.meaning || ""}</div>
      </div>
      <div class="vocab-note-wrapper">
        <label>批注：</label>
        <div class="vocab-note" contenteditable="true" data-idx="${idx}" data-type="note" class="vocab-note-edit">${item.note || ""}</div>
      </div>
      <div class="vocab-sentence-wrapper">
        <label>例句：</label>
        <small contenteditable="true" data-idx="${idx}" data-type="sentence" class="vocab-sentence-edit">${item.sentence || ""}</small>
      </div>
    `;
    row.appendChild(contentWrapper);
    
    // 创建删除按钮，放在右上角
    const del = createEl("button", "vocab-delete-btn");
    del.title = "删除词条";
    del.innerHTML = "🗑️";
    del.onclick = () => {
      state.vocab.splice(idx, 1);
      persistVocab();
      renderVocab();
      renderVocabBookSelector(); // 更新生词本计数
      renderSubtitles(); // 重新渲染字幕以移除下划线
    };
    row.appendChild(del);
    
    container.appendChild(row);
  });
  
  // 释义编辑
  container.querySelectorAll('.vocab-meaning-edit').forEach(el => {
    el.addEventListener('blur', (e) => {
      const idx = Number(e.target.dataset.idx);
      state.vocab[idx].meaning = e.target.textContent;
      persistVocab();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      }
    });
  });
  
  // 批注编辑
  container.querySelectorAll('.vocab-note-edit').forEach(el => {
    el.addEventListener('blur', (e) => {
      const idx = Number(e.target.dataset.idx);
      state.vocab[idx].note = e.target.textContent;
      persistVocab();
    });
  });
  
  // 例句编辑
  container.querySelectorAll('.vocab-sentence-edit').forEach(el => {
    el.addEventListener('blur', (e) => {
      const idx = Number(e.target.dataset.idx);
      state.vocab[idx].sentence = e.target.textContent;
      persistVocab();
    });
  });
};

// Player logic --------------------------------------------------------------


const jumpToSubtitle = (idx, pause = false, forcePlay = false) => {
  const player = $("#player");
  const sub = state.subtitles[idx];
  if (!sub) return;
  state.currentIndex = idx;
  player.currentTime = sub.start + 0.02;
  lastPauseIndex = -1; // 切换句子时重置暂停标记
  boundaryTriggeredIndex = -1; // 允许新句再次触发边界逻辑
  // 初始化本句循环剩余次数
  if (state.loop) {
    state.loopRemaining = state.loopCount;
  }
  // 自动播放逻辑：forcePlay 优先级最高，其次 pause/autoPause；autoPlay 仅由调用方通过 forcePlay 传入
  if (forcePlay) {
    player.play();
  } else if (pause || state.autoPause) {
    player.pause();
  }
  logEvent("jumpToSubtitle", {
    idx,
    pause,
    forcePlay,
    start: sub.start,
    end: sub.end,
    loop: state.loop,
    loopCount: state.loopCount,
    loopRemaining: state.loopRemaining,
    autoPause: state.autoPause,
    autoPlay: state.autoPlay
  });
  renderSubtitles();
  renderEditors();
};

const jumpPrevSubtitle = (forcePlay) => {
  const shouldPlay = forcePlay !== undefined ? forcePlay : state.autoPlay;
  if (state.currentIndex > 0) jumpToSubtitle(state.currentIndex - 1, false, shouldPlay);
};
const jumpNextSubtitle = (forcePlay) => {
  const shouldPlay = forcePlay !== undefined ? forcePlay : state.autoPlay;
  if (state.currentIndex < state.subtitles.length - 1) jumpToSubtitle(state.currentIndex + 1, false, shouldPlay);
};

let listenMode = false;
let lastPauseIndex = -1; // 防止同一句重复触发暂停
let boundaryTriggeredIndex = -1; // 避免同一句在同一尾点重复触发
let savedAutoPauseState = false; // 保存进入精听模式前的自动暂停状态
let playerWavesurfer = null; // 主播放器波形图实例
let playerRegions = null; // 波形图字幕区域插件
let waveZoomPercent = 100; // 波形图缩放百分比 (100=原始宽度)
let isSeekingWave = false; // 防止seekTo时重复触发
let lastWaveUpdate = 0; // 上次波形图更新时间

// 节流函数
const throttle = (func, delay) => {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func.apply(this, args);
    }
  };
};

// 精确时间格式化：转换为 hh:mm:ss.SSS 格式
const formatPreciseTime = (seconds) => {
  if (isNaN(seconds) || seconds < 0) return "00:00:00.000";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

// 解析时间字符串：支持 hh:mm:ss.SSS 或 mm:ss.SSS 或 ss.SSS
const parseTimeString = (timeStr) => {
  const parts = timeStr.trim().split(':');
  let h = 0, m = 0, s = 0;
  
  if (parts.length === 3) {
    // hh:mm:ss.SSS
    h = parseInt(parts[0]) || 0;
    m = parseInt(parts[1]) || 0;
    s = parseFloat(parts[2]) || 0;
  } else if (parts.length === 2) {
    // mm:ss.SSS
    m = parseInt(parts[0]) || 0;
    s = parseFloat(parts[1]) || 0;
  } else if (parts.length === 1) {
    // ss.SSS
    s = parseFloat(parts[0]) || 0;
  }
  
  return h * 3600 + m * 60 + s;
};

// 按钮状态管理
const updateButtonState = (buttonId, isActive) => {
  const btn = $(buttonId);
  if (!btn) return;
  
  if (isActive) {
    btn.classList.add("active");
  } else {
    btn.classList.remove("active");
  }
};

// 播放控制状态栏文案（确保完整、一致且符合逻辑）
const updatePlaybackStatusTexts = () => {
  const autoPauseText = listenMode
    ? "⏸️ 自动暂停：开（精听）"
    : `⏸️ 自动暂停：${state.autoPause ? "开" : "关"}`;
  const autoPlayText = listenMode
    ? "▶️ 切句自动播放：开（精听）"
    : `▶️ 切句自动播放：${state.autoPlay ? "开" : "关"}`;

  const elPause = $("#auto-pause-status");
  const elPlay = $("#auto-play-status");
  if (elPause) elPause.textContent = autoPauseText;
  if (elPlay) elPlay.textContent = autoPlayText;
};

const startListenMode = () => {
  listenMode = true;
  // 保存当前自动暂停状态
  savedAutoPauseState = state.autoPause;
  state.loop = false;
  state.autoPause = true;
  $("#loop-status").textContent = "🔁 循环: 关";
  updatePlaybackStatusTexts();
  updateButtonState("#btn-listen-mode", true);
  updateButtonState("#toggle-loop", false);
  updateButtonState("#toggle-auto-pause", true);
  if (state.currentIndex === -1 && state.subtitles.length > 0) jumpToSubtitle(0, true);
  alert("精听训练模式已开启：播放完自动暂停，空格重复当前句，方向键上下切换句子");
};
const stopListenMode = () => {
  listenMode = false;
  // 恢复进入精听前的自动暂停状态
  state.autoPause = savedAutoPauseState;
  updatePlaybackStatusTexts();
  updateButtonState("#btn-listen-mode", false);
  updateButtonState("#toggle-auto-pause", state.autoPause);
  alert("已退出精听训练模式");
};

const handleTimeUpdate = () => {
  const player = $("#player");
  const t = player.currentTime;
  
  // 实时更新波形图时间输入框
  const timeInput = $("#wave-time-input");
  if (timeInput && !timeInput.matches(':focus')) {
    timeInput.value = formatPreciseTime(t);
  }
  
  const prevIndex = state.currentIndex;
  // 同步手动打轴波形的进度
  try {
    if (!isSeekingManualWave && manualWavesurfer && player.duration) {
      manualWavesurfer.seekTo(t / player.duration);
    }
  } catch (e) { /* ignore */ }
  const currentSub = state.subtitles[prevIndex];

  // 先处理当前句尾逻辑（循环/自动暂停），避免刚跨句就跳过循环
  if (currentSub && t >= currentSub.end - 0.05) {
    // 当离开尾点区域（回退或重播）时，清除边界触发标记，允许再次触发
    if (boundaryTriggeredIndex === prevIndex && t < currentSub.end - 0.1) {
      boundaryTriggeredIndex = -1;
      logEvent("boundaryReset", { idx: prevIndex, t, end: currentSub.end });
    }

    // 如果循环打开但当前计数为 0，且仍在本句区间，重新初始化循环次数
    if (state.loop && state.loopRemaining === 0 && state.loopCount !== -1 && t < currentSub.end - 0.05) {
      state.loopRemaining = state.loopCount;
    }

    // 将后续逻辑委托给 currentSub，并在处理完成后 return，避免 index 提前跳转
    const sub = currentSub;
    // 循环逻辑（支持次数与无限）
    if (state.loop && t >= sub.end - 0.05) {
      if (boundaryTriggeredIndex === prevIndex) return; // 避免重复触发
      boundaryTriggeredIndex = prevIndex;
      // 若计数尚未初始化（如从中间开始播放），进行一次初始化
      if (state.loopRemaining === 0 && state.loopCount !== -1) {
        state.loopRemaining = state.loopCount;
      }
      // 无限循环
      if (state.loopCount === -1) {
        // 如果设置了循环间隔，先暂停一段时间再跳回
        if (state.loopPause > 0) {
          const duration = sub.end - sub.start;
          const pauseDuration = duration * state.loopPause * 1000;
          player.pause();
          logEvent("loopPauseInterval", {
            idx: prevIndex,
            pauseMs: pauseDuration,
            loopPause: state.loopPause,
            infinite: true
          });
          setTimeout(() => {
            player.currentTime = sub.start;
            player.play();
          }, pauseDuration);
        } else {
          player.currentTime = sub.start;
          player.play();
        }
        logEvent("loopInfinite", { idx: prevIndex, start: sub.start, end: sub.end });
        return;
      }
      // 次数循环
      if (state.loopRemaining > 1) {
        state.loopRemaining -= 1;
        // 如果设置了循环间隔，先暂停一段时间再跳回
        if (state.loopPause > 0) {
          const duration = sub.end - sub.start;
          const pauseDuration = duration * state.loopPause * 1000; // 转为毫秒
          player.pause();
          logEvent("loopPauseInterval", {
            idx: prevIndex,
            remaining: state.loopRemaining,
            pauseMs: pauseDuration,
            loopPause: state.loopPause
          });
          setTimeout(() => {
            player.currentTime = sub.start;
            player.play();
          }, pauseDuration);
        } else {
          player.currentTime = sub.start;
          player.play();
        }
        logEvent("loopDecrement", {
          idx: prevIndex,
          remaining: state.loopRemaining,
          count: state.loopCount,
          t,
          start: sub.start,
          end: sub.end
        });
        return;
      }
      // 最后一次循环结束
      if (state.loopRemaining === 1 || state.loopRemaining === 0) {
        state.loopRemaining = 0;
        if (state.autoPause) {
          if (lastPauseIndex !== prevIndex) {
            lastPauseIndex = prevIndex;
            player.pause();
            logEvent("loopFinalPause", { idx: prevIndex, t, start: sub.start, end: sub.end });
          }
          return;
        } else {
          // 跳到下一句，自动继续播放（关闭自动暂停时不应停顿）
          if (prevIndex < state.subtitles.length - 1) {
            jumpToSubtitle(prevIndex + 1, false);
          } else {
            player.pause();
          }
          logEvent("loopFinalNext", {
            idx: prevIndex,
            next: prevIndex + 1,
            t,
            start: sub.start,
            end: sub.end
          });
          return;
        }
      }
    }

    // 自动暂停（非循环模式）
    if (!state.loop && state.autoPause && t >= sub.end - 0.05 && !player.paused) {
      if (boundaryTriggeredIndex === prevIndex) return; // 避免重复触发
      boundaryTriggeredIndex = prevIndex;
      if (lastPauseIndex !== prevIndex) {
        lastPauseIndex = prevIndex;
        player.pause();
        logEvent("autoPause", { idx: prevIndex, t, start: sub.start, end: sub.end });
      }
      // 精听模式下不自动准备下一句，保持在当前句
      if (listenMode) {
        return;
      }
      // 自动跳到下一句准备播放
      if (prevIndex < state.subtitles.length - 1) {
        setTimeout(() => {
          if (player.paused) {
            const nextSub = state.subtitles[prevIndex + 1];
            player.currentTime = nextSub.start;
            state.currentIndex = prevIndex + 1;
            // 新句子时重置循环与暂停标记
            if (state.loop) state.loopRemaining = state.loopCount;
            lastPauseIndex = -1;
            boundaryTriggeredIndex = -1;
            renderSubtitles();
            renderEditors();
            logEvent("autoPauseNextPrepared", {
              idx: state.currentIndex,
              start: nextSub.start,
              end: nextSub.end
            });
          }
        }, 50);
      }
      return;
    }

    // 精听模式（与自动暂停共享边界防抖）
    if (listenMode && t >= sub.end - 0.05 && !player.paused) {
      if (boundaryTriggeredIndex === prevIndex) return;
      boundaryTriggeredIndex = prevIndex;
      player.pause();
      // 将播放位置设为句尾前0.1秒，防止跨句触发下一句索引更新
      player.currentTime = sub.end - 0.1;
      logEvent("listenModePause", { idx: prevIndex, t, start: sub.start, end: sub.end, adjustedTime: sub.end - 0.1 });
      return;
    }
  }

  // 若未触发尾点逻辑，再进行字幕索引更新
  const idx = state.subtitles.findIndex((s) => t >= s.start && t < s.end);
  if (idx !== -1 && idx !== state.currentIndex) {
    // 精听模式下，如果播放器已暂停，不自动切换索引（保持在当前句）
    if (listenMode && player.paused) {
      return;
    }
    state.currentIndex = idx;
    // 新句子时重置循环计数与暂停标记
    if (state.loop) {
      state.loopRemaining = state.loopCount;
    }
    lastPauseIndex = -1;
    boundaryTriggeredIndex = -1;
    logEvent("subtitleIndexChanged", {
      idx,
      start: state.subtitles[idx]?.start,
      end: state.subtitles[idx]?.end,
      loop: state.loop,
      loopRemaining: state.loopRemaining
    });
    renderSubtitles();
    renderEditors();
  }
  
  // 如果没有字幕，直接返回
  if (state.currentIndex === -1 || state.subtitles.length === 0) return;
  
  const sub = state.subtitles[state.currentIndex];

  // 当离开尾点区域（回退或重播）时，清除边界触发标记，允许再次触发
  if (boundaryTriggeredIndex === state.currentIndex && t < sub.end - 0.1) {
    boundaryTriggeredIndex = -1;
    logEvent("boundaryReset", { idx: state.currentIndex, t, end: sub.end });
  }

  // 如果循环打开但当前计数为 0，且仍在本句区间，重新初始化循环次数
  if (state.loop && state.loopRemaining === 0 && state.loopCount !== -1 && t < sub.end - 0.05) {
    state.loopRemaining = state.loopCount;
  }
  
  // 循环逻辑（支持次数与无限）
  if (state.loop && t >= sub.end - 0.05) {
    if (boundaryTriggeredIndex === state.currentIndex) return; // 避免重复触发
    boundaryTriggeredIndex = state.currentIndex;
    // 若计数尚未初始化（如从中间开始播放），进行一次初始化
    if (state.loopRemaining === 0 && state.loopCount !== -1) {
      state.loopRemaining = state.loopCount;
    }
    // 无限循环
    if (state.loopCount === -1) {
      player.currentTime = sub.start;
      player.play();
      logEvent("loopInfinite", { idx: state.currentIndex, start: sub.start, end: sub.end });
      return;
    }
    // 次数循环
    if (state.loopRemaining > 1) {
      state.loopRemaining -= 1;
      player.currentTime = sub.start;
      player.play();
      logEvent("loopDecrement", {
        idx: state.currentIndex,
        remaining: state.loopRemaining,
        count: state.loopCount,
        t,
        start: sub.start,
        end: sub.end
      });
      return;
    }
    // 最后一次循环结束
    if (state.loopRemaining === 1 || state.loopRemaining === 0) {
      state.loopRemaining = 0;
      if (state.autoPause) {
        if (lastPauseIndex !== state.currentIndex) {
          lastPauseIndex = state.currentIndex;
          player.pause();
          logEvent("loopFinalPause", { idx: state.currentIndex, t, start: sub.start, end: sub.end });
        }
        return;
      } else {
        // 跳到下一句并暂停，便于学习节奏
        if (state.currentIndex < state.subtitles.length - 1) {
          jumpToSubtitle(state.currentIndex + 1, true);
        } else {
          player.pause();
        }
        logEvent("loopFinalNext", {
          idx: state.currentIndex,
          next: state.currentIndex + 1,
          t,
          start: sub.start,
          end: sub.end
        });
        return;
      }
    }
  }
  
  // 自动暂停（非循环模式）
  if (!state.loop && state.autoPause && t >= sub.end - 0.05 && !player.paused) {
    if (boundaryTriggeredIndex === state.currentIndex) return; // 避免重复触发
    boundaryTriggeredIndex = state.currentIndex;
    if (lastPauseIndex !== state.currentIndex) {
      lastPauseIndex = state.currentIndex;
      player.pause();
      logEvent("autoPause", { idx: state.currentIndex, t, start: sub.start, end: sub.end });
    }
    // 精听模式下不自动准备下一句，保持在当前句
    if (listenMode) {
      return;
    }
    // 自动跳到下一句准备播放
    if (state.currentIndex < state.subtitles.length - 1) {
      setTimeout(() => {
        if (player.paused) {
          const nextSub = state.subtitles[state.currentIndex + 1];
          player.currentTime = nextSub.start;
          state.currentIndex += 1;
          // 新句子时重置循环与暂停标记
          if (state.loop) state.loopRemaining = state.loopCount;
          lastPauseIndex = -1;
          boundaryTriggeredIndex = -1;
          renderSubtitles();
          renderEditors();
          logEvent("autoPauseNextPrepared", {
            idx: state.currentIndex,
            start: nextSub.start,
            end: nextSub.end
          });
        }
      }, 50);
    }
    return;
  }
  
  // 精听模式（与自动暂停共享边界防抖）
  if (listenMode && t >= sub.end - 0.05 && !player.paused) {
    if (boundaryTriggeredIndex === state.currentIndex) return;
    boundaryTriggeredIndex = state.currentIndex;
    player.pause();
    // 将播放位置设为句尾前0.1秒，防止跨句触发下一句索引更新
    player.currentTime = sub.end - 0.1;
    logEvent("listenModePause", { idx: state.currentIndex, t, start: sub.start, end: sub.end, adjustedTime: sub.end - 0.1 });
  }
};

// Recording ---------------------------------------------------------------

const startRecording = async () => {
  if (!navigator.mediaDevices) {
    alert("浏览器不支持录音");
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  state.recording.mediaRecorder = recorder;
  state.recording.chunks = [];
  state.recording.isRecording = true;

  recorder.ondataavailable = (e) => state.recording.chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(state.recording.chunks, { type: "audio/webm" });
    state.recording.blobUrl = URL.createObjectURL(blob);
    $("#record-audio").src = state.recording.blobUrl;
    state.recording.isRecording = false;
    updateRecordButtonState();
  };

  recorder.start();
  updateRecordButtonState();
};

const stopRecording = () => {
  const rec = state.recording.mediaRecorder;
  if (rec && rec.state === "recording") rec.stop();
};

const clearRecording = () => {
  if (state.recording.isRecording) stopRecording();
  if (state.recording.blobUrl) {
    URL.revokeObjectURL(state.recording.blobUrl);
  }
  state.recording.blobUrl = null;
  state.recording.chunks = [];
  state.recording.mediaRecorder = null;
  const audio = $("#record-audio");
  if (audio) {
    audio.src = "";
    audio.removeAttribute("src");
    audio.load();
  }
  updateRecordButtonState();
};

const toggleRecording = async () => {
  if (state.recording.isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
};

const updateRecordButtonState = () => {
  const btn = $("#btn-record-toggle");
  if (state.recording.isRecording) {
    btn.textContent = "⏹️ 停止录音";
    btn.classList.add("active");
  } else {
    btn.textContent = "⏺️ 开始录音";
    btn.classList.remove("active");
  }
};

const showProgress = (visible, message = "处理中...") => {
  const progressBar = $("#progress-container");
  const progressText = $("#progress-text");
  const progressFill = $("#progress-fill");
  const cancelBtn = $("#progress-cancel-btn");
  
  if (visible) {
    progressBar.style.display = "block";
    progressText.textContent = message;
    progressFill.style.width = "0%";
    state.cancelOperation = false;
    cancelBtn.style.display = "inline-block";
  } else {
    progressBar.style.display = "none";
    progressText.textContent = "";
    progressFill.style.width = "0%";
    state.cancelOperation = false;
    cancelBtn.style.display = "none";
  }
};

// 取消当前操作
const cancelProgress = () => {
  state.cancelOperation = true;
  const progressText = $("#progress-text");
  progressText.textContent = "正在取消...";
  console.log("用户取消了操作");
  
  // 2秒后隐藏进度条
  setTimeout(() => {
    showProgress(false);
    alert("操作已取消");
  }, 500);
};

// 更新生词本通用性滑块样式
const updateCommonVocabToggleStyle = () => {
  const checkbox = $("#checkbox-common-vocab");
  const toggle = $("#toggle-common-vocab");
  if (!checkbox || !toggle) return;
  
  const slider = toggle.querySelector(".slider");
  const knob = slider ? slider.querySelector("span") : null;
  
  if (checkbox.checked) {
    if (slider) slider.style.backgroundColor = "#34c759";
    if (knob) knob.style.left = "24px";
  } else {
    if (slider) slider.style.backgroundColor = "#999";
    if (knob) knob.style.left = "2px";
  }
};

// 播放默认偏好设置渲染（参考“折叠偏好”的 iOS 风格开关）
const renderPlaybackDefaultSettings = () => {
  const container = document.getElementById("playback-default-settings");
  if (!container) return;

  container.style.display = "grid";
  container.style.gridTemplateColumns = "1fr";
  container.style.rowGap = "16px";
  container.style.marginTop = "12px";
  container.style.width = "100%";
  container.style.boxSizing = "border-box";

  const items = [
    {
      key: "defaultAutoPause",
      label: "⏸️ 默认自动暂停",
      get: () => !!state.settings.defaultAutoPause,
      set: (v) => {
        state.settings.defaultAutoPause = !!v;
        // 默认偏好：非精听时可直接同步到当前开关，避免“改了设置但不生效”的困惑
        if (!listenMode) {
          state.autoPause = !!v;
          updateButtonState("#toggle-auto-pause", state.autoPause);
          updatePlaybackStatusTexts();
        }
        persistSettings();
      }
    },
    {
      key: "defaultAutoPlay",
      label: "▶️ 默认切句自动播放",
      get: () => !!state.settings.defaultAutoPlay,
      set: (v) => {
        state.settings.defaultAutoPlay = !!v;
        if (!listenMode) {
          state.autoPlay = !!v;
          updateButtonState("#toggle-auto-play", state.autoPlay);
          updatePlaybackStatusTexts();
        }
        persistSettings();
      }
    },
  ];

  container.innerHTML = "";

  const buildToggle = (labelText, checked, onChange) => {
    const wrap = document.createElement("div");
    wrap.className = "toggle-item";
    wrap.style.display = "flex";
    wrap.style.justifyContent = "space-between";
    wrap.style.alignItems = "center";

    const labelEl = document.createElement("span");
    labelEl.className = "toggle-label";
    labelEl.textContent = labelText;

    const toggleLabel = document.createElement("label");
    toggleLabel.style.position = "relative";
    toggleLabel.style.display = "inline-block";
    toggleLabel.style.width = "44px";
    toggleLabel.style.height = "24px";
    toggleLabel.style.verticalAlign = "middle";
    toggleLabel.style.cursor = "pointer";
    toggleLabel.style.flexShrink = "0";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    input.style.display = "none";

    const slider = document.createElement("span");
    slider.style.position = "absolute";
    slider.style.top = "0";
    slider.style.left = "0";
    slider.style.right = "0";
    slider.style.bottom = "0";
    slider.style.width = "44px";
    slider.style.height = "24px";
    slider.style.cursor = "pointer";
    slider.style.borderRadius = "24px";
    slider.style.transition = "background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
    slider.style.display = "block";

    const knob = document.createElement("span");
    knob.style.position = "absolute";
    knob.style.width = "20px";
    knob.style.height = "20px";
    knob.style.borderRadius = "50%";
    knob.style.backgroundColor = "white";
    knob.style.top = "2px";
    knob.style.transition = "left 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease";
    knob.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
    knob.style.display = "block";

    const updateToggleStyle = () => {
      if (input.checked) {
        slider.style.backgroundColor = "#34c759";
        knob.style.left = "22px";
        knob.style.boxShadow = "0 2px 5px rgba(52, 199, 89, 0.3)";
      } else {
        slider.style.backgroundColor = "#a0aec0";
        knob.style.left = "2px";
        knob.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
      }
    };
    updateToggleStyle();

    toggleLabel.addEventListener("click", () => {
      input.checked = !input.checked;
      updateToggleStyle();
      onChange(input.checked);
    });

    slider.appendChild(knob);
    toggleLabel.appendChild(input);
    toggleLabel.appendChild(slider);

    wrap.appendChild(labelEl);
    wrap.appendChild(toggleLabel);
    return wrap;
  };

  items.forEach((it) => {
    container.appendChild(buildToggle(it.label, it.get(), it.set));
  });
};

// 折叠设置渲染 - iOS 风格开关（带 JavaScript 交互）
const renderCollapseSettings = () => {
  const container = document.getElementById("collapse-settings");
  if (!container) {
    console.warn("❌ collapse-settings 容器不存在");
    return;
  }
  
  // 强制两栏布局
  container.style.display = "grid";
  container.style.gridTemplateColumns = "1fr 1fr";
  container.style.columnGap = "300px";
  container.style.rowGap = "16px";
  container.style.marginTop = "12px";
  container.style.width = "100%";
  container.style.boxSizing = "border-box";
  
  const items = [
    { id: "playback-body", label: "播放器", icon: "📽️" },
    { id: "subtitle-list-wrapper", label: "字幕列表", icon: "📄" },
    { id: "editor-body", label: "字幕编辑", icon: "✏️" },
    { id: "control-body", label: "播放控制", icon: "⚙️" },
    { id: "playlist-body", label: "播放列表", icon: "📋" },
    { id: "recording-body", label: "跟读录音", icon: "🎤" },
    { id: "vocab-body", label: "生词本", icon: "📚" },
  ];
  
  container.innerHTML = "";
  items.forEach(({ id, label, icon }) => {
    const wrap = document.createElement("div");
    wrap.className = "toggle-item";
    // 使用 flex 布局，标签左开关右
    wrap.style.display = "flex";
    wrap.style.justifyContent = "space-between";
    wrap.style.alignItems = "center";
    
    const labelEl = document.createElement("span");
    labelEl.className = "toggle-label";
    labelEl.textContent = `${icon} ${label}`;
    
    const toggleLabel = document.createElement("label");
    toggleLabel.style.position = "relative";
    toggleLabel.style.display = "inline-block";
    toggleLabel.style.width = "44px";
    toggleLabel.style.height = "24px";
    toggleLabel.style.verticalAlign = "middle";
    toggleLabel.style.cursor = "pointer";
    toggleLabel.style.flexShrink = "0";
    
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!state.settings.collapsed?.[id];
    input.style.display = "none";
    
    const slider = document.createElement("span");
    slider.style.position = "absolute";
    slider.style.top = "0";
    slider.style.left = "0";
    slider.style.right = "0";
    slider.style.bottom = "0";
    slider.style.width = "44px";
    slider.style.height = "24px";
    slider.style.cursor = "pointer";
    slider.style.borderRadius = "24px";
    slider.style.transition = "background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
    slider.style.display = "block";
    
    const knob = document.createElement("span");
    knob.style.position = "absolute";
    knob.style.width = "20px";
    knob.style.height = "20px";
    knob.style.borderRadius = "50%";
    knob.style.backgroundColor = "white";
    knob.style.top = "2px";
    knob.style.transition = "left 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease";
    knob.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
    knob.style.display = "block";
    
    // 初始化样式
    const updateToggleStyle = () => {
      if (input.checked) {
        slider.style.backgroundColor = "#34c759";
        knob.style.left = "22px";
        knob.style.boxShadow = "0 2px 5px rgba(52, 199, 89, 0.3)";
      } else {
        slider.style.backgroundColor = "#a0aec0";
        knob.style.left = "2px";
        knob.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
      }
    };
    updateToggleStyle();
    
    // 点击事件
    toggleLabel.addEventListener("click", () => {
      input.checked = !input.checked;
      updateToggleStyle();
      setCollapsedState(id, input.checked);
    });
    
    slider.appendChild(knob);
    toggleLabel.appendChild(input);
    toggleLabel.appendChild(slider);
    
    wrap.appendChild(labelEl);
    wrap.appendChild(toggleLabel);
    container.appendChild(wrap);
  });
  
  console.log("✓ iOS 开关已渲染，共 7 个");
};

// 为阅读模块渲染折叠设置
const renderReadingCollapseSettings = () => {
  const container = document.getElementById("collapse-settings-reading");
  if (!container) {
    console.warn("❌ collapse-settings-reading 容器不存在");
    return;
  }
  
  // 强制两栏布局
  container.style.display = "grid";
  container.style.gridTemplateColumns = "1fr 1fr";
  container.style.columnGap = "300px";
  container.style.rowGap = "16px";
  container.style.marginTop = "12px";
  container.style.width = "100%";
  container.style.boxSizing = "border-box";
  
  const items = [
    { id: "reading-documents-body", label: "文档列表", icon: "📂" },
    { id: "reading-text-body", label: "阅读内容", icon: "📖" },
    { id: "reading-notes-body", label: "笔记", icon: "📝" },
    { id: "reading-nav-body", label: "阅读进度", icon: "📊" },
    { id: "reading-vocab-body", label: "生词本", icon: "📚" },
  ];
  
  container.innerHTML = "";
  items.forEach(({ id, label, icon }) => {
    const wrap = document.createElement("div");
    wrap.className = "toggle-item";
    wrap.style.display = "flex";
    wrap.style.justifyContent = "space-between";
    wrap.style.alignItems = "center";
    
    const labelEl = document.createElement("span");
    labelEl.className = "toggle-label";
    labelEl.textContent = `${icon} ${label}`;
    
    const toggleLabel = document.createElement("label");
    toggleLabel.style.position = "relative";
    toggleLabel.style.display = "inline-block";
    toggleLabel.style.width = "44px";
    toggleLabel.style.height = "24px";
    toggleLabel.style.verticalAlign = "middle";
    toggleLabel.style.cursor = "pointer";
    toggleLabel.style.flexShrink = "0";
    
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!state.settings.collapsed?.[id];
    input.style.display = "none";
    
    const slider = document.createElement("span");
    slider.style.position = "absolute";
    slider.style.top = "0";
    slider.style.left = "0";
    slider.style.right = "0";
    slider.style.bottom = "0";
    slider.style.width = "44px";
    slider.style.height = "24px";
    slider.style.cursor = "pointer";
    slider.style.borderRadius = "24px";
    slider.style.transition = "background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
    slider.style.display = "block";
    
    const knob = document.createElement("span");
    knob.style.position = "absolute";
    knob.style.width = "20px";
    knob.style.height = "20px";
    knob.style.borderRadius = "50%";
    knob.style.backgroundColor = "white";
    knob.style.top = "2px";
    knob.style.transition = "left 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease";
    knob.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
    knob.style.display = "block";
    
    // 初始化样式
    const updateToggleStyle = () => {
      if (input.checked) {
        slider.style.backgroundColor = "#34c759";
        knob.style.left = "22px";
        knob.style.boxShadow = "0 2px 5px rgba(52, 199, 89, 0.3)";
      } else {
        slider.style.backgroundColor = "#a0aec0";
        knob.style.left = "2px";
        knob.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
      }
    };
    updateToggleStyle();
    
    // 点击事件
    toggleLabel.addEventListener("click", () => {
      input.checked = !input.checked;
      updateToggleStyle();
      setCollapsedState(id, input.checked);
    });
    
    slider.appendChild(knob);
    toggleLabel.appendChild(input);
    toggleLabel.appendChild(slider);
    
    wrap.appendChild(labelEl);
    wrap.appendChild(toggleLabel);
    container.appendChild(wrap);
  });
  
  console.log("✓ 阅读模块 iOS 开关已渲染，共 5 个");
};

// 实时获取转录进度
const pollProgress = async (interval = 200) => {
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      // 检查是否用户取消了操作
      if (state.cancelOperation) {
        clearInterval(timer);
        resolve();
        return;
      }
      
      try {
        const res = await fetch("/api/transcribe/progress").then((r) => r.json());
        const progressFill = $("#progress-fill");
        const progressText = $("#progress-text");
        
        if (res.progress !== undefined) {
          const progress = Math.min(res.progress, 95);
          progressFill.style.width = progress + "%";
        }
        
        // 构建更详细的进度显示
        let message = res.status || "处理中...";
        if (res.detected_lang) {
          message = `🌍 ${res.detected_lang.replace("Detected language: ", "")} • ${res.status}`;
        }
        
        // 更新进度百分比显示
        let progressPercent = 0;
        if (res.progress !== undefined) {
          progressPercent = Math.round(res.progress);
          message += ` ${progressPercent}%`;
          
          const percentLabel = $("#progress-percent");
          if (percentLabel) {
            percentLabel.textContent = progressPercent + "%";
          }
        }
        
        progressText.textContent = message;
        
        if (res.progress >= 100) {
          clearInterval(timer);
          progressFill.style.width = "100%";
          const percentLabel = $("#progress-percent");
          if (percentLabel) {
            percentLabel.textContent = "100%";
          }
          resolve();
        }
      } catch (err) {
        console.warn("进度获取失败:", err);
      }
    }, interval);
    
    // 超时 15 分钟后自动停止轮询
    setTimeout(() => {
      clearInterval(timer);
      resolve();
    }, 15 * 60 * 1000);
  });
};

// 识别功能已移除，仅保留录音和回放

// Editing ------------------------------------------------------------------

// 初始化按钮状态
const initializeButtonStates = () => {
  updateButtonState("#toggle-loop", state.loop);
  updateButtonState("#toggle-auto-pause", state.autoPause);
  updateButtonState("#toggle-auto-play", state.autoPlay);
  updateButtonState("#btn-listen-mode", listenMode);
  updatePlaybackStatusTexts();
};

const applyPlaybackDefaultsFromSettings = () => {
  if (typeof state.settings.defaultAutoPause === "boolean") {
    state.autoPause = state.settings.defaultAutoPause;
  }
  if (typeof state.settings.defaultAutoPlay === "boolean") {
    state.autoPlay = state.settings.defaultAutoPlay;
  }
};

const bindEditors = () => {
  let editTimer = null;
  
  $("#edit-en").addEventListener("input", (e) => {
    const cur = state.subtitles[state.currentIndex];
    if (!cur) return;
    cur.userEn = e.target.value;
    renderSubtitles();
  });
  $("#edit-zh").addEventListener("input", (e) => {
    const cur = state.subtitles[state.currentIndex];
    if (!cur) return;
    cur.userZh = e.target.value;
    renderSubtitles();
  });
  $("#edit-note").addEventListener("input", (e) => {
    const cur = state.subtitles[state.currentIndex];
    if (!cur) return;
    cur.note = e.target.value;
    renderSubtitles();
  });
  ["#edit-en", "#edit-zh", "#edit-note"].forEach((id) => {
    $(id).addEventListener("change", () => {
      saveHistory();
      persistSubtitles();
    });
  });
};

// Vocab 系统已迁移到气泡编辑模式，不再需要手动表单

const bindVocabForm = () => {
  // 导出生词本
  $("#btn-vocab-export").addEventListener("click", () => {
    if (!state.vocab || state.vocab.length === 0) {
      alert("当前生词本为空");
      return;
    }
    const currentBook = state.vocabBooks.find(vb => vb.id === state.currentVocabBookId);
    const filename = currentBook ? `${currentBook.name}.json` : "vocab.json";
    const blob = new Blob([JSON.stringify(state.vocab, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
  
  // 导入生词本
  $("#vocab-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) {
        // 导入到当前生词本
        state.vocab = arr;
        persistVocab();
        renderVocab();
        renderVocabBookSelector();
        renderSubtitles(); // 重新渲染字幕以显示下划线
        alert("生词本导入成功");
      }
    } catch {
      alert("导入失败，文件格式错误");
    }
    e.target.value = "";
  });
};

// Import/Export -------------------------------------------------------------

const subtitlesToSRT = (subtitles) => {
  return subtitles
    .map((sub, idx) => {
      const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.round((seconds % 1) * 1000);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
      };
      const text = [sub.en, sub.zh].filter(Boolean).join("\n");
      return `${idx + 1}\n${formatTime(sub.start)} --> ${formatTime(sub.end)}\n${text}`;
    })
    .join("\n\n");
};

const downloadFile = (content, filename, mimeType = "text/plain") => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const exportSubtitles = () => {
  if (!state.subtitles.length) {
    alert("没有字幕可导出");
    return;
  }

  const baseFilename = state.mediaTitle ? state.mediaTitle.replace(/\.[^.]+$/, "") : "subtitles";
  
  // 创建导出菜单
  const choice = prompt(
    "选择导出格式:\n1. JSON (保留所有信息)\n2. SRT (仅保留时间和文本)\n\n请输入 1 或 2 (默认: 1):",
    "1"
  );

  if (choice === null) return; // 取消

  if (choice === "2") {
    // 导出为 SRT
    const srtContent = subtitlesToSRT(state.subtitles);
    downloadFile(srtContent, `${baseFilename}.srt`, "text/plain");
    console.log(`✅ 已导出 ${state.subtitles.length} 条字幕为 SRT 格式`);
  } else {
    // 默认导出为 JSON
    const jsonContent = JSON.stringify(state.subtitles, null, 2);
    downloadFile(jsonContent, `${baseFilename}.json`, "application/json");
    console.log(`✅ 已导出 ${state.subtitles.length} 条字幕为 JSON 格式`);
  }
};

const exportSubtitlesSRT = () => {
  if (!state.subtitles.length) {
    alert("没有字幕可导出");
    return;
  }
  const baseFilename = state.mediaTitle ? state.mediaTitle.replace(/\.[^.]+$/, "") : "subtitles";
  const srtContent = subtitlesToSRT(state.subtitles);
  downloadFile(srtContent, `${baseFilename}.srt`, "text/plain");
  alert(`成功导出 ${state.subtitles.length} 条字幕为 SRT 格式`);
};

const requestAutoSubtitles = async () => {
  // 检查是否有当前播放的文件
  if (!state.mediaTitle) {
    alert("请先选择音频/视频文件");
    return;
  }
  
  showProgress(true, "📝 生成字幕中...");
  
  try {
    const fd = new FormData();
    fd.append("filename", state.mediaTitle);
    
    // 开始生成字幕并实时显示进度
    const generatePromise = fetch("/api/subtitles/generate", { method: "POST", body: fd }).then((r) => r.json());
    const progressPromise = pollProgress();
    
    const [result] = await Promise.all([generatePromise, progressPromise]);
    
    if (result.status !== "success") {
      alert("生成失败: " + (result.error || "未知错误"));
      return;
    }
    
    state.subtitles = result.subtitles || [];
    // 初始化历史记录
    state.history = [JSON.parse(JSON.stringify(state.subtitles))];
    state.historyIndex = 0;
    persistSubtitles();
    renderSubtitles();
    updateHistoryButtons();
    alert(`成功生成 ${state.subtitles.length} 条字幕`);
  } catch (err) {
    alert("错误: " + err.message);
  } finally {
    showProgress(false);
  }
};

// Bootstrap -----------------------------------------------------------------

const bindInputs = () => {
  $("#audio-upload").addEventListener("change", (e) => {
    if (e.target.files?.length) {
      addToPlaylist(Array.from(e.target.files));
      // 自动播放第一个
      if (state.playlist.length > 0 && state.currentPlaylistIndex === -1) {
        playlistItem(0);
      }
    }
  });
  
  // 拖拽导入支持
  const body = document.body;
  body.addEventListener('dragover', (e) => {
    if (isPlaylistDragging) return; // 内部排序时不拦截
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  body.addEventListener('drop', async (e) => {
    if (isPlaylistDragging) return; // 内部排序时不拦截
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    
    const audioFiles = files.filter(f => f.type.startsWith('audio/') || f.type.startsWith('video/'));
    const subtitleFiles = files.filter(f => f.name.endsWith('.json') || f.name.endsWith('.srt'));
    
    // 导入音频/视频文件
    if (audioFiles.length > 0) {
      await addToPlaylist(audioFiles);
      if (state.playlist.length > 0 && state.currentPlaylistIndex === -1) {
        playlistItem(0);
      }
    }
    
    // 导入字幕文件
    if (subtitleFiles.length > 0) {
      await loadSubtitleFile(subtitleFiles[0]);
    }
  });
  $("#subtitle-upload").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) loadSubtitleFile(file);
  });
  $("#player").addEventListener("timeupdate", handleTimeUpdate);
  $("#toggle-loop").addEventListener("click", () => {
    state.loop = !state.loop;
    updateButtonState("#toggle-loop", state.loop);
    if (state.loop) {
      $("#loop-control").style.display = "flex";
      const countSelect = $("#loop-count");
      const parsed = parseInt(countSelect.value, 10);
      state.loopCount = Number.isNaN(parsed) ? 1 : parsed;
      state.loopRemaining = state.loopCount;
      $("#loop-status").textContent = `🔁 循环: ${state.loopCount === -1 ? "无限" : state.loopCount + "次"}`;
      logEvent("loopEnabled", { loopCount: state.loopCount });
    } else {
      $("#loop-control").style.display = "none";
      state.loopRemaining = 0;
      $("#loop-status").textContent = "🔁 循环: 关";
      logEvent("loopDisabled", {});
    }
  });
  $("#loop-count").addEventListener("change", (e) => {
    const parsed = parseInt(e.target.value, 10);
    state.loopCount = Number.isNaN(parsed) ? 1 : parsed;
    state.loopRemaining = state.loopCount;
    const text = state.loopCount === -1 ? "无限" : state.loopCount + "次";
    $("#loop-status").textContent = `🔁 循环: ${text}`;
    logEvent("loopCountChanged", { loopCount: state.loopCount });
  });
  $("#loop-pause").addEventListener("change", (e) => {
    state.loopPause = parseFloat(e.target.value) || 0;
    const pauseText = state.loopPause === 0 ? "无" : `${(state.loopPause * 100).toFixed(0)}%句长`;
    $("#loop-pause-status").textContent = `⏱️ 间隔: ${pauseText}`;
    logEvent("loopPauseChanged", { loopPause: state.loopPause });
  });
  $("#toggle-auto-pause").addEventListener("click", () => {
    state.autoPause = !state.autoPause;
    updateButtonState("#toggle-auto-pause", state.autoPause);
    updatePlaybackStatusTexts();
    logEvent("autoPauseToggled", { autoPause: state.autoPause });
  });
  $("#toggle-auto-play").addEventListener("click", () => {
    state.autoPlay = !state.autoPlay;
    updateButtonState("#toggle-auto-play", state.autoPlay);
    updatePlaybackStatusTexts();
    logEvent("autoPlayToggled", { autoPlay: state.autoPlay });
  });
  $("#btn-export").addEventListener("click", exportSubtitles);
  $("#btn-export-srt").addEventListener("click", exportSubtitlesSRT);
  $("#btn-auto-sub").addEventListener("click", requestAutoSubtitles);
  $("#btn-manual-timing").addEventListener("click", openManualTimingModal);
  $("#btn-record-toggle").addEventListener("click", toggleRecording);
  $("#btn-clear-record").addEventListener("click", clearRecording);
  $("#btn-prev-sen").addEventListener("click", () => jumpPrevSubtitle());
  $("#btn-next-sen").addEventListener("click", () => jumpNextSubtitle());
  $("#btn-listen-mode").addEventListener("click", () => {
    if (!listenMode) startListenMode(); else stopListenMode();
  });
  $("#btn-split-sub").addEventListener("click", () => window.Split && window.Split.open());
  // 播放列表
  const btnClearPlaylist = $("#btn-clear-playlist");
  if (btnClearPlaylist) {
    btnClearPlaylist.addEventListener("click", clearPlaylist);
  }

  
  // 右上角统一设置按钮
  const btnSettingsHeader = $("#btn-settings-header");
  if (btnSettingsHeader) {
    btnSettingsHeader.addEventListener("click", async () => {
      const modal = $("#settings-modal");
      modal.style.display = "flex";
      renderModelSettings();
      await updateCacheInfo();
      renderPlaybackDefaultSettings();
      // 更新折叠偏好设置
      renderCollapseSettings();
      renderReadingCollapseSettings();
      // 更新生词本通用性滑块
      updateCommonVocabToggleStyle();
    });
  }
  
  // 初始化按钮状态显示
  initializeButtonStates();
  
  // 设置面板事件处理
  const btnCloseSettings = $("#btn-close-settings");
  const settingsModal = $("#settings-modal");
  if (btnCloseSettings && settingsModal) {
    btnCloseSettings.addEventListener("click", () => {
      settingsModal.style.display = "none";
    });
  }
  
  // 生词本通用性设置（滑块样式）
  const checkboxCommonVocab = $("#checkbox-common-vocab");
  const toggleCommonVocab = $("#toggle-common-vocab");
  if (checkboxCommonVocab && toggleCommonVocab) {
    checkboxCommonVocab.checked = state.settings.commonDefaultVocab;
    updateCommonVocabToggleStyle();
    
    checkboxCommonVocab.addEventListener("change", async (e) => {
      state.settings.commonDefaultVocab = e.target.checked;
      updateCommonVocabToggleStyle();
      await persistSettings();
      
      // 调用确保默认生词本配置的函数，处理数据合并和分离
      await ensureDefaultVocabBooks();
      
      // 重新初始化生词本选择器（刷新显示）
      renderVocabBookSelector();
      renderVocab();
      renderReadingVocabBookSelector();
      renderReadingVocab();
    });
    
    toggleCommonVocab.addEventListener("click", () => {
      checkboxCommonVocab.checked = !checkboxCommonVocab.checked;
      checkboxCommonVocab.dispatchEvent(new Event('change'));
    });
  }
  
  $("#btn-clear-cache").addEventListener("click", clearAllCache);
  $("#btn-export-all").addEventListener("click", exportAllData);
  // 关闭 modal 的外层点击
  $("#settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") {
      e.target.style.display = "none";
    }
  });

  // 手动打轴 Modal 事件
  const timingModal = document.getElementById('timing-modal');
  if (timingModal) {
    document.getElementById('btn-close-timing').addEventListener('click', () => closeManualTimingModal());
    document.getElementById('btn-timing-load').addEventListener('click', () => manualTimingLoadText());
    document.getElementById('btn-timing-load-subs').addEventListener('click', () => manualTimingLoadFromSubs());
    const fileEl = document.getElementById('timing-file');
    if (fileEl) fileEl.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (f) {
        const text = await f.text();
        document.getElementById('timing-text').value = text;
        manualTimingLoadText();
      }
    });
    document.getElementById('btn-timing-start').addEventListener('click', () => manualTimingStart());
    document.getElementById('btn-timing-mark-start').addEventListener('click', () => manualTimingMarkStart());
    document.getElementById('btn-timing-mark').addEventListener('click', () => manualTimingMark());
    document.getElementById('btn-timing-undo').addEventListener('click', () => manualTimingUndo());
    document.getElementById('btn-timing-reset').addEventListener('click', () => manualTimingReset());
    document.getElementById('btn-timing-finish').addEventListener('click', () => manualTimingFinish());
  }

  // 字幕列表操作按钮
  const btnSubDelete = document.getElementById('btn-sub-delete');
  const btnSubClear = document.getElementById('btn-sub-clear');
  if (btnSubDelete) btnSubDelete.addEventListener('click', deleteCurrentSubtitle);
  if (btnSubClear) btnSubClear.addEventListener('click', clearAllSubtitles);
  // 键盘快捷键
  document.addEventListener("keydown", (e) => {
    // 如果分句模态框打开，则禁用主播放页面的键盘快捷键
    const splitModal = $("#split-modal");
    if (splitModal && splitModal.style.display === 'flex') {
      return; // 让 split.js 的键盘处理接管
    }

    // 如果手动打轴打开，则使用打轴快捷键，但编辑文本时不响应
    const timingModal = document.getElementById('timing-modal');
    if (timingModal && timingModal.style.display === 'flex') {
      const timingText = document.getElementById('timing-text');
      if (timingText && document.activeElement === timingText) {
        // 正在编辑文本框，忽略打轴快捷键
        return;
      }
      if (e.code === 'Space') { e.preventDefault(); manualTimingMark(); return; }
      if (e.code === 'Backspace') { e.preventDefault(); manualTimingUndo(); return; }
      if (e.code === 'ArrowLeft') { e.preventDefault(); const p = document.getElementById('player'); if (p) p.currentTime = Math.max(0, (p.currentTime||0) - 5); return; }
      if (e.code === 'ArrowRight') { e.preventDefault(); const p = document.getElementById('player'); if (p) p.currentTime = Math.min(p.duration||p.currentTime, (p.currentTime||0) + 5); return; }
      if (e.code === 'Enter') { e.preventDefault(); const p = document.getElementById('player'); if (p) { if (p.paused) p.play(); else p.pause(); } return; }
    }
    
    // 如果焦点在文本编辑区域（字幕编辑器），则禁用播放控制快捷键
    const activeElement = document.activeElement;
    const isEditingText = activeElement && (
      activeElement.tagName === 'TEXTAREA' || 
      activeElement.tagName === 'INPUT' ||
      activeElement.isContentEditable
    );
    
    // Ctrl+Z: 撤销（全局有效，包括编辑区域）
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      // 检查焦点是否在播放列表区域
      const playlistEl = document.getElementById('playlist');
      const isFocusInPlaylist = playlistEl && playlistEl.contains(document.activeElement);
      
      if (isFocusInPlaylist) {
        undoPlaylist();
      } else {
        undo();
      }
      return;
    }
    
    // Ctrl+Shift+Z 或 Ctrl+Y: 重做（全局有效，包括编辑区域）
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'z' || e.key === 'y')) {
      e.preventDefault();
      // 检查焦点是否在播放列表区域
      const playlistEl = document.getElementById('playlist');
      const isFocusInPlaylist = playlistEl && playlistEl.contains(document.activeElement);
      
      if (isFocusInPlaylist) {
        redoPlaylist();
      } else {
        redo();
      }
      return;
    }
    
    // 以下快捷键在文本编辑时不生效
    if (isEditingText) {
      return;
    }
    
    // 空格键：精听模式下重复当前句，普通模式下播放/暂停
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault(); // 阻止默认翻页
      if (listenMode) {
        // 精听模式：重复当前句（从头播放）
        if (state.currentIndex >= 0) {
          jumpToSubtitle(state.currentIndex, false, true);
        }
      } else {
        const player = $("#player");
        if (player.paused) {
          player.play();
        } else {
          player.pause();
        }
      }
    }
    
    // 方向键上/下：上一句/下一句（精听模式下自动播放）
    if (e.code === "ArrowUp" || e.key === "ArrowUp") {
      e.preventDefault();
      jumpPrevSubtitle(listenMode || state.autoPlay); // 精听或自动播放时强制播放
    }
    if (e.code === "ArrowDown" || e.key === "ArrowDown") {
      e.preventDefault();
      jumpNextSubtitle(listenMode || state.autoPlay); // 精听或自动播放时强制播放
    }
    
    // 方向键左/右：时间轴前后调整（5秒）
    if (e.code === "ArrowLeft" || e.key === "ArrowLeft") {
      e.preventDefault();
      const player = $("#player");
      player.currentTime = Math.max(0, player.currentTime - 5);
      logEvent("seekBackward", { time: player.currentTime });
    }
    if (e.code === "ArrowRight" || e.key === "ArrowRight") {
      e.preventDefault();
      const player = $("#player");
      player.currentTime = Math.min(player.duration || player.currentTime, player.currentTime + 5);
      logEvent("seekForward", { time: player.currentTime });
    }
    
    // Delete 键：删除当前字幕（仅在波形图聚焦时）
    if (e.code === "Delete" || e.key === "Delete") {
      const waveformContainer = $("#player-waveform");
      if (document.activeElement === waveformContainer || waveformContainer.contains(document.activeElement)) {
        e.preventDefault();
        if (state.currentIndex >= 0) {
          if (confirm(`确定要删除第 ${state.currentIndex + 1} 条字幕吗？`)) {
            deleteSubtitle(state.currentIndex);
            renderWaveformRegions();
          }
        }
      }
    }
    
    // D 键：重复当前区域
    if ((e.key === 'D' || e.key === 'd') && e.ctrlKey) {
      e.preventDefault();
      if (state.currentIndex >= 0) {
        saveHistory();
        const sub = state.subtitles[state.currentIndex];
        const newSub = JSON.parse(JSON.stringify(sub));
        newSub.start = sub.end + 0.1;
        newSub.end = newSub.start + (sub.end - sub.start);
        state.subtitles.splice(state.currentIndex + 1, 0, newSub);
        persistSubtitles();
        renderSubtitles();
        renderWaveformRegions();
      }
    }
    
    // Ctrl+Z: 撤销
    if ((e.key === 'z' || e.key === 'Z') && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    
    // Ctrl+Y 或 Ctrl+Shift+Z: 重做
    if (((e.key === 'y' || e.key === 'Y') && e.ctrlKey) || 
        ((e.key === 'z' || e.key === 'Z') && e.ctrlKey && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  });
};

// Cache management ---------------------------------------------------------

const getCacheSize = async () => {
  try {
    const response = await fetch("/api/user-data/size");
    const data = await response.json();
    if (data.status === "success") {
      console.log("✓ 缓存统计", data);
      return data;
    }
  } catch (e) {
    console.warn("⚠ 获取缓存大小失败", e);
  }
  return { bytes: { media: 0, subtitles: 0, vocab: 0, playlists: 0, settings: 0, total: 0 }, total_kb: 0 };
};

// 格式化字节大小为易读的单位
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(1, bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const updateCacheInfo = async () => {
  const cacheInfoEl = $("#cache-info");
  if (cacheInfoEl) {
    const data = await getCacheSize();
    const bytes = data.bytes || {};
    const vocabBookCount = state.vocabBooks.length;
    const vocabTotal = state.vocabBooks.reduce((sum, vb) => sum + vb.words.length, 0);
    
    // 计算阅读文件数据统计
    const readingDocCount = readingState.documents.length;
    let readingDataSize = 0;
    
    // 计算阅读文档占用空间（本地数据）
    if (readingState.documents && readingState.documents.length > 0) {
      const readingDocsJson = JSON.stringify(readingState.documents);
      readingDataSize += readingDocsJson.length;
    }
    
    let html = `<strong>📊 数据统计</strong><br>`;
    const totalBytes = bytes.total || data.total_bytes || 0;
    html += `<strong>总占用：</strong> ${formatBytes(totalBytes)}<br>`;
    
    if (bytes.media > 0) html += `<strong>📁 导入文件：</strong> ${formatBytes(bytes.media)}<br>`;
    if (bytes.subtitles > 0) html += `<strong>📝 字幕数据：</strong> ${formatBytes(bytes.subtitles)}<br>`;
    html += `<strong>📚 生词本：</strong> ${vocabBookCount} 本，${vocabTotal} 词<br>`;
    
    // 添加阅读文件统计
    if (readingDocCount > 0) {
      html += `<strong>📖 阅读文档：</strong> ${readingDocCount} 个文件，约 ${formatBytes(readingDataSize)}<br>`;
    }
    
    if (bytes.settings > 0) html += `<strong>⚙️ 设置数据：</strong> ${formatBytes(bytes.settings)}<br>`;
    
    cacheInfoEl.innerHTML = html;
  }
};

const clearAllCache = async () => {
  if (confirm("确定要清除所有缓存吗？\n包括：字幕、生词本、播放列表和所有用户数据\n此操作不可恢复！")) {
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key) && key.startsWith("lr-")) {
        localStorage.removeItem(key);
      }
    }
    // 清空播放列表 URL
    state.playlist.forEach(item => URL.revokeObjectURL(item.url));
    state.playlist = [];
    state.subtitles = [];
    state.vocab = [];
    state.currentPlaylistIndex = -1;
    
    $("#player").src = "";
    renderPlaylist();
    renderSubtitles();
    renderVocab();
    await updateCacheInfo();
    alert("✅ 所有缓存已清除");
  }
};

const exportAllData = () => {
  const allData = {
    exportTime: new Date().toISOString(),
    version: "1.0",
    data: {
      subtitles: state.subtitles,
      vocab: state.vocab,
      playlist: state.playlist.map(item => ({ name: item.name }))
    }
  };
  downloadFile(
    JSON.stringify(allData, null, 2),
    `learning-data-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json"
  );
  alert("✅ 所有数据已导出为 JSON 文件");
};

const formatTimeWithMs = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  const ms = Math.floor((seconds % 1) * 100).toString().padStart(2, "0");
  return `${m}:${s}.${ms}`;
};

const init = async () => {
  await loadSettings();
  applyPlaybackDefaultsFromSettings();
  await loadVocab();
  await loadPlaylist();

  // 如果没有本地模型，则引导用户在设置中选择下载
  try {
    const info = await fetchModels();
    if (info.status === 'success' && (!info.local || info.local.length === 0)) {
      const modal = document.getElementById('settings-modal');
      if (modal) {
        modal.style.display = 'flex';
        renderModelSettings();
        alert('⚠️ 未检测到本地 Whisper 模型，请在设置中选择下载。');
      }
    }
  } catch (e) { /* ignore */ }
  renderVocabBookSelector();
  renderVocab();
  renderPlaylist();
  updateMediaName();
  bindInputs();
  bindEditors();
  bindVocabForm();
  renderSubtitles();
  bindCollapsibles();
  renderCollapseSettings();
  renderReadingCollapseSettings();
  renderPlaybackDefaultSettings();

  const player = $("#player");
  if (player) {
    player.addEventListener('loadedmetadata', () => {
      const isAudio = (player.videoWidth === 0 && player.videoHeight === 0) || player.videoHeight <= 0;
      updatePlayerMediaMode(isAudio);
      // 在视频模式下，元数据加载完成后同步一次波形高度
      syncWaveformHeight();
    });
  }
  updateHistoryButtons(); // 初始化撤销/重做按钮状态
  
  // 初始化主播放器波形图
  if (window.WaveSurfer) {
    try {
      const player = $("#player");
      const container = $("#player-waveform");
      
      playerWavesurfer = window.WaveSurfer.create({
        container: "#player-waveform",
        waveColor: "rgba(99, 102, 241, 0.3)",
        progressColor: "rgba(99, 102, 241, 0.8)",
        cursorColor: "rgba(139, 92, 246, 0.9)",
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 80,
        normalize: true,
        interact: true,
        fillParent: true,
        minPxPerSec: 100,
        autoScroll: true,
        autoScrollInterval: 100,
      });
      
      // 立即注入样式隐藏滚动条（在 ready 之前）
      const injectScrollStyle = () => {
        const waveformDiv = container.querySelector('div:nth-child(1)');
        if (waveformDiv?.shadowRoot) {
          const style = document.createElement('style');
          style.textContent = `
            [part="scroll"] {
              overflow-x: hidden !important;
              overflow-y: hidden !important;
            }
          `;
          waveformDiv.shadowRoot.appendChild(style);
          console.log('✓ 成功隐藏主波形的滚动条（创建时）');
          return true;
        }
        return false;
      };
      
      // 立即尝试注入
      if (!injectScrollStyle()) {
        // 如果 shadowRoot 还没创建，使用 MutationObserver 监听
        const observer = new MutationObserver((mutations) => {
          if (injectScrollStyle()) {
            observer.disconnect();
          }
        });
        observer.observe(container, { childList: true, subtree: true });
        // 5秒后停止观察
        setTimeout(() => observer.disconnect(), 5000);
      }
      
      // 初始化Cursor插件 - 跟随鼠标的时间头
      // 检查是否真的加载了 Cursor 脚本
      // 实现自定义鼠标跟随时间显示和光标线（因为 WaveSurfer v7 中 Cursor 插件不可用）
      const waveformContainer = container;
      
      // 初始化Regions插件
      if (window.WaveSurfer.Regions) {
        playerRegions = playerWavesurfer.registerPlugin(window.WaveSurfer.Regions.create());
        
        // 跟踪当前活动区域
        let activeRegionId = null;
        
        // 监听区域更新事件 - 实时保存字幕时间
        playerRegions.on('region-updated', (region) => {
          const idx = parseInt(region.id.replace('subtitle-', ''));
          if (!isNaN(idx) && state.subtitles[idx]) {
            const start = Math.max(0, region.start);
            const end = Math.min(playerWavesurfer.getDuration(), region.end);
            
            // 防止无效的时间范围
            if (start >= end) {
              region.play();
              return;
            }
            
            saveHistory();
            state.subtitles[idx].start = start;
            state.subtitles[idx].end = end;
            persistSubtitles();
            renderSubtitles();
            renderEditors();
            logEvent('subtitleTimeUpdated', { idx, start: region.start, end: region.end });
          }
        });
        
        // 点击区域跳转到该字幕
        playerRegions.on('region-clicked', (region, e) => {
          e.stopPropagation();
          const idx = parseInt(region.id.replace('subtitle-', ''));
          if (!isNaN(idx)) {
            // 更新活动区域ID
            activeRegionId = region.id;
            
            // 刷新所有区域以应用活动样式
            const allRegions = document.querySelectorAll('.ws-region');
            allRegions.forEach(el => el.classList.remove('active'));
            region.element?.classList.add('active');
            
            jumpToSubtitle(idx, false, true); // 跳转并播放
            logEvent('regionClicked', { idx, start: region.start, end: region.end });
          }
        });
        
        // 区域进入事件 - 字幕跟随波形图
        playerRegions.on('region-in', (region) => {
          const idx = parseInt(region.id.replace('subtitle-', ''));
          if (!isNaN(idx)) {
            activeRegionId = region.id;
            
            // 刷新所有区域以应用活动样式
            const allRegions = document.querySelectorAll('.ws-region');
            allRegions.forEach(el => el.classList.remove('active'));
            region.element?.classList.add('active');
            
            const subtitleEl = $(`#subtitle-${idx}`);
            if (subtitleEl) {
              subtitleEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            logEvent('regionEntered', { idx, start: region.start, end: region.end });
          }
        });
        
        // 区域离开事件
        playerRegions.on('region-out', (region) => {
          region.element?.classList.remove('active');
        });
      }
      
      // 点击波形图跳转播放位置
      playerWavesurfer.on("click", (progress) => {
        player.currentTime = progress * player.duration;
      });
      
      // 波形图加载完成
      playerWavesurfer.on("ready", () => {
        logEvent("playerWaveformReady", { duration: playerWavesurfer.getDuration() });
        // 如果当前处于视频并排布局，按播放器高度同步波形容器
        syncWaveformHeight();
        // 加载完成后渲染字幕区域
        renderWaveformRegions();
        
        // 调试：打印实际DOM结构
        console.log('container HTML:', container.innerHTML.substring(0, 500));
        
        // 获取所有子元素信息
        const allChildren = container.querySelectorAll('*');
        console.log('容器内所有元素数:', allChildren.length);
        allChildren.forEach((el, i) => {
          if (i < 10) {
            console.log(`元素${i}:`, el.tagName, {
              className: el.className,
              part: el.getAttribute('part'),
              width: el.offsetWidth,
              scrollWidth: el.scrollWidth,
              overflowX: window.getComputedStyle(el).overflowX
            });
          }
        });
        
        // 查看ready时的结构 - 尝试多种方式查找scroll容器
        let scrollContainer = container.querySelector('[part="scroll"]');
        if (!scrollContainer) {
          // 如果part属性没有找到，尝试找overflow-x:auto的div
          scrollContainer = container.querySelector('div[style*="overflow-x: auto"]');
        }
        if (!scrollContainer) {
          // 如果还是没有，尝试找类名为scroll的div
          scrollContainer = container.querySelector('div.scroll');
        }
        if (!scrollContainer) {
          // 最后尝试找第一个overflow-x属性的元素
          const allDivs = container.querySelectorAll('div');
          for (const div of allDivs) {
            const style = window.getComputedStyle(div);
            if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
              scrollContainer = div;
              break;
            }
          }
        }
        
        console.log('Ready事件中找到的scroll容器:', scrollContainer, {
          scrollWidth: scrollContainer?.scrollWidth,
          clientWidth: scrollContainer?.clientWidth,
          className: scrollContainer?.className,
          part: scrollContainer?.getAttribute('part')
        });
        
        // 添加滚轮只滚动波形图的水平滚动条（必须在 ready 之后）
        // WaveSurfer 使用 Shadow DOM，需要通过 shadowRoot 访问
        setTimeout(() => {
          let scrollableContainer = null;
          
          // 获取 WaveSurfer 的主容器（第一个 div）
          const waveformDiv = container.querySelector('div:nth-child(1)');
          if (waveformDiv?.shadowRoot) {
            // 通过 shadowRoot 查找 [part="scroll"] 元素
            scrollableContainer = waveformDiv.shadowRoot.querySelector('[part="scroll"]');
            console.log('通过 shadowRoot 找到的scroll容器:', {
              exists: !!scrollableContainer,
              scrollWidth: scrollableContainer?.scrollWidth,
              clientWidth: scrollableContainer?.clientWidth,
              canScroll: scrollableContainer && scrollableContainer.scrollWidth > scrollableContainer.clientWidth
            });
          } else {
            console.log('未找到 shadowRoot');
          }
          
          // 如果找到了可滚动的容器，添加滚轮监听
          if (scrollableContainer && scrollableContainer.scrollWidth > scrollableContainer.clientWidth) {
            console.log('✓ 成功配置滚轮滚动');
            container.addEventListener('wheel', (e) => {
              e.preventDefault();
              scrollableContainer.scrollLeft += e.deltaY * 0.5;
            }, { passive: false });
          } else {
            console.log('✗ 无法配置滚轮滚动');
          }
        }, 500);
      });
      
      // 同步播放进度（只更新进度显示，不播放声音）
      // 使用节流限制更新频率，避免抽搐
      const updateWaveProgress = throttle(() => {
        if (isSeekingWave || !playerWavesurfer || !player.duration) return;
        
        const progress = player.currentTime / player.duration;
        if (!isNaN(progress) && progress >= 0 && progress <= 1) {
          isSeekingWave = true;
          try {
            playerWavesurfer.seekTo(progress);
          } catch (e) {
            console.warn('波形图进度更新失败:', e);
          }
          setTimeout(() => { isSeekingWave = false; }, 50);
        }
      }, 100); // 每100ms最多更新一次
      
      player.addEventListener("timeupdate", () => {
        // 只在100%（非缩放）状态下自动更新进度
        if (waveZoomPercent === 100) {
          updateWaveProgress();
        }
      });
      
      logEvent("playerWaveformInitialized");
    } catch (e) {
      console.error("波形图初始化失败:", e);
    }
  } else {
    console.warn("WaveSurfer 库未加载");
  }

  // 窗口尺寸变化时，若为视频并排布局，保持右侧波形高度与播放器一致
  window.addEventListener('resize', () => {
    syncWaveformHeight();
  });
  
  // 绑定波形图缩放按钮（在WaveSurfer块外面）
  const btnZoomIn = $("#btn-wave-zoom-in");
  const btnZoomOut = $("#btn-wave-zoom-out");
  const btnZoomReset = $("#btn-wave-zoom-reset");
  const zoomInput = $("#wave-zoom-percent");
  
  // 应用缩放的函数
  const applyZoom = (percent) => {
    waveZoomPercent = Math.max(100, Math.min(2000, percent)); // 限制在100%-2000%
    if (zoomInput) zoomInput.value = waveZoomPercent;
    
    if (playerWavesurfer) {
      // WaveSurfer的zoom参数是像素/秒
      // 基础值50像素/秒对应100%，按比例计算
      const pxPerSec = (waveZoomPercent / 100) * 50;
      playerWavesurfer.zoom(pxPerSec);
      
      logEvent("waveZoom", { percent: waveZoomPercent, pxPerSec: pxPerSec });
    }
  };
  
  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      applyZoom(waveZoomPercent + 5); // 增加5%
    });
  }
  
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      applyZoom(waveZoomPercent - 5); // 减少5%
    });
  }
  
  if (btnZoomReset) {
    btnZoomReset.addEventListener("click", () => {
      applyZoom(100); // 重置到100%
    });
  }
  
  // 自定义缩放输入
  if (zoomInput) {
    zoomInput.addEventListener("change", () => {
      const percent = parseInt(zoomInput.value) || 100;
      applyZoom(percent);
    });
    
    zoomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const percent = parseInt(zoomInput.value) || 100;
        applyZoom(percent);
      }
    });
  }
  
  // 精确时间跳转功能
  const timeInput = $("#wave-time-input");
  const btnTimeGo = $("#btn-wave-time-go");
  const playerEl = $("#player");
  
  if (timeInput && btnTimeGo) {
    const jumpToTime = () => {
      const timeStr = timeInput.value;
      if (!timeStr) return;
      
      const seconds = parseTimeString(timeStr);
      if (seconds >= 0 && seconds <= playerEl.duration) {
        playerEl.currentTime = seconds;
        updateTimeDisplay();
        logEvent("jumpToTime", { time: seconds, formatted: formatPreciseTime(seconds) });
      } else {
        alert("时间超出范围！");
      }
    };
    
    btnTimeGo.addEventListener("click", jumpToTime);
    timeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") jumpToTime();
    });
    
    // 输入框失焦时跳转到指定时间
    timeInput.addEventListener("blur", jumpToTime);
    
    // 点击输入框时自动填充当前时间
    timeInput.addEventListener("focus", () => {
      if (!timeInput.value && playerEl.currentTime) {
        timeInput.value = formatPreciseTime(playerEl.currentTime);
      }
      timeInput.select(); // 选中所有文本便于快速替换
    });
  }
};

window.addEventListener("DOMContentLoaded", async () => {
  await init();
  initReadingModule();
});

// 全局点击隐藏右键菜单
document.addEventListener("click", (e) => {
  if (state.contextMenu.visible && !e.target.closest(".context-menu")) {
    hideContextMenu();
  }
});

document.addEventListener("contextmenu", (e) => {
  if (state.contextMenu.visible && !e.target.closest(".context-menu")) {
    hideContextMenu();
  }
});

const readingState = {
  currentDocId: null,
  documents: [], // 存储已导入的文档列表
  text: "", // 完整文本内容
  totalChars: 0, // 总字符数
  scrollPercent: 0, // 滚动百分比
  notes: [],
  selectedText: "",
  selectedPosition: { start: 0, end: 0 },
  allWords: [],
  currentSearchQuery: "",
  searchResults: [],
  currentVocabBookId: null, // 阅读模块独立的生词本选择
};

// 取消阅读进度
const cancelReadingProgress = () => {
  const progressContainer = $('#reading-progress-container');
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }
};

// 模式切换
const initModeNavigation = () => {
  const listeningBtn = $('#mode-listening');
  const readingBtn = $('#mode-reading');
  const listeningModule = $('#listening-module');
  const readingModule = $('#reading-module');
  
  if (!listeningBtn || !readingBtn) return;
  
  listeningBtn.addEventListener('click', () => {
    listeningModule.style.display = 'flex';
    readingModule.style.display = 'none';
    listeningBtn.classList.add('active');
    readingBtn.classList.remove('active');
  });
  
  readingBtn.addEventListener('click', () => {
    readingModule.style.display = 'flex';
    listeningModule.style.display = 'none';
    readingBtn.classList.add('active');
    listeningBtn.classList.remove('active');
  });
};

// 文件上传处理
const initReadingFileUpload = () => {
  const fileInput = $('#reading-file-upload');
  if (!fileInput) return;
  
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    for (const file of files) {
      await uploadReadingDocument(file);
    }
    
    // 清空input，允许重复选择同一文件
    fileInput.value = '';
  });
  
  // 添加拖拽上传支持
  const documentsBody = $('#reading-documents-body');
  if (documentsBody) {
    documentsBody.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      documentsBody.style.backgroundColor = 'rgba(100, 150, 255, 0.1)';
      documentsBody.style.borderColor = 'var(--accent)';
    });
    
    documentsBody.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      documentsBody.style.backgroundColor = '';
      documentsBody.style.borderColor = '';
    });
    
    documentsBody.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      documentsBody.style.backgroundColor = '';
      documentsBody.style.borderColor = '';
      
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      
      for (const file of files) {
        await uploadReadingDocument(file);
      }
    });
  }
  
  // 清空文档列表
  const clearBtn = $('#btn-reading-clear-documents');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('确定要清空所有文档吗？')) {
        readingState.documents = [];
        renderReadingDocumentsList();
        localStorage.setItem('readingDocuments', JSON.stringify([]));
      }
    });
  }
};

// 渲染文档列表
const renderReadingDocumentsList = () => {
  const listDiv = $('#reading-documents-list');
  if (!listDiv) return;
  
  // 更新文档列表标题，显示长度
  const documentsTitle = document.querySelector("#reading-documents-title");
  if (documentsTitle) {
    documentsTitle.textContent = `文档列表 (${readingState.documents.length})`;
  }
  
  if (readingState.documents.length === 0) {
    listDiv.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 12px; font-size: 12px;">暂无文档</p>';
    return;
  }
  
  // 构建树形结构
  const treeData = buildDocumentsTree(readingState.documents);
  
  // 渲染树形结构
  listDiv.innerHTML = "";
  renderTreeNode(listDiv, treeData, "documents");
  
  // 绑定点击事件
  bindDocumentsEvents(listDiv);
  
  // 绑定右键菜单事件
  bindDocumentsContextMenu(listDiv);
  
  // 绑定新建文件夹按钮事件
  const createFolderBtn = document.getElementById('btn-create-folder');
  if (createFolderBtn) {
    createFolderBtn.addEventListener('click', async () => {
      const folderName = prompt('请输入文件夹名称:');
      if (folderName && folderName.trim()) {
        await createFolder(folderName.trim());
      }
    });
  }
};

const buildDocumentsTree = (documents) => {
  const tree = { children: [], name: "root", type: "folder" };
  
  documents.forEach((doc) => {
    const name = doc.filename || "";
    const folder = doc.folder || "";
    
    let currentNode = tree;
    let currentPath = "";
    
    // 处理文件夹路径
    if (folder) {
      const folderParts = folder.split(/[\\/]/);
      folderParts.forEach((part) => {
        if (part) {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          
          let folderNode = currentNode.children.find(
            child => child.type === "folder" && child.name === part
          );
          
          if (!folderNode) {
            folderNode = {
              name: part,
              type: "folder",
              path: `documents/${currentPath}`,
              children: [],
              expanded: false
            };
            currentNode.children.push(folderNode);
          }
          
          currentNode = folderNode;
        }
      });
    }
    
    // 添加文件
    currentNode.children.push({
      name: name,
      type: "file",
      docId: doc.id,
      doc: doc
    });
  });
  
  return tree.children;
};

const bindDocumentsEvents = (listDiv) => {
  listDiv.querySelectorAll('.tree-node-content').forEach(contentEl => {
    contentEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('tree-toggle')) return;
      
      const nodeEl = contentEl.closest('.tree-node');
      const docId = nodeEl?.dataset.docId;
      
      if (docId) {
        loadReadingDocument(docId);
      }
    });
  });
};

const bindDocumentsContextMenu = (listDiv) => {
  if (listDiv.dataset.contextMenuBound) return;
  
  listDiv.addEventListener("contextmenu", (e) => {
    const contentEl = e.target.closest(".tree-node-content");
    const nodeEl = e.target.closest(".tree-node");
    
    if (contentEl && nodeEl) {
      const idx = nodeEl.dataset.index;
      const docId = nodeEl.dataset.docId;
      const folderName = nodeEl.dataset.folderName;
      
      if (docId !== undefined && docId !== null) {
        showContextMenu(e, "documents-file", { docId: docId });
      } else if (folderName) {
        showContextMenu(e, "documents-folder", { name: folderName });
      } else {
        showContextMenu(e, "documents-root", null);
      }
    } else {
      showContextMenu(e, "documents-root", null);
    }
  });
  
  listDiv.dataset.contextMenuBound = "1";
};

// 删除文档
const deleteReadingDocument = async (docId) => {
  if (!confirm('确定要删除这个文档吗？')) return;

  try {
    const resp = await fetch(`/api/reading/delete-document/${docId}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok || data.status !== 'success') {
      throw new Error(data.error || '删除失败');
    }
  } catch (err) {
    console.error('删除文档失败:', err);
    alert(`删除失败: ${err.message || err}`);
    return;
  }
  
  readingState.documents = readingState.documents.filter(doc => doc.id !== docId);
  localStorage.setItem('readingDocuments', JSON.stringify(readingState.documents));
  renderReadingDocumentsList();
  
  if (readingState.currentDocId === docId) {
    readingState.currentDocId = null;
    readingState.text = "";
    readingState.totalChars = 0;
    $('#reading-content').innerHTML = '<p style="color: var(--muted); text-align: center; padding: 20px;">请从文档列表中选择文档</p>';
    $('#reading-current-file').textContent = '未选择';
    updateReadingProgress();
  }
};

// 加载文档列表
const loadReadingDocuments = async () => {
  try {
    const response = await fetch('/api/reading/documents');
    const data = await response.json();
    if (data.status === 'success' && data.documents) {
      readingState.documents = Object.entries(data.documents).map(([id, info]) => ({
        id,
        filename: info.filename,
        folder: info.folder || "",
        charCount: info.char_count || 0,
        totalWords: info.total_words || 0,
        uploadTime: new Date(parseFloat(info.upload_time) * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        readProgress: { scrollPercent: 0, scrollPosition: 0 }
      }));
      localStorage.setItem('readingDocuments', JSON.stringify(readingState.documents));
    }
  } catch (e) {
    console.warn('加载文档列表失败', e);
  }
};

// 创建文件夹
const createReadingFolder = async (folderName, parentPath = "") => {
  try {
    const response = await fetch('/api/reading/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_name: folderName, parent_path: parentPath })
    });
    
    const data = await response.json();
    if (data.status !== 'success') {
      throw new Error(data.error || '创建文件夹失败');
    }
    
    // 重新加载文档列表
    await loadReadingDocuments();
    renderReadingDocumentsList();
    
    return true;
  } catch (err) {
    console.error('创建文件夹失败:', err);
    alert(`创建文件夹失败: ${err.message || err}`);
    return false;
  }
};

// 删除文件夹
const deleteReadingFolder = async (folderPath) => {
  if (!confirm('确定要删除这个文件夹吗？文件夹中的所有文件也会被删除。')) return;

  try {
    const response = await fetch('/api/reading/delete-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath })
    });
    
    const data = await response.json();
    if (data.status !== 'success') {
      throw new Error(data.error || '删除文件夹失败');
    }
    
    // 重新加载文档列表
    await loadReadingDocuments();
    renderReadingDocumentsList();
    
    return true;
  } catch (err) {
    console.error('删除文件夹失败:', err);
    alert(`删除文件夹失败: ${err.message || err}`);
    return false;
  }
};

// 重命名文件夹
const renameReadingFolder = async (oldPath, newName) => {
  try {
    const response = await fetch('/api/reading/rename-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_path: oldPath, new_name: newName })
    });
    
    const data = await response.json();
    if (data.status !== 'success') {
      throw new Error(data.error || '重命名文件夹失败');
    }
    
    // 重新加载文档列表
    await loadReadingDocuments();
    renderReadingDocumentsList();
    
    return true;
  } catch (err) {
    console.error('重命名文件夹失败:', err);
    alert(`重命名文件夹失败: ${err.message || err}`);
    return false;
  }
};

// 移动文档到文件夹
const moveDocumentToFolder = async (docId, targetFolder) => {
  try {
    const response = await fetch('/api/reading/move-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_id: docId, target_folder: targetFolder })
    });
    
    const data = await response.json();
    if (data.status !== 'success') {
      throw new Error(data.error || '移动文档失败');
    }
    
    // 更新本地文档信息
    const doc = readingState.documents.find(d => d.id === docId);
    if (doc) {
      doc.folder = targetFolder;
    }
    
    localStorage.setItem('readingDocuments', JSON.stringify(readingState.documents));
    renderReadingDocumentsList();
    
    return true;
  } catch (err) {
    console.error('移动文档失败:', err);
    alert(`移动文档失败: ${err.message || err}`);
    return false;
  }
};

const uploadReadingDocument = async (file, folder = "") => {
  const progressContainer = $('#reading-progress-container');
  const progressText = $('#reading-progress-text');
  const progressPercent = $('#reading-progress-percent');
  const progressFill = $('#reading-progress-fill');
  
  progressContainer.style.display = 'block';
  progressText.textContent = '上传中...';
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    
    const response = await fetch('/api/reading/upload-document', {
      method: 'POST',
      body: formData
    });
    
    progressText.textContent = '处理中...';
    progressPercent.textContent = '75%';
    progressFill.style.width = '75%';
    
    const data = await response.json();
    
    if (data.status === 'success') {
      // 添加到文档列表
      const docInfo = {
        id: data.doc_id,
        filename: data.filename,
        folder: data.folder || folder,
        charCount: data.char_count || 0,
        totalWords: data.total_words || 0,
        uploadTime: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        readProgress: { scrollPercent: 0, scrollPosition: 0 }
      };
      
      // 检查是否已存在
      const existingIndex = readingState.documents.findIndex(doc => doc.id === data.doc_id);
      if (existingIndex === -1) {
        readingState.documents.push(docInfo);
      } else {
        readingState.documents[existingIndex] = docInfo;
      }
      
      // 保存到localStorage
      localStorage.setItem('readingDocuments', JSON.stringify(readingState.documents));
      renderReadingDocumentsList();
      
      // 自动加载文档
      readingState.currentDocId = data.doc_id;
      await loadReadingDocument(data.doc_id);
      
      progressText.textContent = '完成!';
      progressPercent.textContent = '100%';
      progressFill.style.width = '100%';
      
      setTimeout(() => {
        progressContainer.style.display = 'none';
      }, 1000);
    } else {
      alert('上传失败: ' + data.error);
    }
  } catch (e) {
    alert('上传错误: ' + e.message);
  }
};

// 加载文档内容
const loadReadingDocument = async (docId) => {
  try {
    const response = await fetch(`/api/reading/load-document/${docId}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      readingState.currentDocId = docId;
      readingState.text = data.text || "";
      readingState.totalChars = data.char_count || 0;
      readingState.totalWords = data.total_words || 0;
      readingState.viewUrl = data.view_url || null;
      readingState.metadata = data.metadata || {};  // ✅ 添加此行保存metadata
      
      // 更新当前文件名显示
      const doc = readingState.documents.find(d => d.id === docId);
      if (doc) {
        $('#reading-current-file').textContent = doc.filename;
        // 更新文档列表中的总词数
        if (doc.totalWords === undefined && readingState.totalWords) {
          doc.totalWords = readingState.totalWords;
        }
      }
      
      // 更新文档列表激活状态
      renderReadingDocumentsList();
      
      // 显示内容（若有viewUrl优先原样展示）
      displayReadingContent();
      
      await Promise.all([
        loadReadingNotes(docId),
        loadDocumentWords(docId)
      ]);
      
      // 加载阅读进度
      await loadDocumentProgress(docId);
      
      updateReadingProgress();
    }
  } catch (e) {
    console.error('加载文档失败:', e);
  }
};

// 显示阅读内容
const displayReadingContent = () => {
  const contentDiv = $('#reading-content');
  if (!contentDiv) return;
  
  const fileType = readingState.metadata?.ext || '';
  console.log('🎯 displayReadingContent:', { fileType, viewUrl: readingState.viewUrl, metadata: readingState.metadata });
  
  // 1️⃣ PDF - 用专门的 PDF.js 查看器完整显示
  if (fileType === '.pdf' && readingState.viewUrl) {
    console.log('✅ 检测到PDF，使用PDF.js查看器');
    // 使用自定义 PDF.js 查看器确保完整的排版和功能
    const cacheBuster = Date.now();
    const currentVocabBookId = readingState.currentVocabBookId || '';
    const pdfViewerUrl = `/static/pdf-viewer.html?v=${cacheBuster}&file=${encodeURIComponent(readingState.viewUrl)}&vocabBookId=${encodeURIComponent(currentVocabBookId)}`;
    console.log('📄 PDF查看器URL:', pdfViewerUrl);
    contentDiv.innerHTML = `<iframe class="doc-viewer" src="${pdfViewerUrl}" allow="fullscreen"></iframe>`;
    return;
  }
  
  // 2️⃣ 转换后的 DOCX -> PDF - 用 PDF.js 查看器显示
  if (readingState.metadata?.converted_pdf && readingState.viewUrl) {
    const cacheBuster = Date.now();
    const currentVocabBookId = readingState.currentVocabBookId || '';
    const pdfViewerUrl = `/static/pdf-viewer.html?v=${cacheBuster}&file=${encodeURIComponent(readingState.viewUrl)}&vocabBookId=${encodeURIComponent(currentVocabBookId)}`;
    contentDiv.innerHTML = `<iframe class="doc-viewer" src="${pdfViewerUrl}" allow="fullscreen"></iframe>`;
    return;
  }

  if (!readingState.text) {
    contentDiv.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 20px;">文档内容为空</p>';
    return;
  }
  
  // 3️⃣ Markdown - 使用 marked.js 解析并显示
  if (fileType === '.md') {
    try {
      const htmlContent = marked.parse(readingState.text);
      contentDiv.innerHTML = htmlContent;
      // 为 Markdown 生成的内容绑定选中事件
      contentDiv.addEventListener('mouseup', handleTextSelection);
      highlightReadingVocabInContent();
      setupScrollListener();
      return;
    } catch (e) {
      console.error('Markdown 解析失败:', e);
      // 降级为纯文本显示
    }
  }
  
  // 4️⃣ EPUB - HTML 内容直接显示
  const isHtmlContent = /<[^>]+>/g.test(readingState.text);
  if (fileType === '.epub' && isHtmlContent) {
    contentDiv.innerHTML = readingState.text;
    contentDiv.addEventListener('mouseup', handleTextSelection);
    highlightReadingVocabInContent();
    setupScrollListener();
    return;
  }
  
  // 5️⃣ TXT 和其他纯文本 - 格式化显示，支持选中和高亮
  const paragraphs = readingState.text.split(/\n\n+/);
  contentDiv.innerHTML = paragraphs
    .filter(p => p.trim())
    .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
    .join('');
  
  // 高亮已添加的词汇
  highlightReadingVocabInContent();
  
  // 绑定选中事件支持笔记和生词本功能
  contentDiv.addEventListener('mouseup', handleTextSelection);
  
  // 绑定滚动进度更新
  setupScrollListener();
};

// 监听来自PDF查看器的进度更新
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'pdfProgressUpdate') {
    const progress = event.data.progress;
    console.log('📩 收到PDF进度更新:', progress);
    
    // 更新当前文档的进度记录
    const doc = readingState.documents.find(d => d.id === readingState.currentDocId);
    if (doc) {
      doc.readProgress = {
        scrollPercent: progress.scrollPercent || 0,
        pagePercent: progress.pagePercent || 0,
        scrollPosition: progress.scrollPosition || 0
      };
      localStorage.setItem('readingDocuments', JSON.stringify(readingState.documents));
      renderReadingDocumentsList();
    }
    
    // 更新阅读进度面板（使用pagePercent作为PDF的主要进度）
    const displayPercent = Math.round(progress.pagePercent || progress.scrollPercent || 0);
    const percentSpan = $('#reading-percent');
    const progressBar = $('#reading-scroll-progress');
    if (percentSpan) percentSpan.textContent = displayPercent;
    if (progressBar) progressBar.style.width = displayPercent + '%';
    
    // PDF的已读字数估算
    if (progress.totalWords || progress.totalChars) {
      const totalWordsSpan = $('#reading-total-words');
      const totalCharsSpan = $('#reading-total-chars');
      const charsReadSpan = $('#reading-chars-read');
      
      if (totalWordsSpan) totalWordsSpan.textContent = (progress.totalWords || 0).toLocaleString();
      if (totalCharsSpan) totalCharsSpan.textContent = (progress.totalChars || 0).toLocaleString();
      
      const charsRead = Math.round((displayPercent / 100) * (progress.totalChars || 0));
      if (charsReadSpan) charsReadSpan.textContent = charsRead.toLocaleString();
    }
  }
});

// 辅助函数：设置滚动监听
const setupScrollListener = () => {
  const scrollContainer = $('#reading-text-body');
  if (scrollContainer) {
    scrollContainer.removeEventListener('scroll', updateReadingProgress);
    scrollContainer.addEventListener('scroll', updateReadingProgress);
    updateReadingProgress();
  }
};

// 高亮阅读内容中的词汇（带批注），并提供悬浮气泡显示批注
const highlightReadingVocabInContent = () => {
  const contentDiv = $('#reading-content');
  if (!contentDiv) return;

  const currentBook = state.vocabBooks.find(v => v.id === readingState.currentVocabBookId);
  if (!currentBook || !currentBook.words || currentBook.words.length === 0) return;

  // 标记所有生词（含无批注的）
  const vocabItems = currentBook.words
    .filter(w => w.word && w.word.trim())
    .map(w => ({
      word: w.word,
      wordLower: w.word.toLowerCase(),
      meaning: w.meaning || '',
      note: w.note || ''
    }));

  if (!vocabItems.length) return;

  // 标准转义，匹配正则特殊字符与反斜杠/方括号
  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 清理已有的高亮，避免重复嵌套
  contentDiv.querySelectorAll('.vocab-highlight').forEach(span => {
    const textNode = document.createTextNode(span.textContent);
    span.replaceWith(textNode);
  });

  // 遍历文本节点，插入高亮 span
  const walker = document.createTreeWalker(
    contentDiv,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  );

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach(node => {
    const text = node.nodeValue;
    const matches = [];

    vocabItems.forEach(item => {
      const regex = new RegExp(`(?<=^|\\s|[^\\p{L}])(${escapeRegExp(item.word)})(?=$|\\s|[^\\p{L}])`, 'giu');
      for (const match of text.matchAll(regex)) {
        matches.push({ index: match.index, len: match[1].length, item });
      }
    });

    if (!matches.length) return;

    matches.sort((a, b) => a.index - b.index);
    const frag = document.createDocumentFragment();
    let cursor = 0;

    matches.forEach(m => {
      if (m.index > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
      }
      const span = document.createElement('span');
      span.className = 'vocab-highlight';
      span.dataset.word = m.item.wordLower;
      span.dataset.meaning = m.item.meaning;
      span.dataset.note = m.item.note;
      span.textContent = text.substr(m.index, m.len);
      frag.appendChild(span);
      cursor = m.index + m.len;
    });

    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }

    node.parentNode.replaceChild(frag, node);
  });

  // 悬浮展示批注
  const spans = contentDiv.querySelectorAll('.vocab-highlight');
  spans.forEach(span => {
    const vocab = vocabItems.find(v => v.wordLower === span.dataset.word);
    if (!vocab) return;

    const showBubble = () => {
      document.querySelectorAll('.vocab-hover-bubble').forEach(b => b.remove());
      const bubble = createEl('div', 'vocab-hover-bubble');
      bubble.innerHTML = `
        <div class="bubble-word">${vocab.word}</div>
        ${vocab.meaning ? `<div class="bubble-meaning">${vocab.meaning}</div>` : ''}
        ${vocab.note ? `<div class="bubble-note"><strong>批注：</strong>${vocab.note}</div>` : ''}
      `;
      document.body.appendChild(bubble);

      const rect = span.getBoundingClientRect();
      let left = rect.left + window.scrollX + rect.width / 2 - bubble.offsetWidth / 2;
      let top = rect.top + window.scrollY - bubble.offsetHeight;
      const minLeft = 10;
      const maxLeft = window.innerWidth - bubble.offsetWidth - 10;
      left = Math.max(minLeft, Math.min(left, maxLeft));
      if (top < 10) {
        top = rect.bottom + window.scrollY;
      }
      bubble.style.left = left + 'px';
      bubble.style.top = top + 'px';

      bubble.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!span.matches(':hover')) {
            bubble.remove();
          }
        }, 100);
      });
    };

    span.addEventListener('mouseenter', showBubble);
    span.addEventListener('mouseleave', () => {
      setTimeout(() => {
        const bubble = document.querySelector('.vocab-hover-bubble');
        if (bubble && !bubble.matches(':hover')) {
          bubble.remove();
        }
      }, 100);
    });
  });
};

// 文本选中处理
const handleTextSelection = () => {
  const selection = window.getSelection();
  readingState.selectedText = selection.toString().trim();
  
  if (readingState.selectedText.length > 0) {
    // 获取光标位置，在该位置显示气泡浮窗
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // 获取选中词在生词本中的信息
    const currentBook = state.vocabBooks.find(b => b.id === readingState.currentVocabBookId);
    const vocabItem = currentBook ? currentBook.words.find(v => v.word.toLowerCase() === readingState.selectedText.toLowerCase()) : null;
    
    // 移除已存在的气泡框
    document.querySelectorAll('.vocab-bubble').forEach(b => b.remove());
    
    // 创建气泡框（与听力模块使用相同的样式）
    const bubble = createEl("div", "vocab-bubble");
    bubble.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <div class="bubble-word">${readingState.selectedText}</div>
        <button class="bubble-lookup-btn" style="background: none; border: none; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 3px; transition: background 0.2s;">
          🔍
        </button>
      </div>
      ${vocabItem ? `<div class="bubble-meaning">${vocabItem.meaning || '未设置释义'}</div>` : ''}
      ${vocabItem && vocabItem.note ? `<div class="bubble-note"><strong>批注：</strong>${vocabItem.note}</div>` : ''}
      <div class="bubble-buttons">
        <button class="bubble-note-btn">📝 添加释义和批注</button>
      </div>
    `;
    
    // 位置定位
    bubble.style.position = 'fixed';
    bubble.style.left = (rect.left + rect.width / 2) + 'px';
    bubble.style.top = (rect.bottom + 10) + 'px';
    bubble.style.transform = 'translateX(-50%)';
    
    document.body.appendChild(bubble);
    
    // 查词典功能
    const lookupBtn = bubble.querySelector('.bubble-lookup-btn');
    if (lookupBtn) {
      lookupBtn.addEventListener('click', async (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        
        // 跳转到词典模块并搜索
        bubble.remove();
        window.getSelection().removeAllRanges();
        
        // 确保词典模块展开
        const dictionaryBody = document.getElementById('reading-dictionary-body');
        if (dictionaryBody) {
          dictionaryBody.style.display = 'block';
        }
        
        // 在词典搜索框中填入单词
        const searchInput = document.getElementById('reading-dictionary-search-input');
        if (searchInput) {
          searchInput.value = readingState.selectedText;
          searchInput.focus();
          
          // 触发搜索
          const searchBtn = document.getElementById('btn-reading-dictionary-search');
          if (searchBtn) {
            searchBtn.click();
          }
        }
        
        // 滚动到词典模块
        const dictionarySection = document.querySelector('#reading-dictionary-body').closest('.collapsible');
        if (dictionarySection) {
          dictionarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, true);
    }
    
    // 编辑/添加功能
    const noteBtn = bubble.querySelector('.bubble-note-btn');
    if (noteBtn) {
      noteBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        showBubbleEditModeForReading(bubble, readingState.selectedText, vocabItem);
      });
    }
    
    // 点击其他地方关闭气泡
    const closeOnOutsideClick = (e) => {
      if (!bubble.contains(e.target)) {
        bubble.remove();
        document.removeEventListener('click', closeOnOutsideClick);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeOnOutsideClick);
    }, 0);
  } else {
    // 取消选择时移除气泡
    document.querySelectorAll('.vocab-bubble').forEach(b => b.remove());
  }
};

// 显示阅读模块的气泡编辑模式
const showBubbleEditModeForReading = (bubble, word, vocabItem) => {
  bubble.innerHTML = `
    <div class="bubble-word">${word}</div>
    <div class="bubble-edit-form">
      <div class="bubble-form-group">
        <label>释义</label>
        <input type="text" class="bubble-input" id="bubble-meaning" placeholder="输入释义..." value="${vocabItem?.meaning || ''}" />
      </div>
      <div class="bubble-form-group">
        <label>批注</label>
        <textarea class="bubble-textarea" id="bubble-note" placeholder="输入批注（Shift+回车换行）..." rows="2">${vocabItem?.note || ''}</textarea>
      </div>
      <div class="bubble-buttons">
        <button class="bubble-cancel-btn">✖ 取消</button>
        <button class="bubble-save-btn">💾 保存</button>
      </div>
    </div>
  `;
  
  // 保存功能
  const performSave = async () => {
    const meaning = bubble.querySelector('#bubble-meaning').value.trim();
    const note = bubble.querySelector('#bubble-note').value.trim();
    
    const currentBook = state.vocabBooks.find(b => b.id === readingState.currentVocabBookId);
    if (!currentBook) {
      alert('生词本不存在');
      return;
    }
    
    // 查找或创建词汇
    let wordIdx = currentBook.words.findIndex(v => v.word.toLowerCase() === word.toLowerCase());
    
    if (wordIdx >= 0) {
      // 更新已存在的词汇
      currentBook.words[wordIdx].meaning = meaning;
      currentBook.words[wordIdx].note = note;
    } else {
      // 添加新词汇，标注来源为"阅读"
      const newWord = {
        id: Date.now().toString(),
        word: word,
        meaning: meaning,
        note: note,
        context: readingState.selectedText,
        addedTime: new Date().toISOString(),
        source: 'reading'  // 标注为阅读模块添加
      };
      
      // 在合并模式中，检查听力生词本是否也有这个词
      if (state.settings.commonDefaultVocab) {
        const listeningDefault = state.vocabBooks.find(v => v.name === "默认生词本（听力）");
        if (listeningDefault) {
          const existsInListening = listeningDefault.words.find(w => w.word.toLowerCase() === word.toLowerCase());
          if (existsInListening) {
            // 如果听力生词本中也存在，标记为多来源
            newWord.sourceMultiple = 'listening,reading';
          }
        }
      }
      
      currentBook.words.push(newWord);
    }
    
    await persistVocab();
    renderVocab();
    renderReadingVocab();
    renderVocabBookSelector();
    renderReadingVocabBookSelector();
    // 立即刷新阅读内容中的高亮，保证批注后立刻显示波浪线
    highlightReadingVocabInContent();
    
    bubble.remove();
  };
  
  const saveBtn = bubble.querySelector('.bubble-save-btn');
  const cancelBtn = bubble.querySelector('.bubble-cancel-btn');
  
  if (saveBtn) {
    saveBtn.addEventListener('click', performSave);
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      bubble.remove();
    });
  }
  
  // 释义输入框：回车保存
  const meaningInput = bubble.querySelector('#bubble-meaning');
  if (meaningInput) {
    meaningInput.focus();
    meaningInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        performSave();
      }
    });
  }
  
  // 批注输入框：回车保存，Shift+回车换行（与听力一致）
  const noteInput = bubble.querySelector('#bubble-note');
  if (noteInput) {
    noteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Shift+回车：换行
          return;
        }
        // 普通回车：保存
        e.preventDefault();
        performSave();
      }
    });
  }
};

// 显示查词结果（已弃用，保留兼容性）
const showLookupResult = (word) => {
  // 此函数已被handleTextSelection中的气泡浮窗机制取代
};

// 页面导航
const initReadingNavigation = () => {
  // 移除分页导航，改用滚动进度
  // 初始化滚动进度跟踪
  updateReadingProgress();
};

// 来自嵌入的PDF阅读器的消息，用于刷新生词本显示
try {
  window.addEventListener('message', async (e) => {
    const data = e && e.data;
    if (data && data.type === 'vocabBooksUpdated') {
      try {
        await loadVocab();
        renderVocabBookSelector();
        renderVocab();
        renderReadingVocabBookSelector();
        renderReadingVocab();
        if (typeof highlightReadingVocabInContent === 'function') {
          highlightReadingVocabInContent();
        }
        console.log('✓ 接收PDF更新消息，已刷新生词本显示');
      } catch (err) {
        console.warn('刷新生词本显示失败:', err);
      }
    }
  });
} catch {}

// ============================================================================
// 文档阅读进度管理
// ============================================================================

let docProgressAutoSaveTimeout = null;  // 防抖计时器

/**
 * 保存文档阅读进度
 */
async function saveDocumentProgress() {
  if (!readingState.currentDocId) return;
  
  try {
    const textSection = document.querySelector('#reading-text-body');
    const scrollPosition = textSection ? textSection.scrollTop : 0;
    const scrollPercent = readingState.scrollPercent || 0;
    
    const progressData = {
      docId: readingState.currentDocId,
      docType: readingState.metadata?.ext || 'unknown',
      scrollPosition: scrollPosition,
      scrollPercent: scrollPercent,
      currentPage: 1,
      displayMode: 'continuous',
      timestamp: Date.now()
    };
    
    const response = await fetch('/api/doc-progress/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progressData)
    });
    
    const result = await response.json();
    if (result.status === 'success') {
      console.log('💾 文档进度已保存:', readingState.currentDocId);
      
      // 更新文档列表中的进度记录
      const doc = readingState.documents.find(d => d.id === readingState.currentDocId);
      if (doc) {
        doc.readProgress = { scrollPercent, scrollPosition };
        localStorage.setItem('readingDocuments', JSON.stringify(readingState.documents));
        renderReadingDocumentsList();
      }
    }
  } catch (e) {
    console.error('❌ 保存文档进度失败:', e);
  }
}

/**
 * 防抖保存文档进度（滚动时）
 */
function debouncedSaveDocumentProgress() {
  if (docProgressAutoSaveTimeout) {
    clearTimeout(docProgressAutoSaveTimeout);
  }
  
  docProgressAutoSaveTimeout = setTimeout(() => {
    saveDocumentProgress();
  }, 1500);
}

/**
 * 加载文档阅读进度
 */
async function loadDocumentProgress(docId) {
  try {
    const response = await fetch('/api/doc-progress/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId: docId })
    });
    
    const result = await response.json();
    if (result.status === 'success' && result.found && result.progress) {
      const progress = result.progress;
      console.log('✅ 加载文档进度:', progress);
      
      readingState.scrollPercent = progress.scrollPercent || 0;
      readingState.scrollPosition = progress.scrollPosition || 0;
      
      // 更新文档列表中的进度（包含PDF的pagePercent）
      const doc = readingState.documents.find(d => d.id === docId);
      if (doc) {
        doc.readProgress = {
          scrollPercent: progress.scrollPercent || 0,
          pagePercent: progress.pagePercent || 0,
          scrollPosition: progress.scrollPosition || 0
        };
        localStorage.setItem('readingDocuments', JSON.stringify(readingState.documents));
        renderReadingDocumentsList();
        
        // 如果是PDF，更新阅读进度面板
        if (progress.pagePercent !== undefined) {
          const displayPercent = Math.round(progress.pagePercent || progress.scrollPercent || 0);
          const percentSpan = $('#reading-percent');
          const progressBar = $('#reading-scroll-progress');
          if (percentSpan) percentSpan.textContent = displayPercent;
          if (progressBar) progressBar.style.width = displayPercent + '%';
        }
      }
      
      setTimeout(() => {
        const textSection = document.querySelector('#reading-text-body');
        if (textSection && progress.scrollPosition > 0) {
          textSection.scrollTop = progress.scrollPosition;
          console.log('⬅️ 恢复滚动位置:', progress.scrollPosition);
        }
        updateReadingProgress();
      }, 200);
      
      return progress;
    } else {
      console.log('ℹ️ 没有找到文档进度，从头开始');
      return null;
    }
  } catch (e) {
    console.error('❌ 加载文档进度失败:', e);
    return null;
  }
}

window.addEventListener('beforeunload', () => {
  saveDocumentProgress();
});

// 更新阅读进度显示（基于滚动位置）
const updateReadingProgress = () => {
  const percentSpan = $('#reading-percent');
  const progressBar = $('#reading-scroll-progress');
  const charsReadSpan = $('#reading-chars-read');
  const totalCharsSpan = $('#reading-total-chars');
  const totalWordsSpan = $('#reading-total-words');
  
  // 更新总字数和总词数
  if (totalCharsSpan) {
    totalCharsSpan.textContent = readingState.totalChars.toLocaleString();
  }
  if (totalWordsSpan) {
    totalWordsSpan.textContent = (readingState.totalWords || 0).toLocaleString();
  }
  
  // 计算滚动进度
  const textSection = document.querySelector('#reading-text-body');
  if (textSection && readingState.totalChars > 0) {
    const scrollTop = textSection.scrollTop;
    const scrollHeight = textSection.scrollHeight - textSection.clientHeight;
    
    let percent = 0;
    if (scrollHeight > 0) {
      percent = Math.round((scrollTop / scrollHeight) * 100);
    }
    
    // 确保百分比在0-100之间
    percent = Math.max(0, Math.min(100, percent));
    
    readingState.scrollPercent = percent;
    
    // 更新UI
    if (percentSpan) percentSpan.textContent = percent;
    if (progressBar) progressBar.style.width = percent + '%';
    
    // 估算已读字数（基于滚动百分比）
    const charsRead = Math.round((percent / 100) * readingState.totalChars);
    if (charsReadSpan) charsReadSpan.textContent = charsRead.toLocaleString();
    
    // 防抖保存进度
    debouncedSaveDocumentProgress();
  } else {
    // 没有内容时显示0
    if (percentSpan) percentSpan.textContent = '0';
    if (progressBar) progressBar.style.width = '0%';
    if (charsReadSpan) charsReadSpan.textContent = '0';
  }
};

// 加载文档词汇
const loadDocumentWords = async (docId) => {
  try {
    const response = await fetch(`/api/reading/extract-words/${docId}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      readingState.allWords = data.words;
    }
  } catch (e) {
    console.error('加载词汇失败:', e);
  }
};

// 搜索功能
const initReadingSearch = () => {
  const searchBox = $('#reading-search-box');
  if (!searchBox) return;
  
  searchBox.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const query = searchBox.value;
      if (query.length > 0) {
        await searchInDocument(query);
      }
    }
  });
};

const searchInDocument = async (query) => {
  if (!readingState.currentDocId) return;
  
  try {
    const response = await fetch(`/api/reading/search/${readingState.currentDocId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    
    const data = await response.json();
    if (data.status === 'success') {
      readingState.searchResults = data.results;
      alert(`找到 ${data.count} 处结果\n注：搜索结果高亮功能待实现`);
      
      // TODO: 实现文本高亮和滚动到结果位置
      // 由于改用连续滚动，需要在文本中查找并高亮关键词
    }
  } catch (e) {
    console.error('搜索失败:', e);
  }
};

// 笔记管理
const initReadingNotes = () => {
  const addNoteBtn = $('#btn-reading-add-note');
  const noteEditor = $('#reading-current-note');
  
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', () => {
      if (readingState.selectedText && noteEditor.value) {
        const note = {
          id: Date.now().toString(),
          text: readingState.selectedText,
          note: noteEditor.value,
          page: readingState.currentPage + 1,
          timestamp: new Date().toISOString()
        };
        
        readingState.notes.push(note);
        saveReadingNotes();
        noteEditor.value = '';
        renderNotesList();
      }
    });
  }
};

const loadReadingNotes = async (docId) => {
  try {
    const response = await fetch(`/api/reading/load-notes/${docId}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      readingState.notes = data.notes;
      renderNotesList();
    }
  } catch (e) {
    console.error('加载笔记失败:', e);
  }
};

const saveReadingNotes = async () => {
  if (!readingState.currentDocId) return;
  
  try {
    await fetch(`/api/reading/save-notes/${readingState.currentDocId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: readingState.notes })
    });
  } catch (e) {
    console.error('保存笔记失败:', e);
  }
};

const renderNotesList = () => {
  const notesList = $('#reading-notes-list');
  if (!notesList) return;
  
  if (readingState.notes.length === 0) {
    notesList.innerHTML = '<p style="color: var(--muted); font-size: 12px;">暂无笔记</p>';
    return;
  }
  
  notesList.innerHTML = readingState.notes.map(note => `
    <div class="note-item">
      <div class="note-text">"${note.text}"</div>
      <div class="note-content">${note.note}</div>
      <div class="note-meta">第 ${note.page} 页 · ${new Date(note.timestamp).toLocaleDateString()}</div>
    </div>
  `).join('');
};

// 初始化阅读模块
const initReadingModule = async () => {
  // 从localStorage加载文档列表
  const savedDocuments = localStorage.getItem('readingDocuments');
  if (savedDocuments) {
    try {
      readingState.documents = JSON.parse(savedDocuments);
    } catch (e) {
      readingState.documents = [];
    }
  }
  
  // 确保默认生词本配置正确（合并或分离）
  await ensureDefaultVocabBooks();
  
  initModeNavigation();
  initReadingFileUpload();
  initReadingNavigation();
  initReadingSearch();
  initReadingNotes();
  initReadingVocab();
  
  // 渲染文档列表（加载之前导入的数据）
  renderReadingDocumentsList();
  
  // 渲染生词本选择器和列表
  renderReadingVocabBookSelector();
  renderReadingVocab();
};

// ========== 阅读模块生词本管理 ==========

// 初始化阅读模块生词本
const initReadingVocab = () => {
  const selector = $('#reading-vocabbook-selector');
  if (!selector) return;
  
  // 绑定选择器变化事件
  selector.addEventListener('change', (e) => {
    switchReadingVocabBook(e.target.value);
  });
  
  // 绑定新建按钮
  const btnNew = $('#btn-reading-vocabbook-new');
  if (btnNew) {
    btnNew.onclick = () => createReadingVocabBook();
  }
};

// 为阅读模块创建生词本
const createReadingVocabBook = (name = "新生词本") => {
  const id = generateVocabBookId();
  const newVocabBook = { id, name, words: [] };
  state.vocabBooks.push(newVocabBook);
  // 自动切换到新生词本
  switchReadingVocabBook(id);
  persistVocab();
  renderReadingVocabBookSelector();
  renderReadingVocab();
  
  // 立即弹出重命名对话框
  setTimeout(() => {
    renameReadingVocabBook(id);
  }, 100);
  
  return id;
};

// 删除生词本（从阅读模块）
const deleteReadingVocabBook = (id) => {
  if (state.vocabBooks.length <= 1) {
    alert("至少需要保留一个生词本");
    return;
  }
  if (!confirm("确定要删除此生词本吗？")) return;
  
  const index = state.vocabBooks.findIndex(v => v.id === id);
  if (index > -1) {
    state.vocabBooks.splice(index, 1);
    
    // 如果删除的是当前生词本，切换到第一个
    if (state.currentVocabBookId === id) {
      if (state.vocabBooks.length > 0) {
        switchReadingVocabBook(state.vocabBooks[0].id);
      } else {
        createReadingVocabBook("默认生词本");
      }
    }
    
    persistVocab();
    renderReadingVocabBookSelector();
    renderReadingVocab();
  }
};

// 为阅读模块切换生词本
const switchReadingVocabBook = (id) => {
  const vocabBook = state.vocabBooks.find(v => v.id === id);
  if (vocabBook) {
    readingState.currentVocabBookId = id;
    
    // 如果启用了公用模式，同步到听力模块
    if (state.settings.commonDefaultVocab) {
      state.currentVocabBookId = id;
      persistVocab();
      renderVocabBookSelector();
      renderVocab();
    }
    
    renderReadingVocabBookSelector();
    renderReadingVocab();
  }
};

// 重命名生词本（从阅读模块）
const renameReadingVocabBook = (id) => {
  const vocabBook = state.vocabBooks.find(v => v.id === id);
  if (!vocabBook) return;
  const newName = prompt("新的生词本名称:", vocabBook.name);
  if (newName && newName.trim()) {
    vocabBook.name = newName.trim();
    persistVocab();
    renderReadingVocabBookSelector();
  }
};

// 渲染阅读模块生词本选择器
const renderReadingVocabBookSelector = () => {
  const selector = $('#reading-vocabbook-selector');
  if (!selector) return;
  
  selector.innerHTML = "";
  
  // 根据模式过滤显示的生词本
  const filteredBooks = state.vocabBooks.filter(vb => {
    if (state.settings.commonDefaultVocab) {
      // 公用模式：只显示通用默认生词本和自定义生词本
      return vb.name === "默认生词本（通用）" || 
             (!vb.name.includes("（听力）") && !vb.name.includes("（阅读）") && !vb.name.includes("(阅读)"));
    } else {
      // 分离模式：显示阅读默认生词本和自定义生词本（不显示听力和通用）
      return vb.name === "默认生词本（阅读）" || 
             (!vb.name.includes("（通用）") && !vb.name.includes("（听力）"));
    }
  });
  
  // 确定应该选择的生词本（使用阅读模块独立的选择）
  let selectedVocabBookId = readingState.currentVocabBookId;
  
  // 如果没有选中的生词本或生词本不存在于过滤列表中
  if (!selectedVocabBookId || !filteredBooks.find(v => v.id === selectedVocabBookId)) {
    // 根据设置选择默认生词本
    if (state.settings.commonDefaultVocab) {
      // 通用模式：选择"默认生词本（通用）"
      const defaultVocab = filteredBooks.find(v => v.name === "默认生词本（通用）");
      selectedVocabBookId = defaultVocab ? defaultVocab.id : (filteredBooks.length > 0 ? filteredBooks[0].id : null);
    } else {
      // 分离模式：选择"默认生词本（阅读）"
      const readingDefault = filteredBooks.find(v => v.name === "默认生词本（阅读）");
      selectedVocabBookId = readingDefault ? readingDefault.id : (filteredBooks.length > 0 ? filteredBooks[0].id : null);
    }
    
    if (selectedVocabBookId) {
      readingState.currentVocabBookId = selectedVocabBookId;
    }
  }
  
  filteredBooks.forEach(vb => {
    const option = document.createElement("option");
    option.value = vb.id;
    option.textContent = `${vb.name} (${vb.words.length})`;
    if (vb.id === selectedVocabBookId) {
      option.selected = true;
    }
    selector.appendChild(option);
  });
};

// 渲染阅读模块生词本列表
const renderReadingVocab = () => {
  const container = $('#reading-vocab-list');
  if (!container) return;
  
  if (!readingState.currentVocabBookId) {
    container.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 12px; font-size: 12px;">请先创建或选择生词本</p>';
    return;
  }
  
  const currentBook = state.vocabBooks.find(v => v.id === readingState.currentVocabBookId);
  if (!currentBook || currentBook.words.length === 0) {
    container.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 12px; font-size: 12px;">暂无词汇</p>';
    return;
  }
  
  // 反向排列词汇，使最新添加的词显示在最前面
  const reversedWords = [...currentBook.words].reverse();
  container.innerHTML = reversedWords.map((word, reversedIdx) => {
    // 映射回原始数组的索引
    const idx = currentBook.words.length - 1 - reversedIdx;
    // 当处于合并模式时，显示来源标注（便于用户区分词汇来源）
    const sourceTag = state.settings.commonDefaultVocab && word.source ? 
      `<span style="font-size: 10px; color: #999; margin-left: 8px; padding: 2px 6px; background: rgba(255,255,255,0.1); border-radius: 3px;">${word.source === 'listening' ? '听力' : '阅读'}</span>` : '';
    
    return `
    <div class="vocab-item">
      <div class="vocab-content">
        <div class="vocab-word"><strong>${word.word}</strong>${sourceTag}</div>
        <div class="vocab-meaning-wrapper">
          <label>释义：</label>
          <div class="vocab-meaning" contenteditable="true" data-idx="${idx}" class="vocab-meaning-edit">${word.meaning || ""}</div>
        </div>
        <div class="vocab-note-wrapper">
          <label>批注：</label>
          <div class="vocab-note" contenteditable="true" data-idx="${idx}" data-type="note" class="vocab-note-edit">${word.note || ""}</div>
        </div>
      </div>
      <button class="vocab-delete-btn" data-idx="${idx}" title="删除">🗑️</button>
    </div>
  `;}).join('');
  
  // 绑定释义编辑事件
  container.querySelectorAll('.vocab-meaning-edit').forEach(el => {
    el.addEventListener('blur', (e) => {
      const idx = Number(e.target.dataset.idx);
      currentBook.words[idx].meaning = e.target.textContent;
      persistVocab();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      }
    });
  });
  
  // 绑定批注编辑事件
  container.querySelectorAll('.vocab-note-edit').forEach(el => {
    el.addEventListener('blur', (e) => {
      const idx = Number(e.target.dataset.idx);
      currentBook.words[idx].note = e.target.textContent;
      persistVocab();
    });
  });
  
  // 绑定删除事件
  container.querySelectorAll('.vocab-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const wordIdx = Number(e.target.dataset.idx);
      currentBook.words.splice(wordIdx, 1);
      persistVocab();
      renderReadingVocab();
    });
  });
};

// 暴露给全局的接口
window.App = {
  ...window.App,
  $,
  readingState,
  // 暴露全局状态，供 split.js 等扩展使用
  state,
  uploadReadingDocument,
  loadReadingDocument,
  displayReadingContent,
  formatTime,
  formatTimeWithMs,
  formatPreciseTime,
  parseTimeString,
  persistSubtitles,
  renderSubtitles,
  jumpToSubtitle,
  renderWaveformRegions,
  saveHistory,
  updateHistoryButtons,
  // 手动打轴对外暴露（供 split/timing 扩展使用）
  openManualTimingModal,
};

// ---------------- 手动打轴实现 ----------------
let manualTimingState = {
  lines: [],
  times: [],
  index: 0,
  running: false,
};
let manualWavesurfer = null;
let isSeekingManualWave = false;
let manualAutoSaveOnClose = true; // 关闭弹窗时是否自动保存当前打轴结果

function deleteCurrentSubtitle() {
  if (state.currentIndex < 0 || state.currentIndex >= state.subtitles.length) return;
  if (!confirm(`确定删除第 ${state.currentIndex + 1} 条字幕吗？`)) return;
  saveHistory();
  state.subtitles.splice(state.currentIndex, 1);
  state.currentIndex = Math.min(state.currentIndex, state.subtitles.length - 1);
  persistSubtitles();
  renderSubtitles();
  renderEditors?.();
  renderWaveformRegions();
  updateHistoryButtons();
}

function clearAllSubtitles() {
  if (state.subtitles.length === 0) return;
  
  // 检查字幕数据大小，如果太大给出警告
  const subtitlesSize = JSON.stringify(state.subtitles).length;
  const sizeInMB = subtitlesSize / (1024 * 1024);
  
  if (sizeInMB > 10) { // 如果字幕数据超过10MB
    const warningMsg = `警告：当前字幕数据较大（约 ${sizeInMB.toFixed(2)} MB），清空操作可能会消耗较多内存。\n\n确定要继续清空吗？`;
    if (!confirm(warningMsg)) return;
  } else {
    if (!confirm('确定清空全部字幕吗？')) return;
  }
  
  // 优化：对于空字幕或大数据量，不保存历史记录以避免内存问题
  if (state.subtitles.length > 0 && sizeInMB < 5) {
    saveHistory();
  } else {
    // 对于大数据量，直接清空历史记录以避免内存溢出
    state.history = [];
    state.historyIndex = -1;
    updateHistoryButtons();
  }
  
  // 先清理波形图区域，释放DOM内存
  if (playerRegions) {
    try {
      playerRegions.clearRegions();
    } catch (e) {
      console.warn('清理波形图区域时出错:', e);
    }
  }
  
  // 清空字幕数据
  const oldSubtitles = state.subtitles;
  state.subtitles = [];
  state.currentIndex = -1;
  
  // 强制垃圾回收提示（仅用于开发环境，Chrome中通过--js-flags="--expose-gc"启用）
  if (typeof window.gc === 'function' && sizeInMB > 5) {
    console.log('触发垃圾回收提示...');
    try {
      window.gc();
    } catch (e) {
      console.warn('垃圾回收调用失败:', e);
    }
  }
  
  // 立即同步保存到存储，确保数据持久化
  persistSubtitles();
  
  // 重新渲染UI
  renderSubtitles();
  renderEditors?.();
  
  // 延迟渲染波形图区域，避免同时进行大量DOM操作
  setTimeout(() => {
    renderWaveformRegions();
  }, 100);
  
  updateHistoryButtons();
  
  // 记录清空操作
  logEvent('subtitlesCleared', { 
    previousCount: oldSubtitles.length, 
    sizeInMB: sizeInMB.toFixed(2),
    savedHistory: sizeInMB < 5
  });
}

function openManualTimingModal() {
  const modal = document.getElementById('timing-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  manualTimingReset();
  // 初始化打轴波形，与主播放器同步
  const player = document.getElementById('player');
  const container = document.getElementById('timing-waveform');
  if (window.WaveSurfer && container) {
    try {
      manualWavesurfer = window.WaveSurfer.create({
        container: '#timing-waveform',
        waveColor: 'rgba(99, 102, 241, 0.3)',
        progressColor: 'rgba(99, 102, 241, 0.8)',
        cursorColor: 'rgba(139, 92, 246, 0.9)',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 80,
        normalize: true,
        interact: true,
        fillParent: true,
        minPxPerSec: 100,
        autoScroll: true,
        autoScrollInterval: 100,
      });
      
      // 立即注入样式隐藏滚动条（在 ready 之前）
      const injectManualScrollStyle = () => {
        const waveformDiv = container.querySelector('div:nth-child(1)');
        if (waveformDiv?.shadowRoot) {
          const style = document.createElement('style');
          style.textContent = `
            [part="scroll"] {
              overflow-x: hidden !important;
              overflow-y: hidden !important;
            }
          `;
          waveformDiv.shadowRoot.appendChild(style);
          console.log('✓ 成功隐藏手动波形的滚动条（创建时）');
          return true;
        }
        return false;
      };
      
      // 立即尝试注入
      if (!injectManualScrollStyle()) {
        // 如果 shadowRoot 还没创建，使用 MutationObserver 监听
        const observer = new MutationObserver((mutations) => {
          if (injectManualScrollStyle()) {
            observer.disconnect();
          }
        });
        observer.observe(container, { childList: true, subtree: true });
        // 5秒后停止观察
        setTimeout(() => observer.disconnect(), 5000);
      }
      
      if (player?.src) {
        manualWavesurfer.load(player.src);
      }
      manualWavesurfer.on('ready', () => {
        attachManualWaveScroll(container);
      });
      manualWavesurfer.on('click', (progress) => {
        if (!player?.duration) return;
        isSeekingManualWave = true;
        player.currentTime = progress * player.duration;
        setTimeout(() => { isSeekingManualWave = false; }, 50);
      });
    } catch (e) { /* ignore */ }
  }
}

function closeManualTimingModal() {
  const modal = document.getElementById('timing-modal');
  if (!modal) return;
  // 自动保存字幕（若已有行与时间标记）
  if (manualAutoSaveOnClose) {
    manualTimingFinish({ auto: true });
  }
  modal.style.display = 'none';
  try { if (manualWavesurfer) { manualWavesurfer.destroy(); manualWavesurfer = null; } } catch (e) { /* ignore */ }
}

function manualTimingLoadText() {
  const textarea = document.getElementById('timing-text');
  const lines = (textarea.value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  manualTimingState.lines = lines;
  manualTimingState.index = 0;
  manualTimingState.times = [];
  updateTimingLinesUI();
}

function manualTimingStart() {
  if (manualTimingState.lines.length === 0) manualTimingLoadText();
  manualTimingState.running = true;
  setTimingStatus('打轴中…');
  const player = document.getElementById('player');
  if (player && player.paused) { player.play(); }
}

function manualTimingMarkStart() {
  if (!manualTimingState.running) manualTimingStart();
  const player = document.getElementById('player');
  if (!player) return;
  const t = player.currentTime || 0;
  manualTimingState.times[0] = t;
  manualTimingState.index = Math.max(manualTimingState.index, 0);
  updateTimingLinesUI();
}

function manualTimingMark() {
  if (!manualTimingState.running) return;
  const player = document.getElementById('player');
  if (!player) return;
  const t = player.currentTime || 0;
  manualTimingState.times.push(t);
  if (manualTimingState.index < manualTimingState.lines.length - 1) {
    manualTimingState.index++;
  }
  updateTimingLinesUI();
}

function manualTimingUndo() {
  if (manualTimingState.times.length > 0) {
    manualTimingState.times.pop();
    manualTimingState.index = Math.max(0, manualTimingState.index - 1);
    updateTimingLinesUI();
  }
}

function manualTimingReset() {
  manualTimingState = { lines: [], times: [], index: 0, running: false };
  document.getElementById('timing-text').value = '';
  document.getElementById('timing-lines-count').textContent = '0 行';
  setTimingStatus('未开始');
  const list = document.getElementById('timing-lines');
  if (list) list.innerHTML = '';
}

function manualTimingFinish(opts = {}) {
  const player = document.getElementById('player');
  const duration = player?.duration || 0;
  const minDur = 0.5;
  const lines = manualTimingState.lines;
  const times = manualTimingState.times;
  if (lines.length === 0 || times.length === 0) {
    if (!opts.auto) alert('请先导入文本并开始打轴');
    return;
  }
  // 序列化为字幕：start = times[i]，end = nextStart 或 start + minDur
  const subs = [];
  for (let i = 0; i < lines.length; i++) {
    const start = times[i] ?? 0;
    const nextStart = times[i + 1] ?? duration;
    let end = (Number.isFinite(nextStart) ? nextStart : start + minDur) - 0.05;
    if (!Number.isFinite(end) || end <= start) end = start + minDur;
    subs.push({ start, end, en: lines[i], zh: '', userEn: '', userZh: '', note: '' });
  }
  // 更新状态并渲染
  saveHistory();
  state.subtitles = subs;
  persistSubtitles();
  renderSubtitles();
  renderEditors?.();
  renderWaveformRegions();
  updateHistoryButtons();
  if (!opts.auto) closeManualTimingModal();
}

// 允许在手动波形中用鼠标滚轮横向滚动，与主波形一致
function attachManualWaveScroll(container) {
  if (!container) return;
  const findScrollEl = () => {
    const wrapper = container.querySelector('div');
    if (wrapper && wrapper.shadowRoot) {
      const sc = wrapper.shadowRoot.querySelector('[part="scroll"]');
      if (sc) {
        return sc;
      }
    }
    return container.querySelector('[part="scroll"]');
  };
  const scroller = findScrollEl();
  if (!scroller) return;
  scroller.addEventListener('wheel', (e) => {
    e.preventDefault();
    scroller.scrollLeft += (e.deltaY || e.deltaX);
  }, { passive: false });
}

function updateTimingLinesUI() {
  const list = document.getElementById('timing-lines');
  const countEl = document.getElementById('timing-lines-count');
  if (!list || !countEl) return;
  const lines = manualTimingState.lines;
  const idx = manualTimingState.index;
  list.innerHTML = '';
  countEl.textContent = `${lines.length} 行`;
  lines.forEach((line, i) => {
    const item = document.createElement('div');
    item.className = 'line-item' + (i === idx ? ' active' : '');
    const timeLabel = document.createElement('div');
    timeLabel.className = 'line-time';
    const t = manualTimingState.times[i];
    timeLabel.textContent = (t !== undefined) ? `${formatTime(t)} 已标记` : '未标记';
    item.textContent = line;
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr auto';
    row.style.gap = '6px';
    row.appendChild(item);
    row.appendChild(timeLabel);
    list.appendChild(row);
    if (i === idx) {
      // 滚动聚焦当前未打轴行，居中显示
      setTimeout(() => {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    }
  });
}

function setTimingStatus(s) {
  const el = document.getElementById('timing-status');
  if (el) el.textContent = s;
}

function manualTimingLoadFromSubs() {
  if (!Array.isArray(state.subtitles) || state.subtitles.length === 0) {
    alert('当前没有可用字幕');
    return;
  }
  const lines = state.subtitles.map(sub => (sub.userEn || sub.en || sub.zh || '').trim()).filter(Boolean);
  if (lines.length === 0) {
    alert('当前字幕没有可用文本');
    return;
  }
  const textarea = document.getElementById('timing-text');
  if (textarea) textarea.value = lines.join('\n');
  manualTimingState.lines = lines;
  manualTimingState.index = 0;
  manualTimingState.times = [];
  manualTimingState.running = false;
  setTimingStatus('未开始');
  updateTimingLinesUI();
}

// --- 侧栏功能 ---------------------------------------------------

// 初始化侧栏功能
const initSidebar = () => {
  // 初始化听力模块侧栏
  initModuleSidebar('listening');
  
  // 初始化阅读模块侧栏
  initModuleSidebar('reading');
};

// 初始化指定模块的侧栏
const initModuleSidebar = (moduleName) => {
  // 右侧栏初始化
  const sidebarId = moduleName === 'listening' ? 'right-sidebar' : 'reading-right-sidebar';
  const toggleId = moduleName === 'listening' ? 'sidebar-toggle' : 'reading-sidebar-toggle';
  
  const sidebar = document.getElementById(sidebarId);
  const toggle = document.getElementById(toggleId);
  
  if (sidebar && toggle) {
    // 加载侧栏状态
    const sidebarState = state.settings.sidebar[moduleName];
    if (sidebarState.collapsed) {
      sidebar.classList.add('collapsed');
    }
    
    // 绑定切换事件
    toggle.addEventListener('click', () => {
      toggleSidebar(moduleName, 'right');
    });
    
    // 绑定功能项点击事件
    const sidebarItems = sidebar.querySelectorAll('.sidebar-item');
    sidebarItems.forEach(item => {
      item.addEventListener('click', () => {
        const module = item.dataset.module;
        if (module) {
          activateSidebarModule(moduleName, module, 'right');
        }
      });
    });
    
    // 激活默认模块
    const defaultModule = sidebarState && sidebarState.currentModule ? sidebarState.currentModule : moduleName === 'listening' ? 'control' : 'reading-dictionary';
    activateSidebarModule(moduleName, defaultModule, 'right');
  }
  
  // 左侧栏初始化
  const leftSidebarId = moduleName === 'listening' ? 'left-sidebar' : 'reading-left-sidebar';
  const leftToggleId = moduleName === 'listening' ? 'left-sidebar-toggle' : 'reading-left-sidebar-toggle';
  
  const leftSidebar = document.getElementById(leftSidebarId);
  const leftToggle = document.getElementById(leftToggleId);
  
  if (leftSidebar && leftToggle) {
    // 加载左侧栏状态
    const leftSidebarState = state.settings.sidebar[`${moduleName}_left`];
    if (leftSidebarState && leftSidebarState.collapsed) {
      leftSidebar.classList.add('collapsed');
    }
    
    // 绑定切换事件
    leftToggle.addEventListener('click', () => {
      toggleSidebar(moduleName, 'left');
    });
    
    // 绑定功能项点击事件
    const leftSidebarItems = leftSidebar.querySelectorAll('.sidebar-item');
    leftSidebarItems.forEach(item => {
      item.addEventListener('click', () => {
        const module = item.dataset.module;
        if (module) {
          activateSidebarModule(moduleName, module, 'left');
        }
      });
    });
    
    // 激活默认模块
    const leftDefaultModule = leftSidebarState && leftSidebarState.currentModule ? leftSidebarState.currentModule : moduleName === 'listening' ? 'playlist' : 'documents';
    activateSidebarModule(moduleName, leftDefaultModule, 'left');
  }
};

// 切换侧栏收起/展开状态
const toggleSidebar = (moduleName, position = 'right') => {
  const sidebarId = position === 'right' ? 
    (moduleName === 'listening' ? 'right-sidebar' : 'reading-right-sidebar') : 
    (moduleName === 'listening' ? 'left-sidebar' : 'reading-left-sidebar');
  
  const sidebar = document.getElementById(sidebarId);
  
  if (sidebar) {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    const sidebarKey = position === 'right' ? moduleName : `${moduleName}_left`;
    
    // 确保侧栏状态对象存在
    if (!state.settings.sidebar[sidebarKey]) {
      state.settings.sidebar[sidebarKey] = {
        collapsed: isCollapsed,
        currentModule: moduleName === 'listening' ? 'playlist' : 'documents'
      };
    } else {
      state.settings.sidebar[sidebarKey].collapsed = isCollapsed;
    }
    
    // 当侧栏展开时，激活第一个模块
    if (!isCollapsed) {
      const sidebarItems = sidebar.querySelectorAll('.sidebar-item');
      if (sidebarItems.length > 0) {
        const firstModule = sidebarItems[0].dataset.module;
        if (firstModule) {
          activateSidebarModule(moduleName, firstModule, position);
        }
      }
    }
    
    persistSettings();
  }
};

// 激活侧栏模块
const activateSidebarModule = (moduleName, moduleId, position = 'right') => {
  const sidebarId = position === 'right' ? 
    (moduleName === 'listening' ? 'right-sidebar' : 'reading-right-sidebar') : 
    (moduleName === 'listening' ? 'left-sidebar' : 'reading-left-sidebar');
  
  const panelId = position === 'right' ? 
    (moduleName === 'listening' ? 'sidebar-panel' : 'reading-sidebar-panel') : 
    (moduleName === 'listening' ? 'left-sidebar-panel' : 'reading-left-sidebar-panel');
  
  const sidebar = document.getElementById(sidebarId);
  const panel = document.getElementById(panelId);
  
  if (sidebar && panel) {
    // 自动展开侧栏
    if (sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      const sidebarKey = position === 'right' ? moduleName : `${moduleName}_left`;
      
      // 确保侧栏状态对象存在
      if (!state.settings.sidebar[sidebarKey]) {
        state.settings.sidebar[sidebarKey] = {
          collapsed: false,
          currentModule: moduleId
        };
      } else {
        state.settings.sidebar[sidebarKey].collapsed = false;
      }
      
      persistSettings();
    }
    
    // 更新状态
    const sidebarKey = position === 'right' ? moduleName : `${moduleName}_left`;
    
    // 确保侧栏状态对象存在
    if (!state.settings.sidebar[sidebarKey]) {
      state.settings.sidebar[sidebarKey] = {
        collapsed: false,
        currentModule: moduleId
      };
    } else {
      state.settings.sidebar[sidebarKey].currentModule = moduleId;
    }
    
    persistSettings();
    
    // 更新功能项激活状态
    const sidebarItems = sidebar.querySelectorAll('.sidebar-item');
    sidebarItems.forEach(item => {
      if (item.dataset.module === moduleId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    
    // 更新模块激活状态
    const modules = panel.querySelectorAll('.sidebar-module');
    modules.forEach(module => {
      if (module.id === `${moduleId}-module`) {
        module.classList.add('active');
        // 当模块激活时，立即调整文本框高度，不需要延迟
        initAutoResizeTextareas();
      } else {
        module.classList.remove('active');
      }
    });
  }
};

// 自动调整文本框高度
const autoResizeTextarea = (textarea) => {
  if (!textarea) return;
  
  // 保存当前的样式
  const originalStyle = textarea.style.cssText;
  
  // 重置高度，使其能够正确计算scrollHeight
  textarea.style.height = 'auto';
  textarea.style.overflowY = 'hidden';
  
  // 计算新高度，使用scrollHeight直接作为高度
  // 这样可以确保内容完全显示
  const newHeight = textarea.scrollHeight;
  
  // 限制最大高度为300px
  const maxHeight = 300;
  const finalHeight = Math.min(newHeight, maxHeight);
  
  // 设置新高度
  textarea.style.height = finalHeight + 'px';
  
  // 只有当内容超过最大高度时才显示滚动条
  textarea.style.overflowY = newHeight > maxHeight ? 'auto' : 'hidden';
  
  // 确保文本框的最小高度
  const minHeight = 70; // 与CSS中的min-height保持一致
  if (finalHeight < minHeight) {
    textarea.style.height = minHeight + 'px';
  }
};

// 初始化自动调整文本框高度的功能
const initAutoResizeTextareas = () => {
  // 使用更通用的选择器，确保找到所有相关的文本框
  const textareas = document.querySelectorAll('textarea');
  textareas.forEach(textarea => {
    // 初始调整
    autoResizeTextarea(textarea);
    // 添加事件监听器
    textarea.addEventListener('input', () => autoResizeTextarea(textarea));
    textarea.addEventListener('paste', () => setTimeout(() => autoResizeTextarea(textarea), 0));
    // 添加focus和blur事件，确保在获得和失去焦点时也能调整高度
    textarea.addEventListener('focus', () => autoResizeTextarea(textarea));
    textarea.addEventListener('blur', () => autoResizeTextarea(textarea));
  });
};

// 为动态添加的文本框添加自动调整高度的功能
const addAutoResizeToTextarea = (textarea) => {
  if (!textarea) return;
  
  // 初始调整
  autoResizeTextarea(textarea);
  // 添加事件监听器
  textarea.addEventListener('input', () => autoResizeTextarea(textarea));
  textarea.addEventListener('paste', () => setTimeout(() => autoResizeTextarea(textarea), 0));
  // 移除focus和blur事件监听器，因为我们希望文本框在显示时就调整高度，而不是等聚焦了才调整
};

// 监听DOM变化，确保动态添加的内容也能触发文本框高度调整
const initDOMObserver = () => {
  // 监听整个文档的变化
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // 检查是否有新的文本框被添加
      if (mutation.type === 'childList') {
        const newTextareas = mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 检查节点本身是否是文本框
            if (node.tagName === 'TEXTAREA') {
              addAutoResizeToTextarea(node);
            }
            // 检查节点的子元素是否有文本框
            const textareas = node.querySelectorAll('textarea');
            textareas.forEach(textarea => addAutoResizeToTextarea(textarea));
          }
        });
      }
      // 检查是否有文本框的内容发生了变化
      else if (mutation.type === 'characterData' && mutation.target.parentNode && mutation.target.parentNode.tagName === 'TEXTAREA') {
        autoResizeTextarea(mutation.target.parentNode);
      }
    });
  });
  
  // 开始观察文档
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
};

// 在DOM加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initAutoResizeTextareas();
    initDOMObserver();
  });
} else {
  initSidebar();
  initAutoResizeTextareas();
  initDOMObserver();
}