
const commands = [
  { id: 'nav-downloader', labelKey: 'nav.downloader', icon: '📥', action: () => navigateTo('downloader'), shortcut: '' },
  { id: 'nav-converter', labelKey: 'nav.converter', icon: '🔄', action: () => navigateTo('converter'), shortcut: '' },
  { id: 'nav-editor', labelKey: 'nav.editor', icon: '✂️', action: () => navigateTo('editor'), shortcut: '' },
  { id: 'nav-history', labelKey: 'nav.history', icon: '📋', action: () => navigateTo('history'), shortcut: '' },
  { id: 'nav-settings', labelKey: 'nav.settings', icon: '⚙️', action: () => navigateTo('settings'), shortcut: '' },
  { id: 'update-ytdlp', labelKey: 'settings.update', icon: '🔄', action: () => document.getElementById('btnUpdateYtdlp')?.click() },
  { id: 'paste-url', labelKey: 'dl.analyze', icon: '📋', action: async () => {
    navigateTo('downloader');
    try {
      const text = await navigator.clipboard.readText();
      document.getElementById('urlInput').value = text;
      analyzeUrl();
    } catch(e) {}
  }},
];

let commandPaletteOpen = false;
let selectedCommandIndex = 0;

function initCommandPalette() {
  const overlay = document.getElementById('commandPaletteOverlay');
  const input = document.getElementById('commandInput');

  window.commandPalette = {
    open: () => openCommandPalette(),
    close: () => closeCommandPalette()
  };

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeCommandPalette();
  });

  input?.addEventListener('input', () => filterCommands(input.value));
  input?.addEventListener('keydown', handleCommandKeydown);

  renderCommands(commands);
}

function openCommandPalette() {
  const overlay = document.getElementById('commandPaletteOverlay');
  overlay.style.display = 'flex';
  commandPaletteOpen = true;
  selectedCommandIndex = 0;

  const input = document.getElementById('commandInput');
  input.value = '';
  input.focus();
  renderCommands(commands);
}

function closeCommandPalette() {
  document.getElementById('commandPaletteOverlay').style.display = 'none';
  commandPaletteOpen = false;
}

function filterCommands(query) {
  const q = query.toLowerCase();
  const filtered = commands.filter(c => t(c.labelKey).toLowerCase().includes(q));
  selectedCommandIndex = 0;
  renderCommands(filtered);
}

function renderCommands(cmds) {
  const list = document.getElementById('commandList');
  list.innerHTML = cmds.map((cmd, i) => `
    <div class="command-item ${i === selectedCommandIndex ? 'selected' : ''}" data-index="${i}" onclick="executeCommand(${commands.indexOf(cmd)})">
      <span>${cmd.icon || ''}</span>
      <span class="command-item-label">${t(cmd.labelKey)}</span>
      ${cmd.shortcut ? `<span class="command-item-shortcut">${cmd.shortcut}</span>` : ''}
    </div>
  `).join('');
}

function handleCommandKeydown(e) {
  const items = document.querySelectorAll('.command-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedCommandIndex = Math.min(selectedCommandIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('selected', i === selectedCommandIndex));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedCommandIndex = Math.max(selectedCommandIndex - 1, 0);
    items.forEach((el, i) => el.classList.toggle('selected', i === selectedCommandIndex));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const selected = items[selectedCommandIndex];
    if (selected) selected.click();
  } else if (e.key === 'Escape') {
    closeCommandPalette();
  }
}

function executeCommand(index) {
  commands[index]?.action();
  closeCommandPalette();
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {

    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      if (commandPaletteOpen) closeCommandPalette();
      else openCommandPalette();
    }

    if (e.key === 'Escape') {
      if (commandPaletteOpen) closeCommandPalette();
    }

    if (e.ctrlKey && e.key === 'v' && state.currentPage === 'downloader') {
      const activeEl = document.activeElement;
      if (!activeEl || activeEl === document.body) {
        navigator.clipboard.readText().then(text => {
          if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
            document.getElementById('urlInput').value = text;
            analyzeUrl();
          }
        }).catch(() => {});
      }
    }
  });
}
