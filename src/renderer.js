'use strict';

const STORAGE_KEY = 'timworkspaces-services';
const SIDEBAR_COLLAPSED_KEY = 'timworkspaces-sidebar-collapsed';
const MUTED_SERVICES_KEY = 'timworkspaces-muted-services';
const MUTE_ALL_KEY = 'timworkspaces-mute-all';
const THEME_KEY = 'timworkspaces-theme';
const DEFAULT_URL_KEY = 'timworkspaces-default-url';
const DEFAULT_URL_FALLBACK = 'https://timdevops.com.br';

const GITHUB_REPO_URL = 'https://github.com/renatoruis/timworkspaces';
const LAST_CHECK_KEY = 'timworkspaces-last-update-check';
const LAST_SEEN_UPDATE_KEY = 'timworkspaces-last-seen-update';
const CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000;
const FIRST_VISIT_KEY = 'timworkspaces-first-visit-done';

const THEME_TOASTS_LIGHT = [
  'Acendeu a luz, meus olhos vão queimar agora!',
  'Quem acendeu o sol?',
];
const THEME_TOASTS_DARK = [
  'Gosta do escurinho né? É um dev raiz',
  'Mode hacker ativado',
  'Agora sim, menos cansaço na vista'
];
const MUTE_TOASTS_SILENCE = ['Shh... ninguém te perturba mais', 'Silêncio total, modo foco ligado'];
const MUTE_TOASTS_ACTIVE = ['As notificações voltaram, cuidado!', 'Voltou a bagunça'];
const ADD_SERVICE_TOASTS = ['Boa! Mais um na coleção', 'Adicionado com sucesso, chefia', 'Pronto, tá na lista'];
const SIDEBAR_COLLAPSE_TOASTS = ['Minimalista mode on', 'Mais espaço pra trabalhar'];
const SIDEBAR_EXPAND_TOASTS = ['Voltou tudo'];
const UPDATE_OK_TOASTS = ['Tá tudo em dia!', 'Nada de novo por aqui', 'Continua na última'];
function formatUpdateAvailableToast(version) {
  const msgs = ['Nova versão %s disponível! Atualiza aí', 'Tem a %s pronta! Vai lá pegar', 'Saiu a %s, corre lá'];
  return pick(msgs).replace('%s', version);
}
const UPDATE_ERROR_TOASTS = ['Deu ruim ao verificar', 'Internet esqueceu de funcionar'];
const WELCOME_TOASTS = [
  'E aí! Bem-vindo ao Tim Workspaces. Espero que ajude nas suas multitarefas caóticas',
  'Fala! Bem-vindo. Aqui tu junta tudo num lugar só'
];
const TAB_SWITCH_TOASTS = ['Quantas abas tu tem abertas no Chrome?', 'Trabalhando em várias frentes, hein'];
const TAB_SWITCH_INTERVAL = 5;

let services = [];
let tabSwitchCount = 0;
let activeServiceId = null;
let activeWebview = null;
let sidebarCollapsed = false;
let mutedServices = new Set();
let muteAll = false;
let searchFilter = '';
const webviewCache = new Map(); // serviceId -> { container, webview, loadingBar }
let updateInfo = null; // { version, url } quando há nova versão

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

const LIGHT_THEME_CSS = `
html,:root{color-scheme:light!important;background-color:#fff!important;}
body{background-color:#fff!important;color:#202124!important;}
body[class*="dark"],body[data-theme="dark"],[data-theme="dark"],[class*="dark-theme"],[class*="DarkTheme"]{background-color:#fff!important;color:#202124!important;}
[style*="212124"],[style*="1f1f1f"],[style*="303134"],[style*="202124"]{background-color:#fff!important;color:#202124!important;}
`;

const LIGHT_THEME_SCRIPT = '(function(){try{var c=' + JSON.stringify(LIGHT_THEME_CSS.trim()) + ';document.documentElement.style.colorScheme="light";document.documentElement.setAttribute("data-theme","light");var m=document.querySelector("meta[name=color-scheme]");if(m)m.content="light";else{var nm=document.createElement("meta");nm.name="color-scheme";nm.content="light";document.head.appendChild(nm);}var s=document.createElement("style");s.id="tw-forcelight";s.textContent=c;if(!document.getElementById("tw-forcelight"))document.head.appendChild(s);}catch(e){}})();';

let presetCategories = [];

async function loadPresets() {
  try {
    const res = await fetch('./presets.json');
    if (!res.ok) return;
    const data = await res.json();
    presetCategories = data?.categories ?? [];
  } catch {
    presetCategories = [];
  }
}

function isServiceUrlAdded(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const norm = u.origin + u.pathname.replace(/\/$/, '') || u.origin;
    return services.some(s => {
      try {
        const su = new URL(s.url);
        const snorm = su.origin + su.pathname.replace(/\/$/, '') || su.origin;
        return norm === snorm;
      } catch { return false; }
    });
  } catch { return false; }
}

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
  const toLight = next === 'light';
  runThemeTransition(toLight, () => {
    document.body.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    updateThemeIcon(next);
    updateSidebarLogo(next);
    showBigToast(pick(toLight ? THEME_TOASTS_LIGHT : THEME_TOASTS_DARK), 2800);
  });
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

function getServiceIconUrl(service) {
  if (service.customIcon && typeof service.customIcon === 'string' && service.customIcon.startsWith('data:')) {
    return service.customIcon;
  }
  return service.iconUrl || getFaviconUrl(service.url);
}

function resizeImageToDataUrl(file, maxSize = 64) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Erro ao carregar imagem'));
    };
    img.src = url;
  });
}

function setCustomIcon(serviceId, dataUrl) {
  const idx = services.findIndex(s => s.id === serviceId);
  if (idx === -1) return;
  services[idx].customIcon = dataUrl;
  saveServices();
  render();
}

function clearCustomIcon(serviceId) {
  const idx = services.findIndex(s => s.id === serviceId);
  if (idx === -1) return;
  delete services[idx].customIcon;
  if (services[idx].url) services[idx].iconUrl = getFaviconUrl(services[idx].url);
  saveServices();
  render();
}

let pendingModalCustomIcon = null;

function loadServices() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    services = stored ? JSON.parse(stored) : [];
    services.forEach(s => {
      if (s.url && !s.customIcon) s.iconUrl = getFaviconUrl(s.url);
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
  showToast(pick(muteAll ? MUTE_TOASTS_SILENCE : MUTE_TOASTS_ACTIVE));
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

function removeFromWebviewCache(serviceId) {
  const cached = webviewCache.get(serviceId);
  if (!cached) return;
  cached.container?.remove?.();
  webviewCache.delete(serviceId);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function showToast(msg, duration = 2200) {
  const overlay = document.getElementById('toast-overlay');
  const text = document.getElementById('toast-text');
  if (!overlay || !text) return;
  text.textContent = typeof msg === 'string' ? msg : 'Serviço adicionado';
  overlay.classList.add('show');
  clearTimeout(showToast._tid);
  showToast._tid = setTimeout(() => {
    overlay.classList.remove('show');
    text.textContent = '';
  }, duration);
}

function showBigToast(msg, duration = 2800) {
  showToast(msg, duration);
}

function runThemeTransition(toLight, onDone) {
  const overlay = document.getElementById('theme-transition-overlay');
  if (!overlay) { onDone?.(); return; }
  overlay.style.backgroundColor = toLight ? '#ffffff' : '#000000';
  overlay.classList.add('active');
  overlay.style.pointerEvents = 'auto';
  setTimeout(() => {
    onDone?.();
    setTimeout(() => {
      overlay.classList.remove('active');
      overlay.style.pointerEvents = 'none';
    }, 350);
  }, 350);
}

function showUpdateBanner(show) {
  const banner = document.getElementById('update-available-banner');
  if (!banner) return;
  banner.classList.toggle('hidden', !show);
}

function openUpdateModal() {
  if (!updateInfo) return;
  const versionEl = document.getElementById('modal-update-version');
  const currentEl = document.getElementById('modal-update-current');
  if (versionEl) versionEl.textContent = updateInfo.version;
  if (currentEl && typeof window.electronAPI?.getAppVersion === 'function') {
    window.electronAPI.getAppVersion().then(v => { currentEl.textContent = v; });
  }
  document.getElementById('modal-update')?.classList.add('modal-open');
}

function closeUpdateModal() {
  if (updateInfo) {
    try { localStorage.setItem(LAST_SEEN_UPDATE_KEY, updateInfo.version); } catch {}
  }
  document.getElementById('modal-update')?.classList.remove('modal-open');
}

async function checkForUpdates(showModalIfNew = false) {
  if (typeof window.electronAPI?.checkUpdates !== 'function') return;
  try {
    const result = await window.electronAPI.checkUpdates();
    try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch {}
    if (result.available && result.version && result.url) {
      updateInfo = { version: result.version, url: result.url };
      showToast(formatUpdateAvailableToast(result.version));
      showUpdateBanner(true);
      const lastSeen = localStorage.getItem(LAST_SEEN_UPDATE_KEY);
      if (showModalIfNew || lastSeen !== result.version) {
        openUpdateModal();
      }
    } else {
      updateInfo = null;
      showUpdateBanner(false);
      if (showModalIfNew) showToast(pick(UPDATE_OK_TOASTS));
    }
  } catch {
    if (showModalIfNew) showToast(pick(UPDATE_ERROR_TOASTS));
  }
}

function addService(name, url, customIcon = null) {
  const service = {
    id: crypto.randomUUID(),
    name: String(name).trim() || new URL(url).hostname,
    url: String(url).trim(),
    iconUrl: getFaviconUrl(url),
    ...(customIcon ? { customIcon } : {})
  };
  services.push(service);
  saveServices();
  activeServiceId = service.id;
  render();
  closeModal();
  showToast(pick(ADD_SERVICE_TOASTS));
}

function updateService(id, name, url, customIcon = undefined) {
  const idx = services.findIndex(s => s.id === id);
  if (idx === -1) return;
  const newUrl = String(url).trim();
  const urlChanged = services[idx].url !== newUrl;
  if (urlChanged) removeFromWebviewCache(id);
  const nextCustomIcon = customIcon !== undefined
    ? (customIcon && typeof customIcon === 'string' && customIcon.startsWith('data:') ? customIcon : null)
    : services[idx].customIcon;
  const hadCustomIcon = !!nextCustomIcon;
  const updated = {
    ...services[idx],
    name: String(name).trim() || new URL(url).hostname,
    url: newUrl,
    iconUrl: hadCustomIcon ? services[idx].iconUrl : getFaviconUrl(url)
  };
  if (nextCustomIcon) updated.customIcon = nextCustomIcon;
  else delete updated.customIcon;
  services[idx] = updated;
  saveServices();
  render();
  closeModal();
}

function duplicateService(service) {
  const copy = {
    id: crypto.randomUUID(),
    name: service.name + ' (cópia)',
    url: service.url,
    iconUrl: service.iconUrl || getFaviconUrl(service.url),
    customIcon: service.customIcon || undefined
  };
  services.push(copy);
  saveServices();
  activeServiceId = copy.id;
  render();
  showToast(pick(ADD_SERVICE_TOASTS));
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
  removeFromWebviewCache(id);
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
  pendingModalCustomIcon = null;
  const presetSearch = document.getElementById('preset-search');
  if (presetSearch) presetSearch.value = '';
  if (modalEl) modalEl.classList.remove('modal-open');
  updateModalForMode();
}

function updateModalIconPreview() {
  const img = document.getElementById('modal-icon-img');
  const placeholder = document.getElementById('modal-icon-placeholder');
  const btnClear = document.getElementById('btn-clear-icon');
  if (!img || !placeholder) return;
  const url = inputUrlEl?.value?.trim();
  let iconSrc = '';
  if (pendingModalCustomIcon) {
    iconSrc = pendingModalCustomIcon;
    if (btnClear) btnClear.classList.remove('hidden');
  } else {
    iconSrc = url ? getFaviconUrl(url) : '';
    if (btnClear) btnClear.classList.add('hidden');
  }
  if (iconSrc) {
    img.src = iconSrc;
    img.classList.remove('hidden');
    img.onerror = () => { img.src = ''; img.classList.add('hidden'); placeholder.classList.remove('hidden'); };
    placeholder.classList.add('hidden');
  } else {
    img.src = '';
    img.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
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
  const tabsEl = document.getElementById('modal-tabs');
  const addBtn = document.getElementById('modal-add-btn');
  const tabPresetsContent = document.getElementById('tab-presets-content');
  const tabCustomContent = document.getElementById('tab-custom-content');
  if (!titleEl || !addBtn) return;
  if (editingServiceId) {
    titleEl.textContent = 'Editar serviço';
    if (tabsEl) tabsEl.classList.add('hidden');
    if (tabPresetsContent) tabPresetsContent.classList.add('hidden');
    if (tabCustomContent) tabCustomContent.classList.remove('hidden');
    addBtn.textContent = 'Salvar';
  } else {
    titleEl.textContent = 'Adicionar serviço';
    if (tabsEl) tabsEl.classList.remove('hidden');
    switchModalTab('presets');
    addBtn.textContent = 'Adicionar';
  }
}

function switchModalTab(tabId) {
  const tabPresets = document.getElementById('tab-presets');
  const tabCustom = document.getElementById('tab-custom');
  const tabPresetsContent = document.getElementById('tab-presets-content');
  const tabCustomContent = document.getElementById('tab-custom-content');
  const isPresets = tabId === 'presets';
  if (tabPresets) { tabPresets.dataset.active = isPresets ? 'true' : 'false'; }
  if (tabCustom) { tabCustom.dataset.active = !isPresets ? 'true' : 'false'; }
  if (tabPresetsContent) {
    tabPresetsContent.classList.toggle('hidden', !isPresets);
    tabPresetsContent.classList.toggle('flex', isPresets);
  }
  if (tabCustomContent) {
    tabCustomContent.classList.toggle('hidden', isPresets);
    tabCustomContent.classList.toggle('flex', !isPresets);
  }
}

function openModal(options = {}) {
  const { clear = true, editService = null } = options;
  editingServiceId = editService?.id ?? null;
  pendingModalCustomIcon = editService?.customIcon ?? null;
  if (editService) {
    if (inputNameEl) inputNameEl.value = editService.name;
    if (inputUrlEl) inputUrlEl.value = editService.url;
  } else if (clear) {
    if (inputNameEl) inputNameEl.value = '';
    if (inputUrlEl) inputUrlEl.value = '';
  }
  showUrlError('');
  updateModalForMode();
  updateModalIconPreview();
  if (!editingServiceId) {
    const searchEl = document.getElementById('preset-search');
    renderPresetCategories(searchEl?.value || '');
  }
  if (modalEl) modalEl.classList.add('modal-open');
  setTimeout(() => {
    if (editingServiceId) (inputNameEl || inputUrlEl)?.focus();
    else document.getElementById('preset-search')?.focus();
  }, 50);
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

  const customIcon = pendingModalCustomIcon || null;
  if (editingServiceId) {
    updateService(editingServiceId, name, url, customIcon);
  } else {
    addService(name, url, customIcon);
  }
  pendingModalCustomIcon = null;
}

function renderSidebar() {
  if (!serviceListEl) return;

  const term = searchFilter.trim().toLowerCase();
  const filtered = term
    ? services.filter(s => (s.name || '').toLowerCase().includes(term))
    : services;

  serviceListEl.innerHTML = '';
  for (const service of filtered) {
    const iconUrl = getServiceIconUrl(service);
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
      if (activeServiceId !== service.id) {
        tabSwitchCount++;
        if (tabSwitchCount % TAB_SWITCH_INTERVAL === 0) {
          showToast(pick(TAB_SWITCH_TOASTS));
        }
      }
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
    const iconItem = document.createElement('button');
    iconItem.type = 'button';
    iconItem.className = 'w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-600 hover:text-zinc-100 flex items-center gap-2';
    const duplicateItem = document.createElement('button');
    duplicateItem.type = 'button';
    duplicateItem.className = 'w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-600 hover:text-zinc-100 flex items-center gap-2';
    duplicateItem.innerHTML = '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> Duplicar';
    duplicateItem.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); duplicateService(service); });
    dropdown.appendChild(duplicateItem);
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

  const validIds = new Set(services.map(s => s.id));
  [...webviewCache.keys()].forEach(id => {
    if (!validIds.has(id)) removeFromWebviewCache(id);
  });

  const hasActiveService = services.length > 0;
  const active = hasActiveService
    ? (services.find(s => s.id === activeServiceId) || services[0])
    : null;
  if (active) activeServiceId = active.id;

  function injectMuteIfNeeded(wv, serviceId) {
    if (!isServiceMuted(serviceId)) return;
    wv.addEventListener('did-finish-load', function onLoad() {
      wv.removeEventListener('did-finish-load', onLoad);
      wv.executeJavaScript(MUTE_SCRIPT).catch(() => {});
    }, { once: true });
  }

  function injectLightTheme(wv) {
    function doInject() {
      wv.executeJavaScript(LIGHT_THEME_SCRIPT).catch(() => {});
      try { wv.insertCSS(LIGHT_THEME_CSS); } catch (_) {}
    }
    wv.addEventListener('did-finish-load', function onLoad() {
      doInject();
      setTimeout(doInject, 500);
      setTimeout(doInject, 1500);
    });
  }

  function createLoadingBar() {
    const wrap = document.createElement('div');
    wrap.className = 'absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-20 pointer-events-none hidden';
    wrap.innerHTML = '<div class="h-full w-1/3 bg-sky-500 loading-bar-progress rounded-r"></div>';
    return wrap;
  }

  function isGoogleAuthUrl(u) {
    if (!u || typeof u !== 'string') return false;
    try {
      const url = new URL(u);
      return url.hostname === 'accounts.google.com' || url.hostname.endsWith('.accounts.google.com');
    } catch {
      return false;
    }
  }

  function getOrCreatePane(service) {
    const serviceId = service.id;
    let cached = webviewCache.get(serviceId);
    if (cached) return cached;

    const currentUrl = service.url ?? getDefaultUrl();
    const loadingBar = createLoadingBar();
    const webview = document.createElement('webview');
    const partitionId = (serviceId && serviceId !== 'default') ? String(serviceId).replace(/[^a-zA-Z0-9_-]/g, '') : 'default';
    webview.partition = 'persist:timworkspaces-' + partitionId;
    webview.useragent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
    webview.className = 'w-full h-full border-0';
    webview.allowpopups = 'allowpopups';
    webview.webpreferences = 'nativeWindowOpen=yes';
    injectMuteIfNeeded(webview, serviceId);
    injectLightTheme(webview);
    webview.src = currentUrl;

    webview.addEventListener('will-navigate', async (e) => {
      const targetUrl = e?.url;
      if (!isGoogleAuthUrl(targetUrl) || typeof window.electronAPI?.openGoogleAuth !== 'function') return;
      try {
        if (typeof e.preventDefault === 'function') e.preventDefault();
      } catch (_) {}
      loadingBar.classList.remove('hidden');
      try {
        const finalUrl = await window.electronAPI.openGoogleAuth(targetUrl, webview.partition);
        if (finalUrl) webview.src = finalUrl;
        else webview.src = currentUrl;
      } catch {
        webview.src = currentUrl;
      } finally {
        loadingBar.classList.add('hidden');
      }
    });

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
      if (loadingTimeout) { clearTimeout(loadingTimeout); loadingTimeout = null; }
      loadingBar.classList.add('hidden');
    }
    webview.addEventListener('did-start-loading', showLoadingBar);
    webview.addEventListener('did-finish-load', hideLoadingBar);
    webview.addEventListener('did-stop-loading', hideLoadingBar);
    webview.addEventListener('did-fail-load', hideLoadingBar);

    const container = document.createElement('div');
    container.className = 'absolute inset-0 flex flex-col min-h-0';
    container.dataset.serviceId = serviceId;
    container.appendChild(loadingBar);
    const webviewWrap = document.createElement('div');
    webviewWrap.className = 'flex-1 min-h-0 relative';
    webviewWrap.appendChild(webview);
    container.appendChild(webviewWrap);

    cached = { container, webview, loadingBar };
    webviewCache.set(serviceId, cached);
    return cached;
  }

  if (!hasActiveService) {
    contentAreaEl.innerHTML = '';
    activeWebview = null;
    return;
  }

  let toolbar = contentAreaEl.querySelector('#content-toolbar');
  let webviewPanes = contentAreaEl.querySelector('#content-panes');
  if (!webviewPanes) {
    contentAreaEl.innerHTML = '';
    toolbar = document.createElement('div');
    toolbar.id = 'content-toolbar';
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
    webviewPanes = document.createElement('div');
    webviewPanes.id = 'content-panes';
    webviewPanes.className = 'flex-1 min-h-0 relative';
    contentAreaEl.appendChild(toolbar);
    contentAreaEl.appendChild(webviewPanes);
  }

  const pane = getOrCreatePane(active);
  if (!webviewPanes.contains(pane.container)) {
    webviewPanes.appendChild(pane.container);
  }
  webviewCache.forEach((c, id) => {
    const isActive = id === activeServiceId;
    c.container.classList.toggle('hidden', !isActive);
  });

  activeWebview = pane.webview;

  const refreshBtn = document.getElementById('toolbar-refresh');
  const externalBtn = document.getElementById('toolbar-open-external');
  const fullscreenBtn = document.getElementById('toolbar-fullscreen');
  const newRefresh = () => { activeWebview?.reload(); };
  const newExternal = () => {
    const u = activeWebview?.getURL?.();
    if (u && typeof window.electronAPI?.openExternal === 'function') window.electronAPI.openExternal(u);
  };
  const newFullscreen = () => {
    if (typeof window.electronAPI?.toggleFullscreen === 'function') window.electronAPI.toggleFullscreen();
  };
  if (refreshBtn) {
    refreshBtn.replaceWith(refreshBtn.cloneNode(true));
    document.getElementById('toolbar-refresh')?.addEventListener('click', newRefresh);
  }
  if (externalBtn) {
    externalBtn.replaceWith(externalBtn.cloneNode(true));
    document.getElementById('toolbar-open-external')?.addEventListener('click', newExternal);
  }
  if (fullscreenBtn) {
    fullscreenBtn.replaceWith(fullscreenBtn.cloneNode(true));
    document.getElementById('toolbar-fullscreen')?.addEventListener('click', newFullscreen);
  }
}

function render() {
  renderSidebar();
  renderContentArea();
  updateMuteAllButton();
}

const PRESET_FALLBACK_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='10' fill='%2374757e'/%3E%3C/svg%3E";

function renderPresetCategories(searchTerm = '') {
  const container = document.getElementById('preset-categories');
  if (!container) return;
  container.innerHTML = '';
  const term = (searchTerm || '').trim().toLowerCase();
  for (const cat of presetCategories) {
    let items = cat.services || [];
    if (term) {
      items = items.filter(s =>
        (s.name || '').toLowerCase().includes(term) ||
        (s.url || '').toLowerCase().includes(term)
      );
    }
    if (items.length === 0) continue;
    const section = document.createElement('div');
    section.className = 'space-y-3';
    const label = document.createElement('p');
    label.className = 'preset-cat-header text-xs font-medium text-zinc-500 uppercase tracking-wider sticky top-0 py-1 z-10 bg-[rgba(33,33,36,0.98)]';
    label.textContent = cat.label || cat.id || 'Outros';
    section.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-4 sm:grid-cols-5 gap-2';
    for (const preset of items) {
      const card = document.createElement('button');
      card.type = 'button';
      const isAdded = isServiceUrlAdded(preset.url);
      card.className = 'preset-card relative flex flex-col items-center gap-2 p-3 bg-zinc-700/30 hover:bg-zinc-600/40 border border-zinc-600/30 rounded-xl text-zinc-300 hover:text-zinc-100 transition-all duration-150 ' +
        (isAdded ? 'opacity-75 ring-1 ring-amber-500/40' : '');
      const iconUrl = preset.icon || getFaviconUrl(preset.url);
      const img = document.createElement('img');
      img.src = iconUrl || PRESET_FALLBACK_ICON;
      img.alt = '';
      img.loading = 'lazy';
      img.className = 'w-8 h-8 rounded-lg flex-shrink-0';
      img.onerror = () => { img.src = PRESET_FALLBACK_ICON; };
      const labelSpan = document.createElement('span');
      labelSpan.className = 'text-xs font-medium text-center leading-tight truncate w-full';
      labelSpan.textContent = preset.name;
      card.appendChild(img);
      card.appendChild(labelSpan);
      if (isAdded) {
        const badge = document.createElement('span');
        badge.className = 'absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-400';
        badge.textContent = 'já tem';
        card.appendChild(badge);
      }
      card.addEventListener('click', () => {
        if (inputNameEl) inputNameEl.value = preset.name;
        if (inputUrlEl) inputUrlEl.value = preset.url;
        pendingModalCustomIcon = null;
        showUrlError('');
        updateModalIconPreview();
        switchModalTab('custom');
        inputNameEl?.focus();
      });
      grid.appendChild(card);
    }
    section.appendChild(grid);
    container.appendChild(section);
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.service-dropdown').forEach(el => el.classList.add('hidden'));
}

function openMenuModal() {
  document.getElementById('modal-menu')?.classList.add('modal-open');
}

function closeMenuModal() {
  document.getElementById('modal-menu')?.classList.remove('modal-open');
}

function toggleSidebarCollapsed() {
  sidebarCollapsed = !sidebarCollapsed;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  applySidebarCollapsed();
  showToast(pick(sidebarCollapsed ? SIDEBAR_COLLAPSE_TOASTS : SIDEBAR_EXPAND_TOASTS));
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
  loadPresets().then(() => renderPresetCategories());

  const lastCheck = parseInt(localStorage.getItem(LAST_CHECK_KEY), 10);
  if (Date.now() - (isNaN(lastCheck) ? 0 : lastCheck) > CHECK_THROTTLE_MS) {
    setTimeout(() => checkForUpdates(true), 1500);
  }

  if (!localStorage.getItem(FIRST_VISIT_KEY)) {
    try { localStorage.setItem(FIRST_VISIT_KEY, '1'); } catch {}
    setTimeout(() => showBigToast(pick(WELCOME_TOASTS), 3500), 800);
  }

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

  document.querySelectorAll('.modal-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) switchModalTab(tab);
    });
  });

  const presetSearch = document.getElementById('preset-search');
  if (presetSearch) {
    presetSearch.addEventListener('input', () => renderPresetCategories(presetSearch.value));
    presetSearch.addEventListener('search', () => renderPresetCategories(presetSearch.value));
  }

  const inputIconFile = document.getElementById('input-icon-file');
  if (inputIconFile) {
    inputIconFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!modalEl?.classList.contains('modal-open')) return;
      try {
        const dataUrl = await resizeImageToDataUrl(file, 64);
        pendingModalCustomIcon = dataUrl;
        updateModalIconPreview();
      } catch {
        showToast('Erro ao carregar imagem');
      }
    });
  }

  const btnPickIcon = document.getElementById('btn-pick-icon');
  if (btnPickIcon) {
    btnPickIcon.addEventListener('click', () => {
      if (inputIconFile) { inputIconFile.value = ''; inputIconFile.click(); }
    });
  }

  const btnClearIcon = document.getElementById('btn-clear-icon');
  if (btnClearIcon) {
    btnClearIcon.addEventListener('click', () => {
      pendingModalCustomIcon = null;
      updateModalIconPreview();
    });
  }

  if (inputUrlEl) {
    inputUrlEl.addEventListener('input', () => updateModalIconPreview());
    inputUrlEl.addEventListener('change', () => updateModalIconPreview());
  }

  const modalCoffee = document.getElementById('modal-coffee');
  const modalCoffeeOverlay = document.getElementById('modal-coffee-overlay');
  const modalCoffeeClose = document.getElementById('modal-coffee-close');
  const coffeeCopyPix = document.getElementById('coffee-copy-pix');
  const PIX_KEY = 'a7f1a823-d3b5-4ab3-b63f-03ffed9459f7';
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
      else if (document.getElementById('modal-menu')?.classList.contains('modal-open')) closeMenuModal();
      else if (modalCoffee?.classList.contains('modal-open')) modalCoffee.classList.remove('modal-open');
      else if (document.getElementById('modal-update')?.classList.contains('modal-open')) closeUpdateModal();
      else if (document.getElementById('modal-star')?.classList.contains('modal-open')) document.getElementById('modal-star')?.classList.remove('modal-open');
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
  });

  const sidebarSearch = document.getElementById('sidebar-search');
  if (sidebarSearch) {
    sidebarSearch.addEventListener('input', () => {
      searchFilter = sidebarSearch.value;
      renderSidebar();
    });
  }

  const btnSidebarMenu = document.getElementById('btn-sidebar-menu');
  if (btnSidebarMenu) btnSidebarMenu.addEventListener('click', openMenuModal);

  document.getElementById('modal-menu-overlay')?.addEventListener('click', closeMenuModal);
  document.getElementById('modal-menu-close')?.addEventListener('click', closeMenuModal);

  document.getElementById('menu-option-star')?.addEventListener('click', () => {
    closeMenuModal();
    document.getElementById('modal-star')?.classList.add('modal-open');
  });
  document.getElementById('menu-option-updates')?.addEventListener('click', () => {
    closeMenuModal();
    checkForUpdates(true);
  });
  document.getElementById('menu-option-coffee')?.addEventListener('click', () => {
    closeMenuModal();
    document.getElementById('modal-coffee')?.classList.add('modal-open');
  });
  const updateBanner = document.getElementById('update-available-banner');
  if (updateBanner) updateBanner.addEventListener('click', () => { if (updateInfo) openUpdateModal(); });
  document.getElementById('modal-update-overlay')?.addEventListener('click', closeUpdateModal);
  document.getElementById('modal-update-close')?.addEventListener('click', closeUpdateModal);
  document.getElementById('modal-update-later')?.addEventListener('click', closeUpdateModal);
  const modalUpdateDownload = document.getElementById('modal-update-download');
  if (modalUpdateDownload) {
    modalUpdateDownload.addEventListener('click', () => {
      if (updateInfo?.url && typeof window.electronAPI?.openExternal === 'function') {
        window.electronAPI.openExternal(updateInfo.url);
      }
      closeUpdateModal();
    });
  }

  const modalStar = document.getElementById('modal-star');
  const modalStarBtn = document.getElementById('modal-star-btn');
  const modalStarLater = document.getElementById('modal-star-later');
  const modalStarOverlay = document.getElementById('modal-star-overlay');
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

}

document.addEventListener('DOMContentLoaded', init);
