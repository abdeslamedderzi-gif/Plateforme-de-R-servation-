/* Fonctions communes aux espaces Citoyens et Administration */
(function () {
  'use strict';
  const L = window.L;
  const G = (window.G = {});

  /* ---------- langue ---------- */
  G.lang = (() => { try { return localStorage.getItem('grd_lang') || 'fr'; } catch (e) { return 'fr'; } })();
  if (!['fr', 'ar'].includes(G.lang)) G.lang = 'fr';
  G.t = (k) => (L[G.lang][k] ?? L.fr[k] ?? k);
  G.setLang = (l) => { G.lang = l; try { localStorage.setItem('grd_lang', l); } catch (e) {} };
  G.applyDir = (title) => {
    document.documentElement.lang = G.lang;
    document.documentElement.dir = G.lang === 'ar' ? 'rtl' : 'ltr';
    document.title = title + ' – ' + G.t('brand');
  };

  /* ---------- texte & dates ---------- */
  G.fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');
  G.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  G.pad = pad;
  G.ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  G.parse = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  G.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  G.toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
  G.toHM = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  G.hm = (s) => String(s || '').slice(0, 5);
  G.monday = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };
  G.fmtD = (s) => { const d = G.parse(s); return G.t('days')[d.getDay()] + ' ' + d.getDate() + ' ' + G.t('months')[d.getMonth()] + ' ' + d.getFullYear(); };
  G.fmtShort = (s) => { const d = G.parse(s); return d.getDate() + ' ' + G.t('months')[d.getMonth()]; };
  G.fmtTs = (iso) => { const d = new Date(iso); return G.ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  G.normPhone = (p) => {
    let s = String(p || '').replace(/[\s.\-()]/g, '');
    if (s.startsWith('+212')) s = '0' + s.slice(4); else if (s.startsWith('00212')) s = '0' + s.slice(5);
    return /^0[5-7]\d{8}$/.test(s) ? s : null;
  };
  G.showPhone = (p) => String(p || '').replace(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5');

  /* Heure de référence : celle du serveur (Africa/Casablanca), pas celle du téléphone */
  let offset = 0;
  G.syncNow = (serverLocal) => { if (serverLocal) offset = new Date(serverLocal).getTime() - Date.now(); };
  G.now = () => new Date(Date.now() + offset);
  G.today = () => G.ymd(G.now());
  G.dt = (date, hm) => { const d = G.parse(date); const m = G.toMin(hm); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d; };

  /* ---------- Supabase ---------- */
  G.configured = () => {
    const c = window.APP_CONFIG || {};
    return c.SUPABASE_URL && !/VOTRE-PROJET/.test(c.SUPABASE_URL) && c.SUPABASE_ANON_KEY && !/VOTRE_CLE/.test(c.SUPABASE_ANON_KEY);
  };
  G.client = (persist) => window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: !!persist, autoRefreshToken: !!persist, storageKey: 'grd-admin-session' }
  });
  const CODES = ['SLOT_TAKEN', 'SLOT_BLOCKED', 'SLOT_CLOSED', 'SLOT_PAST', 'BAD_SLOT', 'BAD_PHONE', 'BAD_NAME', 'BAD_ASSOC', 'NO_CONSENT',
    'BAD_TERRAIN', 'PHONE_LIMIT', 'RATE_LIMIT', 'LOCKED', 'TOO_LATE', 'NOT_CANCELLABLE', 'FORBIDDEN'];
  G.errCode = (err) => {
    const m = String((err && (err.message || err.details || err.hint)) || err || '');
    if (/no_double_booking|exclusion|23P01/.test(m) || (err && err.code === '23P01')) return 'SLOT_TAKEN';
    return CODES.find((c) => m.includes(c)) || 'generic';
  };
  G.errMsg = (err, vars) => G.fill(G.t('e_' + G.errCode(err)), vars || {});

  /* ---------- interface ---------- */
  const $ = (G.$ = (s) => document.querySelector(s));
  G.toast = (html, kind, ms) => {
    const d = document.createElement('div'); d.className = kind || ''; d.innerHTML = html; d.setAttribute('role', 'status');
    $('#toast').appendChild(d); setTimeout(() => d.remove(), ms || 3200);
  };
  G.modal = (html) => { $('#mbox').innerHTML = html; $('#modal').classList.add('on'); const f = $('#mbox').querySelector('input,select,button'); f && f.focus(); };
  G.closeModal = () => $('#modal').classList.remove('on');
  G.badge = (s) => `<span class="badge b-${s}">${G.t('st_' + s)}</span>`;
  G.tbadge = (ty) => `<span class="badge b-${ty}">${ty === 'assoc' ? G.t('tAssoc') : G.t('tIndiv')}</span>`;
  G.base = '';
  // chemin d'une image (les versions autonomes fournissent les images intégrées dans window.__ASSETS)
  G.asset = (name) => (window.__ASSETS && window.__ASSETS[name]) || (G.base + 'assets/img/' + name);
  G.tn = (T) => (T ? (G.lang === 'ar' ? T.name_ar : T.name_fr) || T.name_fr : '—');
  G.td = (T) => (G.lang === 'ar' ? T.desc_ar : T.desc_fr) || T.desc_fr || '';
  G.imgSrc = (T) => T.image_url || G.asset('terrain-' + T.id + '.jpg');
  G.timg = (T) => `<img src="${G.esc(G.imgSrc(T))}" alt="${G.esc(G.tn(T))}" loading="lazy">`;
  // image de secours si une photo en ligne ne se charge pas (sans attribut inline, compatible CSP)
  document.addEventListener('error', (e) => { const i = e.target; if (i && i.tagName === 'IMG' && !i.dataset.fb) { i.dataset.fb = '1'; i.src = G.asset('terrain-1.jpg'); } }, true);
  G.crest = () => `<span class="crest"><img src="${G.asset('embleme.png')}" alt="${G.esc(G.t('brand'))}"></span>`;

  G.header = (view, nav, sub) => {
    const n = (h, k) => `<a href="#${h}" class="${view === h ? 'on' : ''}">${G.t(k)}</a>`;
    return `<header class="top"><div class="wrap hd"><a href="${nav ? '#home' : '#'}" class="brand">${G.crest()}<span><b>${G.t('brand')}</b><small>${sub || G.t('title')}</small></span></a>
      ${nav ? `<nav class="mn" aria-label="Menu">${nav.map(([h, k]) => n(h, k)).join('')}</nav>` : ''}
      <button class="langbtn" data-act="lang" lang="${G.lang === 'fr' ? 'ar' : 'fr'}">${G.t('lang')}</button></div></header>`;
  };
  G.footer = (s) => {
    s = s || {};
    const addr = (G.lang === 'ar' ? s.contact_address_ar : s.contact_address_fr) || G.t('addr');
    return `<footer><div class="wrap fg"><div class="flogo"><img src="${G.asset('logo-commune.jpg')}" alt="${G.esc(G.t('brand'))}"><span><b>${G.t('brand')}</b><br>${G.esc(addr)}</span></div>
      <div><b>${G.t('contact')}</b><br>${s.contact_phone ? `<a class="ltr" style="color:#fff" href="tel:${G.esc(s.contact_phone)}">${G.esc(s.contact_phone)}</a><br>` : ''}${G.t('hoursC')}</div>
      <div class="small">${G.t('privacy')}<br><a style="color:#f3c316" href="${G.base}confidentialite.html">${G.t('privacyLink')}</a></div></div></footer>`;
  };
  G.loadingView = () => `<section class="wrap narrow"><div class="card" style="margin-top:28px;text-align:center"><div class="spin" aria-hidden="true"></div><p class="muted">${G.t('loading')}</p></div></section>`;
  G.errorView = () => `<section class="wrap narrow"><div class="card" style="margin-top:28px;text-align:center"><p class="note">${G.t('offline')}</p><button class="btn p" data-act="retry">${G.t('retry')}</button></div></section>`;
  G.notConfiguredView = () => `<section class="wrap narrow"><div class="card" style="margin-top:28px"><h2>Configuration requise</h2><p>Renseignez l'adresse et la clé publique de votre projet Supabase dans <code>js/config.js</code> (voir docs/GUIDE-DEPLOIEMENT.md).</p></div></section>`;

  /* Remplacer le contenu sans perdre le champ actif */
  G.paint = (html) => {
    const fid = document.activeElement && document.activeElement.id;
    $('#root').innerHTML = html;
    if (fid) { const n = document.getElementById(fid); if (n && n.tagName === 'INPUT' && n.type !== 'file' && n.type !== 'checkbox') { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {} } }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') G.closeModal(); });
  document.addEventListener('click', (e) => { if (e.target && e.target.id === 'modal') G.closeModal(); });
})();
