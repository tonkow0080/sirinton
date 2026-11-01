(() => {
  const api = async (url, options = {}) => {
    if (location.protocol === 'file:') throw new Error('โปรดเปิดระบบผ่าน http://localhost:3000 เพื่อให้เชื่อมต่อฐานข้อมูลได้');
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
    return data;
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(date);
  };
  const statusLabel = (status) => ({ pending: 'รอยืนยัน', confirmed: 'ยืนยันแล้ว', cancelled: 'ยกเลิกแล้ว' }[status] || status);
  const flash = (element, message, kind = 'error') => {
    if (!element) return;
    element.textContent = message;
    element.className = `form-message is-visible ${kind}`;
  };
  const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const sessionNav = async () => {
    const nav = document.querySelector('.nav-links');
    if (!nav) return;
    const booking = [...nav.querySelectorAll('a')].find((link) => /queue\.html/.test(link.getAttribute('href') || ''));
    if (booking) { booking.href = 'booking.html'; booking.textContent = 'จองเข้าอุทยาน'; }
    let account = document.querySelector('.nav-account');
    if (!account) {
      account = document.createElement('a');
      account.className = 'nav-account';
      account.href = 'login.html';
      account.textContent = 'เข้าสู่ระบบ';
      nav.append(account);
    }
    try {
      const result = await api('/api/auth/me');
      const user = result.user;
      if (user) {
        account.href = user.role === 'admin' ? 'admin.html' : 'account.html';
        account.textContent = user.role === 'admin' ? 'ผู้ดูแลระบบ' : user.name;
        account.title = user.email;
      }
    } catch { /* The public site remains readable if the session service is unavailable. */ }
  };
  document.querySelectorAll('#year').forEach((node) => { node.textContent = new Date().getFullYear(); });
  sessionNav();
  window.Siep = { api, escapeHtml, formatDate, statusLabel, flash, localToday };
})();
