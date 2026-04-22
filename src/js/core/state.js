
const state = {
  currentPage: 'downloader',
  sidebarExpanded: false,
  panelVisible: false,
  mediaInfo: null,
  downloads: new Map(),
  conversions: new Map(),
  convertFiles: [],
  downloadMode: 'video',
  pendingQueue: [],
  queueProcessingActive: false,
  editingQueueIndex: null,
  settings: {},
  selectedPreset: null,
  globalRateLimit: 0,
  playlistEntries: null,
  playlistSelected: new Set(),
  toggleStates: {
    thumbnail: false,
    metadata: true,
    openFolder: false,
    shutdown: false
  }
};
