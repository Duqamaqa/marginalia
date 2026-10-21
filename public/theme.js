// Apply before styles paint so a saved dark preference never flashes a white page.
(() => {
  const key = 'marginalia.theme.v1';
  const valid = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { preference = valid(localStorage.getItem(key)); } catch { /* Theme still works without storage. */ }
  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0d0c' : '#ffffff');
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', dark ? 'black' : 'default');
    const choice = document.getElementById('theme-choice');
    if (choice) choice.value = preference;
  }
  apply();
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-choice')?.addEventListener('change', event => {
      preference = valid(event.target.value);
      try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this session. */ }
      apply();
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); }
  });
})();
