
function initWindowControls() {
  document.getElementById('btnMinimize')?.addEventListener('click', () => window.bitkit?.window.minimize());
  document.getElementById('btnMaximize')?.addEventListener('click', () => window.bitkit?.window.maximize());
  document.getElementById('btnClose')?.addEventListener('click', () => window.bitkit?.window.close());
}
