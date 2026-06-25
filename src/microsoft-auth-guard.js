'use strict';

function isMicrosoftAuthHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase();
  if (host === 'login.microsoftonline.com' || host.endsWith('.microsoftonline.com')) return true;
  if (host === 'login.microsoft.com') return true;
  if (host === 'login.live.com' || host.endsWith('.login.live.com')) return true;
  if (host === 'account.live.com' || host.endsWith('.account.live.com')) return true;
  if (host === 'account.microsoft.com') return true;
  if (host === 'credential.login.microsoftonline.com') return true;
  return false;
}

/** Script injectável no main world (inclui iframes). */
function getMicrosoftWebAuthnBlockScript() {
  return `(function(){
    var host = (location.hostname || '').toLowerCase();
    var isMs = host.endsWith('.microsoftonline.com') || host === 'login.microsoft.com'
      || host === 'login.live.com' || host.endsWith('.login.live.com')
      || host === 'account.live.com' || host.endsWith('.account.live.com')
      || host === 'account.microsoft.com';
    if (!isMs) return;
    try {
      Object.defineProperty(navigator, 'webdriver', { get: function(){ return false; }, configurable: true });
    } catch (e) {}
    try {
      Object.defineProperty(window, 'PublicKeyCredential', {
        value: undefined,
        configurable: true,
        writable: true
      });
    } catch (e) {}
    try {
      var err = function() {
        return Promise.reject(new DOMException('The operation is not supported.', 'NotSupportedError'));
      };
      Object.defineProperty(navigator, 'credentials', {
        value: { create: err, get: err, store: err, preventSilentAccess: function(){ return Promise.resolve(undefined); } },
        configurable: true,
        writable: true
      });
    } catch (e) {}
  })();`;
}

function applyMicrosoftAuthGuard() {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch {}

  if (!isMicrosoftAuthHost(window.location.hostname)) return;

  try {
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: undefined,
      configurable: true,
      writable: true
    });
  } catch {}

  try {
    const err = () => Promise.reject(new DOMException('The operation is not supported.', 'NotSupportedError'));
    Object.defineProperty(navigator, 'credentials', {
      value: { create: err, get: err, store: err, preventSilentAccess: () => Promise.resolve(undefined) },
      configurable: true,
      writable: true
    });
  } catch {}
}

module.exports = {
  isMicrosoftAuthHost,
  applyMicrosoftAuthGuard,
  getMicrosoftWebAuthnBlockScript
};
