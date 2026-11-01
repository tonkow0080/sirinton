(() => {
  const { api, escapeHtml, formatDate, statusLabel, flash, localToday } = window.Siep;
  const content = document.querySelector('#booking-content');
  const login = document.querySelector('#booking-login');
  const dateInput = document.querySelector('[name="visitDate"]');
  const form = document.querySelector('#booking-form');
  const message = form.querySelector('.form-message');
  const capacityDate = document.querySelector('#capacity-date');
  const history = document.querySelector('#booking-history');
  let hasCapacity = true;
  dateInput.min = localToday();
  dateInput.value = localToday();
  const renderHistory = (items) => {
    if (!items.length) { history.innerHTML = '<div class="empty-state">ยังไม่มีรายการจองของคุณ</div>'; return; }
    history.innerHTML = items.slice(0, 5).map((item) => `<article class="side-booking-item">
      <div><span>คิว ${String(item.bookingNumber).padStart(2, '0')}</span><b class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</b></div>
      <strong>${escapeHtml(formatDate(item.visitDate))}</strong><small>${item.people} ผู้เข้าชม · ${escapeHtml(item.bookingCode)}</small>
    </article>`).join('');
  };
  const refreshAvailability = async () => {
    if (!dateInput.value) return;
    try {
      const data = await api(`/api/bookings/availability?date=${encodeURIComponent(dateInput.value)}`);
      document.querySelector('#capacity-remaining').textContent = data.remaining;
      capacityDate.textContent = `เหลือ ${data.remaining} จาก ${data.capacity} คน · ${formatDate(data.date)}`;
      hasCapacity = data.remaining > 0;
      form.querySelector('[type="submit"]').disabled = !hasCapacity;
      if (!data.remaining) flash(message, 'วันที่เลือกเต็มแล้ว กรุณาเลือกวันอื่น', 'error');
      else if (message.textContent.includes('วันที่เลือกเต็มแล้ว')) message.className = 'form-message';
    } catch (error) { flash(message, error.message); }
  };
  dateInput.addEventListener('change', refreshAvailability);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    flash(message, 'กำลังบันทึกการจอง…', 'success');
    try {
      const result = await api('/api/bookings', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const item = result.booking;
      flash(message, `จองสำเร็จ · หมายเลขคิว ${String(item.bookingNumber).padStart(2, '0')} · รหัส ${item.bookingCode}`, 'success');
      form.reset(); dateInput.value = localToday(); dateInput.min = localToday();
      renderHistory(await api('/api/bookings/me'));
      await refreshAvailability();
    } catch (error) { flash(message, error.message); await refreshAvailability(); }
    finally { button.disabled = !hasCapacity; }
  });
  async function init() {
    const { user } = await api('/api/auth/me');
    if (!user) {
      login.hidden = false;
      document.querySelector('#booking-login-link').href = 'login.html?next=booking.html';
      return;
    }
    content.hidden = false;
    renderHistory(await api('/api/bookings/me'));
    await refreshAvailability();
  }
  init().catch((error) => { login.hidden = false; login.querySelector('p').textContent = error.message; });
})();
