
const convState = {
  paths: [],
  hasFiles: false,
  videoFormat: 'mp4',
  audioFormat: 'm4a',
  videoCodec: 'libx264',
  audioCodec: 'aac',
  hwAccel: 'none',
  videoEngineEnabled: true,
  audioEngineEnabled: true,
  videoBitrate: '5000',
  videoStreamMode: 'copy',
  audioStreamMode: 'copy',
  qualityMode: 'crf',
  crf: 14,
  resolution: 'original',
  fps: 'original',
  preset: 'veryslow',
  twoPass: false,
  sampleRate: 'original',
  channels: 'original',
  volume: 'original',
  audioBitrate: 'original',
  operationMode: 'video_audio',
  gpuAvailableEncoders: [],
  filters: {
    hdr2sdr: false,
    deshake: false,
    deblock: false,
    deinterlace: false,
    minterpolate: false,
    denoise: false,
    sharpen: false,
    loudnorm: false,
    audiodenoise: false
  },
  filterValues: {
    deblock: 50,
    denoise: 50,
    sharpen: 50,
    audiodenoise: 50
  }
};

function initConverter() {
  setupDragAndDrop();
  setupUIBindings();
  detectAndSetupGPU();

  if (typeof window.MEGA_MATRIX !== 'undefined') {
    populateFormatDropdown();
  }
}

async function detectAndSetupGPU() {
  const select = document.getElementById('convHwAccel');
  if (!select) return;

  select.innerHTML = '<option value="none">Yok (Sadece CPU)</option>';

  if (window.bitkit?.system?.getGPU) {
    try {
      const gpu = await window.bitkit.system.getGPU();
      if (gpu && gpu.vendor && gpu.vendor !== 'none') {
        const vendorMap = {
          nvidia: { val: 'nvenc', text: 'NVIDIA (NVENC)' },
          amd: { val: 'amf', text: 'AMD (AMF)' },
          intel: { val: 'qsv', text: 'Intel (QSV)' },
          apple: { val: 'videotoolbox', text: 'Apple (VideoToolbox)' }
        };

        const mapped = vendorMap[gpu.vendor];
        if (mapped) {

          convState.gpuAvailableEncoders = gpu.available || [];
          console.log('[BitKit:GPU]', gpu.name, '— Desteklenen encoder\'lar:', convState.gpuAvailableEncoders);

          const opt = document.createElement('option');
          opt.value = mapped.val;
          opt.textContent = `${mapped.text} - ${gpu.name || 'Bulundu'}`;
          select.appendChild(opt);

          renderConverterUI();
        }
      }
    } catch (e) {
      console.warn("[BitKit] GPU detection failed:", e);
    }
  }
}

function setupUIBindings() {

  const fileListHeader = document.getElementById('fileListHeader');
  if (fileListHeader) {
    fileListHeader.addEventListener('click', () => {
      const body = document.getElementById('fileListBody');
      const chevron = document.getElementById('fileListChevron');
      if (body.style.display === 'none') {
        body.style.display = 'block';
        chevron.style.transform = 'rotate(180deg)';
      } else {
        body.style.display = 'none';
        chevron.style.transform = 'rotate(0deg)';
      }
    });
  }

  const btnClearConvertFiles = document.getElementById('btnClearConvertFiles');
  if (btnClearConvertFiles) {
    btnClearConvertFiles.addEventListener('click', (e) => {
      e.stopPropagation();
      convState.paths = [];
      convState.hasFiles = false;
      document.getElementById('convSettingsPanel').style.display = 'none';
      document.getElementById('fileListAccordion').style.display = 'none';
      renderFileList();
    });
  }

  document.querySelectorAll('#convTabs .tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#convTabs .tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');

      const target = e.target.getAttribute('data-target');
      document.getElementById('tabProSettings').style.display = target === 'tabProSettings' ? 'block' : 'none';
      document.getElementById('tabQuickTemplates').style.display = target === 'tabQuickTemplates' ? 'block' : 'none';
    });
  });

  document.querySelectorAll('.filter-range').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const target = e.target.getAttribute('data-target');
      const val = parseInt(e.target.value);
      convState.filterValues[target] = val;

      const label = e.target.parentElement.querySelector('.slider-val-text');
      if (label) {
        if (val === 50) {
           label.textContent = typeof t === 'function' ? t('conv.recommended') : 'Recommended';
           label.style.color = 'var(--accent-teal)';
        } else {
           label.textContent = '%' + val;
           label.style.color = 'var(--text-primary)';
        }
      }
    });
  });

  document.querySelectorAll('.filter-toggle').forEach(toggle => {

    const tEl = toggle.querySelector('.toggle');
    const tThumb = toggle.querySelector('.toggle-thumb');
    if (tEl) tEl.removeAttribute('style');
    if (tThumb) tThumb.removeAttribute('style');

    toggle.addEventListener('click', (e) => {
      const filterId = e.currentTarget.getAttribute('data-filter');
      const thumb = e.currentTarget.querySelector('.toggle-thumb');

      convState.filters[filterId] = !convState.filters[filterId];

      const videoFilters = ['deshake', 'deblock', 'deinterlace', 'denoise', 'sharpen', 'minterpolate', 'hdr2sdr'];
      const audioFilters = ['loudnorm', 'audiodenoise'];

      const toggleEl = e.currentTarget.querySelector('.toggle');
      if (toggleEl) {
        const sliderWrapper = document.getElementById('slider-' + filterId);
        if (convState.filters[filterId]) {
          toggleEl.classList.add('active');
          if (sliderWrapper) sliderWrapper.style.display = 'block';
        } else {
          toggleEl.classList.remove('active');
          if (sliderWrapper) sliderWrapper.style.display = 'none';
        }
      }

      if (convState.filters[filterId]) {
        if (videoFilters.includes(filterId) && convState.videoStreamMode === 'copy') {
          convState.videoStreamMode = 'encode';
          const vsModeEl = document.getElementById('convVideoStreamMode');
          if(vsModeEl) vsModeEl.value = 'encode';
          renderConverterUI();
        } else if (audioFilters.includes(filterId) && convState.audioStreamMode === 'copy') {
          convState.audioStreamMode = 'encode';
          const asModeEl = document.getElementById('convAudioStreamMode');
          if(asModeEl) asModeEl.value = 'encode';
          renderConverterUI();
        }
      }

      if (filterId === 'minterpolate') {
        const fpsDropdown = document.getElementById('convFps');
        if (fpsDropdown) {
          if (convState.filters.minterpolate) {
            fpsDropdown.value = 'original';
            convState.fps = 'original';
            fpsDropdown.disabled = true;
            fpsDropdown.title = t('conv.fpsLockedMinterpolate') || 'Manual FPS is locked while Smooth 60 FPS is active.';
            const customDiv = document.getElementById('convFpsCustom');
            if (customDiv) customDiv.style.display = 'none';
          } else {
            fpsDropdown.disabled = false;
            fpsDropdown.title = '';
          }
        }
      }

      if (filterId === 'loudnorm') {
        const volDropdown = document.getElementById('convVolume');
        const chDropdown = document.getElementById('convChannels');
        const srDropdown = document.getElementById('convSampleRate');

        if (convState.filters.loudnorm) {
          if (volDropdown) {
            volDropdown.value = 'original';
            convState.volume = 'original';
            volDropdown.disabled = true;
            volDropdown.title = t('conv.volumeLockedLoudnorm') || 'Volume is locked while Smart Equalizer is active.';
            const customDiv = document.getElementById('convVolumeCustom');
            if (customDiv) customDiv.style.display = 'none';
          }
          if (chDropdown) {
            chDropdown.value = '2';
            convState.channels = '2';
            chDropdown.disabled = true;
            chDropdown.title = t('conv.channelsLockedLoudnorm') || 'Channels locked to Stereo while Smart Equalizer is active.';
            const customDiv = document.getElementById('convChannelsCustom');
            if (customDiv) customDiv.style.display = 'none';
          }
          if (srDropdown) {
            srDropdown.value = 'original';
            convState.sampleRate = 'original';
            srDropdown.disabled = true;
            srDropdown.title = t('conv.srLockedLoudnorm') || 'Smart Equalizer locks to 48kHz sample rate.';
            const customDiv = document.getElementById('convSampleRateCustom');
            if (customDiv) customDiv.style.display = 'none';
          }
        } else {
          if (volDropdown) { volDropdown.disabled = false; volDropdown.title = ''; }
          if (chDropdown) { chDropdown.disabled = false; chDropdown.title = ''; }
          if (srDropdown) { srDropdown.disabled = false; srDropdown.title = ''; }
        }
      }

    });
  });

  document.getElementById('convVideoFormat')?.addEventListener('change', (e) => {
    convState.videoFormat = e.target.value;
    verifyCodecsAgainstFormat();
    renderConverterUI();
  });

  document.getElementById('convAudioFormat')?.addEventListener('change', (e) => {
    convState.audioFormat = e.target.value;
    verifyCodecsAgainstFormat();
    renderConverterUI();
  });

  document.querySelectorAll('.op-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.op-mode-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      const mode = e.target.getAttribute('data-mode');
      convState.operationMode = mode;

      if (mode === 'video_audio') {
        convState.videoEngineEnabled = true;
        convState.audioEngineEnabled = true;
      } else if (mode === 'video_only') {
        convState.videoEngineEnabled = true;
        convState.audioEngineEnabled = false;
      } else if (mode === 'audio_only') {
        convState.videoEngineEnabled = false;
        convState.audioEngineEnabled = true;
      }

      renderConverterUI();
    });
  });

  document.querySelectorAll('#convQualityTabs .tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#convQualityTabs .tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      convState.qualityMode = e.target.getAttribute('data-val');
      renderConverterUI();
    });
  });

  const crfSlider = document.getElementById('convCrfSlider');
  if(crfSlider) {
    crfSlider.addEventListener('input', (e) => {
      convState.crf = parseInt(e.target.value, 10);
      document.getElementById('convCrfValDisplay').textContent = e.target.value;
    });
  }

  document.getElementById('convVideoCodec')?.addEventListener('change', e => {
    const newCodec = e.target.value;

    const isLossless = [14, 15, 20, 3].includes(parseInt(convState.crf));
    if (isLossless) {
      if (newCodec.includes('vp9')) convState.crf = 15;
      else if (newCodec.includes('av1')) convState.crf = 20;
      else if (newCodec.includes('mpeg4') || newCodec.includes('mpeg2video')) convState.crf = 3;
      else convState.crf = 14;

      const slider = document.getElementById('convCrfSlider');
      if (slider) slider.value = convState.crf;
    }

    convState.videoCodec = newCodec;
    renderConverterUI();
  });
  document.getElementById('convHwAccel')?.addEventListener('change', e => {
    convState.hwAccel = e.target.value;
    renderConverterUI();
  });
  document.getElementById('convAudioCodec')?.addEventListener('change', e => { convState.audioCodec = e.target.value; renderConverterUI(); });
  document.getElementById('convResolution')?.addEventListener('change', e => {
    const val = e.target.value;
    const customDiv = document.getElementById('convResolutionCustom');
    if (val === 'custom') {
      if (customDiv) customDiv.style.display = 'block';
      const w = document.getElementById('convResW')?.value;
      const h = document.getElementById('convResH')?.value;
      convState.resolution = (w && h) ? `${w}x${h}` : 'original';
    } else {
      if (customDiv) customDiv.style.display = 'none';
      convState.resolution = val;
    }
  });

  const sanitizeNumericInput = (e) => {
    e.target.value = e.target.value.replace(/[^0-9.]/g, '');
  };

  ['convResW','convResH','convFpsInput','convSampleRateInput','convChannelsInput','convABitrateInput','convVolumeInput']
    .forEach(id => document.getElementById(id)?.addEventListener('input', sanitizeNumericInput));

  document.getElementById('convResW')?.addEventListener('input', e => {
    let w = parseInt(e.target.value);
    const h = document.getElementById('convResH')?.value;
    if (w && h) convState.resolution = `${w}x${h}`;
  });

  document.getElementById('convResH')?.addEventListener('input', e => {
    let h = parseInt(e.target.value);
    const w = document.getElementById('convResW')?.value;
    if (w && h) convState.resolution = `${w}x${h}`;
  });

  document.getElementById('convFps')?.addEventListener('change', e => {
    const val = e.target.value;
    const customDiv = document.getElementById('convFpsCustom');
    if (val === 'custom') {
      if (customDiv) customDiv.style.display = 'block';
      const inputVal = document.getElementById('convFpsInput')?.value;
      convState.fps = inputVal || 'original';
    } else {
      if (customDiv) customDiv.style.display = 'none';
      convState.fps = val;
    }
  });

  document.getElementById('convFpsInput')?.addEventListener('input', e => {
    let val = parseInt(e.target.value);
    convState.fps = val ? val.toString() : 'original';
  });
  document.getElementById('convPreset')?.addEventListener('change', e => { convState.preset = e.target.value; });

  const twoPassToggle = document.getElementById('convTwoPassToggle');
  if(twoPassToggle) {
    twoPassToggle.addEventListener('click', () => {
      convState.twoPass = !convState.twoPass;
      twoPassToggle.classList.toggle('active', convState.twoPass);
      const label = document.getElementById('convTwoPassLabel');
      if(label) label.textContent = convState.twoPass ? (t('conv.on') || 'On') : (t('conv.off') || 'Off');
    });
  }

  document.getElementById('convSampleRate')?.addEventListener('change', e => {
    const val = e.target.value;
    const customDiv = document.getElementById('convSampleRateCustom');
    if (val === 'custom') {
      if (customDiv) customDiv.style.display = 'block';
      const inputVal = document.getElementById('convSampleRateInput')?.value;
      convState.sampleRate = inputVal || 'original';
    } else {
      if (customDiv) customDiv.style.display = 'none';
      convState.sampleRate = val;
    }
  });
  document.getElementById('convSampleRateInput')?.addEventListener('input', e => {
    let val = parseInt(e.target.value);
    convState.sampleRate = val ? val.toString() : 'original';
  });

  document.getElementById('convChannels')?.addEventListener('change', e => {
    const val = e.target.value;
    const customDiv = document.getElementById('convChannelsCustom');
    if (val === 'custom') {
      if (customDiv) customDiv.style.display = 'block';
      const inputVal = document.getElementById('convChannelsInput')?.value;
      convState.channels = inputVal || 'original';
    } else {
      if (customDiv) customDiv.style.display = 'none';
      convState.channels = val;
    }
  });
  document.getElementById('convChannelsInput')?.addEventListener('input', e => {
    let val = parseInt(e.target.value);
    convState.channels = val ? val.toString() : 'original';
  });

  document.getElementById('convABitrate')?.addEventListener('change', e => {
    const val = e.target.value;
    const customDiv = document.getElementById('convABitrateCustom');
    if (val === 'custom') {
      if (customDiv) customDiv.style.display = 'block';
      const inputVal = document.getElementById('convABitrateInput')?.value;
      convState.audioBitrate = inputVal ? inputVal + 'k' : '192k';
    } else {
      if (customDiv) customDiv.style.display = 'none';
      convState.audioBitrate = val;
    }
  });
  document.getElementById('convABitrateInput')?.addEventListener('input', e => {
    let val = parseInt(e.target.value);
    convState.audioBitrate = val ? val + 'k' : '192k';
  });
  document.getElementById('convVolume')?.addEventListener('change', e => {
    const val = e.target.value;
    const customDiv = document.getElementById('convVolumeCustom');
    if (val === 'custom') {
      if (customDiv) customDiv.style.display = 'block';
      const inputVal = document.getElementById('convVolumeInput')?.value;
      convState.volume = inputVal || 'original';
    } else {
      if (customDiv) customDiv.style.display = 'none';
      convState.volume = val;
    }
  });
  document.getElementById('convVolumeInput')?.addEventListener('input', e => {
    let val = parseInt(e.target.value);
    convState.volume = !isNaN(val) ? val.toString() : 'original';
  });

  const CONV_LIMITS = {
    resW:       { min: 16, max: 15360, i18nKey: 'conv.limWidth', fallback: 'Width', unit: 'px' },
    resH:       { min: 16, max: 8640,  i18nKey: 'conv.limHeight', fallback: 'Height', unit: 'px' },
    fps:        { min: 1,  max: 10000, i18nKey: null, fallback: 'FPS', unit: '' },
    sampleRate: { min: 1,  max: 384000, i18nKey: 'conv.limSampleRate', fallback: 'Sample Rate', unit: 'Hz' },
    channels:   { min: 1,  max: 64,    i18nKey: 'conv.limChannels', fallback: 'Channels', unit: '' },
    aBitrate:   { min: 8,  max: 2000,  i18nKey: 'conv.limABitrate', fallback: 'Audio Bitrate', unit: 'kbps' },
    vBitrate:   { min: 8,  max: 1000000, i18nKey: 'conv.limVBitrate', fallback: 'Video Bitrate', unit: 'kbps' },
    volume:     { min: 0,  max: 500,   i18nKey: 'conv.limVolume', fallback: 'Volume', unit: '%' }
  };

  const btnStart = document.getElementById('btnStartConvert');
  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      if (!convState.paths || convState.paths.length === 0) {
        if (window.showToast) window.showToast(t('conv.noFiles') || "Please drop files first!", "error");
        return;
      }

      const validationChecks = [];
      const resW = document.getElementById('convResW');
      const resH = document.getElementById('convResH');
      const fpsInput = document.getElementById('convFpsInput');
      const srInput = document.getElementById('convSampleRateInput');
      const chInput = document.getElementById('convChannelsInput');
      const abInput = document.getElementById('convABitrateInput');
      const volInput = document.getElementById('convVolumeInput');

      const vbInput = document.getElementById('convVBitrateInput');

      const checkField = (el, key, dropdownId, activeValue = 'custom') => {
        if (!el) return;

        if (dropdownId) {
           const dropdown = document.getElementById(dropdownId);
           if (dropdown && dropdown.value !== activeValue) return;
        }

        const val = parseFloat(el.value);
        const lim = { ...CONV_LIMITS[key] };

        let arrayErrorMsg = null;

        if (window.MEGA_MATRIX) {
           if (window.MEGA_MATRIX.audioCodecConstraints && ['sampleRate', 'channels', 'aBitrate'].includes(key)) {
               const constraints = window.MEGA_MATRIX.audioCodecConstraints[convState.audioCodec];
               if (constraints) {
                  if (key === 'sampleRate' && constraints.sampleRates) {
                     lim.max = Math.max(...constraints.sampleRates);
                     if (!constraints.sampleRates.includes(val)) {
                         arrayErrorMsg = constraints.sampleRates.join(', ') + ' Hz';
                     }
                  }
                  else if (key === 'channels' && constraints.maxChannels) lim.max = constraints.maxChannels;
                  else if (key === 'aBitrate' && constraints.maxBitrate) lim.max = constraints.maxBitrate;
               }
           }
           if (window.MEGA_MATRIX.videoCodecConstraints && ['resW', 'resH', 'fps', 'vBitrate'].includes(key)) {
               const vConstraints = window.MEGA_MATRIX.videoCodecConstraints[convState.videoCodec];
               if (vConstraints) {
                  if (key === 'resW' && vConstraints.maxWidth) lim.max = vConstraints.maxWidth;
                  else if (key === 'resH' && vConstraints.maxHeight) lim.max = vConstraints.maxHeight;
                  else if (key === 'fps' && vConstraints.maxFps) lim.max = vConstraints.maxFps;
                  else if (key === 'vBitrate' && vConstraints.maxBitrate) lim.max = vConstraints.maxBitrate;
               }
           }
        }

        let label = lim.fallback;
        if (lim.i18nKey) {
          const resolved = t(lim.i18nKey);
          if (resolved !== lim.i18nKey) label = resolved;
        }
        if (isNaN(val)) {
          validationChecks.push(`${label}: ${t('conv.limInvalid') || 'Invalid value'}`);
        } else if (arrayErrorMsg) {
          validationChecks.push(`${label}: ${t('conv.limOnlyValues') || 'Only these values are supported:'} ${arrayErrorMsg}`);
        } else if (val < lim.min || val > lim.max) {

          const range = `${lim.min.toLocaleString()} – ${lim.max.toLocaleString()}${lim.unit ? ' ' + lim.unit : ''}`;
          validationChecks.push(`${label}: ${t('conv.limRange') || 'Must be within range:'} ${range}`);
        }
      };

      checkField(resW, 'resW', 'convResolution');
      checkField(resH, 'resH', 'convResolution');
      checkField(fpsInput, 'fps', 'convFps');
      if (convState.qualityMode === 'bitrate') {
         checkField(vbInput, 'vBitrate');
      }
      checkField(srInput, 'sampleRate', 'convSampleRate');
      checkField(chInput, 'channels', 'convChannels');
      checkField(abInput, 'aBitrate', 'convABitrate');
      checkField(volInput, 'volume', 'convVolume');

      if (validationChecks.length > 0) {
        if (window.showToast) validationChecks.forEach(msg => window.showToast(msg, 'error'));
        return;
      }

      if (!window.bitkit?.convert?.start) {
        console.error("[BitKit] convert.start API not found!");
        return;
      }

      const activeFormat = convState.videoEngineEnabled ? convState.videoFormat : (convState.audioEngineEnabled ? convState.audioFormat : 'mp4');

      let settings = {};
      try {
        if (window.bitkit?.settings?.get) {
          settings = await window.bitkit.settings.get();
        }
      } catch(e) {}
      const customDir = settings.convertPath;

      for (const inputPath of convState.paths) {
        const isWin = inputPath.includes('\\');
        const sep = isWin ? '\\' : '/';

        const parts = inputPath.split(/[\\/]/);
        const filename = parts.pop();
        const lastDot = filename.lastIndexOf('.');
        const baseName = lastDot > 0 ? filename.substring(0, lastDot) : filename;

        let targetDir = customDir;
        if (!targetDir) {
          targetDir = parts.join(sep);
        }

        const requestedOutputPath = `${targetDir}${sep}${baseName}_converted.${activeFormat}`;

        const audioBitrateEl = document.getElementById('convABitrate');
        let audioBitrateVal = convState.audioBitrate;
        if (audioBitrateVal === 'custom' || (audioBitrateEl && audioBitrateEl.value === 'custom')) {
           let customVal = parseInt(document.getElementById('convABitrateInput')?.value);
           if (customVal < 8) customVal = 8;
           audioBitrateVal = customVal ? `${customVal}k` : '192k';
        }

        const videoBitrateEl = document.getElementById('convVBitrateInput');
        const options = {
          operationMode: convState.operationMode,
          videoEngineEnabled: convState.videoEngineEnabled,
          audioEngineEnabled: convState.audioEngineEnabled,
          videoStreamMode: convState.videoStreamMode,
          audioStreamMode: convState.audioStreamMode,
          filters: convState.filters,
          videoCodec: convState.videoCodec,
          audioCodec: convState.audioCodec,
          audioBitrate: audioBitrateVal,
          videoBitrate: videoBitrateEl ? videoBitrateEl.value : '5000',
          qualityMode: convState.qualityMode,
          crf: convState.crf,
          hwAccel: convState.hwAccel || 'none',
          resolution: convState.resolution,
          fps: convState.fps,
          preset: convState.preset,
          twoPass: convState.twoPass,
          sampleRate: convState.sampleRate,
          channels: convState.channels,
          volume: convState.volume,
          filterValues: convState.filterValues
        };

        console.log('[BitKit:Converter] Sending options to backend:', JSON.stringify(options));
        console.log('[BitKit:Converter] Output path:', requestedOutputPath);

        try {
          const result = await window.bitkit.convert.start(inputPath, requestedOutputPath, options);
          console.log(`[BitKit] Job Queued: ${result.id}`, result);

          activeConversions.set(result.id, {
            id: result.id,
            input: inputPath,
            status: 'queued'
          });
        } catch (e) {
          console.error(e);
        }
      }

      convState.paths = [];
      convState.hasFiles = false;
      document.getElementById('convSettingsPanel').style.display = 'none';
      document.getElementById('fileListAccordion').style.display = 'none';
      renderFileList();
      updateConvertQueueUI();
    });
  }
}

function populateFormatDropdown() {
  const vSelect = document.getElementById('convVideoFormat');
  const aSelect = document.getElementById('convAudioFormat');
  if(!window.MEGA_MATRIX) return;

  if (vSelect) vSelect.innerHTML = '';
  if (aSelect) aSelect.innerHTML = '';

  const groups = {
    modern: t('conv.groupModern') || 'Modern & Web',
    audio: t('conv.groupAudio') || 'Audio Formats',
    pro: t('conv.groupPro') || 'Pro & Broadcast',
    legacy: t('conv.groupLegacy') || 'Legacy & Archive'
  };

  const vGroups = {}, aGroups = {};
  for(let key in groups) {
    const og1 = document.createElement('optgroup'); og1.label = groups[key]; vGroups[key] = og1;
    const og2 = document.createElement('optgroup'); og2.label = groups[key]; aGroups[key] = og2;

    if(vSelect && key !== 'audio') vSelect.appendChild(og1);
    if(aSelect && key === 'audio') aSelect.appendChild(og2);
  }

  for(const [fmt, data] of Object.entries(window.MEGA_MATRIX.containers)) {
    if(data.group === 'audio') {
      if(aGroups[data.group]) {
        const opt = document.createElement('option');
        opt.value = fmt; opt.textContent = fmt.toUpperCase();
        aGroups[data.group].appendChild(opt);
      }
    } else {
      if(vGroups[data.group]) {
        const opt = document.createElement('option');
        opt.value = fmt; opt.textContent = fmt.toUpperCase();
        vGroups[data.group].appendChild(opt);
      }
    }
  }

  if (vSelect) vSelect.value = convState.videoFormat;
  if (aSelect) aSelect.value = convState.audioFormat;

  renderConverterUI();
}

function verifyCodecsAgainstFormat() {
  if (!window.MEGA_MATRIX) return;

  const vData = window.MEGA_MATRIX.containers[convState.videoFormat];
  if(vData && vData.videoCodecs.length > 0 && !vData.videoCodecs.includes(convState.videoCodec)) {
    convState.videoCodec = vData.videoCodecs[0];
  }

  const aData = window.MEGA_MATRIX.containers[convState.audioFormat];
  if(aData && aData.audioCodecs.length > 0 && !aData.audioCodecs.includes(convState.audioCodec)) {
    convState.audioCodec = aData.audioCodecs[0];
  }
}

function renderConverterUI() {
  if (!window.MEGA_MATRIX) return;

  const vPanel = document.getElementById('macroVideoPanel');
  const aPanel = document.getElementById('macroAudioPanel');

  if (vPanel) {
    vPanel.style.display = (convState.operationMode === 'audio_only') ? 'none' : 'block';
  }

  if (aPanel) {
    aPanel.style.display = (convState.operationMode === 'video_only') ? 'none' : 'block';
  }

  const getFriendlyCodecName = (codec) => {
        const map = {
          'libx264': 'H.264 / AVC',
          'libx265': 'H.265 / HEVC',
          'libaom-av1': 'AV1 (AOM)',
          'libvpx-vp9': 'VP9 (Google)',
          'libvpx': 'VP8',
          'mpeg4': 'MPEG-4',
          'mpeg2video': 'MPEG-2',
          'mpeg1video': 'MPEG-1',
          'prores': 'Apple ProRes',
          'dnxhd': 'Avid DNxHD',
          'libwebp_anim': 'Animated WebP',
          'libwebp': 'WebP',
          'mjpeg': 'Motion JPEG',
          'h263': 'H.263',
          'wmv1': 'WMV 7',
          'wmv2': 'WMV 8',
          'flv1': 'Sorenson Spark (FLV)',
          'libmp3lame': 'MP3',
          'aac': 'AAC',
          'ac3': 'Dolby Digital (AC3)',
          'eac3': 'Dolby Digital Plus (E-AC3)',
          'truehd': 'Dolby TrueHD',
          'dts': 'DTS',
          'flac': 'FLAC',
          'alac': 'ALAC',
          'libopus': 'Opus',
          'libvorbis': 'Vorbis',
          'pcm_s16le': 'WAV (PCM)',
          'pcm_s16be': 'AIFF (PCM)',
          'wmav1': 'WMA 7',
          'wmav2': 'WMA 8',
          'amr_nb': 'AMR Narrowband',
          'amr_wb': 'AMR Wideband',
          'mp2': 'MP2'
        };
        return map[codec] || codec.toUpperCase();
      };

      const vData = window.MEGA_MATRIX.containers[convState.videoFormat];
      const vCodecSelect = document.getElementById('convVideoCodec');
      if(vCodecSelect && vData && vData.videoCodecs) {
        vCodecSelect.innerHTML = '';
        const hwMap = (convState.hwAccel !== 'none' && window.MEGA_MATRIX.hardwareEmitters)
          ? window.MEGA_MATRIX.hardwareEmitters[convState.hwAccel] || {}
          : null;

        let hasHW = false;
        vData.videoCodecs.forEach(vc => {
          const o = document.createElement('option');
          o.value = vc;
          let displayName = getFriendlyCodecName(vc);

          if(hwMap) {
            if(hwMap[vc]) {

              const hwEncoderName = hwMap[vc];
              const isAvailable = convState.gpuAvailableEncoders.length === 0 || convState.gpuAvailableEncoders.includes(hwEncoderName);
              if (isAvailable) {
                hasHW = true;
                o.textContent = displayName + ' (' + convState.hwAccel.toUpperCase() + ')';
                vCodecSelect.appendChild(o);
              }
            }
          } else {
            o.textContent = displayName;
            vCodecSelect.appendChild(o);
          }
        });

        if (hwMap && vCodecSelect.options.length === 0) {
          convState.hwAccel = 'none';
          const hwSelect = document.getElementById('convHwAccel');
          if(hwSelect) hwSelect.value = 'none';
          vData.videoCodecs.forEach(vc => {
            const o = document.createElement('option');
            o.value = vc;
            o.textContent = getFriendlyCodecName(vc);
            vCodecSelect.appendChild(o);
          });
        }

        if (hwMap && !hasHW) {
          document.getElementById('hwAccelGroup').style.opacity = '0.5';
        } else if (document.getElementById('hwAccelGroup')) {
          document.getElementById('hwAccelGroup').style.opacity = '1';
        }

        if(vCodecSelect.querySelector(`option[value="${convState.videoCodec}"]`)) {
          vCodecSelect.value = convState.videoCodec;
        } else if(vCodecSelect.options.length > 0) {
          convState.videoCodec = vCodecSelect.options[0].value;
          vCodecSelect.value = convState.videoCodec;

          const isLossless = [14, 15, 20, 3].includes(parseInt(convState.crf));
          if (isLossless) {
            if (convState.videoCodec.includes('vp9')) convState.crf = 15;
            else if (convState.videoCodec.includes('av1')) convState.crf = 20;
            else if (convState.videoCodec.includes('mpeg4') || convState.videoCodec.includes('mpeg2video')) convState.crf = 3;
            else convState.crf = 14;
          }
        }
      }

      const crfSlider = document.getElementById('convCrfSlider');
      const crfDisplay = document.getElementById('convCrfValDisplay');
      if (crfSlider) {
        if (convState.videoCodec && (convState.videoCodec.includes('vp9') || convState.videoCodec.includes('av1'))) {
          crfSlider.max = "63";
          crfSlider.min = "0";
        } else if (convState.videoCodec && (convState.videoCodec.includes('mpeg4') || convState.videoCodec.includes('mpeg2video'))) {
          crfSlider.max = "31";
          crfSlider.min = "1";
          if (parseInt(convState.crf) > 31) convState.crf = 31;
          if (parseInt(convState.crf) < 1) convState.crf = 1;
        } else {
          crfSlider.max = "51";
          crfSlider.min = "0";
          if (parseInt(convState.crf) > 51) convState.crf = 51;
        }
        crfSlider.value = convState.crf;
        if (crfDisplay) crfDisplay.textContent = convState.crf;
      }

  const hw = convState.hwAccel || 'none';
  const presetSelect = document.getElementById('convPreset');
  if (presetSelect) {
    const presetMap = {
      none: [
        {val: 'ultrafast', key: 'conv.presetUltrafast'},
        {val: 'superfast', key: 'conv.presetSuperfast'},
        {val: 'veryfast', key: 'conv.presetVeryfast'},
        {val: 'faster', key: 'conv.presetFaster'},
        {val: 'fast', key: 'conv.presetFast'},
        {val: 'medium', key: 'conv.presetMedium'},
        {val: 'slow', key: 'conv.presetSlow'},
        {val: 'slower', key: 'conv.presetSlower'},
        {val: 'veryslow', key: 'conv.presetVeryslow'}
      ],
      qsv: 'none',
      nvenc: [
        {val: 'p1', key: 'conv.presetP1'},
        {val: 'p2', key: 'conv.presetP2'},
        {val: 'p3', key: 'conv.presetP3'},
        {val: 'p4', key: 'conv.presetP4'},
        {val: 'p5', key: 'conv.presetP5'},
        {val: 'p6', key: 'conv.presetP6'},
        {val: 'p7', key: 'conv.presetP7'}
      ],
      amf: [
        {val: 'speed', key: 'conv.presetAmfSpeed'},
        {val: 'balanced', key: 'conv.presetAmfBalanced'},
        {val: 'quality', key: 'conv.presetAmfQuality'}
      ]
    };

    let options = presetMap[hw];
    if (options === 'none') options = presetMap.none;

    const validVals = options.map(o => o.val);
    if (!validVals.includes(convState.preset)) {
      if (hw === 'amf') convState.preset = 'quality';
      else if (hw === 'nvenc') convState.preset = 'p7';
      else convState.preset = 'veryslow';
    }

    presetSelect.innerHTML = options.map(opt =>
      `<option value="${opt.val}" data-i18n="${opt.key}" ${convState.preset === opt.val ? 'selected' : ''}>${opt.val}</option>`
    ).join('');
  }

  const audioFormatGroup = document.getElementById('audioFormatGroup');
  let audioCodecSource;

  const formatHasAudio = vData && vData.audioCodecs && vData.audioCodecs.length > 0;

  if (convState.operationMode === 'video_audio' || convState.operationMode === 'video_only') {

    if (audioFormatGroup) audioFormatGroup.style.display = 'none';
    audioCodecSource = vData;
  } else {

    if (audioFormatGroup) audioFormatGroup.style.display = 'block';
    audioCodecSource = window.MEGA_MATRIX.containers[convState.audioFormat];
  }

  const aCodecSelect = document.getElementById('convAudioCodec');
  if(aCodecSelect && audioCodecSource && audioCodecSource.audioCodecs) {
    aCodecSelect.innerHTML = '';
    audioCodecSource.audioCodecs.forEach(ac => {
      const o = document.createElement('option');
      o.value = ac;
      o.textContent = getFriendlyCodecName(ac);
      aCodecSelect.appendChild(o);
    });
    if(audioCodecSource.audioCodecs.includes(convState.audioCodec)) {
      aCodecSelect.value = convState.audioCodec;
    } else if(audioCodecSource.audioCodecs.length > 0) {
      convState.audioCodec = audioCodecSource.audioCodecs[0];
      aCodecSelect.value = convState.audioCodec;
    }
  }

  const constraints = window.MEGA_MATRIX.audioCodecConstraints?.[convState.audioCodec];

  const srSelect = document.getElementById('convSampleRate');
  if (srSelect && constraints) {
    Array.from(srSelect.options).forEach(opt => {
      if (opt.value === 'original' || opt.value === 'custom') return;
      const sr = parseInt(opt.value);
      opt.disabled = !constraints.sampleRates.includes(sr);
      opt.style.display = opt.disabled ? 'none' : '';
    });

    if (convState.sampleRate !== 'original' && convState.sampleRate !== 'custom') {
      const sr = parseInt(convState.sampleRate);
      if (!constraints.sampleRates.includes(sr)) {
        convState.sampleRate = 'original';
        srSelect.value = 'original';
        const customDiv = document.getElementById('convSampleRateCustom');
        if (customDiv) customDiv.style.display = 'none';
      }
    }
  }

  const chSelect = document.getElementById('convChannels');
  if (chSelect && constraints) {
    Array.from(chSelect.options).forEach(opt => {
      if (opt.value === 'original' || opt.value === 'custom') return;
      const ch = parseInt(opt.value);
      opt.disabled = ch > constraints.maxChannels;
      opt.style.display = opt.disabled ? 'none' : '';
    });

    if (convState.channels !== 'original') {
      const ch = parseInt(convState.channels);
      if (ch > constraints.maxChannels) {
        convState.channels = 'original';
        chSelect.value = 'original';
        const customDiv = document.getElementById('convChannelsCustom');
        if (customDiv) customDiv.style.display = 'none';
      }
    }
  }

  const abSelect = document.getElementById('convABitrate');
  const abInputWrapper = document.getElementById('convABitrateInput')?.parentElement;
  if (abSelect && constraints) {
    if (constraints.lossless) {
      abSelect.disabled = true;
      abSelect.value = 'original';
      convState.audioBitrate = 'original';
      if (abInputWrapper) abInputWrapper.style.display = 'none';
      abSelect.parentElement.setAttribute('data-i18n-tip', 'conv.tipLosslessNoBitrate');
    } else {
      abSelect.disabled = false;
      abSelect.parentElement.removeAttribute('data-i18n-tip');
    }
  }

  if (convState.videoEngineEnabled && !formatHasAudio) {

    if (aPanel) aPanel.style.opacity = '0.3';
    if (aPanel) aPanel.style.pointerEvents = 'none';
    if (aStatus) {
      aStatus.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">' + t('conv.noAudioSupport') + '</span>';
    }
  } else if (aPanel) {
    aPanel.style.opacity = '';
    aPanel.style.pointerEvents = '';
  }

  const videoOnlyIds = ['convResolution', 'convFps', 'convPreset', 'convTwoPassToggle'];
  videoOnlyIds.forEach(elId => {
    const group = document.getElementById(elId)?.closest('.input-group');
    if (group) {
      group.style.display = convState.videoEngineEnabled ? '' : 'none';
    }
  });

  const qualityTabs = document.getElementById('convQualityTabs')?.closest('.input-group');
  if (qualityTabs) {
    qualityTabs.style.display = convState.videoEngineEnabled ? '' : 'none';
  }

  const isHW = convState.hwAccel !== 'none';
  const crfLabel = document.getElementById('convCrfLabel');

  if(crfLabel) {
    crfLabel.textContent = isHW ? (t('conv.crfLabelHW') || 'Constant Quality (CQ)') : (t('conv.crfLabelCPU') || 'Quality Value (CRF)');
  }

  const twoPassGroup = document.getElementById('convTwoPassToggle')?.closest('.input-group');
  if (twoPassGroup) {
    twoPassGroup.style.display = 'none';
    if (isHW) convState.twoPass = false;
  }

  const crfBox = document.getElementById('convQualityCrfBox');
  const brBox = document.getElementById('convQualityBitrateBox');
  if(crfBox) crfBox.style.display = convState.qualityMode === 'crf' ? 'block' : 'none';
  if(brBox) brBox.style.display = convState.qualityMode === 'bitrate' ? 'block' : 'none';

  if (typeof applyTranslations === 'function') applyTranslations();
}

function setupDragAndDrop() {
  const dropZone = document.getElementById('dropZone');

  if (dropZone) {
    dropZone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');

      const filesArr = Array.from(e.dataTransfer.files);
      if (filesArr.length === 0) return;

      let paths = [];
      if (window.bitkit?.utils?.getPathForFile) {
        paths = filesArr.map(f => window.bitkit.utils.getPathForFile(f)).filter(p => p);
      } else {
        paths = filesArr.map(f => f.path).filter(p => p);
      }

      console.log("[Converter] Dropped files:", paths);

      document.getElementById('convSettingsPanel').style.display = 'block';
      convState.hasFiles = true;

      paths.forEach(p => {
        if (!convState.paths.includes(p)) convState.paths.push(p);
      });

      populateFormatDropdown();
      renderFileList();
      probeFiles(paths);
    });

    dropZone.addEventListener('click', async () => {
      if (!window.bitkit?.file?.selectFiles) return;
      try {
        const result = await window.bitkit.file.selectFiles({
          title: t('conv.selectMediaFiles') || 'Select Media Files',
          filters: [{ name: t('conv.mediaFilter') || 'Media', extensions: ['mp4','mkv','avi','mov','webm','flv','wmv','mp3','m4a','flac','wav','ogg','aac'] }]
        });
        if (result && !result.canceled && result.paths && result.paths.length > 0) {
          document.getElementById('convSettingsPanel').style.display = 'block';
          convState.hasFiles = true;
          result.paths.forEach(p => { if (!convState.paths.includes(p)) convState.paths.push(p); });
          populateFormatDropdown();
          renderFileList();
          probeFiles(result.paths);
        }
      } catch (e) { console.warn('[BitKit] File selection failed:', e); }
    });
  }
}

async function probeFiles(paths) {
  if (!convState.fileMeta) convState.fileMeta = {};

  for (const p of paths) {
    if (!convState.fileMeta[p]) {
      convState.fileMeta[p] = { loading: true, data: null };
      renderFileList();

      if (window.bitkit?.media?.getInfo) {
        try {
          const res = await window.bitkit.media.getInfo(p);
          if (res && res.success) {
            convState.fileMeta[p] = { loading: false, data: res.data };
          } else {
            convState.fileMeta[p] = { loading: false, data: null, error: true };
          }
        } catch(e) {
          convState.fileMeta[p] = { loading: false, data: null, error: true };
        }
        renderFileList();
      }
    }
  }
}

function renderFileList() {
  const fileListAccordion = document.getElementById('fileListAccordion');
  const fileList = document.getElementById('fileList');
  const fileListCount = document.getElementById('fileListCount');

  if (!fileListAccordion || !fileList || !fileListCount) return;

  if (convState.paths.length === 0) {
    fileListAccordion.style.display = 'none';
    return;
  }

  fileListAccordion.style.display = 'block';
  fileListCount.textContent = convState.paths.length;
  fileList.innerHTML = '';

  convState.paths.forEach((path, index) => {

    const parts = path.split(/[\\/]/);
    const filename = parts[parts.length - 1];
    const extMatch = filename.match(/\.([^.]+)$/);
    const ext = extMatch ? extMatch[1].toUpperCase() : (t('conv.unknown') || 'UNKNOWN');

    let metaTags = '';
    const meta = convState.fileMeta ? convState.fileMeta[path] : null;

    if (meta) {
      if (meta.loading) {
        metaTags = `<span class="tag tag-neutral" style="opacity:0.6;">⏳ ${t('conv.analyzing') || 'Analiz ediliyor...'}</span>`;
      } else if (meta.data) {
        const d = meta.data;
        if (d.video && d.video.length > 0) {
          const v = d.video[0];
          if (v.width && v.height) metaTags += `<span class="tag tag-teal">${v.width}x${v.height}</span>`;
          if (v.fps) metaTags += `<span class="tag tag-neutral">${Math.round(v.fps)} FPS</span>`;
          if (v.bitrate) {
            metaTags += `<span class="tag tag-neutral">${Math.round(v.bitrate / 1000)} kbps</span>`;
          } else if (d.bitrate) {
            metaTags += `<span class="tag tag-neutral">~${Math.round(d.bitrate / 1000)} kbps</span>`;
          }
          if (v.codec) metaTags += `<span class="tag tag-neutral">${v.codec.toUpperCase()}</span>`;
        }
        if (d.audio && d.audio.length > 0) {
          const a = d.audio[0];
          if (a.codec) metaTags += `<span class="tag tag-neutral">♪ ${a.codec.toUpperCase()}</span>`;
          if (a.bitrate) metaTags += `<span class="tag tag-neutral">${Math.round(a.bitrate / 1000)} kbps</span>`;
          if (a.sampleRate) metaTags += `<span class="tag tag-neutral">${a.sampleRate} Hz</span>`;
          if (a.channels) {
            const chStr = a.channels === 1 ? 'Mono' : a.channels === 2 ? 'Stereo' : a.channels === 6 ? '5.1' : `${a.channels} CH`;
            metaTags += `<span class="tag tag-neutral">${chStr}</span>`;
          }
        }
      }
    }

    const item = document.createElement('div');
    item.className = 'file-item';

    item.innerHTML = `
      <div class="file-item-icon" style="color: #fff;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
      </div>
      <div class="file-item-info">
        <div class="file-item-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
        <div class="file-item-meta" style="display:flex; align-items:center; gap:6px; margin-top:4px; flex-wrap:wrap;">
          <span class="tag tag-bordo">${ext}</span>
          ${metaTags}
        </div>
      </div>
      <button class="file-item-remove btn-remove-file" data-index="${index}" title="${t('conv.remove') || 'Remove'}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    `;
    fileList.appendChild(item);
  });

  fileList.querySelectorAll('.btn-remove-file').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'));
      convState.paths.splice(idx, 1);

      if (convState.paths.length === 0) {
        document.getElementById('convSettingsPanel').style.display = 'none';
        document.getElementById('fileListAccordion').style.display = 'none';
        convState.hasFiles = false;
      }
      renderFileList();
    });
  });
}

window.setupDragAndDrop = setupDragAndDrop;

const activeConversions = state.conversions;

window.cancelConversion = function(id) {
  if (window.bitkit?.convert?.cancel) {
    window.bitkit.convert.cancel(id);
  }
  activeConversions.delete(id);
  updateConvertQueueUI();
  if(window.showToast) window.showToast(t('conv.cancelledSingle') || 'Conversion cancelled.', 'info');
};

window.cancelAllConversions = async function() {
  if (activeConversions.size === 0) return;

  const confirmStr = t('conv.cancelAllConfirm') || "Cancel all conversions?";
  if (window.showConfirm) {
    if (!(await window.showConfirm(confirmStr, null, null, true))) return;
  } else {
    if (!confirm(confirmStr)) return;
  }

  const ids = Array.from(activeConversions.keys());
  ids.forEach(id => {
    if (window.bitkit?.convert?.cancel) {
      window.bitkit.convert.cancel(id);
    }
  });

  activeConversions.clear();
  updateConvertQueueUI();
  if(window.showToast) window.showToast(t('conv.cancelledAll') || 'All conversions cancelled.', 'info');
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(str, n) {
  return (str.length > n) ? str.slice(0, n-1) + '…' : str;
}

function updateConvertQueueUI() {
  if (typeof window.updateStatusBar === 'function') window.updateStatusBar();

  const container = document.getElementById('convertQueue');
  if (!container) return;

  if (activeConversions.size === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  const existingCards = container.querySelectorAll('.card[id^="conv-item-"]');
  let needsFullRender = existingCards.length !== activeConversions.size;

  if (!needsFullRender) {
    activeConversions.forEach((conv) => {
      const card = document.getElementById(`conv-item-${conv.id}`);
      if (!card) { needsFullRender = true; return; }

      let percent = conv.percent ?? conv.progress ?? 0;
      percent = Math.min(100, Math.max(0, percent));

      if (conv.status === 'error') {
         if (!card.hasAttribute('data-error-state')) { needsFullRender = true; return; }
      } else {
         const pctEl = card.querySelector('.conv-pct');
         const barEl = card.querySelector('.conv-bar');
         if (pctEl && barEl) {
           pctEl.textContent = `${percent.toFixed(1)}%`;
           barEl.style.width = `${percent}%`;
         } else {
           needsFullRender = true;
         }
      }
    });
  }

  if (!needsFullRender) return;

  const itemsHTML = Array.from(activeConversions.values()).map(conv => {
    let percent = conv.percent ?? conv.progress ?? 0;
    percent = Math.min(100, Math.max(0, percent));
    const filename = conv.input ? conv.input.split(/[\\/]/).pop() : `${t('conv.task') || 'Task'} ${conv.id}`;

    return `
      <div class="card" id="conv-item-${conv.id}" ${conv.status === 'error' ? 'data-error-state="true"' : ''} style="margin-bottom:var(--space-sm); ${conv.status === 'error' ? 'border: 1px solid var(--accent-bordo);' : ''}">
        <div class="flex-between" style="margin-bottom:var(--space-sm)">
          <div class="text-md" style="font-weight:600">${escapeHtml(truncate(filename, 50))}</div>
          <div style="display:flex;align-items:center;gap:var(--space-sm)">
            ${conv.status === 'error'
              ? `<div class="tag tag-bordo" style="font-size:12px;font-weight:700">${t('conv.failed') || 'FAILED'}</div>`
              : `<div class="conv-pct tag tag-teal" style="font-family:var(--font-mono)">${percent.toFixed(1)}%</div>`
            }
            <button class="btn-cancel-convert btn-convert-queue-action" data-id="${conv.id}" data-error="${conv.status === 'error'}" title="${t('dl.cancel') || 'Cancel'}" style="background:var(--accent-bordo);border:none;color:#fff;cursor:pointer;padding:6px 10px;border-radius:var(--radius-sm);font-size:20px;font-weight:bold;line-height:1;transition:all .2s">✕</button>
          </div>
        </div>
        ${conv.status === 'error'
          ? `<div style="color: var(--accent-bordo); font-size: 13px; margin-top: 8px; font-weight: 500; word-break: break-all;">${t('conv.errorPrefix') || 'Hata'}: ${escapeHtml(conv.errorMsg || t('conv.unknownError') || 'Bilinmeyen Hata')}</div>`
          : `<div class="progress-bar">
              <div class="conv-bar progress-fill" style="width: ${percent}%;"></div>
             </div>`
        }
      </div>
    `;
  }).join('');

  const convCount = activeConversions.size;

  container.innerHTML = `
    <div class="card" style="margin-top: var(--space-lg); cursor:pointer; user-select:none;"
         onclick="if(event.target.closest('.conv-queue-list')) return; const list = this.querySelector('.conv-queue-list'); const svg = this.querySelector('.conv-chevron'); if(list.style.display === 'none') { list.style.display = ''; svg.style.transform = 'rotate(180deg)'; } else { list.style.display = 'none'; svg.style.transform = 'rotate(0deg)'; }">
      <div class="flex-between" style="margin-bottom: var(--space-md);">
        <div style="display:flex; align-items:center; gap:8px;">
          <h3 style="font-size: var(--text-lg); margin: 0; font-weight:800;" data-i18n="conv.activeTasks">${t('conv.activeTasks') || 'Active Tasks'}</h3>
          <span style="font-size:13px; font-weight:800; background:var(--accent-teal); color:#000; padding:3px 10px; border-radius:999px; line-height:1.4;">${convCount}</span>
          <svg class="conv-chevron" fill="none" height="18" stroke="currentColor" stroke-width="2" style="transition: transform 0.2s ease; transform: rotate(180deg); color: var(--text-muted);" viewBox="0 0 24 24" width="18"><path d="M6 9l6 6 6-6"></path></svg>
        </div>
        <div onclick="event.stopPropagation()" style="display:flex; gap:var(--space-sm);">
          <button class="btn btn-secondary btn-sm btn-convert-cancel-all" style="background:var(--accent-bordo); color:#fff; font-weight:600;">
            <svg fill="none" height="14" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14"><path d="M18 6L6 18M6 6l12 12"></path></svg>
            <span data-i18n="dl.cancelAll">Tümünü İptal Et</span>
          </button>
        </div>
      </div>
      <div class="conv-queue-list flex-col gap-sm" onclick="event.stopPropagation()" style="cursor:default; user-select:text;">
        ${itemsHTML}
      </div>
    </div>
  `;

  container.querySelectorAll('.btn-convert-queue-action').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const isError = btn.getAttribute('data-error') === 'true';
      if (isError) {
        activeConversions.delete(id);
        updateConvertQueueUI();
      } else {
        window.cancelConversion(id);
      }
    });
  });

  const cancelAllBtn = container.querySelector('.btn-convert-cancel-all');
  if (cancelAllBtn) {
    cancelAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.cancelAllConversions();
    });
  }
}

if (!document.getElementById('convert-queue-styles')) {
  const style = document.createElement('style');
  style.id = 'convert-queue-styles';
  style.innerHTML = `
    .btn-convert-queue-action:hover { background: var(--accent-bordo-hover) !important; transform: scale(1.1); }
  `;
  document.head.appendChild(style);
}

if (window.bitkit?.convert?.onProgress) {
  window.bitkit.convert.onProgress((data) => {
    if (!data || !data.id) return;
    if (!activeConversions.has(data.id)) {
      activeConversions.set(data.id, { ...data, status: 'progress' });
    } else {
      const existing = activeConversions.get(data.id);
      activeConversions.set(data.id, { ...existing, ...data, status: 'progress' });
    }
    updateConvertQueueUI();
  });
}

if (window.bitkit?.convert?.onComplete) {
  window.bitkit.convert.onComplete((data) => {
    if (!data || !data.id) return;
    if (activeConversions.has(data.id)) {
      const existing = activeConversions.get(data.id);
      activeConversions.set(data.id, { ...existing, ...data, status: 'done', progress: 100 });
      updateConvertQueueUI();

      if (window.bitkit?.history?.add) {
        const filename = existing.input ? existing.input.split(/[\\/]/).pop() : `Task ${data.id}`;
        window.bitkit.history.add({
          title: filename,
          url: existing.input || '',
          outputPath: data.outputPath || existing.output || '',
          type: 'convert'
        });
        if (state.currentPage === 'history' && typeof loadHistory === 'function') {
          loadHistory();
        }
      }

      setTimeout(() => {
        activeConversions.delete(data.id);
        updateConvertQueueUI();
      }, 3000);
    }
  });
}

if (window.bitkit?.convert?.onError) {
  window.bitkit.convert.onError((data) => {
    if (!data || !data.id) return;
    if (activeConversions.has(data.id)) {
      const existing = activeConversions.get(data.id);
      activeConversions.set(data.id, { ...existing, ...data, status: 'error', errorMsg: data.message || data.errorKey });
      updateConvertQueueUI();

      setTimeout(() => {
        activeConversions.delete(data.id);
        updateConvertQueueUI();
      }, 5000);
    }
  });
}

document.addEventListener('bitkit:quickConvert', async (e) => {
  const { templateId, params } = e.detail;

  if (convState.paths.length === 0) {
    if (window.showToast) window.showToast(typeof t === 'function' ? t('quick.errNoFile') : 'Please select a video to convert first!', 'warning');
    return;
  }

  const btnQuick = document.getElementById('btnQuickConvert');
  if (btnQuick) btnQuick.setAttribute('disabled', 'true');

  try {
    let settings = state.settings;
    if (!settings && window.bitkit?.settings?.get) {
      settings = await window.bitkit.settings.get();
    }
    const customDir = settings?.convertPath;

    for (const inputPath of convState.paths) {
      const sourceExt = inputPath.split('.').pop().toLowerCase();

      let targetExt = 'mp4';
      if (templateId === 'smart_convert') targetExt = params && params['sc-format'] ? params['sc-format'] : 'mp4';
      else if (templateId === 'audio_only') targetExt = params && params.value === 'original' ? 'mka' : (params && params.value ? params.value : 'mp3');
      else if (templateId === 'video_mute') targetExt = params && params.value === 'original' ? sourceExt : (params && params.value ? params.value : 'mp4');
      else if (templateId === 'webm') targetExt = 'webm';
      else if (templateId === 'gif') targetExt = 'gif';
      else if (templateId === 'webp_anim') targetExt = 'webp';
      else if (templateId === 'thumbnail') targetExt = 'png';

      const isWin = inputPath.includes('\\');
      const sep = isWin ? '\\' : '/';
      const parts = inputPath.split(/[\\/]/);
      const filename = parts.pop();
      const lastDot = filename.lastIndexOf('.');
      const pureName = lastDot > 0 ? filename.substring(0, lastDot) : filename;

      let targetDir = customDir;
      if (!targetDir) {
        targetDir = parts.join(sep);
      }

      const suffix = `_BitKit_${templateId}`;
      let requestedOutputPath;

      const hasSplit = templateId === 'split' ||
        (templateId === 'multi_filter' && params?.filters?.some(f => f.id === 'split'));

      if (hasSplit) {
        requestedOutputPath = `${targetDir}${sep}${pureName}${suffix}_%03d.${targetExt}`;
      } else {
        requestedOutputPath = `${targetDir}${sep}${pureName}${suffix}.${targetExt}`;
      }

      if (!hasSplit && window.bitkit?.fileManager?.getUniquePath) {
        requestedOutputPath = await window.bitkit.fileManager.getUniquePath(requestedOutputPath);
      }

      const options = {
        templateId: templateId,
        templateParams: params
      };

      console.log(`[BitKit:QuickConvert] Starting template ${templateId} for ${inputPath}`);

      if (window.bitkit?.convert?.start) {
        const result = await window.bitkit.convert.start(inputPath, requestedOutputPath, options);
        activeConversions.set(result.id, {
          id: result.id,
          input: inputPath,
          status: 'queued',
          progress: 0
        });
      }
    }

    convState.paths = [];
    convState.hasFiles = false;
    renderFileList();
    updateConvertQueueUI();

    const queueEl = document.getElementById('convertQueue');
    if (queueEl) {
      queueEl.style.display = 'block';
      queueEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const dropzone = document.getElementById('convDropzone');
    if (dropzone) {
      dropzone.innerHTML = `
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" x2="12" y1="3" y2="15"></line></svg>
        <div class="drop-zone-title" data-i18n="conv.dropTitle" style="pointer-events: none;">${typeof t === 'function' ? t('conv.dropTitle') : 'Drag files here'}</div>
        <div class="drop-zone-hint" data-i18n="conv.dropHint" style="pointer-events: none;">${typeof t === 'function' ? t('conv.dropHint') : 'or click to select • Video & Audio files'}</div>
         ${typeof applyTranslations === 'function' ? (applyTranslations(), '') : ''}
      `;
    }

  } catch (err) {
    console.error('[BitKit:QuickConvert] Error:', err);
    if (window.showToast) window.showToast(typeof t === 'function' ? t('quick.errFailed') : 'Conversion failed to start!', 'error');
  } finally {
    if (btnQuick) btnQuick.removeAttribute('disabled');
  }
});
