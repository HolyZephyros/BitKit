
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const iconColors = {
    success: 'var(--success)',
    error: 'var(--error)',
    warning: 'var(--warning)',
    info: 'var(--accent-teal)'
  };

  toast.className = `toast toast-${type}`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  iconSpan.style.color = iconColors[type];
  iconSpan.style.fontWeight = 'bold';
  iconSpan.textContent = icons[type];

  const messageSpan = document.createElement('span');
  messageSpan.className = 'toast-message';
  messageSpan.innerHTML = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => toast.remove();

  toast.appendChild(iconSpan);
  toast.appendChild(messageSpan);
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, duration);

  while (container.children.length > 5) {
    container.firstChild.remove();
  }
}
