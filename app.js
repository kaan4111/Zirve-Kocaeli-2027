'use strict';
const $ = s => document.querySelector(s);
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PERMS = { 'users.manage': 'Kullanıcı yönetimi', 'roles.manage': 'Rol yönetimi', 'social.moderate': 'Sosyal moderasyon', 'warnings.issue': 'Uyarı verme', 'discipline.lift': 'Kısıtlama kaldırma', 'audit.read': 'Audit log okuma', 'certs.issue': 'Belge oluşturma' };
const TYPES = { KATILIM: 'Katılım belgesi', BASARI: 'Başarı belgesi', ODUL: 'Ödül' };
let me = null, view = 'feed', arg = null, roles = [], sort = 'recent';
const has = p => me.perms.includes('*') || me.perms.includes(p);
const roleName = k => (roles.find(r => r.key === k) || {}).name || k;
const dt = t => new Date(t).toLocaleString('tr-TR');
const ago = t => { const s = (Date.now() - t) / 1e3 | 0; return s < 60 ? 'şimdi' : s < 3600 ? (s / 60 | 0) + ' dk önce' : s < 86400 ? (s / 3600 | 0) + ' saat önce' : new Date(t).toLocaleDateString('tr-TR'); };
async function api(m, p, b) {
  const r = await fetch('/api' + p, { method: m, headers: { 'X-ZH': '1', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Hata'); e.status = r.status; e.data = j; throw e; } return j;
}
let tt; function toast(t) { const x = $('#toast'); x.textContent = t; x.style.display = 'block'; clearTimeout(tt); tt = setTimeout(() => x.style.display = 'none', 3500); }

async function boot() {
  try { me = await api('GET', '/me'); } catch { const s = await api('GET', '/state'); return authScreen(s.setup); }
  if (me.must_change) return pwScreen();
  roles = await api('GET', '/roles'); shell(); go(view === 'feed' ? 'feed' : view, arg);
}
function authScreen(setup) {
  $('#app').innerHTML = `<div class="auth"><div class="logo">ZİRVE HUB<small>${setup ? 'İlk kurulum: yönetici hesabını oluştur' : 'Kocaeli Zirve’27'}</small></div><form class="card" id="af">
  ${setup ? '<label for="fn">Ad Soyad</label><input id="fn" required autocomplete="name">' : ''}
  <label for="un">${setup ? 'Kullanıcı adı' : 'Ad / Kullanıcı adı'}</label><input id="un" required autocomplete="username">
  <label for="pw">Şifre${setup ? ' (en az 8 karakter)' : ''}</label><input id="pw" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}">
  <div class="err" id="ae" role="alert"></div><button class="btn" style="width:100%">${setup ? 'Yönetici hesabını oluştur' : 'Giriş Yap'}</button></form></div>`;
  $('#af').onsubmit = async e => {
    e.preventDefault(); try {
      if (setup) await api('POST', '/setup', { full_name: $('#fn').value, username: $('#un').value, password: $('#pw').value });
      await api('POST', '/login', { username: $('#un').value, password: $('#pw').value }); boot();
    } catch (x) { $('#ae').textContent = x.message; }
  };
}
function pwScreen() {
  $('#app').innerHTML = `<div class="auth"><div class="logo">Şifreni değiştir<small>${me.must_change ? 'Devam etmeden önce yeni bir şifre belirle.' : ''}</small></div><form class="card" id="pf">
  <label for="po">Mevcut şifre</label><input id="po" type="password" required autocomplete="current-password"><label for="pn">Yeni şifre (en az 8 karakter)</label><input id="pn" type="password" required autocomplete="new-password">
  <div class="err" id="pe" role="alert"></div><button class="btn" style="width:100%">Kaydet</button></form></div>`;
  $('#pf').onsubmit = async e => { e.preventDefault(); try { await api('POST', '/me/password', { old: $('#po').value, new: $('#pn').value }); me.must_change = false; boot(); } catch (x) { $('#pe').textContent = x.message; } };
}
function shell() {
  const NAV = [['feed', 'ZİRVE SOSYAL'], ['me', 'Profilim'], ['users', 'Kullanıcılar', 'users.manage'], ['mod', 'Sosyal Medya Yönetimi', 'social.moderate'], ['certs', 'Belgeler', 'certs.issue'], ['roles', 'Roller', 'roles.manage'], ['audit', 'Audit Logs', 'audit.read']];
  $('#app').innerHTML = `<div class="top"><b>ZİRVE HUB</b><button id="hb" aria-label="Menü">☰</button></div><div class="shell"><aside id="side"><div class="logo">ZİRVE HUB<small>Kocaeli Zirve’27</small></div>
  ${NAV.filter(n => !n[2] || has(n[2])).map(n => `<a data-a="nav" data-v="${n[0]}" id="n-${n[0]}">${n[1]}</a>`).join('')}<a data-a="logout">Çıkış yap</a>
  <div class="who">${E(me.full_name)}${me.restricted ? ' <span class="warn">❗</span>' : ''}<br>${E(roleName(me.role))}${me.committee ? ' · ' + E(me.committee) : ''}</div></aside><main id="main"></main></div>`;
  $('#hb').onclick = () => $('#side').classList.toggle('open');
}
async function go(v, a) {
  view = v; arg = a || null; const s = $('#side'); if (s) s.classList.remove('open');
  document.querySelectorAll('aside a').forEach(x => x.classList.toggle('on', x.id === 'n-' + (v === 'user' ? 'users' : v === 'prof' ? 'feed' : v)));
  try { $('#main').innerHTML = await V[v](a); } catch (e) { if (e.status === 401) return boot(); $('#main').innerHTML = `<div class="alert">${E(e.message)}</div>`; }
}
const refresh = () => go(view, arg);
const reason = t => { const r = prompt(t || 'Gerekçe:'); if (!r || !r.trim()) throw new Error('İşlem iptal edildi (gerekçe gerekli).'); return r.trim(); };
const stTag = u => u.restricted ? '<span class="tag bad">Kısıtlı</span>' : u.status === 'ACTIVE' ? '<span class="tag ok">Aktif</span>' : '<span class="tag">Pasif</span>';
const warnCell = u => u.restricted ? `<span class="warn">${u.warn_level} ❗</span>` : u.warn_level;
const elig = v => v ? '<span class="tag ok">Uygun</span>' : '<span class="tag bad">ENGELLENDİ</span>';

function postHtml(p) {
  return `<article class="card post"><div class="head"><div class="av">${E(p.full_name[0])}</div><div><a data-a="prof" data-id="${p.aid}"><b>${E(p.full_name)}</b></a><div class="mut">${E(roleName(p.role))}${p.committee ? ' · ' + E(p.committee) : ''} · ${ago(p.created)}</div></div></div>
  ${p.body ? `<p>${E(p.body)}</p>` : ''}${p.img ? `<img src="${E(p.img)}" alt="Gönderi görseli">` : ''}
  <div class="row" style="margin-top:8px"><button class="btn sm g" data-a="like" data-id="${p.id}">${p.liked ? '♥' : '♡'} ${p.likes}</button><span class="mut">💬 ${p.cmts}</span>${p.aid === me.id ? `<button class="btn sm r" data-a="delpost" data-id="${p.id}" style="margin-left:auto">Sil</button>` : ''}</div>
  ${p.comments.map(c => `<div class="cm"><b>${E(c.full_name)}</b> ${E(c.body)}${c.author === me.id ? ` <a data-a="delcm" data-id="${c.id}" class="mut">sil</a>` : ''}</div>`).join('')}
  <div class="row" style="margin-top:8px"><input class="grow" id="c${p.id}" maxlength="500" placeholder="Yorum yaz…" aria-label="Yorum"><button class="btn sm" data-a="comment" data-id="${p.id}">Gönder</button></div></article>`;
}
const V = {
  async feed() {
    const ps = await api('GET', '/posts?sort=' + sort), d = me.restricted ? 'disabled' : '';
    return `<h1>ZİRVE SOSYAL</h1>${me.restricted ? '<div class="alert">❗ Disiplin kısıtlaman nedeniyle gönderi, yorum ve beğeni özelliklerin kapalı.</div>' : ''}
    <div class="card"><textarea id="pb" maxlength="1000" placeholder="Ne paylaşmak istersin?" aria-label="Gönderi" ${d}></textarea><div class="row" style="margin-top:8px"><input class="grow" id="pi" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Fotoğraf" ${d}><button class="btn" data-a="post" ${d}>+ Gönderi Oluştur</button></div></div>
    <div class="row" style="margin-bottom:12px"><button class="btn sm ${sort === 'recent' ? '' : 'g'}" data-a="sort" data-v="recent">En yeni</button><button class="btn sm ${sort === 'popular' ? '' : 'g'}" data-a="sort" data-v="popular">Popüler</button></div>
    ${ps.map(postHtml).join('') || '<div class="card mut">Henüz gönderi yok.</div>'}`;
  },
  async prof(id) {
    if (id === me.id) return V.me(); const p = await api('GET', '/profile/' + id);
    return `<h1>${E(p.full_name)}</h1><div class="card">${E(roleName(p.role))}${p.committee ? ' · ' + E(p.committee) : ''}</div><h2>Gönderiler</h2>${p.posts.map(x => `<div class="card post"><div class="mut">${ago(x.created)}</div>${x.body ? `<p>${E(x.body)}</p>` : ''}${x.img ? `<img src="${E(x.img)}" alt="">` : ''}</div>`).join('') || '<div class="card mut">Gönderi yok.</div>'}`;
  },
  async me() {
    const [w, c] = await Promise.all([api('GET', '/me/warnings'), api('GET', '/me/certs')]);
    return `<h1>Profilim ${me.restricted ? '<span class="warn">❗</span>' : ''}</h1>
    ${me.restricted ? '<div class="alert"><b>❗ Disiplin Kısıtlaması</b><br>3 sosyal medya uyarısı nedeniyle belge ve sertifika uygunluğu geçici olarak kısıtlanmıştır.</div>' : ''}
    <div class="card"><b>${E(me.full_name)}</b><div class="mut">@${E(me.username)} · ${E(roleName(me.role))}${me.committee ? ' · ' + E(me.committee) : ''}</div><div class="row" style="margin-top:10px"><button class="btn sm g" data-a="chpw">Şifremi değiştir</button></div></div>
    <div class="card"><h2>Belge uygunluğu</h2><div class="row">Sertifika ${elig(me.cert_ok)} Ödül ${elig(me.award_ok)} Katılım belgesi ${elig(me.att_ok)}</div></div>
    <div class="card"><h2>Uyarılarım</h2>${w.map(x => `<div class="cm">${x.level >= 3 ? '<span class="warn">❗ </span>' : ''}<b>${x.level}. Uyarı</b>${x.revoked ? ' <span class="tag">kaldırıldı</span>' : ''}<div class="mut">${dt(x.at)}</div>Sebep: ${E(x.reason)}</div>`).join('') || '<span class="mut">Uyarın yok (0 uyarı).</span>'}</div>
    <div class="card"><h2>Belgelerim</h2>${c.map(x => `<div class="cm">${TYPES[x.type] || x.type} <span class="mut">${dt(x.at)}</span></div>`).join('') || '<span class="mut">Henüz belge yok.</span>'}</div>`;
  },
  async users() {
    const us = await api('GET', '/admin/users');
    return `<div class="row"><h1 class="grow">Kullanıcılar</h1><button class="btn" data-a="newuser">+ Yeni kullanıcı</button></div><div class="card"><table><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Komite</th><th>Sosyal Uyarı</th><th>Durum</th><th></th></tr></thead><tbody>
    ${us.map(u => `<tr><td data-l="Kullanıcı"><a data-a="user" data-id="${u.id}"><b>${E(u.full_name)}</b></a> ${u.restricted ? '<span class="warn">❗</span>' : ''}<div class="mut">@${E(u.username)}</div></td><td data-l="Rol">${E(roleName(u.role))}</td><td data-l="Komite">${E(u.committee) || '—'}</td><td data-l="Sosyal Uyarı">${warnCell(u)}</td><td data-l="Durum">${stTag(u)}</td>
    <td><div class="row"><button class="btn sm g" data-a="edituser" data-id="${u.id}">Düzenle</button><button class="btn sm g" data-a="resetpw" data-id="${u.id}">Şifre sıfırla</button><button class="btn sm g" data-a="toggle" data-id="${u.id}" data-s="${u.status}">${u.status === 'ACTIVE' ? 'Pasife al' : 'Aktifleştir'}</button><button class="btn sm r" data-a="deluser" data-id="${u.id}">Sil</button></div></td></tr>`).join('')}</tbody></table></div>`;
  },
  async user(id) {
    const d = await api('GET', '/admin/users/' + id), u = d.user;
    return `<a data-a="nav" data-v="users">← Kullanıcılar</a><h1>${E(u.full_name)} ${u.restricted ? '<span class="warn">❗</span>' : ''}</h1>
    ${u.restricted ? '<div class="alert"><b>❗ Disiplin Kısıtlaması</b> · ' + u.warn_level + ' Sosyal Medya Uyarısı</div>' : ''}
    <div class="card"><div class="mut">@${E(u.username)} · ${E(roleName(u.role))} · ${E(u.committee) || 'komite yok'} · ${E(u.event) || 'etkinlik yok'}</div><div style="margin:8px 0">${stTag(u)} Sosyal Medya Uyarıları: <b>${warnCell(u)}</b>${u.suspended_until > Date.now() ? ' · Yasak: ' + dt(u.suspended_until) + ' tarihine kadar' : ''}</div>
    <div class="row">${has('warnings.issue') ? `<button class="btn sm r" data-a="warn" data-id="${u.id}">Uyarı ver</button>` : ''}${has('social.moderate') ? `<button class="btn sm g" data-a="suspend" data-id="${u.id}">Geçici yasak</button>` : ''}${has('discipline.lift') && u.restricted ? `<button class="btn sm" data-a="lift" data-id="${u.id}">Disiplin Kısıtlamasını Kaldır</button>` : ''}</div></div>
    <div class="card"><h2>Belge uygunluğu</h2><div class="row">Sertifika ${elig(u.cert_ok)} Ödül ${elig(u.award_ok)} Katılım belgesi ${elig(u.att_ok)}</div></div>
    <div class="card"><h2>Sosyal medya uyarıları</h2>${d.warnings.map(w => `<div class="cm">${w.level >= 3 ? '<span class="warn">❗ </span>' : ''}<b>${w.level}. Uyarı</b>${w.revoked ? ' <span class="tag">kaldırıldı</span>' : ''} · ${dt(w.at)} · veren: ${E(w.issuer)}<br>Sebep: ${E(w.reason)} ${!w.revoked && has('warnings.issue') ? `<a data-a="revoke" data-id="${w.id}">[iptal et]</a>` : ''}</div>`).join('') || '<span class="mut">Uyarı yok.</span>'}</div>
    <div class="card"><h2>Gönderiler (${d.posts.length})</h2>${d.posts.map(p => `<div class="cm">${E(p.body) || '(görsel)'} <span class="mut">${dt(p.created)}${p.status === 'REMOVED' ? ' · kaldırıldı' : ''}</span></div>`).join('') || '<span class="mut">Yok.</span>'}</div>
    <div class="card"><h2>Yorumlar (${d.comments.length})</h2>${d.comments.map(p => `<div class="cm">${E(p.body)} <span class="mut">${dt(p.created)}${p.status === 'REMOVED' ? ' · kaldırıldı' : ''}</span></div>`).join('') || '<span class="mut">Yok.</span>'}</div>
    <div class="card"><h2>Belgeler / Ödüller</h2>${d.certs.map(c => `<div class="cm">${TYPES[c.type] || c.type} · ${dt(c.at)}</div>`).join('') || '<span class="mut">Yok.</span>'}</div>
    <div class="card"><h2>Audit Log</h2>${d.audit.map(a => `<div class="cm"><b>${E(a.action)}</b> · ${dt(a.at)} · ${E(a.actor || '—')}<div class="mut">${E(a.reason)}</div></div>`).join('') || '<span class="mut">Kayıt yok veya yetkin yok.</span>'}</div>`;
  },
  async mod() {
    const d = await api('GET', '/admin/social');
    return `<h1>Sosyal Medya Yönetimi</h1><div class="card"><h2>Gönderiler</h2>${d.posts.map(p => `<div class="cm"><a data-a="user" data-id="${p.aid}"><b>${E(p.full_name)}</b></a> <span class="mut">${dt(p.created)}</span><br>${E(p.body) || '(görsel)'} <button class="btn sm r" data-a="rmpost" data-id="${p.id}">Sil</button></div>`).join('') || '<span class="mut">Gönderi yok.</span>'}</div>
    <div class="card"><h2>Yorumlar</h2>${d.comments.map(c => `<div class="cm"><a data-a="user" data-id="${c.aid}"><b>${E(c.full_name)}</b></a> <span class="mut">${dt(c.created)}</span><br>${E(c.body)} <button class="btn sm r" data-a="rmcm" data-id="${c.id}">Sil</button></div>`).join('') || '<span class="mut">Yorum yok.</span>'}</div>`;
  },
  async certs() {
    const us = (await api('GET', '/admin/users').catch(() => [])).filter(u => u.status === 'ACTIVE');
    return `<h1>Belgeler</h1><div class="card"><label for="cu">Kullanıcı</label><select id="cu">${us.map(u => `<option value="${u.id}">${E(u.full_name)}${u.restricted ? ' ❗' : ''}</option>`).join('')}</select>
    <label for="ct">Tür</label><select id="ct">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><div class="row" style="margin-top:12px"><button class="btn" data-a="issue">Belge oluştur</button></div><div class="err" id="ce"></div></div>`;
  },
  async roles() {
    return `<h1>Roller</h1>${roles.map(r => `<div class="card"><b>${E(r.name)}</b> <span class="mut">${E(r.key)}</span><div class="mut">${r.perms.includes('*') ? 'Tüm izinler' : r.perms.map(p => PERMS[p]).join(', ') || 'Ek izin yok'}</div></div>`).join('')}
    <div class="card"><h2>Yeni rol</h2><label for="rk">Anahtar (BUYUK_HARF)</label><input id="rk" maxlength="30"><label for="rn">Görünen ad</label><input id="rn">${Object.entries(PERMS).map(([k, v]) => `<label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" style="width:auto" value="${k}" class="rp"> ${v}</label>`).join('')}<div class="row" style="margin-top:12px"><button class="btn" data-a="newrole">Rolü kaydet</button></div></div>`;
  },
  async audit() {
    const a = await api('GET', '/admin/audit');
    return `<h1>Audit Logs</h1><div class="card"><table><thead><tr><th>Tarih</th><th>İşlemi yapan</th><th>Etkilenen</th><th>İşlem</th><th>Gerekçe</th><th>IP</th></tr></thead><tbody>${a.map(x => `<tr><td data-l="Tarih">${dt(x.at)}</td><td data-l="İşlemi yapan">${E(x.actor || '—')}</td><td data-l="Etkilenen">${E(x.target || '—')}</td><td data-l="İşlem"><b>${E(x.action)}</b></td><td data-l="Gerekçe">${E(x.reason)}</td><td data-l="IP">${E(x.ip)}</td></tr>`).join('')}</tbody></table></div>`;
  }
};
function userDialog(u) {
  const d = document.createElement('dialog'), nu = !u;
  d.innerHTML = `<form method="dialog" id="uf"><h2>${nu ? 'Yeni kullanıcı' : 'Kullanıcıyı düzenle'}</h2><label for="uf1">Ad Soyad</label><input id="uf1" required value="${E(u?.full_name)}">
  ${nu ? '<label for="uf2">Kullanıcı adı veya e-posta</label><input id="uf2" required autocomplete="off"><label for="uf3">Şifre (en az 8 karakter)</label><input id="uf3" type="text" required autocomplete="off">' : ''}
  <label for="uf4">Rol</label><select id="uf4">${roles.map(r => `<option value="${r.key}" ${u?.role === r.key ? 'selected' : ''}>${E(r.name)}</option>`).join('')}</select>
  <label for="uf5">Komite</label><input id="uf5" value="${E(u?.committee)}"><label for="uf6">Etkinlik</label><input id="uf6" value="${E(u ? u.event : 'Kocaeli Zirve’27')}">
  <label for="uf7">Durum</label><select id="uf7"><option value="ACTIVE">Aktif</option><option value="PASSIVE" ${u?.status === 'PASSIVE' ? 'selected' : ''}>Pasif</option></select>
  <div class="err" id="ue" role="alert"></div><div class="row" style="margin-top:12px"><button class="btn" value="ok">Kaydet</button><button class="btn g" value="x" formnovalidate>Vazgeç</button></div></form>`;
  document.body.appendChild(d); d.showModal(); d.addEventListener('close', () => d.remove());
  d.querySelector('form').addEventListener('submit', async e => {
    if (e.submitter.value !== 'ok') return; e.preventDefault();
    const b = { full_name: $('#uf1').value, role: $('#uf4').value, committee: $('#uf5').value, event: $('#uf6').value, status: $('#uf7').value };
    try { if (nu) { b.username = $('#uf2').value; b.password = $('#uf3').value; await api('POST', '/admin/users', b); } else await api('PATCH', '/admin/users/' + u.id, b); d.close(); toast('Kaydedildi.'); refresh(); }
    catch (x) { $('#ue').textContent = x.message; }
  });
}
const A = {
  nav: async d => go(d.v), prof: async d => go('prof', +d.id), user: async d => go('user', +d.id),
  logout: async () => { await api('POST', '/logout'); me = null; view = 'feed'; boot(); },
  chpw: async () => { me.must_change = false; pwScreen(); },
  sort: async d => { sort = d.v; refresh(); },
  async post() {
    const f = $('#pi').files[0], body = $('#pb').value; let img = null;
    if (f) img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => { const k = Math.min(1, 1100 / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = i.width * k; c.height = i.height * k; c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .75)); }; i.onerror = () => rej(new Error('Görsel okunamadı.')); i.src = URL.createObjectURL(f); });
    await api('POST', '/posts', { body, img }); refresh();
  },
  like: async d => { await api('POST', `/posts/${d.id}/like`); refresh(); },
  async comment(d) { const i = $('#c' + d.id); await api('POST', `/posts/${d.id}/comments`, { body: i.value }); refresh(); },
  delpost: async d => { if (confirm('Gönderi silinsin mi?')) { await api('DELETE', '/posts/' + d.id); refresh(); } },
  delcm: async d => { await api('DELETE', '/comments/' + d.id); refresh(); },
  newuser: async () => userDialog(),
  async edituser(d) { const us = await api('GET', '/admin/users'); userDialog(us.find(u => u.id === +d.id)); },
  async resetpw(d) { const p = prompt('Yeni geçici şifre (en az 8 karakter):'); if (p) { await api('POST', `/admin/users/${d.id}/reset-password`, { password: p }); toast('Şifre sıfırlandı; kullanıcı girişte değiştirecek.'); } },
  toggle: async d => { await api('PATCH', '/admin/users/' + d.id, { status: d.s === 'ACTIVE' ? 'PASSIVE' : 'ACTIVE' }); refresh(); },
  deluser: async d => { if (confirm('Kullanıcı silinsin mi?')) { await api('DELETE', '/admin/users/' + d.id); refresh(); } },
  warn: async d => { const r = await api('POST', `/admin/users/${d.id}/warn`, { reason: reason('Uyarı sebebi:') }); toast(r.level + '. uyarı verildi' + (r.restricted ? ' · disiplin kısıtlaması uygulandı' : '')); refresh(); },
  revoke: async d => { await api('POST', `/admin/warnings/${d.id}/revoke`, { reason: reason('İptal gerekçesi:') }); refresh(); },
  lift: async d => { await api('POST', `/admin/users/${d.id}/lift`, { reason: reason('Kaldırma gerekçesi:') }); refresh(); },
  suspend: async d => { const days = prompt('Kaç gün sosyal medya yasağı? (0 = yasağı kaldır, en fazla 30)'); if (days === null) return; await api('POST', `/admin/users/${d.id}/suspend`, { days: +days, reason: reason() }); refresh(); },
  rmpost: async d => { await api('POST', `/admin/posts/${d.id}/remove`, { reason: reason() }); refresh(); },
  rmcm: async d => { await api('POST', `/admin/comments/${d.id}/remove`, { reason: reason() }); refresh(); },
  async issue() { try { await api('POST', '/admin/certs', { user_id: +$('#cu').value, type: $('#ct').value }); $('#ce').textContent = ''; toast('Belge oluşturuldu.'); } catch (e) { $('#ce').textContent = (e.data?.DOCUMENT_ELIGIBILITY ? '❗ ' : '') + e.message; } },
  async newrole() { await api('POST', '/admin/roles', { key: $('#rk').value, name: $('#rn').value, perms: [...document.querySelectorAll('.rp:checked')].map(x => x.value) }); roles = await api('GET', '/roles'); refresh(); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && A[b.dataset.a]) { e.preventDefault(); A[b.dataset.a](b.dataset).catch(x => { if (x.status === 401) boot(); else toast(x.message); }); } });
boot();
