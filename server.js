const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { db, UPLOAD_DIR } = require('./lib/database');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const QUEUE_CAPACITY = Math.max(1, Math.min(100, Math.floor(Number(process.env.QUEUE_CAPACITY) || 100)));
const VISIT_CAPACITY = Math.max(1, Math.min(5000, Math.floor(Number(process.env.VISIT_CAPACITY) || 100)));
const SESSION_DAYS = 7;
const resources = new Set(['news', 'activities', 'learning', 'gallery']);
const managedTypes = new Set(['activities', 'learning']);
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.avif':'image/avif', '.ico':'image/x-icon' };

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(data));
}
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''; let size = 0; let settled = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > 8 * 1024 * 1024) { settled = true; reject(fail('ข้อมูลมีขนาดใหญ่เกินกำหนด', 413)); req.resume(); return; }
      body += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(fail('รูปแบบข้อมูลไม่ถูกต้อง', 400)); }
    });
    req.on('error', error => { if (!settled) reject(error); });
  });
}
function parkDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function getContent(type) {
  return db.prepare('SELECT * FROM content WHERE type = ? AND published = 1 ORDER BY sort_order, id DESC').all(type);
}
function publicLocations() {
  return db.prepare('SELECT id,name,description,category,image_url,sort_order FROM locations WHERE published=1 ORDER BY sort_order,id').all();
}
function publicData() {
  return { site: {
    name: 'อุทยานสิ่งแวดล้อมนานาชาติสิรินธร', englishName: 'Sirindhorn International Environmental Park',
    address: '1281 ค่ายพระรามหก ตำบลชะอำ อำเภอชะอำ จังหวัดเพชรบุรี 76120', phone: '032 508 352', email: 'siep@sirindhornpark.or.th',
    officialUrl: 'https://home.sirindhornpark.or.th/', facebookUrl: 'https://www.facebook.com/siepchaam'
  }, locations: publicLocations(), news: getContent('news'), activities: getContent('activities'), learning: getContent('learning'), gallery: getContent('gallery') };
}
function queueStatus(visitorKey = '') {
  const date = parkDate();
  const issued = db.prepare('SELECT COALESCE(MAX(ticket_number), 0) AS n FROM queue_tickets WHERE service_date=?').get(date).n;
  const mine = visitorKey ? db.prepare('SELECT ticket_number FROM queue_tickets WHERE service_date=? AND visitor_key=?').get(date, visitorKey) : null;
  return { date, issued, capacity: QUEUE_CAPACITY, remaining: Math.max(0, QUEUE_CAPACITY - issued), nextNumber: issued < QUEUE_CAPACITY ? issued + 1 : null, myTicket: mine?.ticket_number || null };
}
function cleanText(value, max, label, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw fail(`กรุณากรอก${label}`);
  if (text.length > max) throw fail(`${label}ยาวเกินกำหนด`);
  return text;
}
function userDto(row) {
  return row ? { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role } : null;
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return '';
}
function sessionCookie(token, req, clear = false) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `siep_session=${clear ? '' : encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : SESSION_DAYS * 24 * 60 * 60}${secure}`;
}
function currentUser(req) {
  const token = getCookie(req, 'siep_session');
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const row = db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), Date.now());
  return row || null;
}
function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw fail('กรุณาเข้าสู่ระบบก่อนทำรายการ', 401);
  return user;
}
function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') throw fail('หน้านี้สำหรับผู้ดูแลระบบเท่านั้น', 403);
  return user;
}
async function createSession(userId, req, res) {
  const previous = getCookie(req, 'siep_session');
  if (/^[a-f0-9]{64}$/i.test(previous)) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(previous));
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(hashToken(token), userId, expiresAt);
  res.setHeader('Set-Cookie', sessionCookie(token, req));
}
async function passwordRecord(password, saltHex = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  return { salt: saltHex, hash: derived.toString('hex') };
}
async function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || (process.env.NODE_ENV === 'production' ? '' : 'admin@siep.local')).trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'SiepAdmin2026!'));
  if (!email || !password) {
    console.warn('Admin account not created. Set ADMIN_EMAIL and ADMIN_PASSWORD to initialize one.');
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must contain at least 8 characters.');
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return;
  const record = await passwordRecord(password);
  db.prepare(`INSERT INTO users(name,email,phone,password_hash,password_salt,role)
    VALUES (?,?,?,?,?,'admin')`).run('ผู้ดูแลระบบ', email, '', record.hash, record.salt);
}
function bookingDto(row) {
  return { id: row.id, bookingNumber: row.booking_number, bookingCode: row.booking_code, visitDate: row.visit_date,
    people: row.people, purpose: row.purpose, status: row.status, createdAt: row.created_at,
    name: row.name, email: row.email, phone: row.phone };
}
function makeBookingCode() { return `SIEP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function nextBookingNumber(date) {
  const used = new Set(db.prepare("SELECT booking_number FROM bookings WHERE visit_date=? AND status!='cancelled'").all(date).map(row => row.booking_number));
  for (let number = 1; number <= VISIT_CAPACITY; number++) if (!used.has(number)) return number;
  return null;
}
function serveFile(res, file, type) {
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" });
    res.end(data);
  });
}
function contentPayload(body, type) {
  return {
    type,
    title: cleanText(body.title, 160, 'ชื่อเรื่อง', true),
    summary: cleanText(body.summary, 800, 'คำอธิบายสั้น'),
    body: cleanText(body.body, 12000, 'รายละเอียด'),
    image_url: cleanText(body.image_url, 600, 'ที่อยู่รูปภาพ'),
    category: cleanText(body.category, 120, 'หมวดหมู่'),
    date_text: cleanText(body.date_text, 120, 'วันและเวลา'),
    location: cleanText(body.location, 180, 'สถานที่'),
    sort_order: Math.max(0, Math.min(9999, Number.parseInt(body.sort_order, 10) || 0)),
    published: body.published === false || body.published === 0 || body.published === '0' ? 0 : 1
  };
}
function locationPayload(body) {
  return {
    name: cleanText(body.name, 160, 'ชื่อสถานที่', true),
    description: cleanText(body.description, 1200, 'รายละเอียด'),
    category: cleanText(body.category, 120, 'ประเภท'),
    image_url: cleanText(body.image_url, 600, 'ที่อยู่รูปภาพ'),
    sort_order: Math.max(0, Math.min(9999, Number.parseInt(body.sort_order, 10) || 0)),
    published: body.published === false || body.published === 0 || body.published === '0' ? 0 : 1
  };
}
async function handleApi(req, res, url, pathname) {
  if (req.method === 'GET' && pathname === '/api/site') return send(res, 200, publicData());
  if (req.method === 'GET' && pathname === '/api/public/locations') return send(res, 200, publicLocations());
  if (req.method === 'GET' && pathname.startsWith('/api/public/')) {
    const type = pathname.slice('/api/public/'.length);
    if (!resources.has(type)) return send(res, 404, { error: 'ไม่พบข้อมูล' });
    return send(res, 200, getContent(type));
  }
  if (pathname === '/api/auth/me' && req.method === 'GET') return send(res, 200, { user: userDto(currentUser(req)) });
  if (pathname === '/api/auth/demo' && req.method === 'GET') {
    const enabled = process.env.NODE_ENV !== 'production' && !process.env.ADMIN_EMAIL && !process.env.ADMIN_PASSWORD;
    return send(res, 200, { enabled, email: enabled ? 'admin@siep.local' : '', password: enabled ? 'SiepAdmin2026!' : '' });
  }
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readBody(req);
    const name = cleanText(body.name, 100, 'ชื่อ-นามสกุล', true);
    const email = cleanText(body.email, 180, 'อีเมล', true).toLowerCase();
    const phone = cleanText(body.phone, 30, 'เบอร์โทรศัพท์');
    const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw fail('รูปแบบอีเมลไม่ถูกต้อง');
    if (password.length < 8 || password.length > 100) throw fail('รหัสผ่านต้องมีความยาว 8–100 ตัวอักษร');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw fail('อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ', 409);
    const record = await passwordRecord(password);
    let result;
    try { result = db.prepare(`INSERT INTO users(name,email,phone,password_hash,password_salt,role) VALUES (?,?,?,?,?,'member')`).run(name, email, phone, record.hash, record.salt); }
    catch (error) { if (String(error.message).includes('UNIQUE')) throw fail('อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ', 409); throw error; }
    await createSession(Number(result.lastInsertRowid), req, res);
    return send(res, 201, { user: userDto(db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(Number(result.lastInsertRowid))) });
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = cleanText(body.email, 180, 'อีเมล', true).toLowerCase();
    const password = String(body.password || '');
    const row = db.prepare('SELECT id,name,email,phone,role,password_hash,password_salt FROM users WHERE email=?').get(email);
    if (!row) { await passwordRecord(password || 'invalid-password'); throw fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401); }
    const record = await passwordRecord(password, row.password_salt);
    const stored = Buffer.from(row.password_hash, 'hex');
    const provided = Buffer.from(record.hash, 'hex');
    if (stored.length !== provided.length || !crypto.timingSafeEqual(stored, provided)) throw fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
    await createSession(row.id, req, res);
    return send(res, 200, { user: userDto(row) });
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = getCookie(req, 'siep_session');
    if (/^[a-f0-9]{64}$/i.test(token)) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', req, true) });
  }
  if (pathname === '/api/bookings/availability' && req.method === 'GET') {
    const date = url.searchParams.get('date') || '';
    if (!validDate(date) || date < parkDate()) throw fail('เลือกวันที่ตั้งแต่วันนี้เป็นต้นไป');
    const visitors = db.prepare("SELECT COALESCE(SUM(people),0) AS n FROM bookings WHERE visit_date=? AND status!='cancelled'").get(date).n;
    return send(res, 200, { date, capacity: VISIT_CAPACITY, booked: visitors, remaining: Math.max(0, VISIT_CAPACITY - visitors) });
  }
  if (pathname === '/api/bookings' && req.method === 'POST') {
    const user = requireUser(req);
    const body = await readBody(req);
    const date = String(body.visitDate || '');
    if (!validDate(date) || date < parkDate()) throw fail('เลือกวันที่ตั้งแต่วันนี้เป็นต้นไป');
    const latestVisit = new Date(`${parkDate()}T00:00:00Z`);
    latestVisit.setUTCDate(latestVisit.getUTCDate() + 366);
    if (date > latestVisit.toISOString().slice(0, 10)) throw fail('เลือกวันเข้าชมภายใน 1 ปี');
    const people = Number(body.people);
    if (!Number.isInteger(people) || people < 1 || people > 20) throw fail('จำนวนผู้เข้าชมต้องอยู่ระหว่าง 1–20 คน');
    const purpose = cleanText(body.purpose, 300, 'หมายเหตุ');
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare("SELECT id FROM bookings WHERE user_id=? AND visit_date=? AND status!='cancelled'").get(user.id, date);
      if (existing) { db.exec('ROLLBACK'); throw fail('คุณมีรายการจองในวันที่เลือกแล้ว', 409); }
      const visitors = db.prepare("SELECT COALESCE(SUM(people),0) AS n FROM bookings WHERE visit_date=? AND status!='cancelled'").get(date).n;
      if (visitors + people > VISIT_CAPACITY) { db.exec('ROLLBACK'); throw fail(`วันที่เลือกเหลือที่ว่าง ${Math.max(0, VISIT_CAPACITY - visitors)} คน`, 409); }
      const bookingNumber = nextBookingNumber(date);
      if (!bookingNumber) { db.exec('ROLLBACK'); throw fail('คิวของวันที่เลือกเต็มแล้ว', 409); }
      const code = makeBookingCode();
      const inserted = db.prepare(`INSERT INTO bookings(user_id,visit_date,booking_number,people,purpose,booking_code)
        VALUES (?,?,?,?,?,?)`).run(user.id, date, bookingNumber, people, purpose, code);
      db.exec('COMMIT');
      const row = db.prepare(`SELECT b.*,u.name,u.email,u.phone FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.id=?`).get(Number(inserted.lastInsertRowid));
      return send(res, 201, { booking: bookingDto(row), capacity: VISIT_CAPACITY });
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }
  if (pathname === '/api/bookings/me' && req.method === 'GET') {
    const user = requireUser(req);
    const rows = db.prepare(`SELECT b.*,u.name,u.email,u.phone FROM bookings b JOIN users u ON u.id=b.user_id
      WHERE b.user_id=? ORDER BY b.visit_date DESC,b.booking_number DESC`).all(user.id);
    return send(res, 200, rows.map(bookingDto));
  }
  const cancelMatch = pathname.match(/^\/api\/bookings\/(\d+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    const user = requireUser(req);
    const result = db.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=? AND status!='cancelled'").run(Number(cancelMatch[1]), user.id);
    if (!result.changes) throw fail('ไม่พบรายการจองที่ยกเลิกได้', 404);
    return send(res, 200, { ok: true });
  }
  if (pathname.startsWith('/api/queue/')) {
    if (req.method === 'GET' && pathname === '/api/queue/status') {
      const visitorKey = url.searchParams.get('visitorKey') || '';
      if (visitorKey && !/^[a-f0-9-]{36}$/i.test(visitorKey)) throw fail('รหัสผู้เข้าชมไม่ถูกต้อง');
      return send(res, 200, queueStatus(visitorKey));
    }
    if (req.method === 'POST' && pathname === '/api/queue/tickets') {
      const visitorKey = String((await readBody(req)).visitorKey || '');
      if (!/^[a-f0-9-]{36}$/i.test(visitorKey)) throw fail('ไม่พบรหัสสำหรับรับคิว กรุณาลองใหม่');
      const date = parkDate();
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db.prepare('SELECT ticket_number FROM queue_tickets WHERE service_date=? AND visitor_key=?').get(date, visitorKey);
        if (existing) { db.exec('COMMIT'); return send(res, 200, { ...queueStatus(visitorKey), message: 'เบราว์เซอร์นี้รับคิววันนี้แล้ว' }); }
        const issued = db.prepare('SELECT COALESCE(MAX(ticket_number), 0) AS n FROM queue_tickets WHERE service_date=?').get(date).n;
        if (issued >= QUEUE_CAPACITY) { db.exec('COMMIT'); return send(res, 409, { ...queueStatus(), error: 'คิวกิจกรรมวันนี้เต็มแล้ว' }); }
        db.prepare('INSERT INTO queue_tickets (service_date,ticket_number,visitor_key) VALUES (?,?,?)').run(date, issued + 1, visitorKey);
        db.exec('COMMIT');
        return send(res, 201, { ...queueStatus(visitorKey), message: 'รับคิวเรียบร้อย' });
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    }
  }
  if (pathname.startsWith('/api/admin/')) {
    const admin = requireAdmin(req);
    if (req.method === 'POST' && pathname === '/api/admin/upload') {
      const body = await readBody(req);
      const mime = String(body.mime || '').toLowerCase();
      const fileTypes = { 'image/jpeg': { ext: '.jpg', valid: (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
        'image/png': { ext: '.png', valid: (data) => data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
        'image/webp': { ext: '.webp', valid: (data) => data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' } };
      const type = fileTypes[mime];
      const encoded = String(body.data || '');
      if (!type || !encoded || encoded.length > 7 * 1024 * 1024 || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) throw fail('เลือกไฟล์ JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB');
      const data = Buffer.from(encoded, 'base64');
      if (data.length > 5 * 1024 * 1024 || !type.valid(data)) throw fail('ไฟล์รูปภาพไม่ถูกต้อง หรือมีขนาดเกิน 5 MB');
      const filename = `${crypto.randomBytes(16).toString('hex')}${type.ext}`;
      await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), data, { flag: 'wx' });
      return send(res, 201, { imageUrl: `/uploads/${filename}` });
    }
    if (req.method === 'GET' && pathname === '/api/admin/summary') {
      const today = parkDate();
      const counts = {
        members: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='member'").get().n,
        bookings: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status!='cancelled'").get().n,
        locations: db.prepare('SELECT COUNT(*) AS n FROM locations').get().n,
        activities: db.prepare("SELECT COUNT(*) AS n FROM content WHERE type='activities'").get().n,
        learning: db.prepare("SELECT COUNT(*) AS n FROM content WHERE type='learning'").get().n
      };
      const todayBookings = db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(people),0) AS people FROM bookings WHERE visit_date=? AND status!='cancelled'").get(today);
      const recent = db.prepare(`SELECT b.*,u.name,u.email,u.phone FROM bookings b JOIN users u ON u.id=b.user_id
        ORDER BY b.created_at DESC,b.id DESC LIMIT 8`).all().map(bookingDto);
      return send(res, 200, { counts, today: { date: today, bookings: todayBookings.n, people: todayBookings.people, capacity: VISIT_CAPACITY }, recent, admin: userDto(admin) });
    }
    if (req.method === 'GET' && pathname === '/api/admin/bookings') {
      const rows = db.prepare(`SELECT b.*,u.name,u.email,u.phone FROM bookings b JOIN users u ON u.id=b.user_id
        ORDER BY b.visit_date DESC,b.booking_number`).all();
      return send(res, 200, rows.map(bookingDto));
    }
    const adminBookingMatch = pathname.match(/^\/api\/admin\/bookings\/(\d+)$/);
    if (adminBookingMatch && req.method === 'PATCH') {
      const body = await readBody(req);
      const status = String(body.status || '');
      if (!['pending','confirmed','cancelled'].includes(status)) throw fail('สถานะรายการจองไม่ถูกต้อง');
      const id = Number(adminBookingMatch[1]);
      const current = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
      if (!current) throw fail('ไม่พบรายการจอง', 404);
      if (status !== 'cancelled' && current.status === 'cancelled') {
        const capacityUsed = db.prepare("SELECT COALESCE(SUM(people),0) AS n FROM bookings WHERE visit_date=? AND status!='cancelled'").get(current.visit_date).n;
        if (capacityUsed + current.people > VISIT_CAPACITY) throw fail('จำนวนผู้เข้าชมของวันนั้นเต็มแล้ว', 409);
        const occupied = db.prepare("SELECT id FROM bookings WHERE visit_date=? AND booking_number=? AND status!='cancelled'").get(current.visit_date, current.booking_number);
        if (occupied) current.booking_number = nextBookingNumber(current.visit_date);
      }
      db.prepare('UPDATE bookings SET status=?,booking_number=? WHERE id=?').run(status, current.booking_number, id);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/admin/locations') return send(res, 200, db.prepare('SELECT * FROM locations ORDER BY sort_order,id DESC').all());
    if (req.method === 'POST' && pathname === '/api/admin/locations') {
      const item = locationPayload(await readBody(req));
      const result = db.prepare(`INSERT INTO locations(name,description,category,image_url,sort_order,published)
        VALUES (?,?,?,?,?,?)`).run(item.name,item.description,item.category,item.image_url,item.sort_order,item.published);
      return send(res, 201, { id: Number(result.lastInsertRowid) });
    }
    const locationMatch = pathname.match(/^\/api\/admin\/locations\/(\d+)$/);
    if (locationMatch && req.method === 'PUT') {
      const item = locationPayload(await readBody(req));
      const result = db.prepare(`UPDATE locations SET name=?,description=?,category=?,image_url=?,
        sort_order=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(item.name,item.description,item.category,item.image_url,
        item.sort_order,item.published,Number(locationMatch[1]));
      if (!result.changes) throw fail('ไม่พบสถานที่', 404);
      return send(res, 200, { ok: true });
    }
    if (locationMatch && req.method === 'DELETE') {
      const result = db.prepare('DELETE FROM locations WHERE id=?').run(Number(locationMatch[1]));
      if (!result.changes) throw fail('ไม่พบสถานที่', 404);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/admin/content') {
      const type = url.searchParams.get('type') || '';
      if (!managedTypes.has(type)) throw fail('เลือกหมวดข้อมูลไม่ถูกต้อง');
      return send(res, 200, db.prepare('SELECT * FROM content WHERE type=? ORDER BY sort_order,id DESC').all(type));
    }
    if (req.method === 'POST' && pathname === '/api/admin/content') {
      const body = await readBody(req);
      const type = String(body.type || '');
      if (!managedTypes.has(type)) throw fail('เลือกหมวดข้อมูลไม่ถูกต้อง');
      const item = contentPayload(body, type);
      const result = db.prepare(`INSERT INTO content(type,title,summary,body,image_url,category,date_text,location,sort_order,published)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(item.type,item.title,item.summary,item.body,item.image_url,item.category,item.date_text,item.location,item.sort_order,item.published);
      return send(res, 201, { id: Number(result.lastInsertRowid) });
    }
    const contentMatch = pathname.match(/^\/api\/admin\/content\/(\d+)$/);
    if (contentMatch && req.method === 'PUT') {
      const body = await readBody(req);
      const type = String(body.type || '');
      if (!managedTypes.has(type)) throw fail('เลือกหมวดข้อมูลไม่ถูกต้อง');
      const item = contentPayload(body, type);
      const result = db.prepare(`UPDATE content SET title=?,summary=?,body=?,image_url=?,category=?,
        date_text=?,location=?,sort_order=?,published=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND type=?`).run(item.title,item.summary,item.body,item.image_url,item.category,item.date_text,item.location,
        item.sort_order,item.published,Number(contentMatch[1]),item.type);
      if (!result.changes) throw fail('ไม่พบข้อมูล', 404);
      return send(res, 200, { ok: true });
    }
    if (contentMatch && req.method === 'DELETE') {
      const result = db.prepare("DELETE FROM content WHERE id=? AND type IN ('activities','learning')").run(Number(contentMatch[1]));
      if (!result.changes) throw fail('ไม่พบข้อมูล', 404);
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'ไม่พบ API นี้' });
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) return handleApi(req, res, url, pathname);
  if (pathname.startsWith('/uploads/')) {
    const filename = path.basename(pathname.slice('/uploads/'.length));
    const ext = path.extname(filename).toLowerCase();
    if (!filename || !MIME[ext] || !['.png','.jpg','.jpeg','.webp','.avif'].includes(ext)) { res.writeHead(404); return res.end('Not found'); }
    return serveFile(res, path.join(UPLOAD_DIR, filename), MIME[ext]);
  }
  const route = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(PUBLIC_DIR, '.' + route);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  serveFile(res, file, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
}

async function start() {
  await seedAdmin();
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'ระบบมีข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
      else res.destroy();
      if (!error.status) console.error(error);
    });
  });
  server.listen(PORT, '0.0.0.0', () => console.log(`Sirindhorn Park is running on port ${PORT} · visitor capacity ${VISIT_CAPACITY}`));
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
start().catch(error => { console.error(error); process.exitCode = 1; });
