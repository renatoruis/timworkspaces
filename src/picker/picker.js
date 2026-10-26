// picker.js — sem dependências externas
(() => {
  const screensSection = document.getElementById('screens-list');
  const windowsSection = document.getElementById('windows-list');
  const shareBtn = document.getElementById('btn-share');
  const cancelBtn = document.getElementById('btn-cancel');
  const refreshBtn = document.getElementById('btn-refresh');
  const audioRow = document.getElementById('audio-row');
  const audioCheckbox = document.getElementById('audio-checkbox');
  const emptyState = document.getElementById('empty-state');

  let selectedId = null;

  function renderSkeleton() {
    [screensSection, windowsSection].forEach((section, i) => {
      section.innerHTML = '';
      for (let n = 0; n < (i === 0 ? 2 : 4); n++) {
        const sk = document.createElement('div');
        sk.className = 'card skeleton';
        sk.innerHTML = '<div class="thumb"></div><div class="card-footer"><span class="sk-line"></span></div>';
        section.appendChild(sk);
      }
    });
  }

  function select(card, id) {
    document.querySelectorAll('.card.selected').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedId = id;
    shareBtn.disabled = false;
  }

  function createCard(source) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = source.id;
    card.title = source.name;

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    if (source.thumbnail) thumb.src = source.thumbnail;
    thumb.alt = source.name;
    card.appendChild(thumb);

    const footer = document.createElement('div');
    footer.className = 'card-footer';
    if (source.type === 'window' && source.appIcon) {
      const icon = document.createElement('img');
      icon.src = source.appIcon;
      icon.className = 'app-icon';
      icon.alt = '';
      footer.appendChild(icon);
    }
    const label = document.createElement('span');
    label.className = 'card-label';
    label.textContent = source.name;
    footer.appendChild(label);
    card.appendChild(footer);

    card.addEventListener('click', () => select(card, source.id));
    card.addEventListener('dblclick', () => share());
    card.addEventListener('focus', () => select(card, source.id));
    return card;
  }

  function renderSources(sources) {
    const screens = sources.filter((s) => s.type === 'screen');
    const windows = sources.filter((s) => s.type === 'window');
    screensSection.innerHTML = '';
    windowsSection.innerHTML = '';
    screens.forEach((s) => screensSection.appendChild(createCard(s)));
    windows.forEach((s) => windowsSection.appendChild(createCard(s)));
    document.getElementById('screens-group').style.display = screens.length ? '' : 'none';
    document.getElementById('windows-group').style.display = windows.length ? '' : 'none';
    emptyState.style.display = sources.length ? 'none' : 'block';

    const previous = selectedId && document.querySelector(`.card[data-id="${CSS.escape(selectedId)}"]`);
    if (previous) select(previous, selectedId);
    else {
      selectedId = null;
      shareBtn.disabled = true;
      // Um único ecrã: pré-selecionar para partilhar com Enter
      if (screens.length === 1 && !windows.length) select(screensSection.firstChild, screens[0].id);
    }
    (document.querySelector('.card.selected') || document.querySelector('.card'))?.focus();
  }

  async function load(refresh) {
    renderSkeleton();
    refreshBtn.disabled = true;
    try {
      const data = await pickerAPI.getSources(refresh);
      if (!data) return pickerAPI.cancel();
      if (data.theme === 'light' || data.theme === 'dark') {
        document.documentElement.setAttribute('data-theme', data.theme);
      }
      if (data.audioSupported && data.audioRequested) audioRow.style.display = 'flex';
      renderSources(data.sources);
    } catch {
      renderSources([]);
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function share() {
    if (selectedId) pickerAPI.choose(selectedId, audioCheckbox.checked);
  }

  function moveFocus(delta) {
    const cards = [...document.querySelectorAll('.card:not(.skeleton)')];
    if (!cards.length) return;
    const idx = cards.indexOf(document.activeElement);
    const next = cards[Math.min(cards.length - 1, Math.max(0, idx + delta))];
    next.focus();
  }

  shareBtn.addEventListener('click', share);
  cancelBtn.addEventListener('click', () => pickerAPI.cancel());
  refreshBtn.addEventListener('click', () => load(true));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') pickerAPI.cancel();
    else if (e.key === 'Enter' && document.activeElement?.classList.contains('card')) { e.preventDefault(); share(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
  });

  load(false);
})();
