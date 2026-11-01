(() => {
  const { api, escapeHtml, formatDate, statusLabel } = window.Siep;
  const main = document.querySelector('#member-main');
  const loading = document.querySelector('#member-loading');
  const renderBookings = (items) => {
    const target = document.querySelector('#member-bookings');
    document.querySelector('#booking-count').textContent = `${items.length} รายการ`;
    if (!items.length) { target.innerHTML = '<div class="empty-state">ยังไม่มีรายการจอง · เลือกวันเข้าชมเพื่อเริ่มวางแผนได้เลย</div>'; return; }
    target.innerHTML = items.map((item) => `<article class="member-booking-card">
      <div class="booking-number"><small>หมายเลขคิว</small><strong>${String(item.bookingNumber).padStart(2, '0')}</strong></div>
      <div class="member-booking-details"><div class="member-booking-title"><strong>${escapeHtml(formatDate(item.visitDate))}</strong><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
        <span>${item.people} ผู้เข้าชม · รหัสจอง ${escapeHtml(item.bookingCode)}</span>${item.purpose ? `<small>${escapeHtml(item.purpose)}</small>` : ''}</div>
      ${item.status !== 'cancelled' && item.visitDate >= window.Siep.localToday() ? `<button class="text-button" type="button" data-cancel-booking="${item.id}">ยกเลิก</button>` : ''}
    </article>`).join('');
    target.querySelectorAll('[data-cancel-booking]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('ยืนยันยกเลิกรายการจองนี้หรือไม่')) return;
      button.disabled = true;
      try { await api(`/api/bookings/${button.dataset.cancelBooking}/cancel`, { method: 'POST', body: '{}' }); await load(); }
      catch (error) { button.disabled = false; window.alert(error.message); }
    }));
  };
  async function load() {
    const { user } = await api('/api/auth/me');
    if (!user) { location.href = 'login.html'; return; }
    if (user.role === 'admin') { location.href = 'admin.html'; return; }
    document.querySelector('#member-name').textContent = user.name.split(' ')[0];
    document.querySelector('#profile-avatar').textContent = [...user.name][0] || 'ส';
    document.querySelector('#profile-name').textContent = user.name;
    document.querySelector('#profile-email').textContent = user.email;
    document.querySelector('#profile-phone').textContent = user.phone || 'ยังไม่ได้เพิ่มเบอร์โทรศัพท์';
    renderBookings(await api('/api/bookings/me'));
    loading.hidden = true; main.hidden = false;
  }
  document.querySelector('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.href = 'index.html'; });
  load().catch((error) => { loading.textContent = error.message; });
})();
