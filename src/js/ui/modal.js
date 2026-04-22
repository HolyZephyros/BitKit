
window.showConfirm = function(message, confirmText = null, cancelText = null, isDanger = true) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.style.zIndex = '99999';
    overlay.style.alignItems = 'center';
    overlay.style.paddingTop = '0';

    if (!confirmText) confirmText = window.t ? window.t('toast.confirmYes') || 'Yes' : 'Yes';
    if (!cancelText) cancelText = window.t ? window.t('dl.cancel') || 'Cancel' : 'Cancel';

    const dialog = document.createElement('div');
    dialog.className = 'command-palette';
    dialog.style.width = '420px';
    dialog.style.padding = '24px';
    dialog.style.display = 'flex';
    dialog.style.flexDirection = 'column';
    dialog.style.gap = '20px';

    const confirmBtnClass = isDanger ? 'btn-primary' : 'btn-primary';
    const confirmBtnStyle = isDanger ? 'background: var(--accent-bordo); border: none; color: #fff;' : '';

    dialog.innerHTML = `
      <div style="font-size: 15px; font-weight: 500; font-family: var(--font-sans); line-height: 1.5; color: var(--text-primary); text-align: left;">
        ${message}
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px;">
        <button class="btn btn-ghost" id="confirmCancelBtn">${cancelText}</button>
        <button class="btn ${confirmBtnClass}" id="confirmAcceptBtn" style="${confirmBtnStyle}">${confirmText}</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = (val) => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 150ms ease';
      dialog.style.transform = 'scale(0.95)';
      dialog.style.transition = 'transform 150ms ease';
      setTimeout(() => overlay.remove(), 150);
      resolve(val);
    };

    overlay.querySelector('#confirmCancelBtn').onclick = () => close(false);
    overlay.querySelector('#confirmAcceptBtn').onclick = () => close(true);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKeyDown);
        close(false);
      } else if (e.key === 'Enter') {
        document.removeEventListener('keydown', handleKeyDown);
        close(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    overlay.querySelector('#confirmAcceptBtn').focus();
  });
};
