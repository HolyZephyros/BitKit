
let selectedTemplateId = null;

function setupQuickTemplates() {
  const container = document.getElementById('quickTemplatesContainer');
  if (!container) return;

  setupAccordionPersistence();

  const cards = container.querySelectorAll('.template-card');
  const btnConvert = document.getElementById('btnQuickConvert');
  const multiInfo = document.getElementById('multiFilterInfo');
  const multiCount = document.getElementById('multiFilterCount');

  function updateMultiFilterUI() {
    const activeCombinable = container.querySelectorAll('.template-card[data-combinable="true"].active');
    const count = activeCombinable.length;

    if (multiInfo) {
      multiInfo.classList.toggle('visible', count > 0);
    }
    if (multiCount) {
      multiCount.textContent = count > 0 ? count : '';
    }

    const anyActive = container.querySelector('.template-card.active');
    if (btnConvert) {
      if (anyActive) btnConvert.removeAttribute('disabled');
      else btnConvert.setAttribute('disabled', 'true');
    }
  }

  cards.forEach(card => {
    card.addEventListener('click', () => {
      const isCombinable = card.dataset.combinable === 'true';

      if (isCombinable) {

        card.classList.toggle('active');

        const exclusionGroups = [
          ['timelapse', 'slowmo'],
          ['volume_boost', 'loudnorm'],
          ['minterpolate', 'reverse'],
          ['minterpolate', 'timelapse', 'slowmo'],
          ['loudnorm', 'audio_denoise'],
        ];

        if (card.classList.contains('active')) {
          const tid = card.dataset.template;
          exclusionGroups.forEach(group => {
            if (group.includes(tid)) {
              const conflicting = group.filter(g => g !== tid);
              conflicting.forEach(cId => {
                const conflictCard = container.querySelector(`.template-card[data-template="${cId}"]`);
                if (conflictCard && conflictCard.classList.contains('active')) {
                  conflictCard.classList.remove('active');
                }
              });
            }
          });
        }

        const activeSingle = container.querySelector('.template-card:not([data-combinable="true"]).active');
        if (activeSingle) {
          activeSingle.classList.remove('active');
          selectedTemplateId = null;
        }

        const activeCombinable = container.querySelectorAll('.template-card[data-combinable="true"].active');
        if (activeCombinable.length > 0) {
          selectedTemplateId = 'multi_filter';
        } else {
          selectedTemplateId = null;
        }
      } else {

        cards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedTemplateId = card.dataset.template;
      }

      updateMultiFilterUI();
    });
  });

  if (btnConvert) {
    btnConvert.addEventListener('click', async () => {
      if (!selectedTemplateId) return;

      let params = {};

      if (selectedTemplateId === 'multi_filter') {

        const activeCards = container.querySelectorAll('.template-card[data-combinable="true"].active');
        const filters = [];

        activeCards.forEach(ac => {
          const filterId = ac.dataset.template;
          const filterParams = {};

          if (ac.dataset.hasParams === 'true') {
            const inputs = ac.querySelectorAll('.template-params input, .template-params select');
            if (inputs.length === 1) {
              filterParams.value = inputs[0].value;
            } else {
              inputs.forEach(inp => {
                const key = inp.id.replace('param-', '');
                filterParams[key] = inp.value;
              });
            }
          }

          filters.push({ id: filterId, params: filterParams });
        });

        params = { filters: filters };
      } else {

        const activeCard = container.querySelector('.template-card.active');
        if (activeCard && activeCard.dataset.hasParams === 'true') {
          const inputs = activeCard.querySelectorAll('.template-params input, .template-params select');
          if (inputs.length === 1) {
            params.value = inputs[0].value;
          } else if (inputs.length > 1) {
            inputs.forEach(inp => {
              const key = inp.id.replace('param-', '');
              params[key] = inp.value;
            });
          }
        }
      }

      const validateTimeFormat = (val) => {
        if (!val) return true;
        return /^[0-9:\\.,]+$/.test(val);
      };

      let timeInvalid = false;
      
      if (params.filters) {
        const trimFilter = params.filters.find(f => f.id === 'trim');
        if (trimFilter && trimFilter.params) {
          if (!validateTimeFormat(trimFilter.params['trim-start']) || !validateTimeFormat(trimFilter.params['trim-end'])) {
            timeInvalid = true;
          }
        }
      } else if (selectedTemplateId === 'trim') {
        if (!validateTimeFormat(params['trim-start']) || !validateTimeFormat(params['trim-end'])) {
          timeInvalid = true;
        }
      }

      if (timeInvalid) {
        if (window.showToast) {
          const errMsg = typeof t === 'function' ? t('toast.invalidTimeFormat') : 'Invalid time format. Please use only numbers and punctuation (:,.)';
          window.showToast(errMsg, 'error', 5000);
        }
        return;
      }

      const event = new CustomEvent('bitkit:quickConvert', {
        detail: {
          templateId: selectedTemplateId,
          params: params
        }
      });
      document.dispatchEvent(event);
    });
  }

  setupSmartConverter();
  setupParamPills();
}

function setupSmartConverter() {
  const formatSelect = document.getElementById('param-sc-format');
  const vcodecSelect = document.getElementById('param-sc-vcodec');
  const acodecSelect = document.getElementById('param-sc-acodec');

  if (!formatSelect || !vcodecSelect || !acodecSelect) return;

  const updateDropdowns = () => {
    const format = formatSelect.value;
    const matrix = window.MEGA_MATRIX;
    if (!matrix || !matrix.containers[format]) return;

    const containerConfig = matrix.containers[format];

    vcodecSelect.innerHTML = '';
    containerConfig.videoCodecs.forEach(codec => {
      const option = document.createElement('option');
      option.value = codec;
      const key = `codec.${codec}`;
      option.dataset.i18n = key;
      option.textContent = typeof t === 'function' ? t(key) : codec;
      vcodecSelect.appendChild(option);
    });

    if (containerConfig.videoCodecs.length > 0) {
      vcodecSelect.value = containerConfig.videoCodecs[0];
    }

    acodecSelect.innerHTML = '';
    containerConfig.audioCodecs.forEach(codec => {
      const option = document.createElement('option');
      option.value = codec;
      const key = `codec.${codec}`;
      option.dataset.i18n = key;
      option.textContent = typeof t === 'function' ? t(key) : codec;
      acodecSelect.appendChild(option);
    });
    if (containerConfig.audioCodecs.length > 0) {
      acodecSelect.value = containerConfig.audioCodecs[0];
    }
  };

  formatSelect.addEventListener('change', updateDropdowns);

  setTimeout(updateDropdowns, 50);
}

function setupParamPills() {

  window.setParamVal = function(inputId, val, btn) {
    const inp = document.getElementById(inputId);
    if (inp) inp.value = val;
    const parent = btn.parentElement;
    parent.querySelectorAll('button').forEach(b => b.classList.remove('active-pill'));
    btn.classList.add('active-pill');
  };

  ['param-timelapse', 'param-slowmo', 'param-split'].forEach(id => {
    const inp = document.getElementById(id);
    if (inp) {
      inp.addEventListener('input', (e) => {
        const btnContainer = e.target.closest('.template-params');
        if (!btnContainer) return;
        const btns = btnContainer.querySelectorAll('.btn-outline');
        btns.forEach(b => {
          b.classList.remove('active-pill');
          if (b.innerText.replace('x', '') == e.target.value) {
            b.classList.add('active-pill');
          }
        });
      });
    }
  });
}

function setupAccordionPersistence() {
  const accordions = document.querySelectorAll('.template-accordion[data-accordion-id]');
  accordions.forEach(acc => {
    const id = acc.getAttribute('data-accordion-id');
    const isCollapsed = localStorage.getItem(`accordion_state_${id}`) === 'true';
    if (isCollapsed) {
      acc.classList.add('collapsed');
    } else {
      acc.classList.remove('collapsed');
    }

    const categoryHeader = acc.querySelector('.template-category');
    if (categoryHeader) {
      categoryHeader.addEventListener('click', () => {
        const isNowCollapsed = acc.classList.toggle('collapsed');
        localStorage.setItem(`accordion_state_${id}`, isNowCollapsed);
      });
    }
  });
}

window.initQuickTemplates = setupQuickTemplates;
