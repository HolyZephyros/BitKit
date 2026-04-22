
const TOGGLE_MAP = {
  toggleThumbnail: 'thumbnail',
  toggleMetadata: 'metadata',
  toggleOpenFolder: 'openFolder',
  toggleShutdown: 'shutdown'
};

const PERSISTENT_TOGGLES = ['thumbnail', 'metadata', 'openFolder'];

function initToggles() {
  document.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', async () => {
      toggle.classList.toggle('active');
      const key = TOGGLE_MAP[toggle.id];
      if (key) {
        state.toggleStates[key] = toggle.classList.contains('active');

        if (PERSISTENT_TOGGLES.includes(key) && window.bitkit) {
          state.settings.toggleStates = state.settings.toggleStates || {};
          state.settings.toggleStates[key] = state.toggleStates[key];
          await window.bitkit.settings.set(state.settings);
        }
      }
    });
  });
}

function restoreToggleStates() {
  const saved = state.settings?.toggleStates;
  if (!saved) return;

  const reverseMap = {};
  for (const [htmlId, stateKey] of Object.entries(TOGGLE_MAP)) {
    reverseMap[stateKey] = htmlId;
  }

  for (const key of PERSISTENT_TOGGLES) {
    if (saved[key] !== undefined && state.toggleStates.hasOwnProperty(key)) {
      state.toggleStates[key] = saved[key];
      const el = document.getElementById(reverseMap[key]);
      if (el) {
        if (saved[key]) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    }
  }
}

function initSliders() {
  const videoBitrate = document.getElementById('videoBitrate');
  const audioBitrate = document.getElementById('audioBitrate');

  videoBitrate?.addEventListener('input', () => {
    document.getElementById('videoBitrateValue').textContent = videoBitrate.value + ' kbps';
  });

  audioBitrate?.addEventListener('input', () => {
    document.getElementById('audioBitrateValue').textContent = audioBitrate.value + ' kbps';
  });
}
