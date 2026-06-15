// theme-boot.js — applied synchronously before first paint to avoid flash
try {
  var __t = localStorage.getItem('timworkspaces-theme');
  if (__t) {
    document.documentElement.setAttribute('data-theme', __t);
  }
} catch (e) {}
