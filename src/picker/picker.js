// picker.js — sem dependências externas
(async () => {
  const data = await pickerAPI.getSources();
  const { sources, audioRequested, platform, theme } = data;
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }

  let selectedId = null;

  const screensSection = document.getElementById('screens-list');
  const windowsSection = document.getElementById('windows-list');
  const shareBtn = document.getElementById('btn-share');
  const cancelBtn = document.getElementById('btn-cancel');
  const audioRow = document.getElementById('audio-row');
  const audioCheckbox = document.getElementById('audio-checkbox');

  // Mostrar checkbox de áudio apenas no Windows quando pedido
  if (platform === 'win32' && audioRequested) {
    audioRow.style.display = 'flex';
  }

  function createCard(source) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = source.id;

    const thumb = document.createElement('img');
    thumb.src = source.thumbnail;
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
    label.title = source.name;
    footer.appendChild(label);

    card.appendChild(footer);

    card.addEventListener('click', () => {
      document.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedId = source.id;
      shareBtn.disabled = false;
    });

    return card;
  }

  const screens = sources.filter((s) => s.type === 'screen');
  const windows = sources.filter((s) => s.type === 'window');

  screens.forEach((s) => screensSection.appendChild(createCard(s)));
  windows.forEach((s) => windowsSection.appendChild(createCard(s)));

  // Ocultar secções vazias
  if (!screens.length) document.getElementById('screens-group').style.display = 'none';
  if (!windows.length) document.getElementById('windows-group').style.display = 'none';

  shareBtn.addEventListener('click', () => {
    if (!selectedId) return;
    pickerAPI.choose(selectedId, audioCheckbox.checked);
  });

  cancelBtn.addEventListener('click', () => {
    pickerAPI.cancel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') pickerAPI.cancel();
  });
})();
