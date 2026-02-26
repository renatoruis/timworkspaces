'use strict';

const STORAGE_KEY = 'timworkspaces-services';
const SIDEBAR_COLLAPSED_KEY = 'timworkspaces-sidebar-collapsed';
const MUTED_SERVICES_KEY = 'timworkspaces-muted-services';
const MUTE_ALL_KEY = 'timworkspaces-mute-all';
const THEME_KEY = 'timworkspaces-theme';
const DEFAULT_URL_KEY = 'timworkspaces-default-url';
const DEFAULT_URL_FALLBACK = 'https://timdevops.com.br';

const GITHUB_REPO_URL = 'https://github.com/renatoruis/timworkspaces';
let services = [];
let activeServiceId = null;
let activeWebview = null;
let sidebarCollapsed = false;
let mutedServices = new Set();
let muteAll = false;
let searchFilter = '';
let pendingImportData = null;

const MUTE_SCRIPT = `
(function(){
  try {
    var O = window.Notification;
    if (O) {
      window.Notification = function(){};
      window.Notification.permission = 'denied';
      window.Notification.requestPermission = function(){ return Promise.resolve('denied'); };
    }
  } catch(e){}
})();
`;

const PRESET_SERVICES = [
  { name: 'Gmail', url: 'https://mail.google.com', icon: 'https://cdn.simpleicons.org/gmail' },
  { name: 'WhatsApp', url: 'https://web.whatsapp.com', icon: 'https://web.whatsapp.com/favicon.ico' },
  { name: 'Microsoft Teams', url: 'https://teams.microsoft.com' },
  { name: 'Google Chat', url: 'https://chat.google.com', icon: 'https://cdn.simpleicons.org/googlechat' },
  { name: 'Slack', url: 'https://app.slack.com' },
  { name: 'Telegram', url: 'https://web.telegram.org' },
  { name: 'Discord', url: 'https://discord.com/app' },
  { name: 'Outlook', url: 'https://outlook.live.com' },
];

let serviceListEl;
let contentAreaEl;
let modalEl;
let sidebarEl;
let inputNameEl;
let inputUrlEl;

const FAVICON_FALLBACKS = {
  'web.whatsapp.com': 'https://web.whatsapp.com/favicon.ico',
  'mail.google.com': 'https://cdn.simpleicons.org/gmail',
  'chat.google.com': 'https://cdn.simpleicons.org/googlechat',
};

function getDefaultUrl() {
  try {
    const url = localStorage.getItem(DEFAULT_URL_KEY);
    return (url && url.startsWith('http')) ? url : DEFAULT_URL_FALLBACK;
  } catch {
    return DEFAULT_URL_FALLBACK;
  }
}

function setDefaultUrl(url) {
  try {
    if (url && url.startsWith('http')) {
      localStorage.setItem(DEFAULT_URL_KEY, url);
    }
  } catch {}
}

function loadTheme() {
  const theme = localStorage.getItem(THEME_KEY) || 'dark';
  document.body.dataset.theme = theme;
  updateThemeIcon(theme);
  updateSidebarLogo(theme);
}

function updateSidebarLogo(theme) {
  const logo = document.getElementById('sidebar-logo');
  const icon = document.getElementById('sidebar-icon');
  const iconPath = theme === 'light' ? 'assets/icone-fundo-claro.png' : 'assets/icone-fundo-escuro.png';
  if (logo) {
    logo.src = theme === 'light' ? 'assets/logo-fundo-claro.png' : 'assets/logo-fundo-escuro.png';
    logo.style.display = '';
  }
  if (icon) {
    icon.src = iconPath;
    icon.style.display = '';
  }
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  const btn = document.getElementById('btn-theme');
  if (!icon || !btn) return;
  if (theme === 'light') {
    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>';
    btn.title = 'Alternar para tema escuro';
  } else {
    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>';
    btn.title = 'Alternar para tema claro';
  }
}

function toggleTheme() {
  const current = document.body.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  updateThemeIcon(next);
  updateSidebarLogo(next);
}

function getFaviconUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (FAVICON_FALLBACKS[host]) return FAVICON_FALLBACKS[host];
    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch {
    return '';
  }
}

function loadServices() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    services = stored ? JSON.parse(stored) : [];
    services.forEach(s => {
      if (s.url) s.iconUrl = getFaviconUrl(s.url);
    });
    saveServices();
  } catch {
    services = [];
  }
}

function loadMuteState() {
  try {
    const stored = localStorage.getItem(MUTED_SERVICES_KEY);
    mutedServices = new Set(stored ? JSON.parse(stored) : []);
    muteAll = localStorage.getItem(MUTE_ALL_KEY) === 'true';
  } catch {
    mutedServices = new Set();
    muteAll = false;
  }
}

function saveMuteState() {
  localStorage.setItem(MUTED_SERVICES_KEY, JSON.stringify([...mutedServices]));
  localStorage.setItem(MUTE_ALL_KEY, String(muteAll));
}

function isServiceMuted(id) {
  return muteAll || mutedServices.has(id);
}

function toggleMuteService(id) {
  if (mutedServices.has(id)) mutedServices.delete(id);
  else mutedServices.add(id);
  saveMuteState();
  render();
}

function toggleMuteAll() {
  muteAll = !muteAll;
  localStorage.setItem(MUTE_ALL_KEY, String(muteAll));
  updateMuteAllButton();
}

function updateMuteAllButton() {
  const btn = document.getElementById('btn-mute-all');
  const icon = document.getElementById('mute-all-icon');
  if (!btn || !icon) return;
  btn.title = muteAll ? 'Ativar notificações' : 'Silenciar todas as notificações';
  if (muteAll) {
    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>';
    btn.classList.add('text-sky-400');
  } else {
    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>';
    btn.classList.remove('text-sky-400');
  }
}

function moveService(fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= services.length || toIdx >= services.length) return;
  const [item] = services.splice(fromIdx, 1);
  services.splice(toIdx, 0, item);
  saveServices();
  render();
}

function loadSidebarState() {
  sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  applySidebarCollapsed();
}

function applySidebarCollapsed() {
  if (!sidebarEl) return;
  sidebarEl.dataset.collapsed = String(sidebarCollapsed);
  sidebarEl.classList.toggle('w-14', sidebarCollapsed);
  sidebarEl.classList.toggle('w-56', !sidebarCollapsed);
  const icon = sidebarEl.querySelector('.collapse-icon');
  if (icon) icon.style.transform = sidebarCollapsed ? 'rotate(180deg)' : 'none';
  const btnCollapse = document.getElementById('btn-collapse');
  if (btnCollapse) btnCollapse.title = sidebarCollapsed ? 'Expandir barra' : 'Recolher barra';
  document.querySelectorAll('.add-btn-label, .sidebar-label').forEach(el => el.classList.toggle('hidden', sidebarCollapsed));
  document.querySelectorAll('.service-more-btn').forEach(el => el.classList.toggle('hidden', sidebarCollapsed));
}

function saveServices() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(services));
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  if (typeof msg === 'string') toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._tid);
  showToast._tid = setTimeout(() => {
    toast.classList.remove('show');
    toast.textContent = 'Serviço adicionado';
  }, 2000);
}

function addService(name, url) {
  const service = {
    id: crypto.randomUUID(),
    name: String(name).trim() || new URL(url).hostname,
    url: String(url).trim(),
    iconUrl: getFaviconUrl(url)
  };
  services.push(service);
  saveServices();
  activeServiceId = service.id;
  render();
  closeModal();
  showToast();
}

function updateService(id, name, url) {
  const idx = services.findIndex(s => s.id === id);
  if (idx === -1) return;
  services[idx] = {
    ...services[idx],
    name: String(name).trim() || new URL(url).hostname,
    url: String(url).trim(),
    iconUrl: getFaviconUrl(url)
  };
  saveServices();
  render();
  closeModal();
}

function duplicateService(service) {
  addService(service.name + ' (cópia)', service.url);
}

let pendingDeleteId = null;
let editingServiceId = null;

function openDeleteModal(service) {
  pendingDeleteId = service.id;
  const nameEl = document.getElementById('delete-service-name');
  if (nameEl) nameEl.textContent = service.name;
  const modal = document.getElementById('modal-delete');
  if (modal) modal.classList.add('modal-open');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  const modal = document.getElementById('modal-delete');
  if (modal) modal.classList.remove('modal-open');
}

function confirmRemoveService() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  const idx = services.findIndex(s => s.id === id);
  if (idx === -1) { closeDeleteModal(); return; }
  services.splice(idx, 1);
  saveServices();
  if (activeServiceId === id) {
    activeServiceId = services[0]?.id ?? null;
  }
  closeDeleteModal();
  render();
}

function removeService(id, e) {
  e?.stopPropagation();
  const service = services.find(s => s.id === id);
  if (!service) return;
  openDeleteModal(service);
}

function closeModal() {
  editingServiceId = null;
  if (modalEl) modalEl.classList.remove('modal-open');
  updateModalForMode();
}

const FOCUSABLE_SELECTOR = 'input:not([disabled]):not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

function getModalFocusables() {
  if (!modalEl) return [];
  return Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR));
}

function handleModalKeydown(e) {
  if (e.key !== 'Tab' || !modalEl?.classList.contains('modal-open')) return;
  const focusables = getModalFocusables();
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function updateModalForMode() {
  const titleEl = document.getElementById('modal-title');
  const descEl = document.getElementById('modal-desc');
  const presetSection = document.getElementById('preset-section');
  const addBtn = document.getElementById('modal-add-btn');
  if (!titleEl || !addBtn) return;
  if (editingServiceId) {
    titleEl.textContent = 'Editar serviço';
    if (descEl) descEl.textContent = 'Altere o nome ou a URL do serviço.';
    if (presetSection) presetSection.classList.add('hidden');
    addBtn.textContent = 'Salvar';
  } else {
    titleEl.textContent = 'Adicionar serviço';
    if (descEl) descEl.textContent = 'Escolha um serviço pronto ou adicione uma URL personalizada.';
    if (presetSection) presetSection.classList.remove('hidden');
    addBtn.textContent = 'Adicionar';
  }
}

function openModal(options = {}) {
  const { clear = true, editService = null } = options;
  editingServiceId = editService?.id ?? null;
  if (editService) {
    if (inputNameEl) inputNameEl.value = editService.name;
    if (inputUrlEl) inputUrlEl.value = editService.url;
  } else if (clear) {
    if (inputNameEl) inputNameEl.value = '';
    if (inputUrlEl) inputUrlEl.value = '';
  }
  const homeCheck = document.getElementById('input-use-as-home');
  if (homeCheck) homeCheck.checked = false;
  showUrlError('');
  updateModalForMode();
  if (modalEl) modalEl.classList.add('modal-open');
  setTimeout(() => (inputNameEl || inputUrlEl)?.focus(), 50);
}

function showUrlError(msg) {
  const el = document.getElementById('url-error');
  if (el) {
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }
}

function handleAddSubmit(e) {
  e.preventDefault();
  const name = inputNameEl?.value?.trim();
  const url = inputUrlEl?.value?.trim();
  showUrlError('');

  if (!name || !url) {
    showUrlError('Preencha nome e URL.');
    inputNameEl?.focus();
    return;
  }

  try {
    new URL(url);
  } catch {
    showUrlError('URL inválida. Use https://...');
    inputUrlEl?.focus();
    return;
  }

  if (editingServiceId) {
    updateService(editingServiceId, name, url);
    const useAsHome = document.getElementById('input-use-as-home')?.checked;
    if (useAsHome) setDefaultUrl(url);
  } else {
    addService(name, url);
    const useAsHome = document.getElementById('input-use-as-home')?.checked;
    if (useAsHome) setDefaultUrl(url);
  }
}

function renderSidebar() {
  if (!serviceListEl) return;

  const term = searchFilter.trim().toLowerCase();
  const filtered = term
    ? services.filter(s => (s.name || '').toLowerCase().includes(term))
    : services;

  serviceListEl.innerHTML = '';
  for (const service of filtered) {
    const iconUrl = service.iconUrl || getFaviconUrl(service.url);
    const isActive = service.id === activeServiceId;

    const row = document.createElement('div');
    row.className = 'service-row group flex items-center gap-2 rounded-lg ' +
      (isActive ? 'bg-zinc-700/50 border-l-2 border-l-sky-500' : 'hover:bg-zinc-700/30');
    row.dataset.id = service.id;
    row.dataset.index = String(services.indexOf(service));
    row.title = service.name;

    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle flex-shrink-0 p-1 cursor-grab active:cursor-grabbing rounded opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-zinc-300';
    dragHandle.draggable = true;
    dragHandle.title = 'Arrastar para reordenar';
    dragHandle.innerHTML = '<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
    dragHandle.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/plain', service.id);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    dragHandle.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!row.classList.contains('dragging')) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      const fromIdx = services.findIndex(s => s.id === id);
      const toIdx = services.indexOf(service);
      if (fromIdx !== -1 && fromIdx !== toIdx) moveService(fromIdx, toIdx);
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'service-btn flex-1 flex items-center gap-2 min-w-0 py-2 px-2 rounded-lg text-left transition-colors ' +
      (isActive ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200');
    btn.addEventListener('click', () => {
      activeServiceId = service.id;
      render();
    });

    const img = document.createElement('img');
    const fallbackIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='10' fill='%2374757e'/%3E%3C/svg%3E";
    img.src = iconUrl || fallbackIcon;
    img.alt = '';
    img.className = 'w-6 h-6 rounded flex-shrink-0 bg-zinc-600/50 service-icon-img';
    img.onerror = () => { img.src = fallbackIcon; };

    const label = document.createElement('span');
    label.className = 'truncate text-sm font-medium sidebar-label';
    label.textContent = service.name;

    btn.appendChild(img);
    btn.appendChild(label);
    row.appendChild(dragHandle);
    row.appendChild(btn);

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'service-more-btn flex-shrink-0 p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-600/50 transition-colors';
    moreBtn.title = 'Opções';
    moreBtn.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg>';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = row.querySelector('.service-dropdown');
      const isOpen = menu && !menu.classList.contains('hidden');
      closeAllDropdowns();
      if (menu && !isOpen) {
        const rect = moreBtn.getBoundingClientRect();
        menu.style.top = rect.bottom + 4 + 'px';
        menu.style.left = rect.right - 140 + 'px';
        menu.style.minWidth = '140px';
        menu.classList.remove('hidden');
      }
    });

    const dropdown = document.createElement('div');
    dropdown.className = 'service-dropdown hidden fixed py-1 bg-zinc-700 border border-zinc-600 rounded-lg shadow-xl z-50';
    const muted = isServiceMuted(service.id);
    if (isActive) {
      const refreshItem = document.createElement('button');
      refreshItem.type = 'button';
      refreshItem.className = 'w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-600 hover:text-zinc-100 flex items-center gap-2';
      refreshItem.innerHTML = '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Atualizar';
      refreshItem.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); if (activeWebview) activeWebview.reload(); });
      dropdown.appendChild(refreshItem);
    }
    const muteItem = document.createElement('button');
    muteItem.type = 'button';
    muteItem.className = 'w-full px-3 py-2 text-left text-sm flex items-center gap-2 ' + (muted ? 'text-sky-400' : 'text-zinc-300 hover:bg-zinc-600 hover:text-zinc-100');
    muteItem.innerHTML = (muted ? '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg> Ativar notificações' : '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg> Silenciar notificações');
    muteItem.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); toggleMuteService(service.id); });
    dropdown.appendChild(muteItem);
    const editItem = document.createElement('button');
    editItem.type = 'button';
    editItem.className = 'w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-600 hover:text-zinc-100 flex items-center gap-2';
    editItem.innerHTML = '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg> Editar';
    editItem.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); openModal({ clear: false, editService: service }); });
    dropdown.appendChild(editItem);
    const duplicateItem = document.createElement('button');
    duplicateItem.type = 'button';
    duplicateItem.className = 'w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-600 hover:text-zinc-100 flex items-center gap-2';
    duplicateItem.innerHTML = '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> Duplicar';
    duplicateItem.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); duplicateService(service); });
    dropdown.appendChild(duplicateItem);
    const setHomeItem = document.createElement('button');
    setHomeItem.type = 'button';
    setHomeItem.className = 'w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-600 hover:text-zinc-100 flex items-center gap-2';
    setHomeItem.innerHTML = '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg> Definir como página inicial';
    setHomeItem.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); setDefaultUrl(service.url); showToast('Página inicial definida'); });
    dropdown.appendChild(setHomeItem);
    const removeItem = document.createElement('button');
    removeItem.type = 'button';
    removeItem.className = 'w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-600 hover:text-red-300 flex items-center gap-2';
    removeItem.innerHTML = '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg> Remover';
    removeItem.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); removeService(service.id, e); });
    dropdown.appendChild(removeItem);

    const wrapper = document.createElement('div');
    wrapper.className = 'relative flex-shrink-0';
    wrapper.appendChild(moreBtn);
    wrapper.appendChild(dropdown);
    row.appendChild(wrapper);
    serviceListEl.appendChild(row);
  }
  applySidebarCollapsed();
}

// 5 & 6. Renderizar content-area (webview ou mensagem)
function renderContentArea() {
  if (!contentAreaEl) return;

  contentAreaEl.innerHTML = '';
  activeWebview = null;

  function injectMuteIfNeeded(wv, serviceId) {
    if (!isServiceMuted(serviceId)) return;
    wv.addEventListener('did-finish-load', function onLoad() {
      wv.removeEventListener('did-finish-load', onLoad);
      wv.executeJavaScript(MUTE_SCRIPT).catch(() => {});
    }, { once: true });
  }

  function createLoadingBar() {
    const wrap = document.createElement('div');
    wrap.id = 'loading-bar-wrap';
    wrap.className = 'absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-20 pointer-events-none hidden';
    wrap.innerHTML = '<div class="h-full w-1/3 bg-sky-500 loading-bar-progress rounded-r"></div>';
    return wrap;
  }

  const hasActiveService = services.length > 0;
  const active = hasActiveService
    ? (services.find(s => s.id === activeServiceId) || services[0])
    : null;
  if (active) activeServiceId = active.id;

  const loadingBar = createLoadingBar();
  contentAreaEl.appendChild(loadingBar);

  if (hasActiveService) {
    const toolbar = document.createElement('div');
    toolbar.className = 'flex items-center justify-end gap-0.5 px-2 py-1 bg-zinc-800/50 border-b border-zinc-600/30 flex-shrink-0';
    toolbar.innerHTML = `
      <button type="button" id="toolbar-refresh" class="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600/50 transition-colors" title="Recarregar">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
      </button>
      <button type="button" id="toolbar-open-external" class="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600/50 transition-colors" title="Abrir em navegador externo">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
      </button>
      <button type="button" id="toolbar-fullscreen" class="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600/50 transition-colors" title="Tela cheia">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
      </button>
    `;
    contentAreaEl.appendChild(toolbar);
  }

  const webviewContainer = document.createElement('div');
  webviewContainer.className = 'flex-1 min-h-0 relative';
  const serviceId = active?.id ?? 'default';
  const currentUrl = active?.url ?? getDefaultUrl();
  const webview = document.createElement('webview');
  const partitionId = (serviceId && serviceId !== 'default') ? serviceId.replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
  webview.partition = 'persist:timworkspaces-' + partitionId;
  webview.useragent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
  webview.className = 'w-full h-full border-0';
  injectMuteIfNeeded(webview, serviceId);
  webview.src = currentUrl;

  function isGoogleAuthUrl(u) {
    if (!u || typeof u !== 'string') return false;
    try {
      const url = new URL(u);
      return url.hostname === 'accounts.google.com' || url.hostname.endsWith('.accounts.google.com');
    } catch {
      return false;
    }
  }

  webview.addEventListener('will-navigate', async (e) => {
    const targetUrl = e?.url;
    if (!isGoogleAuthUrl(targetUrl) || typeof window.electronAPI?.openGoogleAuth !== 'function') return;
    try {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    } catch (_) {}
    loadingBar.classList.remove('hidden');
    try {
      const finalUrl = await window.electronAPI.openGoogleAuth(targetUrl, webview.partition);
      if (finalUrl && activeWebview === webview) {
        webview.src = finalUrl;
      } else if (!finalUrl && activeWebview === webview) {
        webview.src = currentUrl;
      }
    } catch {
      if (activeWebview === webview) webview.src = currentUrl;
    } finally {
      loadingBar.classList.add('hidden');
    }
  });
  webviewContainer.appendChild(webview);
  contentAreaEl.appendChild(webviewContainer);
  activeWebview = webview;

  let loadingTimeout = null;
  function showLoadingBar() {
    loadingBar.classList.remove('hidden');
    if (!loadingTimeout) {
      loadingTimeout = setTimeout(() => {
        loadingBar.classList.add('hidden');
        loadingTimeout = null;
      }, 8000);
    }
  }
  function hideLoadingBar() {
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
      loadingTimeout = null;
    }
    loadingBar.classList.add('hidden');
  }
  webview.addEventListener('did-start-loading', showLoadingBar);
  webview.addEventListener('did-finish-load', hideLoadingBar);
  webview.addEventListener('did-stop-loading', hideLoadingBar);
  webview.addEventListener('did-fail-load', hideLoadingBar);

  if (hasActiveService) {
    document.getElementById('toolbar-refresh')?.addEventListener('click', () => activeWebview?.reload());
    document.getElementById('toolbar-open-external')?.addEventListener('click', () => {
      const u = activeWebview?.getURL?.();
      if (u && typeof window.electronAPI?.openExternal === 'function') window.electronAPI.openExternal(u);
    });
    document.getElementById('toolbar-fullscreen')?.addEventListener('click', () => {
      if (typeof window.electronAPI?.toggleFullscreen === 'function') window.electronAPI.toggleFullscreen();
    });
  }
}

function render() {
  renderSidebar();
  renderContentArea();
  updateMuteAllButton();
}

function renderPresetServices() {
  const container = document.getElementById('preset-services');
  if (!container) return;
  container.innerHTML = '';
  for (const preset of PRESET_SERVICES) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card flex flex-col items-center gap-2 p-3 bg-zinc-700/30 hover:bg-zinc-600/40 border border-zinc-600/30 rounded-xl text-zinc-300 hover:text-zinc-100 transition-all';
    const iconUrl = preset.icon || getFaviconUrl(preset.url);
    const img = document.createElement('img');
    img.src = iconUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Ccircle cx="12" cy="12" r="10" fill="%2374757e"/%3E%3C/svg%3E';
    img.alt = '';
    img.className = 'w-8 h-8 rounded-lg flex-shrink-0';
    img.onerror = () => { img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Ccircle cx="12" cy="12" r="10" fill="%2374757e"/%3E%3C/svg%3E'; };
    const label = document.createElement('span');
    label.className = 'text-xs font-medium text-center leading-tight truncate w-full';
    label.textContent = preset.name;
    card.appendChild(img);
    card.appendChild(label);
    card.addEventListener('click', () => {
      if (inputNameEl) inputNameEl.value = preset.name;
      if (inputUrlEl) inputUrlEl.value = preset.url;
      showUrlError('');
      inputNameEl?.focus();
    });
    container.appendChild(card);
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.service-dropdown').forEach(el => el.classList.add('hidden'));
}

function closeSidebarMenu() {
  const menu = document.getElementById('sidebar-menu-dropdown');
  if (menu) menu.classList.add('hidden');
}

function exportServices() {
  const blob = new Blob([JSON.stringify(services, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tim-workspaces-servicos-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  closeSidebarMenu();
}

function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data) ? data : (data.services || []);
        if (!Array.isArray(list)) return reject(new Error('Formato inválido'));
        const valid = list.filter(s => s && typeof s === 'object' && s.url);
        resolve(valid);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsText(file, 'UTF-8');
  });
}

function openImportModal(imported) {
  pendingImportData = imported;
  const countEl = document.getElementById('import-count');
  if (countEl) countEl.textContent = String(imported.length);
  const modal = document.getElementById('modal-import');
  if (modal) modal.style.display = 'flex';
}

function closeImportModal() {
  pendingImportData = null;
  const modal = document.getElementById('modal-import');
  if (modal) modal.style.display = 'none';
}

function applyImport(mode) {
  if (!pendingImportData || pendingImportData.length === 0) {
    closeImportModal();
    return;
  }
  const imported = pendingImportData.map(s => ({
    id: crypto.randomUUID(),
    name: String(s.name || '').trim() || (() => { try { return new URL(s.url).hostname; } catch { return 'Serviço'; } })(),
    url: String(s.url).trim(),
    iconUrl: getFaviconUrl(s.url)
  }));

  if (mode === 'replace') {
    services = imported;
  } else {
    const existUrls = new Set(services.map(s => s.url));
    imported.filter(s => !existUrls.has(s.url)).forEach(s => services.push(s));
  }
  saveServices();
  activeServiceId = services[0]?.id ?? null;
  closeImportModal();
  render();
  closeSidebarMenu();
}

function toggleSidebarCollapsed() {
  sidebarCollapsed = !sidebarCollapsed;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  applySidebarCollapsed();
}

function init() {
  serviceListEl = document.getElementById('service-list');
  contentAreaEl = document.getElementById('content-area');
  modalEl = document.getElementById('modal');
  sidebarEl = document.getElementById('sidebar');
  const btnAddService = document.getElementById('btn-add-service');
  inputNameEl = document.getElementById('input-name');
  inputUrlEl = document.getElementById('input-url');

  loadServices();
  loadMuteState();
  loadSidebarState();
  loadTheme();
  render();
  renderPresetServices();

  const btnCollapse = document.getElementById('btn-collapse');
  if (btnCollapse) btnCollapse.addEventListener('click', toggleSidebarCollapsed);

  const btnMuteAll = document.getElementById('btn-mute-all');
  if (btnMuteAll) btnMuteAll.addEventListener('click', toggleMuteAll);

  const btnTheme = document.getElementById('btn-theme');
  if (btnTheme) btnTheme.addEventListener('click', toggleTheme);

  if (btnAddService) btnAddService.addEventListener('click', () => openModal());

  const modalForm = document.getElementById('modal-form');
  if (modalForm) {
    modalForm.addEventListener('submit', handleAddSubmit);
  }

  const modalOverlay = document.getElementById('modal-overlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', closeModal);
  }

  const modalClose = document.getElementById('modal-close');
  if (modalClose) modalClose.addEventListener('click', closeModal);

  const modalCancel = document.getElementById('modal-cancel');
  if (modalCancel) modalCancel.addEventListener('click', closeModal);

  const modalCoffee = document.getElementById('modal-coffee');
  const modalCoffeeOverlay = document.getElementById('modal-coffee-overlay');
  const modalCoffeeClose = document.getElementById('modal-coffee-close');
  const menuCoffee = document.getElementById('menu-coffee');
  const coffeeCopyPix = document.getElementById('coffee-copy-pix');
  const PIX_KEY = 'a7f1a823-d3b5-4ab3-b63f-03ffed9459f7';
  if (menuCoffee && modalCoffee) {
    menuCoffee.addEventListener('click', () => {
      document.getElementById('sidebar-menu-dropdown')?.classList.add('hidden');
      modalCoffee.classList.add('modal-open');
    });
  }
  if (modalCoffeeOverlay) modalCoffeeOverlay.addEventListener('click', () => modalCoffee?.classList.remove('modal-open'));
  if (modalCoffeeClose) modalCoffeeClose.addEventListener('click', () => modalCoffee?.classList.remove('modal-open'));
  if (coffeeCopyPix) {
    coffeeCopyPix.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(PIX_KEY);
        showToast('Chave PIX copiada');
      } catch {
        showToast('Erro ao copiar');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalEl?.classList.contains('modal-open')) closeModal();
      else if (document.getElementById('modal-delete')?.classList.contains('modal-open')) closeDeleteModal();
      else if (document.getElementById('modal-import')?.style.display === 'flex') closeImportModal();
      else if (modalCoffee?.classList.contains('modal-open')) modalCoffee.classList.remove('modal-open');
      return;
    }
    handleModalKeydown(e);
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key, 10) - 1;
      if (services[idx] && !modalEl?.classList.contains('modal-open')) {
        e.preventDefault();
        activeServiceId = services[idx].id;
        render();
      }
    } else if (e.key === 'r' || e.key === 'R') {
      if (activeWebview && !modalEl?.classList.contains('modal-open')) {
        e.preventDefault();
        activeWebview.reload();
      }
    }
  });

  const modalDeleteOverlay = document.getElementById('modal-delete-overlay');
  if (modalDeleteOverlay) modalDeleteOverlay.addEventListener('click', closeDeleteModal);

  const modalDeleteCancel = document.getElementById('modal-delete-cancel');
  if (modalDeleteCancel) modalDeleteCancel.addEventListener('click', closeDeleteModal);

  const modalDeleteConfirm = document.getElementById('modal-delete-confirm');
  if (modalDeleteConfirm) modalDeleteConfirm.addEventListener('click', confirmRemoveService);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.service-more-btn') && !e.target.closest('.service-dropdown')) {
      closeAllDropdowns();
    }
    if (!e.target.closest('#btn-sidebar-menu') && !e.target.closest('#sidebar-menu-dropdown')) {
      closeSidebarMenu();
    }
  });

  const sidebarSearch = document.getElementById('sidebar-search');
  if (sidebarSearch) {
    sidebarSearch.addEventListener('input', () => {
      searchFilter = sidebarSearch.value;
      renderSidebar();
    });
  }

  const btnSidebarMenu = document.getElementById('btn-sidebar-menu');
  const sidebarMenuDropdown = document.getElementById('sidebar-menu-dropdown');
  if (btnSidebarMenu && sidebarMenuDropdown) {
    btnSidebarMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !sidebarMenuDropdown.classList.contains('hidden');
      closeAllDropdowns();
      sidebarMenuDropdown.classList.toggle('hidden', isOpen);
    });
  }

  const menuExport = document.getElementById('menu-export');
  if (menuExport) menuExport.addEventListener('click', exportServices);

  const menuStar = document.getElementById('menu-star');
  const modalStar = document.getElementById('modal-star');
  const modalStarBtn = document.getElementById('modal-star-btn');
  const modalStarLater = document.getElementById('modal-star-later');
  const modalStarOverlay = document.getElementById('modal-star-overlay');
  if (menuStar && modalStar) {
    menuStar.addEventListener('click', () => {
      document.getElementById('sidebar-menu-dropdown')?.classList.add('hidden');
      modalStar.classList.add('modal-open');
    });
  }
  if (modalStarBtn) {
    modalStarBtn.addEventListener('click', () => {
      if (GITHUB_REPO_URL && GITHUB_REPO_URL.startsWith('http') && typeof window.electronAPI?.openExternal === 'function') {
        window.electronAPI.openExternal(GITHUB_REPO_URL);
      }
      modalStar?.classList.remove('modal-open');
    });
  }
  if (modalStarLater) modalStarLater.addEventListener('click', () => modalStar?.classList.remove('modal-open'));
  if (modalStarOverlay) modalStarOverlay.addEventListener('click', () => modalStar?.classList.remove('modal-open'));

  const menuImport = document.getElementById('menu-import');
  const inputImportFile = document.getElementById('input-import-file');
  if (menuImport && inputImportFile) {
    menuImport.addEventListener('click', () => {
      inputImportFile.value = '';
      inputImportFile.click();
    });
    inputImportFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const imported = await parseImportFile(file);
        if (imported.length === 0) {
          alert('Nenhum serviço válido encontrado no arquivo.');
          return;
        }
        openImportModal(imported);
      } catch (err) {
        alert('Erro ao importar: ' + (err.message || 'Formato inválido'));
      }
      e.target.value = '';
    });
  }

  const modalImportOverlay = document.getElementById('modal-import-overlay');
  if (modalImportOverlay) modalImportOverlay.addEventListener('click', closeImportModal);

  const modalImportCancel = document.getElementById('modal-import-cancel');
  if (modalImportCancel) modalImportCancel.addEventListener('click', closeImportModal);

  const modalImportMerge = document.getElementById('modal-import-merge');
  if (modalImportMerge) modalImportMerge.addEventListener('click', () => applyImport('merge'));

  const modalImportReplace = document.getElementById('modal-import-replace');
  if (modalImportReplace) modalImportReplace.addEventListener('click', () => applyImport('replace'));
}

document.addEventListener('DOMContentLoaded', init);
