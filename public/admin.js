(() => {
  const { api, escapeHtml, formatDate, statusLabel } = window.Siep;
  const app = document.querySelector('#admin-app');
  const loading = document.querySelector('#admin-loading');
  const dialog = document.querySelector('#editor-dialog');
  const form = document.querySelector('#editor-form');
  const fields = document.querySelector('#editor-fields');
  const toast = document.querySelector('#admin-toast');
  let editorKind = '';
  let editorId = null;
  let allBookings = [];
  let toastTimer;
  const views = { dashboard: 'ภาพรวมระบบ', locations: 'จัดการข้อมูลสถานที่', activities: 'จัดการกิจกรรม', learning: 'จัดการสื่อการเรียนรู้', bookings: 'รายการจองคิว' };
  const notify = (message, error = false) => {
    toast.textContent = message;
    toast.className = `admin-toast is-visible${error ? ' is-error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'admin-toast'; }, 2600);
  };
  const setView = (name) => {
    if (!views[name]) return;
    document.querySelectorAll('.admin-panel').forEach((panel) => panel.classList.toggle('is-visible', panel.dataset.panel === name));
    document.querySelectorAll('.admin-nav [data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === name));
    document.querySelector('#view-title').textContent = views[name];
    if (name === 'dashboard') loadDashboard();
    if (name === 'locations') loadLocations();
    if (name === 'activities' || name === 'learning') loadContent(name);
    if (name === 'bookings') loadBookings();
  };
  const pill = (status) => `<span class="status-pill status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
  const emptyImage = '<div class="admin-item-image is-empty">✳</div>';
  const itemImage = (url, title) => url ? `<img class="admin-item-image" src="${escapeHtml(url)}" alt="${escapeHtml(title)}" loading="lazy">` : emptyImage;
  const publishedBadge = (published) => `<span class="publish-badge${published ? '' : ' is-hidden'}">${published ? 'เผยแพร่แล้ว' : 'ฉบับร่าง'}</span>`;

  async function loadDashboard() {
    try {
      const data = await api('/api/admin/summary');
      document.querySelector('#stat-members').textContent = data.counts.members;
      document.querySelector('#stat-locations').textContent = data.counts.locations;
      document.querySelector('#stat-activities').textContent = data.counts.activities;
      document.querySelector('#stat-learning').textContent = data.counts.learning;
      document.querySelector('#welcome-name').textContent = data.admin.name.split(' ')[0];
      document.querySelector('#admin-today').textContent = formatDate(data.today.date);
      document.querySelector('#today-date').textContent = formatDate(data.today.date);
      document.querySelector('#today-people').textContent = data.today.people;
      document.querySelector('#today-capacity').textContent = data.today.capacity;
      document.querySelector('#today-bookings').textContent = data.today.bookings;
      document.querySelector('#today-remaining').textContent = `เหลือ ${Math.max(0, data.today.capacity - data.today.people)} คน`;
      document.querySelector('#today-progress').style.width = `${Math.min(100, data.today.people / data.today.capacity * 100)}%`;
      const recent = document.querySelector('#recent-bookings');
      recent.innerHTML = data.recent.length ? data.recent.slice(0, 6).map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.email)}</small></td><td>${escapeHtml(formatDate(item.visitDate))}</td><td>${item.people} คน</td><td>${String(item.bookingNumber).padStart(2, '0')}</td><td>${pill(item.status)}</td></tr>`).join('') : '<tr><td colspan="5" class="table-empty">ยังไม่มีรายการจอง</td></tr>';
    } catch (error) { notify(error.message, true); }
  }
  async function loadLocations() {
    const target = document.querySelector('#location-list');
    target.innerHTML = '<div class="loading-card">กำลังโหลดสถานที่…</div>';
    try {
      const items = await api('/api/admin/locations');
      target.innerHTML = items.length ? items.map((item) => `<article class="admin-item-card">${itemImage(item.image_url, item.name)}<div class="admin-item-copy"><div class="admin-item-meta"><span>${escapeHtml(item.category || 'สถานที่เรียนรู้')}</span>${publishedBadge(item.published)}</div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p><div class="admin-item-actions"><button type="button" data-edit-kind="location" data-id="${item.id}">แก้ไขข้อมูล</button><button class="delete-button" type="button" data-delete-kind="location" data-id="${item.id}">ลบ</button></div></div></article>`).join('') : '<div class="empty-state">ยังไม่มีข้อมูลสถานที่ กด “เพิ่มสถานที่” เพื่อเริ่มต้น</div>';
    } catch (error) { target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
  }
  async function loadContent(type) {
    const target = document.querySelector(`#${type}-list`);
    target.innerHTML = '<div class="loading-card">กำลังโหลดข้อมูล…</div>';
    try {
      const items = await api(`/api/admin/content?type=${type}`);
      target.innerHTML = items.length ? items.map((item) => `<article class="admin-item-card">${itemImage(item.image_url, item.title)}<div class="admin-item-copy"><div class="admin-item-meta"><span>${escapeHtml(item.category || (type === 'activities' ? 'กิจกรรม' : 'สื่อการเรียนรู้'))}</span>${publishedBadge(item.published)}</div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p><div class="admin-item-actions"><button type="button" data-edit-kind="${type}" data-id="${item.id}">แก้ไขข้อมูล</button><button class="delete-button" type="button" data-delete-kind="${type}" data-id="${item.id}">ลบ</button></div></div></article>`).join('') : `<div class="empty-state">ยังไม่มี${type === 'activities' ? 'กิจกรรม' : 'สื่อการเรียนรู้'} กดปุ่มเพิ่มเพื่อเริ่มต้น</div>`;
    } catch (error) { target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
  }
  async function loadBookings() {
    const target = document.querySelector('#all-bookings');
    target.innerHTML = '<tr><td colspan="6" class="table-empty">กำลังโหลดรายการ…</td></tr>';
    try { allBookings = await api('/api/admin/bookings'); renderBookings(); }
    catch (error) { target.innerHTML = `<tr><td colspan="6" class="table-empty">${escapeHtml(error.message)}</td></tr>`; }
  }
  function renderBookings() {
    const query = document.querySelector('#booking-search').value.trim().toLowerCase();
    const status = document.querySelector('#booking-filter').value;
    const rows = allBookings.filter((item) => (status === 'all' || item.status === status) && (!query || [item.name, item.email, item.bookingCode].some((value) => String(value || '').toLowerCase().includes(query))));
    const target = document.querySelector('#all-bookings');
    target.innerHTML = rows.length ? rows.map((item) => `<tr data-booking-row="${item.id}">
      <td><div class="booking-person"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.email)}${item.phone ? ` · ${escapeHtml(item.phone)}` : ''}</small></div></td>
      <td>${escapeHtml(formatDate(item.visitDate))}</td><td>${item.people} คน</td>
      <td><strong>คิว ${String(item.bookingNumber).padStart(2, '0')}</strong><br><small>${escapeHtml(item.bookingCode)}</small></td>
      <td><select class="booking-admin-select" aria-label="สถานะการจอง">${['pending','confirmed','cancelled'].map((choice) => `<option value="${choice}"${choice === item.status ? ' selected' : ''}>${statusLabel(choice)}</option>`).join('')}</select></td>
      <td><button class="save-status-button" type="button" data-save-status="${item.id}">บันทึกสถานะ</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="table-empty">ไม่พบรายการที่ตรงกัน</td></tr>';
  }
  function field(name, label, value = '', options = {}) {
    const val = escapeHtml(value);
    const req = options.required ? ' required' : '';
    const wide = options.wide ? ' wide' : '';
    const helper = options.helper ? `<span class="helper">${options.helper}</span>` : '';
    let input;
    if (options.select) input = `<select name="${name}"${req}>${options.select.map(([v, text]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${text}</option>`).join('')}</select>`;
    else if (options.textarea) input = `<textarea name="${name}" maxlength="${options.max || 12000}"${req}>${val}</textarea>`;
    else input = `<input name="${name}" value="${val}" maxlength="${options.max || 600}"${req}${options.type ? ` type="${options.type}"` : ''}>`;
    return `<label class="${wide}"><span>${label}</span>${input}${helper}</label>`;
  }
  function openEditor(kind, item = null) {
    editorKind = kind;
    editorId = item?.id || null;
    const isLocation = kind === 'location';
    document.querySelector('#editor-title').textContent = `${editorId ? 'แก้ไข' : 'เพิ่ม'}${isLocation ? 'สถานที่' : kind === 'activities' ? 'กิจกรรม' : 'สื่อการเรียนรู้'}`;
    let content = '';
    if (isLocation) {
      content += field('name', 'ชื่อสถานที่', item?.name, { required: true, max: 160 });
      content += field('category', 'ประเภทสถานที่', item?.category, { max: 120 });
      content += field('description', 'รายละเอียด', item?.description, { textarea: true, wide: true, max: 1200 });
      content += field('image_url', 'ที่อยู่รูปภาพ', item?.image_url, { max: 600, wide: true, helper: 'เลือกไฟล์ด้านล่าง หรือใช้ที่อยู่รูปภาพในระบบ เช่น /images/mangrove-garden.jpg' });
    } else {
      content += field('title', 'ชื่อเรื่อง', item?.title, { required: true, max: 160 });
      content += field('category', 'หมวดหมู่', item?.category, { max: 120 });
      content += field('summary', 'คำอธิบายสั้น', item?.summary, { textarea: true, wide: true, max: 800 });
      content += field('body', 'รายละเอียดเพิ่มเติม', item?.body, { textarea: true, wide: true, max: 12000 });
      content += field('location', 'สถานที่', item?.location, { max: 180 });
      content += field('date_text', 'วันและเวลาจัดกิจกรรม', item?.date_text, { max: 120 });
      content += field('image_url', 'ที่อยู่รูปภาพ', item?.image_url, { max: 600, wide: true, helper: 'เลือกไฟล์ด้านล่าง หรือระบุที่อยู่รูปภาพในระบบ' });
    }
    content += '<label class="wide"><span>อัปโหลดรูปภาพ</span><input name="image_file" type="file" accept="image/png,image/jpeg,image/webp"><span class="helper">รองรับ JPG, PNG และ WebP ขนาดไม่เกิน 5 MB</span></label>';
    content += field('sort_order', 'ลำดับการแสดงผล', item?.sort_order ?? 0, { type: 'number', max: 4 });
    content += field('published', 'การเผยแพร่', item?.published === 0 ? '0' : '1', { select: [['1','เผยแพร่บนเว็บไซต์'],['0','บันทึกเป็นฉบับร่าง']] });
    fields.innerHTML = content;
    document.querySelector('#editor-message').className = 'form-message';
    dialog.showModal();
  }
  async function saveEditor(event) {
    event.preventDefault();
    const message = document.querySelector('#editor-message');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const file = form.elements.image_file.files[0];
      delete data.image_file;
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error('ไฟล์รูปภาพต้องมีขนาดไม่เกิน 5 MB');
        message.textContent = 'กำลังอัปโหลดรูปภาพ…'; message.className = 'form-message is-visible success';
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
          reader.readAsDataURL(file);
        });
        const uploaded = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ mime: file.type, data: base64 }) });
        data.image_url = uploaded.imageUrl;
      }
      if (editorKind !== 'location') data.type = editorKind;
      const endpoint = editorKind === 'location' ? '/api/admin/locations' : '/api/admin/content';
      const url = editorId ? `${endpoint}/${editorId}` : endpoint;
      await api(url, { method: editorId ? 'PUT' : 'POST', body: JSON.stringify(data) });
      dialog.close();
      notify('บันทึกข้อมูลเรียบร้อยแล้ว');
      if (editorKind === 'location') await loadLocations(); else await loadContent(editorKind);
      await loadDashboard();
    } catch (error) { message.textContent = error.message; message.className = 'form-message is-visible error'; }
    finally { submit.disabled = false; }
  }
  async function deleteItem(kind, id) {
    if (!window.confirm('ต้องการลบข้อมูลนี้หรือไม่')) return;
    try {
      const endpoint = kind === 'location' ? `/api/admin/locations/${id}` : `/api/admin/content/${id}`;
      await api(endpoint, { method: 'DELETE' });
      notify('ลบข้อมูลเรียบร้อยแล้ว');
      if (kind === 'location') await loadLocations(); else await loadContent(kind);
      await loadDashboard();
    } catch (error) { notify(error.message, true); }
  }
  async function saveBooking(id, button) {
    const row = button.closest('[data-booking-row]');
    const status = row.querySelector('select').value;
    button.disabled = true;
    try {
      await api(`/api/admin/bookings/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      notify('อัปเดตสถานะการจองแล้ว');
      await loadBookings(); await loadDashboard();
    } catch (error) { notify(error.message, true); button.disabled = false; }
  }
  document.querySelectorAll('.admin-nav [data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.goView)));
  document.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => openEditor(button.dataset.add)));
  document.querySelectorAll('.admin-items-grid').forEach((list) => list.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-kind]');
    const remove = event.target.closest('[data-delete-kind]');
    if (edit) {
      const kind = edit.dataset.editKind;
      const id = Number(edit.dataset.id);
      const items = await api(kind === 'location' ? '/api/admin/locations' : `/api/admin/content?type=${kind}`);
      const item = items.find((entry) => entry.id === id);
      if (item) openEditor(kind, item);
    }
    if (remove) deleteItem(remove.dataset.deleteKind, Number(remove.dataset.id));
  }));
  document.querySelector('#editor-form').addEventListener('submit', saveEditor);
  document.querySelector('#editor-close').addEventListener('click', () => dialog.close());
  document.querySelector('#editor-cancel').addEventListener('click', () => dialog.close());
  document.querySelector('#booking-search').addEventListener('input', renderBookings);
  document.querySelector('#booking-filter').addEventListener('change', renderBookings);
  document.querySelector('#refresh-bookings').addEventListener('click', loadBookings);
  document.querySelector('#all-bookings').addEventListener('click', (event) => { const button = event.target.closest('[data-save-status]'); if (button) saveBooking(Number(button.dataset.saveStatus), button); });
  document.querySelector('#admin-logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.href = 'index.html'; });
  async function init() {
    const { user } = await api('/api/auth/me');
    if (!user || user.role !== 'admin') { location.href = 'login.html'; return; }
    document.querySelector('#admin-name').textContent = user.name;
    document.querySelector('#admin-today').textContent = formatDate(new Date().toISOString().slice(0, 10));
    loading.hidden = true; app.hidden = false;
    await loadDashboard();
  }
  init().catch((error) => { loading.textContent = error.message; });
})();
