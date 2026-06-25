'use strict';

function isMicrosoftAuthHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase();
  if (host === 'login.microsoftonline.com' || host.endsWith('.microsoftonline.com')) return true;
  if (host === 'login.microsoft.com') return true;
  if (host === 'login.live.com' || host.endsWith('.login.live.com')) return true;
  if (host === 'account.live.com' || host.endsWith('.account.live.com')) return true;
  if (host === 'account.microsoft.com') return true;
  return false;
}

function applyMicrosoftAuthGuard() {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch {}

  if (!isMicrosoftAuthHost(window.location.hostname)) return;

  try {
    Object.defineProperty(navigator, 'credentials', {
      value: undefined,
      configurable: true,
      writable: true
    });
  } catch {}
}

module.exports = { isMicrosoftAuthHost, applyMicrosoftAuthGuard };
