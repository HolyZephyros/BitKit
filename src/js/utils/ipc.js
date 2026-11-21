
const ipc = window.bitkit || {};

const isNativeApp = typeof window.bitkit !== 'undefined';

if (!isNativeApp) {
  console.warn('BitKit: Native IPC bridge not available, running in preview mode');
}
