# Plano: Facelift UI/UX + Correção de Bugs — Tim Workspaces

## Contexto

O Tim Workspaces é um gestor de workspaces web (Electron 37 + Tailwind 4, **vanilla JS**) que corre serviços como WhatsApp, Gmail, Teams, Meet e Slack em `<webview>` isoladas por partição. A app está funcional e visualmente polida, mas a análise revelou:

1. **Feedback ruidoso** — 21 pontos de toast, alguns repetidos a cada 5 trocas de aba.
2. **Memory leaks reais** no lifecycle dos webviews e na toolbar.
3. **Screen sharing inconsistente** entre plataformas (prioridade declarada).
4. **Integração com o SO incompleta** — sem dock badge, sem notificações nativas, sem atalhos globais.
5. **Dívida de design** — cores hardcoded, sem tokens.

**Objetivo:** tornar a app **mais funcional para produtividade** e **mais bonita**, por esta ordem. Reduzir ruído, corrigir bugs, robustecer o screen sharing e a integração com o SO, e depois aplicar o facelift visual e as melhorias sugeridas.

**Decisões tomadas:**
- Toasts: **manter o humor**, mas reduzir drasticamente a **frequência** (cortar repetições, não a personalidade).
- Incluir 4 extras: **notificações nativas do SO**, **command palette (Cmd+K)**, **atalhos globais + auto-launch**, **cache local de ícones**.

**Ficheiros centrais:** [main.js](main.js) · [preload.js](preload.js) · [src/renderer.js](src/renderer.js) (1627 linhas, monolítico) · [src/index.html](src/index.html) · [src/tailwind.input.css](src/tailwind.input.css) · [package.json](package.json) · [entitlements.mac.plist](entitlements.mac.plist)

**Restrições técnicas confirmadas:**
- CSP estrita: `script-src 'self'` → sem inline scripts; qualquer JS novo vem de ficheiro em `src/` (já empacotado via `build.files: src/**/*`).
- `renderer.js` carregado como script clássico (não módulo). Estado global em variáveis de topo.
- Webviews criados em JS (`getOrCreatePane`), **sem preload próprio** hoje → injeções feitas tarde via `executeJavaScript`.
- Tailwind 4 CLI sem config file; `@source` varre `index.html` e `renderer.js` (classes novas em strings JS são detetadas).

---

## FASE 0 — Bugs críticos e segurança (fundação)

Baixo risco, alto valor. Estabiliza a base antes de tudo o resto.

| # | Problema | Ficheiro:linha | Correção |
|---|----------|----------------|----------|
| 0.1 | **Memory leak: listeners de webview nunca removidos** | `renderer.js:1036-1078` + `removeFromWebviewCache` `384-389` | Dar a cada webview um `AbortController`; passar `{ signal }` em **todos** os `addEventListener`. `removeFromWebviewCache` faz `abortController.abort()` + `webview.stop()` + `src='about:blank'` + `container.remove()`. Guardar `abortController` no objeto de cache. |
| 0.2 | **Memory leak: toolbar re-liga listeners a cada render** (`cloneNode`) | `renderer.js:1197-1231` | Registar os 5 handlers (back/forward/refresh/external/fullscreen) **uma única vez** na criação da toolbar (`if (!webviewPanes)`, `1136-1164`); handlers leem `activeWebview` (variável de módulo) no clique. Eliminar o bloco `replaceWith(cloneNode)`. |
| 0.3 | **Memory leak: `loadingTimeout` órfão (8s)** | `renderer.js:1061-1074` | Expor `cancelLoadingTimer()` no objeto de cache; `removeFromWebviewCache` chama-o antes de remover o DOM. |
| 0.4 | **Memory leak: listeners de `mainWindow` nunca limpos** | `main.js:207-221` | No `closed`: `clearTimeout(boundsDebounce)` + `removeAllListeners('resize'/'move')` antes de `mainWindow=null`. |
| 0.5 | **Segurança: `partition` não validada em `openGoogleAuth`** | `main.js:312`, `379` | `sanitizePartition(p)` com regex `^persist:timworkspaces(-[a-zA-Z0-9_-]+)?$`, fallback para `GOOGLE_AUTH_PARTITION`. Tem de aceitar exatamente o formato que o renderer emite (`renderer.js:1026`). |
| 0.6 | **Race condition na janela Google Auth** | `main.js:335-344` | Em `onDone`: `if (authWin.isDestroyed()) return` antes de `close()`; `removeAllListeners` dos `did-navigate*`; try/catch no `setWindowOpenHandler` (`380-384`). |

**Verificação:** abrir/fechar muitos serviços e trocar de aba dezenas de vezes; inspecionar `process.getProcessMemoryInfo()` / DevTools → memória estável. Tentar `openGoogleAuth` com partition inválida → cai no fallback.

---

## FASE 1 — Redução de ruído dos toasts *(prioridade)*

**Diagnóstico:** `showToast(msg, duration=1800)` (`renderer.js:432-447`), toast único (sem fila/stack), sem close manual. 21 pontos de disparo. Pior ofensor: `TAB_SWITCH_TOASTS` dispara **a cada 5 trocas de aba** com contador que nunca reseta (`renderer.js:825-828`). Também repetitivos: mute toggle, collapse sidebar, add/duplicate. Estimativa: 8-15 toasts/10min.

**Política (manter humor, cortar repetição):**

| Ação | Hoje | Decisão |
|------|------|---------|
| Troca de aba (a cada 5) | toast jocoso recorrente | **Cortar** o disparo recorrente; remover `tabSwitchCount` e bloco `825-828` |
| Toggle mute-all / collapse sidebar | toast a cada toggle | **Inline/subtil** — o ícone/estado já comunica; sem toast |
| Add / duplicate serviço | toast a cada ação | **Silenciar** (a UI já mostra o serviço novo) |
| Theme toggle | toast 2.8s | **Silenciar** (a transição visual já é feedback) |
| Update "está em dia" | toast | **Silenciar** (manter só no fluxo manual explícito) |
| Boas-vindas (1ª visita) | toast 3.5s | **Manter com humor** (raro, gated por `FIRST_VISIT_KEY`) |
| Erros (import/export/icon/PIX/update) | toast | **Manter**, com `role="alert"` + close manual, 6s ou persistente |
| Export/import OK, PIX copiado | toast | **Manter** curto (2.5s) — confirmação de ação real |

**Implementação:**
- Reescrever o subsistema para **fila/stack** (máx. 3 visíveis): `#toast-overlay` (`index.html:221-225`) passa a `flex-col gap-2`; cada toast é nó criado por `createToastNode(msg, {type, closable})`. Timer **por nó**, pausado em `mouseenter` (hover-to-read).
- API: `showToast(msg, {type='info'|'success'|'error', duration, closable})`; tipos com defaults. `dismissToast(node)`.
- **Config de nível** no `modal-menu`: chave `timworkspaces-toast-level` ∈ {`normal`, `só-erros`, `silencioso`}; `showToast` consulta no início e faz early-return.
- Manter as constantes de humor que sobrevivem (boas-vindas); remover as recorrentes mortas (`THEME_TOASTS_*`, `MUTE_TOASTS_*`, `ADD_SERVICE_TOASTS`, `SIDEBAR_*_TOASTS`, `TAB_SWITCH_TOASTS`, `TAB_SWITCH_INTERVAL`).

**Ficheiros:** `renderer.js` (subsistema + 21 call sites + limpeza de constantes), `index.html` (estrutura `#toast-overlay`, CSS `41-43`).

**Verificação:** sessão de 10 min com trocas de aba/toggles → ~0-2 toasts (só erros e ações reais). Boas-vindas aparece 1x em perfil novo.

---

## FASE 2 — Performance, lifecycle e cache local

### 2.1 Suspensão suave de webviews inativos
- No loop de mostrar/esconder (`renderer.js:1170-1173`), aplicar `webview.setBackgroundThrottling(!isActive)` por webview. Mantém websockets vivos (notificações continuam) mas reduz CPU de timers/rAF em background. Opt-out por serviço se algum atrasar badges (ex: WhatsApp).
- **Não** introduzir estado "suspenso por `about:blank`": ganho de RAM marginal (webContents continua vivo) e perde estado. A sessão persiste via `persist:` partitions, logo recriar não força re-login.

### 2.2 `WEBVIEW_CACHE_MAX` adaptativo
- `renderer.js:44` passa a `let` lido de `localStorage` (`timworkspaces-cache-max`, default 10). Opcional: ajustar no arranque por RAM via novo IPC `get-system-memory` (≤8GB→6, ≤16GB→10, >16GB→16). `updateWebviewLRU` (`391-401`) já respeita a variável.

### 2.3 Persistência local
- **Serviço ativo** (`timworkspaces-active-service`): introduzir setter `setActiveService(id)` que grava e centraliza as ~8 atribuições espalhadas (`299, 521, 561, 592, 829, 1364, 1539, 972`). Ler no `init` antes de `render()`; fallback para 1.º serviço ativo.
- **Zoom** (`timworkspaces-zoom`): serializar o Map `zoomLevels` (`renderer.js:58`); `loadZoomLevels()` no init, `saveZoomLevels()` nos 3 handlers (`1523, 1529, 1533`). Re-apply já existe (`1177-1180`).

### 2.4 Cache local de ícones (offline) *(extra)*
- Ícones de serviços vêm de CDN (`cdn.simpleicons.org`, `icons.duckduckgo.com` — `renderer.js:186-194`) → dependem de rede.
- **Custom protocol** (recomendado): `protocol.handle('twicon', ...)` no main serve de `userData/icon-cache/<sha1>` e faz fetch+grava no miss (TTL ~7 dias por mtime). Renderer usa `img.src = 'twicon://<host>'`. **Adicionar `twicon:` ao `img-src` da CSP** (`index.html:6`).
- Alternativa mais simples: IPC `get-cached-icon(url)` → devolve `data:` URL (progressive enhancement: troca `img.src` quando resolve).
- Pre-fetch no `init` em background para popular o cache.

### 2.5 Flash de tema na 1ª visita
- Criar `src/theme-boot.js` (síncrono, no `<head>` antes do CSS) que lê `localStorage` e aplica `data-theme` no `<html>`. Remover `style="background-color:#212124"` inline do body (`index.html:122`); mover cores base para CSS dirigido por `data-theme`.
- Para perfil sem escolha guardada: `@media (prefers-color-scheme)` como default CSS (síncrono, sem IPC). Remove o flash da 1ª visita.

### 2.6 Sidebar search sem re-render total
- `renderSidebar()` inteiro a cada keystroke (`renderer.js:1570-1573`) → `filterSidebar(term)` que faz `row.classList.toggle('hidden', !match)` (rows já têm `data-id`). Debounce ~120ms. Abdicar do highlight `<mark>` em tempo real (ou atualizar só `.sidebar-label`).

**Verificação:** offline → ícones carregam do cache. Reiniciar app → serviço ativo e zoom preservados. 1ª visita em SO claro → sem flash escuro. Busca fluida com 30+ serviços sem perder foco.

---

## FASE 3 — Integração com SO e dispositivos *(prioridade: screen sharing)*

### 3.1 Screen sharing robusto *(prioridade máxima)*
**Problema raiz:** `attachWebviewDisplayMediaHandler` (`main.js:25-49`) tem `useSystemPicker:true` **mas** o callback também escolhe `sources[0]` automaticamente. São mutuamente exclusivos: em macOS 15+ o picker nativo trata tudo (callback ignorado); em Windows/Linux o callback corre e partilha **sempre o ecrã inteiro** sem deixar escolher.

**Abordagem híbrida por plataforma:**
- **macOS 15+** (`Darwin ≥ 24`): `useSystemPicker: true` (SCContentSharingPicker nativo). Fallback para picker custom se a stream falhar.
- **macOS <15 / Windows / Linux:** **picker custom HTML** — novo `BrowserWindow` modal (`src/picker/picker.html` + `picker.js` + `picker-preload.js`) que mostra ecrãs e janelas com thumbnails (`desktopCapturer.getSources` com `thumbnailSize 320×200`, `fetchWindowIcons`). Devolve `{id, withAudio}`.
- **macOS — permissão de gravação de ecrã:** `ensureScreenPermission()` via `systemPreferences.getMediaAccessStatus('screen')`; não há prompt programático → disparar `getSources` uma vez (regista a app na lista), depois `dialog` + `shell.openExternal('x-apple.systempreferences:...ScreenCapture')`. Avisar que só toma efeito após reiniciar a app.
- **Áudio de sistema:** Windows `streams.audio='loopback'` (condicionado a checkbox no picker); macOS/Linux só vídeo (não prometer). Adicionar `NSAudioCaptureUsageDescription` em `package.json > build.mac.extendInfo` para o futuro.
- **Feedback:** canal `screen-share-status` (main→renderer) com `{state: 'cancelled'|'error'|'permission-denied'}` → `showToast`.
- **Limitação documentada:** partilha de "aba específica" de outro browser não é possível via `desktopCapturer` (só janela inteira).

**Ficheiros:** `main.js:25-49` (reescrever; importar `systemPreferences`), `package.json` (extendInfo), novos `src/picker/*`, `preload.js` (`onScreenShareStatus`).

### 3.2 Dock badge (macOS) + overlay icon (Windows) + Unity (Linux)
- Os counts já existem (`notificationCounts` Map, `renderer.js:57,407`). Adicionar `pushTotalUnread()` que soma e chama `electronAPI.setUnreadCount(total)`.
- **IPC `set-unread-count`** (renderer→main): `app.dock.setBadge` (mac), `mainWindow.setOverlayIcon` (win, com `nativeImage` 16×16), `app.setBadgeCount` (linux best-effort).

### 3.3 Notificações nativas do SO *(extra)*
**Refactor de base:** introduzir **preload dedicado de webview** (`src/webview-preload.js`, definido em `webview.preload` em `renderer.js:1025-1034`). Substitui o `executeJavaScript` tardio e centraliza mute + light-theme + notificações.
- No preload: shim de `window.Notification` que faz `ipcRenderer.sendToHost('web-notification', {title,body,tag,icon})` em vez de criar a notificação web.
- Host (`renderer.js`, perto de `1036`): ouvir `ipc-message`; se serviço **não** mutado (`isServiceMuted`), chamar `electronAPI.showNativeNotification({serviceId, serviceName, title, body, icon})`.
- Main: `new Notification(...)`; no `click` → `mainWindow.show()/focus()` + `send('focus-service', {serviceId})`. Renderer ativa o serviço (reusar `setActiveService`).
- Windows: `app.setAppUserModelId('com.timworkspaces.app')` no `whenReady` (senão notificações não agrupam).
- **Canais:** `web-notification` (webview→host), `show-native-notification` (host→main), `focus-service` (main→host).

### 3.4 Tray no macOS + atalhos globais + auto-launch *(extra)*
- **Tray macOS:** mover criação para `setupTray()` cross-platform; ícone template (`setTemplateImage(true)`); tooltip com total de não-lidos. Manter comportamento `close→hide` só em não-darwin.
- **Atalho global** (`globalShortcut`): `CommandOrControl+Shift+Space` toggle show/hide. `will-quit` → `unregisterAll`. Next/prev de serviço como atalhos **locais** no keydown (`renderer.js:1506`).
- **Auto-launch:** `app.setLoginItemSettings({openAtLogin, openAsHidden})`; IPC `get-auto-launch`/`set-auto-launch`; toggle no `modal-menu`. Linux: fallback `.desktop` em `~/.config/autostart` (best-effort).

### 3.5 Auto-update — faseado (nota de viabilidade)
- macOS auto-update exige app **assinada e notarizada**; o build atual usa `CSC_IDENTITY_AUTO_DISCOVERY=false` → inviável sem Apple Developer ID. **Não migrar cegamente.**
- Curto prazo: melhorar o fluxo manual existente (`main.js:268-296`) — botão "Descarregar" no banner abre o asset certo + changelog do `data.body`.
- Médio prazo: `electron-updater` **só Windows** (provider GitHub). macOS fica para quando houver assinatura.

**Verificação:** screen share em Meet/Teams/Zoom mostra picker e partilha a fonte escolhida (não sempre o ecrã todo); macOS sem permissão → diálogo claro. Notificação de WhatsApp/Slack aparece nativa e o clique foca o serviço. Badge no dock/taskbar reflete total. Atalho global e auto-launch funcionam.

---

## FASE 4 — Design system e facelift visual *(melhorias sugeridas)*

### 4.1 Tokens CSS (fundação visual)
- Substituir as ~70 linhas de tema hardcoded (`index.html:51-119`) por **custom properties** em `:root`/`[data-theme="light"]`: `--bg, --surface, --surface-raised, --border, --text, --text-muted, --accent, --danger, --star, --radius*, --toast-bg`.
- `tailwind.input.css`: `@theme inline { --color-surface: var(--surface-solid); ... }` → gera utilitários (`bg-surface`, `text-app-muted`) que resolvem o var em runtime (troca de tema sem JS, sem muro de `!important`).
- Migração **incremental**, testando `pnpm build:css` a cada fase: (1) tokens + remover inline styles; (2) corrigir badges/overlays com cor hardcoded em JS (`renderer.js:419,850,858` — `#0ea5e9`/`#212124` quebram no tema light: **bug real**); (3) varrer `zinc-*` críticos.

### 4.2 Facelift visual focado em produtividade
- Indicação de serviço ativo mais forte (barra accent 3px + glow leve); badge vira **dot** quando sidebar colapsada.
- **Empty state** com chips de presets populares (WhatsApp, Gmail, Slack, Notion) que abrem o modal pré-preenchido (reusa `openModal` + preset card `1288-1296`).
- Toolbar: mostrar **título + favicon do serviço ativo** no centro (`renderer.js:1148`, hoje vazio); indicador de zoom quando ≠100%.
- Micro-interações: badge com scale-in quando o count sobe.

### 4.3 Command palette (Cmd+K) *(extra)*
- Novo `#modal-palette` (padrão dos modais existentes). Cmd/Ctrl+K abre overlay centrado-no-topo: input + lista fuzzy (serviços + ações: adicionar, mute-all, updates, export/import, tema).
- Navegação 100% teclado (↑/↓/Enter/Esc); mostra `Cmd+1-9` nos 9 primeiros. Ícones via `getServiceIconUrl`; badge inline.
- Funções: `openPalette/closePalette/renderPaletteList/movePaletteSelection/runPaletteItem`. Hook no keydown (`renderer.js:1506`). Reusar `setActiveService` (Fase 2.3) e `handleModalKeydown` (`647-664`) para tab-trap.

### 4.4 Acessibilidade e responsividade
- `aria-label` em `sidebar-search` (`150`) e `preset-search` (`179`); `aria-describedby="url-error"` no input de URL.
- Sidebar: `role="listbox"`/`role="option"` + navegação por setas (opcional — o palette cobre 80%).
- Auto-collapse da sidebar abaixo de ~640px via `matchMedia` (sem persistir). Palette `max-w-xl w-[90vw]`.

**Verificação:** alternar tema → sem cores partidas (badges corretos no light); Cmd+K abre, filtra e salta entre serviços por teclado; janela estreita → sidebar colapsa.

---

## Sequenciamento recomendado

```
Fase 0 (bugs/segurança)  →  Fase 1 (toasts)  →  Fase 2 (perf/cache)
        ↓                                              ↓
Fase 3 (SO/screen share, paralelizável)   ──────►  Fase 4 (design/palette)
```

- **Dependência crítica:** Fase 0.1 muda a forma do objeto em `webviewCache` (adiciona `abortController`/`cancelLoadingTimer`); Fase 2.1 e 3.3 assumem essa estrutura → fazer 0.1 primeiro.
- **`setActiveService()`** (Fase 2.3) é reutilizado pela command palette (4.3) e pelas notificações nativas (3.3) → introduzir cedo.
- **Preload de webview** (3.3) é fundação para limpar as injeções de mute/tema → fazer antes/junto com 4.1.
- Fase 3.1 (screen share) é independente das restantes → pode arrancar em paralelo logo após a Fase 0.

| Fase | Foco | Prioridade | Esforço |
|------|------|-----------|---------|
| 0 | Bugs + segurança | Alta | Baixo/Médio |
| 1 | Toasts | Alta | Médio |
| 2 | Perf + cache + persistência | Alta/Média | Médio |
| 3 | SO + screen share + notificações | Alta | Alto |
| 4 | Design tokens + palette + facelift | Média | Médio |

## Novos canais IPC (consolidado)

| Canal | Direção | Payload |
|-------|---------|---------|
| `set-unread-count` | renderer→main | `number` |
| `show-native-notification` | host→main | `{serviceId, serviceName, title, body, icon}` |
| `web-notification` | webview→host (`sendToHost`) | `{title, body, tag, icon}` |
| `focus-service` | main→host | `{serviceId}` |
| `screen-share-status` | main→host | `{state, message?}` |
| `picker:get-sources` / `picker:choose` / `picker:cancel` | picker↔main | `{sources[],...}` / `{id, withAudio}` / — |
| `get-auto-launch` / `set-auto-launch` | host→main | `→bool` / `bool→bool` |
| `get-cached-icon` ou protocolo `twicon:` | renderer→main | `url→data:`/stream |
| `get-system-memory` (opcional) | renderer→main | `→{totalMB}` |

## Verificação end-to-end

1. `pnpm install && pnpm run start` — app arranca sem erros de consola.
2. `pnpm run build:css` após cada alteração a tokens/Tailwind — confirmar output gerado.
3. **Memória:** abrir/fechar serviços e trocar de aba 50×; memória estável (sem crescimento linear).
4. **Toasts:** sessão típica → ≤2 toasts; erros forçados (importar ficheiro inválido) → toast com close.
5. **Screen share:** Meet/Teams/Zoom em macOS e Windows → picker aparece, partilha a fonte escolhida; macOS sem permissão → diálogo.
6. **Notificações:** mensagem nova em WhatsApp → notificação nativa; clique foca o serviço; badge no dock/taskbar correto.
7. **Persistência:** fechar/reabrir → serviço ativo, zoom e tema preservados; offline → ícones do cache.
8. **Palette/atalhos:** Cmd+K, Cmd+1-9, atalho global de show/hide, auto-launch.
9. Build final por plataforma (`pnpm run build:mac`/`:win`/`:linux`) sem regressões; cuidado com o patch `dmg-builder`.

## Notas / riscos

- **App não assinada:** auto-update macOS inviável; SmartScreen no Windows. Sinalizado, não bloqueante.
- **Wayland (Linux):** `desktopCapturer` limitado; testar em X11, documentar.
- **CSP:** qualquer recurso novo (`twicon:`, `theme-boot.js`, `webview-preload.js`) tem de constar/ser compatível com a meta CSP (`index.html:6`).
- **Throttling vs notificações:** validar que badges continuam a atualizar com `setBackgroundThrottling(true)`; opt-out por serviço se preciso.
- **`renderer.js` monolítico (1627 linhas):** não modularizar agora (CSP + script clássico). Agrupar funções novas em secções comentadas; modularização leve fica para fase posterior.
- **Segurança (fora de escopo, sinalizado):** `setWindowOpenHandler` (`main.js:374-390`) faz `shell.openExternal` para qualquer URL http(s) sem interação — abrir como tarefa separada.
