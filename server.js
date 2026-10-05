use strict';
// ZİRVE HUB sunucusu: bağımlılıksız Node.js (22.5+) + yerleşik SQLite.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const PORT = process.env.PORT || 3000, SECURE = process.env.SECURE === '1';
const db = new DatabaseSync(process.env.DB || path.join(__dirname, 'zirve.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS roles(key TEXT PRIMARY KEY,name TEXT,perms TEXT,sys INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,full_name TEXT NOT NULL,username TEXT NOT NULL UNIQUE COLLATE NOCASE,pw TEXT NOT NULL,role TEXT NOT NULL,committee TEXT DEFAULT '',event TEXT DEFAULT '',status TEXT DEFAULT 'ACTIVE',must_change INTEGER DEFAULT 0,warn_level INTEGER DEFAULT 0,restricted INTEGER DEFAULT 0,cert_ok INTEGER DEFAULT 1,award_ok INTEGER DEFAULT 1,att_ok INTEGER DEFAULT 1,suspended_until INTEGER DEFAULT 0,created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY,uid INTEGER,expires INTEGER,ip TEXT);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,author INTEGER,body TEXT,img TEXT,status TEXT DEFAULT 'VISIBLE',created INTEGER);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY,post INTEGER,author INTEGER,body TEXT,status TEXT DEFAULT 'VISIBLE',created INTEGER);
CREATE TABLE IF NOT EXISTS likes(post INTEGER,uid INTEGER,PRIMARY KEY(post,uid));
CREATE TABLE IF NOT EXISTS warnings(id INTEGER PRIMARY KEY,uid INTEGER,level INTEGER,reason TEXT,issuer INTEGER,at INTEGER,revoked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS certs(id INTEGER PRIMARY KEY,uid INTEGER,type TEXT,issuer INTEGER,at INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor INTEGER,target INTEGER,action TEXT,reason TEXT,ip TEXT,at INTEGER);
CREATE TRIGGER IF NOT EXISTS audit_u BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_d BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit append-only'); END;
CREATE TRIGGER IF NOT EXISTS cert_block BEFORE INSERT ON certs WHEN (SELECT restricted FROM users WHERE id=NEW.uid)=1 BEGIN SELECT RAISE(ABORT,'DOCUMENT_ELIGIBILITY=BLOCKED'); END;`);

const ALL = ['users.manage', 'roles.manage', 'social.moderate', 'warnings.issue', 'discipline.lift', 'audit.read', 'certs.issue'];
[['SUPER_ADMIN', 'Süper Admin', ['*']], ['MECLIS_BASKANI', 'Meclis Başkanı', ['social.moderate', 'warnings.issue', 'audit.read', 'certs.issue']],
 ['GENEL_SEKRETER', 'Genel Sekreter', ['certs.issue']], ['KOMITE_BASKANI', 'Komite Başkanı', []], ['KOMITE_UYESI', 'Komite Üyesi', []],
 ['KATILIMCI', 'Katılımcı', []], ['PERSONEL', 'Personel', []]]
  .forEach(r => db.prepare('INSERT OR IGNORE INTO roles VALUES(?,?,?,1)').run(r[0], r[1], JSON.stringify(r[2])));

const q = (s, ...a) => db.prepare(s).all(...a), one = (s, ...a) => db.prepare(s).get(...a), run = (s, ...a) => db.prepare(s).run(...a);
const now = () => Date.now(), sha = t => crypto.createHash('sha256').update(t).digest('hex');
const hash = pw => { const s = crypto.randomBytes(16); return 's1:' + s.toString('hex') + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const verify = (pw, h) => { const [, s, x] = h.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(x, 'hex')); };
const DUMMY = hash('x-dummy');
class HttpErr extends Error { constructor(c, m, x) { super(m); this.c = c; this.x = x; } }
const bad = (m, c = 400, x) => { throw new HttpErr(c, m, x); };
const tx = f => { db.exec('BEGIN IMMEDIATE'); try { const r = f(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const log = (req, actor, target, action, reason) => run('INSERT INTO audit(actor,target,action,reason,ip,at) VALUES(?,?,?,?,?,?)', actor, target || null, action, reason || '', req.ip, now());
const permsOf = r => { const x = one('SELECT perms FROM roles WHERE key=?', r); return x ? JSON.parse(x.perms) : []; };
const can = (u, p) => u.perms.includes('*') || u.perms.includes(p);
const need = (u, p) => { if (!can(u, p)) bad('Bu işlem için yetkin yok.', 403); };
const isSuper = u => u.perms.includes('*');
const reasonOf = b => { const r = String(b.reason || '').trim(); if (!r) bad('Gerekçe zorunlu.'); return r.slice(0, 500); };

function auth(req) {
  const m = /(?:^|; )sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); if (!m) return null;
  const s = one('SELECT * FROM sessions WHERE th=?', sha(m[1])); if (!s || s.expires < now()) return null;
  const u = one('SELECT * FROM users WHERE id=?', s.uid); if (!u || u.status !== 'ACTIVE') return null;
  run('UPDATE sessions SET expires=? WHERE th=?', now() + 12 * 36e5, s.th);
  u.perms = permsOf(u.role); u.th = s.th; return u;
}
const meOf = u => ({ id: u.id, full_name: u.full_name, username: u.username, role: u.role, committee: u.committee, event: u.event, must_change: !!u.must_change, perms: u.perms, warn_level: u.warn_level, restricted: !!u.restricted, cert_ok: !!u.cert_ok, award_ok: !!u.award_ok, att_ok: !!u.att_ok, suspended_until: u.suspended_until });
function mkUser(b, role) {
  const fn = String(b.full_name || '').trim(), un = String(b.username || '').trim(), pw = String(b.password || '');
  if (!fn || !un) bad('Ad soyad ve kullanıcı adı zorunlu.'); if (pw.length < 8) bad('Şifre en az 8 karakter olmalı.');
  if (!one('SELECT 1 x FROM roles WHERE key=?', role)) bad('Geçersiz rol.');
  if (one('SELECT 1 x FROM users WHERE username=?', un)) bad('Bu kullanıcı adı kullanılıyor.', 409);
  return Number(run('INSERT INTO users(full_name,username,pw,role,committee,event,status,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    fn.slice(0, 80), un.slice(0, 60), hash(pw), role, String(b.committee || '').slice(0, 60), String(b.event || '').slice(0, 60), b.status === 'PASSIVE' ? 'PASSIVE' : 'ACTIVE', b.must_change === false ? 0 : 1, now()).lastInsertRowid);
}
const target = id => { const t = one("SELECT * FROM users WHERE id=? AND status!='DELETED'", Number(id)); if (!t) bad('Kullanıcı bulunamadı.', 404); return t; };
const canTouch = (u, t) => { if (t.role === 'SUPER_ADMIN' && !isSuper(u)) bad('Bu kullanıcı üzerinde yetkin yok.', 403); };
const canSocial = u => { if (u.restricted) bad('Sosyal medya erişimin kısıtlandı.', 403); if (u.suspended_until > now()) bad('Sosyal medya kullanımın geçici olarak durduruldu.', 403); };

const R = [], r = (m, p, f, pub) => R.push([m, new RegExp('^' + p + '$'), f, pub]);
const fails = new Map();
r('GET', '/api/state', () => ({ setup: !one('SELECT 1 x FROM users') }), 1);
r('POST', '/api/setup', ({ b, req }) => {
  if (one('SELECT 1 x FROM users')) bad('Kurulum tamamlanmış.', 403);
  const id = mkUser({ ...b, must_change: false }, 'SUPER_ADMIN'); log(req, id, id, 'Kullanıcı oluşturuldu', 'İlk kurulum'); return { ok: 1 };
}, 1);
r('POST', '/api/login', ({ b, req }) => {
  const un = String(b.username || '').trim(), k = req.ip + '|' + un.toLowerCase(), f = fails.get(k);
  if (f && f.until > now()) bad('Çok fazla deneme. Birkaç dakika sonra tekrar dene.', 429);
  const u = one('SELECT * FROM users WHERE username=?', un), ok = verify(String(b.password || ''), u ? u.pw : DUMMY);
  if (!u || !ok || u.status !== 'ACTIVE') { const n = (f ? f.n : 0) + 1; fails.set(k, { n, until: n >= 5 ? now() + 3e5 : 0 }); bad('Kullanıcı adı veya şifre hatalı.', 401); }
  fails.delete(k); const t = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions VALUES(?,?,?,?)', sha(t), u.id, now() + 12 * 36e5, req.ip);
  req.setCookie = `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${SECURE ? '; Secure' : ''}`;
  u.perms = permsOf(u.role); return meOf(u);
}, 1);
r('POST', '/api/logout', ({ u, req }) => { run('DELETE FROM sessions WHERE th=?', u.th); req.setCookie = 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'; return { ok: 1 }; });
r('GET', '/api/me', ({ u }) => meOf(u));
r('POST', '/api/me/password', ({ u, b, req }) => {
  if (!verify(String(b.old || ''), u.pw)) bad('Mevcut şifre hatalı.', 403);
  const n = String(b.new || ''); if (n.length < 8) bad('Yeni şifre en az 8 karakter olmalı.');
  run('UPDATE users SET pw=?,must_change=0 WHERE id=?', hash(n), u.id); run('DELETE FROM sessions WHERE uid=? AND th!=?', u.id, u.th);
  log(req, u.id, u.id, 'Şifre değiştirildi'); return { ok: 1 };
});
r('GET', '/api/roles', () => q('SELECT key,name,perms FROM roles').map(x => ({ ...x, perms: JSON.parse(x.perms) })));
r('POST', '/api/admin/roles', ({ u, b, req }) => {
  need(u, 'roles.manage'); const key = String(b.key || '').trim().toUpperCase(), perms = Array.isArray(b.perms) ? b.perms.filter(p => ALL.includes(p)) : [];
  if (!/^[A-Z_]{3,30}$/.test(key)) bad('Rol anahtarı 3-30 büyük harf/alt çizgi olmalı.'); if (one('SELECT 1 x FROM roles WHERE key=?', key)) bad('Bu rol var.', 409);
  if (perms.includes('discipline.lift') && !isSuper(u)) bad('Bu izni yalnızca süper admin verebilir.', 403);
  run('INSERT INTO roles VALUES(?,?,?,0)', key, String(b.name || key).slice(0, 60), JSON.stringify(perms)); log(req, u.id, null, 'Rol oluşturuldu', key); return { ok: 1 };
});
// --- Kullanıcı yönetimi
r('GET', '/api/admin/users', ({ u }) => { need(u, 'users.manage'); return q("SELECT id,full_name,username,role,committee,event,status,warn_level,restricted FROM users WHERE status!='DELETED' ORDER BY id"); });
r('POST', '/api/admin/users', ({ u, b, req }) => {
  need(u, 'users.manage'); if (b.role === 'SUPER_ADMIN' && !isSuper(u)) bad('Süper admin oluşturamazsın.', 403);
  const id = mkUser(b, String(b.role || '')); log(req, u.id, id, 'Kullanıcı oluşturuldu', b.role); return { id };
});
r('PATCH', '/api/admin/users/(\\d+)', ({ u, b, req, p }) => {
  need(u, 'users.manage'); const t = target(p[0]); canTouch(u, t);
  if (t.id === u.id && ((b.role && b.role !== t.role) || (b.committee !== undefined && b.committee !== t.committee) || (b.status && b.status !== 'ACTIVE'))) bad('Kendi rolünü, komitenı veya durumunu değiştiremezsin.', 403);
  if (b.role && b.role !== t.role) { if (!one('SELECT 1 x FROM roles WHERE key=?', b.role)) bad('Geçersiz rol.'); if (b.role === 'SUPER_ADMIN' && !isSuper(u)) bad('Yetkin yok.', 403); }
  const n = { full_name: String(b.full_name ?? t.full_name).trim().slice(0, 80) || t.full_name, role: b.role || t.role, committee: String(b.committee ?? t.committee).slice(0, 60), event: String(b.event ?? t.event).slice(0, 60), status: b.status === 'PASSIVE' ? 'PASSIVE' : b.status === 'ACTIVE' ? 'ACTIVE' : t.status };
  run('UPDATE users SET full_name=?,role=?,committee=?,event=?,status=? WHERE id=?', n.full_name, n.role, n.committee, n.event, n.status, t.id);
  if (n.role !== t.role) log(req, u.id, t.id, 'Rol değiştirildi', `${t.role} → ${n.role}`);
  if (n.committee !== t.committee) log(req, u.id, t.id, 'Komite değiştirildi', `${t.committee} → ${n.committee}`);
  if (n.status !== t.status) { log(req, u.id, t.id, n.status === 'PASSIVE' ? 'Hesap pasife alındı' : 'Hesap aktifleştirildi'); if (n.status === 'PASSIVE') run('DELETE FROM sessions WHERE uid=?', t.id); }
  return { ok: 1 };
});
r('POST', '/api/admin/users/(\\d+)/reset-password', ({ u, b, req, p }) => {
  need(u, 'users.manage'); const t = target(p[0]); canTouch(u, t); const pw = String(b.password || ''); if (pw.length < 8) bad('Şifre en az 8 karakter olmalı.');
  run('UPDATE users SET pw=?,must_change=1 WHERE id=?', hash(pw), t.id); run('DELETE FROM sessions WHERE uid=?', t.id); log(req, u.id, t.id, 'Şifre değiştirildi', 'Yönetici sıfırladı'); return { ok: 1 };
});
r('DELETE', '/api/admin/users/(\\d+)', ({ u, req, p }) => {
  need(u, 'users.manage'); const t = target(p[0]); canTouch(u, t); if (t.id === u.id) bad('Kendini silemezsin.', 403);
  run("UPDATE users SET status='DELETED' WHERE id=?", t.id); run('DELETE FROM sessions WHERE uid=?', t.id); log(req, u.id, t.id, 'Kullanıcı silindi'); return { ok: 1 };
});
r('GET', '/api/admin/users/(\\d+)', ({ u, p }) => {
  if (!can(u, 'users.manage') && !can(u, 'social.moderate')) bad('Bu işlem için yetkin yok.', 403); const t = target(p[0]); const id = t.id;
  return { user: { id, full_name: t.full_name, username: t.username, role: t.role, committee: t.committee, event: t.event, status: t.status, warn_level: t.warn_level, restricted: !!t.restricted, cert_ok: !!t.cert_ok, award_ok: !!t.award_ok, att_ok: !!t.att_ok, suspended_until: t.suspended_until },
    posts: q("SELECT id,body,status,created FROM posts WHERE author=? ORDER BY id DESC LIMIT 50", id), comments: q("SELECT id,body,status,created FROM comments WHERE author=? ORDER BY id DESC LIMIT 50", id),
    warnings: q('SELECT w.id,w.level,w.reason,w.at,w.revoked,i.full_name issuer FROM warnings w JOIN users i ON i.id=w.issuer WHERE w.uid=? ORDER BY w.id', id), certs: q('SELECT id,type,at FROM certs WHERE uid=?', id),
    audit: can(u, 'audit.read') ? q('SELECT a.action,a.reason,a.at,x.full_name actor FROM audit a LEFT JOIN users x ON x.id=a.actor WHERE a.target=? ORDER BY a.id DESC LIMIT 50', id) : [] };
});
// --- Sosyal alan
r('GET', '/api/posts', ({ u, url }) => {
  const rows = q(`SELECT p.id,p.body,p.img,p.created,a.id aid,a.full_name,a.role,a.committee,(SELECT COUNT(*) FROM likes WHERE post=p.id) likes,(SELECT COUNT(*) FROM comments WHERE post=p.id AND status='VISIBLE') cmts,(SELECT COUNT(*) FROM likes WHERE post=p.id AND uid=?) liked FROM posts p JOIN users a ON a.id=p.author WHERE p.status='VISIBLE' AND a.status!='DELETED' ORDER BY p.id DESC LIMIT 100`, u.id);
  if (url.searchParams.get('sort') === 'popular') rows.sort((x, y) => (y.likes * 2 + y.cmts) - (x.likes * 2 + x.cmts) || y.id - x.id);
  const ids = rows.map(x => x.id).join(','), cs = ids ? q(`SELECT c.id,c.post,c.body,c.created,c.author,a.full_name FROM comments c JOIN users a ON a.id=c.author WHERE c.status='VISIBLE' AND c.post IN (${ids}) ORDER BY c.id`) : [];
  return rows.map(x => ({ ...x, liked: !!x.liked, comments: cs.filter(c => c.post === x.id) }));
});
r('POST', '/api/posts', ({ u, b, req }) => {
  canSocial(u); const body = String(b.body || '').trim().slice(0, 1000), img = b.img ? String(b.img) : null;
  if (img && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 1.4e6)) bad('Geçersiz veya çok büyük görsel (en fazla ~1 MB).');
  if (!body && !img) bad('Boş gönderi paylaşılamaz.');
  const id = Number(run('INSERT INTO posts(author,body,img,created) VALUES(?,?,?,?)', u.id, body, img, now()).lastInsertRowid); log(req, u.id, u.id, 'Gönderi oluşturuldu', '#' + id); return { id };
});
r('DELETE', '/api/posts/(\\d+)', ({ u, req, p }) => {
  const x = one('SELECT * FROM posts WHERE id=? AND author=? AND status=?', Number(p[0]), u.id, 'VISIBLE'); if (!x) bad('Gönderi bulunamadı.', 404);
  run("UPDATE posts SET status='REMOVED' WHERE id=?", x.id); log(req, u.id, u.id, 'Gönderi silindi', '#' + x.id + ' (sahibi)'); return { ok: 1 };
});
r('POST', '/api/posts/(\\d+)/like', ({ u, p }) => {
  canSocial(u); const id = Number(p[0]); if (!one("SELECT 1 x FROM posts WHERE id=? AND status='VISIBLE'", id)) bad('Gönderi bulunamadı.', 404);
  if (one('SELECT 1 x FROM likes WHERE post=? AND uid=?', id, u.id)) run('DELETE FROM likes WHERE post=? AND uid=?', id, u.id); else run('INSERT INTO likes VALUES(?,?)', id, u.id); return { ok: 1 };
});
r('POST', '/api/posts/(\\d+)/comments', ({ u, b, p }) => {
  canSocial(u); const id = Number(p[0]), body = String(b.body || '').trim().slice(0, 500); if (!body) bad('Yorum boş olamaz.');
  if (!one("SELECT 1 x FROM posts WHERE id=? AND status='VISIBLE'", id)) bad('Gönderi bulunamadı.', 404); run('INSERT INTO comments(post,author,body,created) VALUES(?,?,?,?)', id, u.id, body, now()); return { ok: 1 };
});
r('DELETE', '/api/comments/(\\d+)', ({ u, req, p }) => {
  const x = one("SELECT * FROM comments WHERE id=? AND author=? AND status='VISIBLE'", Number(p[0]), u.id); if (!x) bad('Yorum bulunamadı.', 404);
  run("UPDATE comments SET status='REMOVED' WHERE id=?", x.id); log(req, u.id, u.id, 'Yorum silindi', '#' + x.id + ' (sahibi)'); return { ok: 1 };
});
r('GET', '/api/profile/(\\d+)', ({ p }) => {
  const t = target(p[0]); return { id: t.id, full_name: t.full_name, role: t.role, committee: t.committee, posts: q("SELECT id,body,img,created FROM posts WHERE author=? AND status='VISIBLE' ORDER BY id DESC LIMIT 30", t.id) };
});
r('GET', '/api/me/warnings', ({ u }) => q('SELECT level,reason,at,revoked FROM warnings WHERE uid=? ORDER BY id', u.id));
r('GET', '/api/me/certs', ({ u }) => q('SELECT id,type,at FROM certs WHERE uid=? ORDER BY id', u.id));
// --- Moderasyon ve disiplin
r('GET', '/api/admin/social', ({ u }) => {
  need(u, 'social.moderate');
  return { posts: q("SELECT p.id,p.body,p.created,a.id aid,a.full_name FROM posts p JOIN users a ON a.id=p.author WHERE p.status='VISIBLE' ORDER BY p.id DESC LIMIT 100"),
    comments: q("SELECT c.id,c.body,c.created,c.post,a.id aid,a.full_name FROM comments c JOIN users a ON a.id=c.author WHERE c.status='VISIBLE' ORDER BY c.id DESC LIMIT 100") };
});
for (const [tbl, path_, label] of [['posts', 'posts', 'Gönderi silindi'], ['comments', 'comments', 'Yorum silindi']])
  r('POST', `/api/admin/${path_}/(\\d+)/remove`, ({ u, b, req, p }) => {
    need(u, 'social.moderate'); const reason = reasonOf(b), x = one(`SELECT * FROM ${tbl} WHERE id=? AND status='VISIBLE'`, Number(p[0])); if (!x) bad('Kayıt bulunamadı.', 404);
    run(`UPDATE ${tbl} SET status='REMOVED' WHERE id=?`, x.id); log(req, u.id, x.author, label, `#${x.id}: ${reason}`); return { ok: 1 };
  });
r('POST', '/api/admin/users/(\\d+)/warn', ({ u, b, req, p }) => {
  need(u, 'warnings.issue'); const t = target(p[0]); canTouch(u, t); const reason = reasonOf(b);
  return tx(() => {
    const lvl = one('SELECT COUNT(*) c FROM warnings WHERE uid=? AND revoked=0', t.id).c + 1;
    run('INSERT INTO warnings(uid,level,reason,issuer,at) VALUES(?,?,?,?,?)', t.id, lvl, reason, u.id, now()); run('UPDATE users SET warn_level=? WHERE id=?', lvl, t.id);
    log(req, u.id, t.id, 'Uyarı verildi', `${lvl}. uyarı: ${reason}`);
    if (lvl >= 3) {
      run('UPDATE users SET restricted=1,cert_ok=0,award_ok=0,att_ok=0 WHERE id=?', t.id);
      if (lvl === 3) log(req, u.id, t.id, '3. uyarıya ulaşıldı', 'SOCIAL_MEDIA_WARNING_LEVEL=3');
      log(req, u.id, t.id, 'Sosyal medya kısıtlaması uygulandı', reason); log(req, u.id, t.id, 'Sertifika engellendi', 'DOCUMENT_ELIGIBILITY=BLOCKED');
    }
    return { level: lvl, restricted: lvl >= 3 };
  });
});
r('POST', '/api/admin/warnings/(\\d+)/revoke', ({ u, b, req, p }) => {
  need(u, 'warnings.issue'); const reason = reasonOf(b), w = one('SELECT * FROM warnings WHERE id=? AND revoked=0', Number(p[0])); if (!w) bad('Uyarı bulunamadı.', 404);
  canTouch(u, target(w.uid));
  return tx(() => { run('UPDATE warnings SET revoked=1 WHERE id=?', w.id); run('UPDATE users SET warn_level=(SELECT COUNT(*) FROM warnings WHERE uid=? AND revoked=0) WHERE id=?', w.uid, w.uid); log(req, u.id, w.uid, 'Uyarı kaldırıldı', `${w.level}. uyarı: ${reason}`); return { ok: 1 }; });
});
r('POST', '/api/admin/users/(\\d+)/lift', ({ u, b, req, p }) => {
  need(u, 'discipline.lift'); const t = target(p[0]), reason = reasonOf(b); if (!t.restricted) bad('Kullanıcıda disiplin kısıtlaması yok.');
  tx(() => { run('UPDATE users SET restricted=0,cert_ok=1,award_ok=1,att_ok=1 WHERE id=?', t.id); log(req, u.id, t.id, 'Sertifika kısıtlaması kaldırıldı', reason); }); return { ok: 1 };
});
r('POST', '/api/admin/users/(\\d+)/suspend', ({ u, b, req, p }) => {
  need(u, 'social.moderate'); const t = target(p[0]); canTouch(u, t); const reason = reasonOf(b), days = Math.max(0, Math.min(30, Number(b.days) || 0));
  run('UPDATE users SET suspended_until=? WHERE id=?', days ? now() + days * 864e5 : 0, t.id); log(req, u.id, t.id, days ? 'Sosyal medya geçici yasağı' : 'Sosyal medya yasağı kaldırıldı', `${days} gün: ${reason}`); return { ok: 1 };
});
r('POST', '/api/admin/certs', ({ u, b, req }) => {
  need(u, 'certs.issue'); const t = one("SELECT * FROM users WHERE id=? AND status='ACTIVE'", Number(b.user_id)); if (!t) bad('Kullanıcı bulunamadı.', 404);
  const type = ['KATILIM', 'BASARI', 'ODUL'].includes(b.type) ? b.type : 'KATILIM';
  const ok = !t.restricted && t.cert_ok && (type === 'KATILIM' ? t.att_ok : type === 'ODUL' ? t.award_ok : true);
  if (!ok) { log(req, u.id, t.id, 'Sertifika engellendi', `${type}: DOCUMENT_ELIGIBILITY=BLOCKED`); bad('Belge oluşturulamaz: kullanıcının uygunluğu ENGELLENDİ.', 403, { DOCUMENT_ELIGIBILITY: 'BLOCKED' }); }
  run('INSERT INTO certs(uid,type,issuer,at) VALUES(?,?,?,?)', t.id, type, u.id, now()); log(req, u.id, t.id, 'Sertifika oluşturuldu', type); return { ok: 1 };
});
r('GET', '/api/admin/audit', ({ u, url }) => {
  need(u, 'audit.read'); const t = Number(url.searchParams.get('user')) || null;
  return q(`SELECT a.id,a.action,a.reason,a.ip,a.at,x.full_name actor,y.full_name target FROM audit a LEFT JOIN users x ON x.id=a.actor LEFT JOIN users y ON y.id=a.target ${t ? 'WHERE a.target=' + t : ''} ORDER BY a.id DESC LIMIT 300`);
});

// --- HTTP
const HDR = { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' };
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const body = req => new Promise((res, rej) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > 3e6) { rej(new HttpErr(413, 'İstek çok büyük.')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { res(c.length ? JSON.parse(Buffer.concat(c)) : {}); } catch { rej(new HttpErr(400, 'Geçersiz JSON.')); } }); });
const send = (res, code, o, req) => {
  if (res.headersSent) return;
  const h = { ...HDR, 'Content-Type': 'application/json; charset=utf-8' };
  if (req && req.setCookie) h['Set-Cookie'] = req.setCookie;
  res.writeHead(code, h);
  res.end(JSON.stringify(o));
};

http.createServer(async (req, res) => {
  req.ip = req.socket.remoteAddress; 
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/')) {
      const f = FILES[url.pathname]; 
      if (!f) { 
        if (!res.headersSent) res.writeHead(404, HDR); 
        return res.end('Not found'); 
      }
      if (!res.headersSent) res.writeHead(200, { ...HDR, 'Content-Type': f[1] }); 
      return res.end(fs.readFileSync(path.join(__dirname, 'public', f[0])));
    }
    if (req.method !== 'GET' && req.headers['x-zh'] !== '1') bad('Geçersiz istek.', 403);
    const hit = R.find(x => x[0] === req.method && x[1].test(url.pathname)); 
    if (!hit) bad('Bulunamadı.', 404);
    const u = auth(req); 
    if (!hit[3] && !u) bad('Oturum gerekli.', 401);
    if (u && u.must_change && !['/api/me', '/api/me/password', '/api/logout'].includes(url.pathname)) bad('Önce şifreni değiştirmelisin.', 403, { must_change: true });
    const b = req.method === 'GET' ? {} : await body(req), m = hit[1].exec(url.pathname);
    return send(res, 200, hit[2]({ u, b, req, url, p: m.slice(1) }), req);
  } catch (e) { 
    if (res.headersSent) return;
    if (e instanceof HttpErr) {
      return send(res, e.c, { error: e.message, ...e.x }, req);
    } else { 
      console.error(e); 
      return send(res, 500, { error: 'Sunucu hatası.' }, req); 
    } 
  }
}).listen(PORT, () => console.log(`ZİRVE HUB http://localhost:${PORT}`));
