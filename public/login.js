(() => {
  const { api, flash } = window.Siep;
  const tabButtons = [...document.querySelectorAll('[data-auth-tab]')];
  const panels = [...document.querySelectorAll('[data-auth-panel]')];
  const messageFor = (form) => form.querySelector('.form-message');
  const showTab = (name) => {
    for (const button of tabButtons) {
      const active = button.dataset.authTab === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    for (const panel of panels) panel.hidden = panel.dataset.authPanel !== name;
  };
  tabButtons.forEach((button) => button.addEventListener('click', () => showTab(button.dataset.authTab)));
  const params = new URLSearchParams(location.search);
  if (location.protocol === 'file:') {
    document.querySelector('#offline-notice').hidden = false;
    document.querySelectorAll('.auth-submit').forEach((button) => { button.disabled = true; });
  }
  api('/api/auth/demo').then((demo) => {
    if (!demo.enabled) return;
    document.querySelector('#demo-email').textContent = demo.email;
    document.querySelector('#demo-password').textContent = demo.password;
    document.querySelector('.demo-credentials').hidden = false;
  }).catch(() => {});
  const next = params.get('next') === 'booking.html' ? 'booking.html' : 'account.html';
  if (params.get('mode') === 'register') showTab('register');
  const redirect = (user) => { location.href = user.role === 'admin' ? 'admin.html' : next; };
  api('/api/auth/me').then(({ user }) => { if (user) redirect(user); }).catch(() => {});
  document.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('[type="submit"]');
    button.disabled = true; flash(messageFor(form), 'กำลังเข้าสู่ระบบ…', 'success');
    try { const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }); redirect(result.user); }
    catch (error) { flash(messageFor(form), error.message); button.disabled = false; }
  });
  document.querySelector('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('[type="submit"]');
    button.disabled = true; flash(messageFor(form), 'กำลังสร้างบัญชี…', 'success');
    try { const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }); location.href = 'booking.html'; }
    catch (error) { flash(messageFor(form), error.message); button.disabled = false; }
  });
})();
