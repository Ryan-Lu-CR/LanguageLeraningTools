// split.js — 分句/合并模块，依赖 window.App 和 split-modal 结构
(function () {
  const { App } = window;
  if (!App) return;

  const $ = App.$;
  const formatTimeWithMs = App.formatTimeWithMs;
  const formatTime = App.formatTime;

  let splitState = {
    mode: 'split',
    selectedIndex: -1,
    mergeSelection: [],
    splitTime: 0,
    wavesurfer: null,
    regions: null,
    region: null,
    zoom: 0, // 0表示使用默认minPxPerSec，非0时使用zoom值
  };
  
  // 分句编辑器缩放百分比（100-2000）
  let splitZoomPercent = 100;

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const getPlayer = () => document.getElementById('player');

  const destroyWaveSurfer = () => {
    if (splitState.wavesurfer) {
      splitState.wavesurfer.destroy();
      splitState.wavesurfer = null;
      splitState.regions = null;
      splitState.region = null;
    }
  };

  const applyZoom = (percent) => {
    if (!splitState.wavesurfer) return;
    
    // 更新百分比
    splitZoomPercent = Math.max(100, Math.min(2000, percent));
    const zoomInput = $('#split-zoom-percent');
    if (zoomInput) zoomInput.value = splitZoomPercent;
    
    // 基础值50像素/秒对应100%，按比例计算（与主播放器一致）
    const pxPerSec = (splitZoomPercent / 100) * 50;
    splitState.wavesurfer.zoom(pxPerSec);
    
    // 缩放后更新参照线位置
    setTimeout(() => {
      const waveformContainer = $('#split-waveform');
      if (waveformContainer) {
        updateSplitReferenceBar(waveformContainer);
      }
    }, 100);
  };

  const zoomIn = () => {
    applyZoom(splitZoomPercent + 5); // 增加5%
  };

  const zoomOut = () => {
    applyZoom(splitZoomPercent - 5); // 减少5%
  };

  const zoomReset = () => {
    applyZoom(100); // 重置到100%
  };

  // 自动聚焦到当前句并设置合适的缩放
  const focusOnCurrentSubtitle = () => {
    if (!splitState.wavesurfer) return;
    const sub = App.state.subtitles[splitState.selectedIndex];
    if (!sub) return;

    const duration = sub.end - sub.start;
    const containerWidth = $('#split-waveform')?.offsetWidth || 800;
    
    // 计算合适的缩放：让当前句占据容器宽度的60-80%
    // 基础值50 px/s对应100%，所以 px/s = (percent / 100) * 50
    // targetPxPerSec = (containerWidth * 0.7) / duration
    // percent = (targetPxPerSec / 50) * 100
    const targetPxPerSec = (containerWidth * 0.7) / duration;
    const targetPercent = Math.max(100, Math.min((targetPxPerSec / 50) * 100, 2000));
    
    applyZoom(targetPercent);
    
    // 延迟执行滚动，确保zoom已经应用
    setTimeout(() => {
      if (!splitState.wavesurfer) return;
      
      const totalDuration = splitState.wavesurfer.getDuration();
      if (!totalDuration || totalDuration === 0) return;
      
      // 获取波形图的滚动容器（Shadow DOM）
      const container = $('#split-waveform');
      if (!container) return;
      
      // 尝试找到滚动容器
      const wrapper = container.querySelector('div');
      if (wrapper && wrapper.shadowRoot) {
        const scrollContainer = wrapper.shadowRoot.querySelector('[part="scroll"]');
        if (scrollContainer) {
          // 计算当前句在波形图中的像素位置，使用当前的缩放百分比
          const pxPerSec = (splitZoomPercent / 100) * 50;
          const scrollPosition = sub.start * pxPerSec;
          
          // 滚动到当前句位置，留一些边距
          const containerWidth = scrollContainer.clientWidth;
          const targetScroll = Math.max(0, scrollPosition - containerWidth * 0.2);
          
          scrollContainer.scrollLeft = targetScroll;
          console.log(`自动聚焦: 当前句 ${sub.start.toFixed(2)}s, 缩放 ${splitZoomPercent}%, 滚动到 ${targetScroll.toFixed(0)}px`);
        }
      }
      
      // 同时设置播放位置（可选）
      splitState.wavesurfer.seekTo(sub.start / totalDuration);
      
      // 更新参考线位置以适应新的缩放
      updateSplitReferenceBar(container);
    }, 150);
  };

  const updateSplitPreview = () => {
    const sub = App.state.subtitles[splitState.selectedIndex];
    if (!sub) return;

    const splitTime = clamp(splitState.splitTime, sub.start, sub.end);
    splitState.splitTime = splitTime;

    $('#split-start-time').textContent = formatTimeWithMs(sub.start);
    $('#split-cut-time').textContent = formatTimeWithMs(splitTime);
    $('#split-end-time').textContent = formatTimeWithMs(sub.end);

    // 显示原始英文或用户编辑的英文（与字幕列表保持一致）
    $('#split-en').textContent = sub.userEn || sub.en || '';
    $('#split-zh').textContent = sub.userZh || sub.zh || '';

    const totalDuration = sub.end - sub.start;
    const beforeDuration = splitTime - sub.start;
    const proportion = Math.max(0, Math.min(1, beforeDuration / (totalDuration || 1)));

    // 使用 userEn 或 en 来计算单词分割
    const enWords = (sub.userEn || sub.en || '').split(' ').filter(Boolean);
    const zhChars = sub.userZh || sub.zh || '';

    const enCutIndex = Math.ceil(enWords.length * proportion);
    const zhCutIndex = Math.ceil(zhChars.length * proportion);

    const part1En = enWords.slice(0, enCutIndex).join(' ');
    const part2En = enWords.slice(enCutIndex).join(' ');
    const part1Zh = zhChars.slice(0, zhCutIndex);
    const part2Zh = zhChars.slice(zhCutIndex);

    // 更新可编辑的文本框
    $('#split-part1-en').value = part1En;
    $('#split-part1-zh').value = part1Zh;
    $('#split-part2-en').value = part2En;
    $('#split-part2-zh').value = part2Zh;
  };

  // 创建并更新分割点参照线
  const createSplitReferenceBar = (container) => {
    // 移除旧的参照线（如果存在）
    const oldBar = container.querySelector('#split-reference-bar');
    if (oldBar) oldBar.remove();
    
    // 创建参照线
    const referenceBar = document.createElement('div');
    referenceBar.id = 'split-reference-bar';
    referenceBar.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 2px;
      height: 100%;
      background: linear-gradient(to right, transparent, rgba(239, 68, 68, 0.9), transparent);
      z-index: 50;
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.7);
      transition: left 0.1s ease-out;
      cursor: ew-resize;
    `;
    
    container.style.position = 'relative';
    container.appendChild(referenceBar);
    
    // 添加拖动功能
    let isDragging = false;
    
    referenceBar.addEventListener('mousedown', (e) => {
      isDragging = true;
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !splitState.wavesurfer) return;
      
      const sub = App.state.subtitles[splitState.selectedIndex];
      if (!sub) return;
      
      const scrollContainer = container.querySelector('div:nth-child(1)')?.shadowRoot?.querySelector('[part="scroll"]');
      if (!scrollContainer) return;
      
      // 计算鼠标在波形图中的相对位置
      const rect = scrollContainer.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      
      // 加上已滚动的距离
      const actualX = mouseX + scrollContainer.scrollLeft;
      
      // 根据当前缩放百分比计算对应的时间
      // pixelsPerSecond = (splitZoomPercent / 100) * 50
      const pixelsPerSecond = (splitZoomPercent / 100) * 50;
      const newSplitTime = actualX / pixelsPerSecond;
      
      // 限制在当前句的范围内
      splitState.splitTime = clamp(newSplitTime, sub.start, sub.end);
      
      updateSplitPreview();
      updateSplitReferenceBar(container);
      
      // 同时更新播放头
      const player = getPlayer();
      if (player) {
        player.currentTime = splitState.splitTime;
      }
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    // 初始定位
    updateSplitReferenceBar(container);
  };

  // 更新参照线位置
  const updateSplitReferenceBar = (container) => {
    const referenceBar = container?.querySelector('#split-reference-bar');
    if (!referenceBar || !splitState.wavesurfer) return;
    
    const sub = App.state.subtitles[splitState.selectedIndex];
    if (!sub) return;
    
    const totalDuration = splitState.wavesurfer.getDuration();
    if (!totalDuration) return;
    
    // 计算分割点在波形图中的像素位置
    const splitTime = clamp(splitState.splitTime, sub.start, sub.end);
    // 根据当前缩放百分比计算像素/秒
    const pixelsPerSecond = (splitZoomPercent / 100) * 50;
    
    // 获取波形图的实际内容宽度
    const scrollContainer = container.querySelector('div:nth-child(1)')?.shadowRoot?.querySelector('[part="scroll"]');
    if (scrollContainer) {
      // 计算相对于可见区域的位置
      const absolutePixelPos = splitTime * pixelsPerSecond;
      const relativePos = absolutePixelPos - scrollContainer.scrollLeft;
      
      referenceBar.style.left = relativePos + 'px';
    }
  };

  const updateSplitBoundsFromSub = (sub) => {
    const mid = (sub.start + sub.end) / 2;
    const clamped = clamp(splitState.splitTime || mid, sub.start, sub.end);
    splitState.splitTime = clamped;
  };

  const onRegionUpdate = (region) => {
    const sub = App.state.subtitles[splitState.selectedIndex];
    if (!sub) return;
    const minLen = 0.05;
    sub.start = Math.max(0, region.start);
    sub.end = Math.max(sub.start + minLen, region.end);

    // 保存历史记录，支持撤销
    if (typeof App.saveHistory === 'function') {
      App.saveHistory();
    }

    // 更新分割滑块边界和预览
    updateSplitBoundsFromSub(sub);
    App.persistSubtitles();
    App.renderSubtitles();
    App.jumpToSubtitle(splitState.selectedIndex, true);
    updateSplitPreview();
  };

  const setRegionToSubtitle = () => {
    if (!splitState.regions) return;
    const sub = App.state.subtitles[App.state.currentIndex];
    if (!sub) return;
    splitState.selectedIndex = App.state.currentIndex;

    splitState.regions.clearRegions();
    splitState.region = splitState.regions.addRegion({
      start: sub.start,
      end: sub.end,
      drag: true,
      resize: true,
      color: 'rgba(14,165,233,0.2)',
    });

    if (splitState.region) {
      splitState.region.on('update-end', () => onRegionUpdate(splitState.region));
    }

    updateSplitBoundsFromSub(sub);
    updateSplitPreview();
  };

  const ensureWaveSurfer = () => {
    const container = $('#split-waveform');
    const player = getPlayer();
    
    if (!container) {
      console.warn('波形容器未找到');
      return;
    }
    
    if (!window.WaveSurfer) {
      console.error('WaveSurfer 未加载，请检查 CDN');
      container.innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">⚠️ 波形图加载失败，请刷新页面</div>';
      return;
    }
    
    if (!player || !player.src) {
      console.warn('播放器未加载媒体文件');
      container.innerHTML = '<div style="padding:20px;color:#f59e0b;text-align:center;">请先加载音频/视频文件</div>';
      return;
    }

    // 检查播放器音频是否已加载（readyState >= 2 表示有足够的数据）
    if (player.readyState < 2) {
      container.innerHTML = '<div style="padding:20px;color:#f59e0b;text-align:center;">⏳ 等待音频加载中...</div>';
      
      // 等待音频加载完成后再初始化
      const loadHandler = () => {
        player.removeEventListener('loadeddata', loadHandler);
        ensureWaveSurfer(); // 递归调用，此时音频已加载
      };
      player.addEventListener('loadeddata', loadHandler);
      return;
    }

    destroyWaveSurfer();
    
    try {
      splitState.wavesurfer = window.WaveSurfer.create({
        container,
        height: 96,
        waveColor: "rgba(99, 102, 241, 0.3)",
        progressColor: "rgba(99, 102, 241, 0.8)",
        cursorColor: "rgba(139, 92, 246, 0.9)",
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        interact: true,
        fillParent: true,
        minPxPerSec: 100,
        autoScroll: false,
        media: player,
      });

      if (window.WaveSurfer.Regions) {
        splitState.regions = splitState.wavesurfer.registerPlugin(window.WaveSurfer.Regions.create());
      } else {
        console.warn('Regions 插件未加载');
      }

      splitState.wavesurfer.on('ready', () => {
        setRegionToSubtitle();
        
        // 创建固定分割点参照线（必须在focusOnCurrentSubtitle之前）
        createSplitReferenceBar(container);
        
        // 自动聚焦到当前句并设置合适缩放
        focusOnCurrentSubtitle();
        
        // 监听波形图滚动事件以更新参照线位置
        const scrollContainer = container.querySelector('div:nth-child(1)')?.shadowRoot?.querySelector('[part="scroll"]');
        if (scrollContainer) {
          scrollContainer.addEventListener('scroll', () => {
            updateSplitReferenceBar(container);
          });
        }
      });

      // 点击波形图时更新分割点位置
      splitState.wavesurfer.on('click', (relativeTime) => {
        const sub = App.state.subtitles[splitState.selectedIndex];
        if (!sub) return;
        
        // 将点击的时间限制在当前字幕范围内
        const clickedTime = relativeTime * splitState.wavesurfer.getDuration();
        const newSplitTime = clamp(clickedTime, sub.start, sub.end);
        
        // 更新分割点
        splitState.splitTime = newSplitTime;
        
        // 移动播放时间头到新位置
        const player = getPlayer();
        if (player) {
          player.currentTime = newSplitTime;
        }
        
        // 更新预览文本
        updateSplitPreview();
        
        // 更新参照线位置
        updateSplitReferenceBar(container);
      });

    } catch (err) {
      console.error('WaveSurfer 初始化失败:', err);
      container.innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">⚠️ 波形图初始化失败: ' + err.message + '</div>';
    }
  };

  const initSplitUI = () => {
    const sub = App.state.subtitles[App.state.currentIndex];
    if (!sub) return;

    // 重置缩放百分比为初始值
    splitZoomPercent = 100;
    const zoomInput = $('#split-zoom-percent');
    if (zoomInput) {
      zoomInput.value = 100;
    }

    splitState.selectedIndex = App.state.currentIndex;

    const startTime = sub.start;
    const endTime = sub.end;
    const midPoint = (startTime + endTime) / 2;

    splitState.splitTime = midPoint;

    ensureWaveSurfer();
    updateSplitPreview();
  };

  const switchSplitMode = (mode) => {
    splitState.mode = mode;

    document.querySelectorAll('.mode-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    document.querySelectorAll('.split-section').forEach((section) => {
      section.classList.toggle(
        'active',
        (mode === 'split' && section.id === 'split-panel') || (mode === 'merge' && section.id === 'merge-panel')
      );
    });

    if (mode === 'split') initSplitUI();
    else initMergeUI();
  };

  const confirmSplit = () => {
    const sub = App.state.subtitles[splitState.selectedIndex];
    if (!sub) return;

    const splitTime = splitState.splitTime;
    if (splitTime <= sub.start || splitTime >= sub.end) {
      alert('分割时间必须在字幕时间范围内');
      return;
    }

    // 保存历史记录，支持撤销
    if (typeof App.saveHistory === 'function') {
      App.saveHistory();
    }

    // 从可编辑文本框中读取用户编辑的内容
    const part1En = $('#split-part1-en').value.trim();
    const part1Zh = $('#split-part1-zh').value.trim();
    const part2En = $('#split-part2-en').value.trim();
    const part2Zh = $('#split-part2-zh').value.trim();

    // 计算 userEn/userZh 的分割比例（用于用户编辑的译文）
    const totalDuration = sub.end - sub.start;
    const beforeDuration = splitTime - sub.start;
    const proportion = Math.max(0, Math.min(1, beforeDuration / (totalDuration || 1)));

    const newSub1 = {
      start: sub.start,
      end: splitTime,
      en: part1En,
      zh: part1Zh,
      userEn: sub.userEn ? sub.userEn.slice(0, Math.ceil((sub.userEn.length || 0) * proportion)) : '',
      userZh: sub.userZh ? sub.userZh.slice(0, Math.ceil((sub.userZh.length || 0) * proportion)) : '',
      note: '',
    };
    const newSub2 = {
      start: splitTime,
      end: sub.end,
      en: part2En,
      zh: part2Zh,
      userEn: sub.userEn ? sub.userEn.slice(Math.ceil((sub.userEn.length || 0) * proportion)) : '',
      userZh: sub.userZh ? sub.userZh.slice(Math.ceil((sub.userZh.length || 0) * proportion)) : '',
      note: '',
    };

    App.state.subtitles.splice(splitState.selectedIndex, 1, newSub1, newSub2);
    App.persistSubtitles();
    App.renderSubtitles();
    
    // 同步更新主播放器波形图的字幕区域
    if (typeof App.renderWaveformRegions === 'function') {
      App.renderWaveformRegions();
    }
    
    App.jumpToSubtitle(splitState.selectedIndex, true);

    // 更新撤销/重做按钮状态
    if (typeof App.updateHistoryButtons === 'function') {
      App.updateHistoryButtons();
    }

    $('#split-modal').style.display = 'none';
    alert('✅ 分句成功！原字幕分成两个片段');
  };

  const initMergeUI = () => {
    const mergeList = $('#merge-list');
    mergeList.innerHTML = '';

    if (App.state.subtitles.length < 2) {
      mergeList.innerHTML = "<div style='padding: 12px; color: var(--muted);'>需要至少 2 个字幕才能合并</div>";
      return;
    }

    App.state.subtitles.forEach((sub, idx) => {
      const item = document.createElement('div');
      item.className = 'merge-item';
      item.innerHTML = `
        <input type="checkbox" data-index="${idx}" class="merge-checkbox">
        <div class="merge-item-text">
          <strong>${idx + 1}:</strong> ${(sub.en || '').slice(0, 40)}${(sub.en || '').length > 40 ? '...' : ''}
        </div>
        <div class="merge-item-time">${formatTime(sub.start)} - ${formatTime(sub.end)}</div>
      `;

      item.querySelector('.merge-checkbox').addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        if (e.target.checked) {
          if (!splitState.mergeSelection.includes(index)) splitState.mergeSelection.push(index);
        } else {
          splitState.mergeSelection = splitState.mergeSelection.filter((i) => i !== index);
        }
        splitState.mergeSelection.sort((a, b) => a - b);
        updateMergeUI();
      });

      mergeList.appendChild(item);
    });

    updateMergeUI();
  };

  const updateMergeUI = () => {
    document.querySelectorAll('.merge-checkbox').forEach((checkbox) => {
      const index = parseInt(checkbox.dataset.index);
      checkbox.checked = splitState.mergeSelection.includes(index);
    });

    document.querySelectorAll('.merge-item').forEach((item) => {
      const index = parseInt(item.querySelector('.merge-checkbox').dataset.index);
      item.classList.toggle('selected', splitState.mergeSelection.includes(index));
    });

    const mergeControls = $('#merge-controls');
    if (splitState.mergeSelection.length >= 2) {
      const sorted = [...splitState.mergeSelection].sort((a, b) => a - b);
      let isConsecutive = true;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) {
          isConsecutive = false;
          break;
        }
      }
      if (isConsecutive) mergeControls.style.display = 'block';
      else {
        alert('请选择连续的字幕进行合并');
        splitState.mergeSelection = [];
        updateMergeUI();
      }
    } else {
      mergeControls.style.display = 'none';
    }
  };

  const confirmMerge = () => {
    if (splitState.mergeSelection.length < 2) {
      alert('请选择至少 2 个字幕');
      return;
    }

    // 保存历史记录，支持撤销
    if (typeof App.saveHistory === 'function') {
      App.saveHistory();
    }

    const indices = splitState.mergeSelection.sort((a, b) => a - b);
    const firstSub = App.state.subtitles[indices[0]];
    const lastSub = App.state.subtitles[indices[indices.length - 1]];

    const mergedTexts = indices.map((i) => App.state.subtitles[i].en).filter((t) => (t || '').trim());
    const mergedZh = indices.map((i) => App.state.subtitles[i].zh).filter((t) => (t || '').trim());
    const mergedUserEn = indices
      .map((i) => App.state.subtitles[i].userEn)
      .filter((t) => t && (t || '').trim());
    const mergedUserZh = indices
      .map((i) => App.state.subtitles[i].userZh)
      .filter((t) => t && (t || '').trim());

    const mergedSub = {
      start: firstSub.start,
      end: lastSub.end,
      en: mergedTexts.join(' '),
      zh: mergedZh.join(''),
      userEn: mergedUserEn.join(' '),
      userZh: mergedUserZh.join(''),
      note: '',
    };

    App.state.subtitles.splice(indices[0], indices.length, mergedSub);
    App.persistSubtitles();
    App.renderSubtitles();
    
    // 同步更新主播放器波形图的字幕区域
    if (typeof App.renderWaveformRegions === 'function') {
      App.renderWaveformRegions();
    }
    
    App.jumpToSubtitle(Math.max(0, indices[0] - 1), true);

    // 更新撤销/重做按钮状态
    if (typeof App.updateHistoryButtons === 'function') {
      App.updateHistoryButtons();
    }

    $('#split-modal').style.display = 'none';
    alert(`✅ 合并成功！${indices.length} 个字幕已合并为 1 个`);
  };

  const bindSplitModal = () => {
    const modal = $('#split-modal');
    if (!modal) return;

    $('#btn-close-split').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    document.querySelectorAll('.mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchSplitMode(tab.dataset.mode));
    });

    $('#btn-confirm-split').addEventListener('click', confirmSplit);
    $('#btn-confirm-merge').addEventListener('click', confirmMerge);

    // 播放/暂停控制
    const playPauseBtn = $('#btn-play-pause');
    const player = getPlayer();
    
    if (playPauseBtn && player) {
      playPauseBtn.addEventListener('click', async () => {
        if (player.paused) {
          try {
            // 开始播放时，如果播放头不在分割点，则先移到分割点
            const sub = App.state.subtitles[splitState.selectedIndex];
            if (sub) {
              const splitTime = clamp(splitState.splitTime, sub.start, sub.end);
              player.currentTime = splitTime;
              
              // 播放到句子结束位置后，自动返回分割点
              const tempHandler = () => {
                if (player.currentTime >= sub.end) {
                  player.pause();
                  player.currentTime = splitTime;
                  player.removeEventListener('timeupdate', tempHandler);
                  playPauseBtn.textContent = '▶️ 播放';
                }
              };
              player.addEventListener('timeupdate', tempHandler);
            }
            
            // 使用延迟确保 currentTime 改变已完成
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // 调用 play() 并捕获可能的错误
            const playPromise = player.play();
            if (playPromise !== undefined) {
              playPromise.catch(error => {
                // 捕获 AbortError 等播放中断错误，不需要处理
                if (error.name === 'AbortError') {
                  console.debug('播放请求被中断（正常）');
                } else {
                  console.error('播放出错:', error);
                }
              });
            }
            
            playPauseBtn.textContent = '⏸️ 暂停';
          } catch (error) {
            console.error('播放控制出错:', error);
          }
        } else {
          player.pause();
          playPauseBtn.textContent = '▶️ 播放';
        }
      });
      
      // 监听播放器状态变化
      player.addEventListener('play', () => {
        playPauseBtn.textContent = '⏸️ 暂停';
      });
      player.addEventListener('pause', () => {
        playPauseBtn.textContent = '▶️ 播放';
      });
      
      // 实时更新分割时间输入框
      player.addEventListener('timeupdate', () => {
        const splitTimeInput = $('#split-time-input');
        if (splitTimeInput && !splitTimeInput.matches(':focus')) {
          splitTimeInput.value = App.formatPreciseTime(player.currentTime);
        }
      });
    }

    // 分割点调整按钮
    const adjustSplitTime = (delta) => {
      const sub = App.state.subtitles[splitState.selectedIndex];
      if (!sub) return;
      
      splitState.splitTime = clamp(
        splitState.splitTime + delta,
        sub.start,
        sub.end
      );
      
      // 同时移动播放头到调整后的分割点
      if (player) {
        player.currentTime = splitState.splitTime;
      }
      
      updateSplitPreview();
      
      // 更新参照线位置
      const waveformContainer = $('#split-waveform');
      if (waveformContainer) {
        updateSplitReferenceBar(waveformContainer);
      }
    };

    $('#btn-backward-1s')?.addEventListener('click', () => adjustSplitTime(-1.0));
    $('#btn-forward-1s')?.addEventListener('click', () => adjustSplitTime(1.0));
    $('#btn-backward-01s')?.addEventListener('click', () => adjustSplitTime(-0.1));
    $('#btn-forward-01s')?.addEventListener('click', () => adjustSplitTime(0.1));

    // 分割时间输入框功能
    const splitTimeInput = $('#split-time-input');
if (splitTimeInput) {
        const jumpToSplitTime = () => {
          const timeStr = splitTimeInput.value;
          if (!timeStr) return;
          
          const seconds = App.parseTimeString(timeStr);
          const sub = App.state.subtitles[splitState.selectedIndex];
          if (!sub) return;
          
          // 限制在当前字幕范围内
          const newSplitTime = clamp(seconds, sub.start, sub.end);
          splitState.splitTime = newSplitTime;
          
          // 移动播放时间头
          const player = getPlayer();
          if (player) {
            player.currentTime = newSplitTime;
          }
          
          updateSplitPreview();
          const waveformContainer = $('#split-waveform');
          if (waveformContainer) {
            updateSplitReferenceBar(waveformContainer);
          }
        };
        
        // 回车键或失焦时跳转
        splitTimeInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') jumpToSplitTime();
        });
        
      splitTimeInput.addEventListener('blur', jumpToSplitTime);
      
      // 点击时自动填充当前时间
      splitTimeInput.addEventListener('focus', () => {
        const player = getPlayer();
        if (!splitTimeInput.value && player) {
          splitTimeInput.value = App.formatPreciseTime(player.currentTime);
        }
        splitTimeInput.select();
      });
    }

    // 键盘快捷键 - 在 capture 阶段处理，优先于其他监听器
    const handleKeyboard = (e) => {
      // 只在模态框打开时响应快捷键
      if (modal.style.display !== 'flex') return;
      
      // 防止在输入框中触发
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      let handled = false;
      
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          e.stopPropagation();
          playPauseBtn?.click();
          handled = true;
          break;
        case 'ArrowLeft':
          e.preventDefault();
          e.stopPropagation();
          adjustSplitTime(-0.1);
          handled = true;
          break;
        case 'ArrowRight':
          e.preventDefault();
          e.stopPropagation();
          adjustSplitTime(0.1);
          handled = true;
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          adjustSplitTime(-1.0);
          handled = true;
          break;
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          adjustSplitTime(1.0);
          handled = true;
          break;
      }
      
      if (handled) {
        console.debug(`分句快捷键: ${e.code}`);
      }
    };

    // 添加键盘事件监听 - 使用 capture 阶段确保优先级
    document.addEventListener('keydown', handleKeyboard, true);

    // 对齐与缩放
    $('#btn-region-align').addEventListener('click', () => {
      const sub = App.state.subtitles[splitState.selectedIndex];
      if (!sub || !splitState.regions) return;
      
      // 清除旧区域并创建新区域
      splitState.regions.clearRegions();
      splitState.region = splitState.regions.addRegion({
        start: sub.start,
        end: sub.end,
        drag: true,
        resize: true,
        color: 'rgba(14,165,233,0.2)',
      });
      
      // 移动播放头到字幕起始位置
      const player = getPlayer();
      if (player) {
        player.currentTime = sub.start;
      }
      
      // 缩放/滚动以显示当前字幕区间
      focusOnCurrentSubtitle();
    });
    
    // 缩放按钮绑定
    $('#btn-zoom-in').addEventListener('click', zoomIn);
    $('#btn-zoom-out').addEventListener('click', zoomOut);
    $('#btn-zoom-reset').addEventListener('click', zoomReset);
    
    // 缩放百分比输入框
    const zoomInput = $('#split-zoom-percent');
    if (zoomInput) {
      zoomInput.addEventListener('change', () => {
        const percent = parseInt(zoomInput.value) || 100;
        applyZoom(percent);
      });
      
      zoomInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const percent = parseInt(zoomInput.value) || 100;
          applyZoom(percent);
        }
      });
    }

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  };

  const open = () => {
    if (App.state.currentIndex < 0) {
      alert('请先选择一个字幕');
      return;
    }
    const modal = $('#split-modal');
    modal.style.display = 'flex';
    switchSplitMode('split');
  };

  // 初始化绑定
  bindSplitModal();

  window.Split = { open };
})();
