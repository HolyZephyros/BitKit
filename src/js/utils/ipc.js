
const ipc = window.bitkit || {};

const isElectron = typeof window.bitkit !== 'undefined';

if (!isElectron) {
  console.warn('BitKit: Electron IPC not available, running in preview mode');
}
