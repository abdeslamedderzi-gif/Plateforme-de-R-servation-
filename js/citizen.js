/* Espace Citoyens — réservation sans compte, sans SMS */
(function () {
  'use strict';
  const { t, esc, fill, fmtD, fmtShort, ymd, parse, addDays, toMin, toHM, hm, badge, tbadge, tn, td, timg, $ } = G;
  const sb = G.configured() ? G.client(false) : null;

  /* ---------- état ---------- */
  const S = { status: 'loading', terrains: [], settings: {}, board: {}, avail: {}, cal: {} };
  const freshB = () => ({ step: 1, tid: null, date: null, start: null, end: null, type: 'indiv', name: '', phone: '', assoc: '', consent: false, err: {}, busy: false, res: null, calY: null, calM: null, formErr: '' });
  let B = freshB();
  let C = { num: '', phone: '', err: '', busy: false, rows: null, phone_ok: null, num_ok: null };
  const terr = (id) => S.terrains.find((x) => x.id == id);
  const arrowBack = () => (G.lang === 'ar' ? '→' : '←'), arrowNext = () => (G.lang === 'ar' ? '←' : '→');

  /* ---------- accès aux données (fonctions publiques uniquement) ---------- */
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async function loadConfig() {
    S.status = 'loading'; render();
    try {
      const cfg = await rpc('get_public_config');
      G.syncNow(cfg.now);
      S.terrains = cfg.terrains || []; S.settings = cfg.settings || {};
      S.status = 'ready'; S.avail = {}; S.cal = {};
      render(); loadBoard();
    } catch (e) { console.error(e); S.status = 'error'; render(); }
  }
  async function loadAvail(tid, date, force) {
    const k = tid + '|' + date;
    if (S.avail[k] && !force) return S.avail[k];
    const rows = await rpc('get_availability', { p_terrain: tid, p_date: date });
    S.avail[k] = rows.map((r) => ({ start: hm(r.start_time), end: hm(r.end_time), st: r.state }));
    return S.avail[k];
  }
  async function loadCal(tid, y, m, force) {
    const k = tid + '|' + y + '-' + m;
    if (S.cal[k] && !force) return;
    const today = G.today(), maxD = ymd(addDays(parse(today), S.settings.max_days_ahead || 30));
    const from = ymd(new Date(y, m, 1)) < today ? today : ymd(new Date(y, m, 1));
    let to = ymd(new Date(y, m + 1, 0)); if (to > maxD) to = maxD;
    const map = {};
    if (from <= to) (await rpc('get_calendar', { p_terrain: tid, p_from: from, p_to: to })).forEach((r) => { map[String(r.day).slice(0, 10)] = r.free_count; });
    S.cal[k] = map;
  }
  async function loadBoard() {
    const today = G.today(), maxD = ymd(addDays(parse(today), S.settings.max_days_ahead || 30));
    await Promise.all(S.terrains.filter((x) => x.active).map(async (T) => {
      try {
        const cal = await rpc('get_calendar', { p_terrain: T.id, p_from: today, p_to: maxD });
        const first = cal.find((r) => r.free_count > 0);
        S.board[T.id] = first ? { d: String(first.day).slice(0, 10), sl: await loadAvail(T.id, String(first.day).slice(0, 10), true) } : null;
      } catch (e) { S.board[T.id] = null; }
    }));
    if (view() === 'home') render();
  }

  /* ---------- vues ---------- */
  const lamp = (side) => `<svg class="lamp ${side}" viewBox="0 0 120 260" aria-hidden="true"><rect x="56" y="40" width="8" height="220" fill="#0d2a1d"/><rect x="18" y="8" width="84" height="40" rx="6" fill="#123827" stroke="#1d4a35"/>${[0, 1, 2, 3].map((c) => [0, 1].map((r) => `<circle class="bulb" cx="${32 + c * 19}" cy="${20 + r * 16}" r="6.5" fill="#fff7d1"/>`).join('')).join('')}</svg>`;

  function vHome() {
    const all = S.terrains, act = all.filter((x) => x.active);
    const first = act[0] || all[0];
    const board = act.map((T) => {
      if (!(T.id in S.board)) return `<div class="sbrow"><div class="sbh"><b>${esc(tn(T))}</b></div><p class="sbnone">${t('loading')}</p></div>`;
      const a = S.board[T.id];
      if (!a) return `<div class="sbrow"><div class="sbh"><b>${esc(tn(T))}</b></div><p class="sbnone">${t('noFreeSoon')}</p></div>`;
      const n = a.sl.filter((s) => s.st === 'free').length;
      return `<div class="sbrow"><div class="sbh"><b>${esc(tn(T))}</b><span>${a.d === G.today() ? t('tonightT') : fmtD(a.d)} · ${fill(t('freeCount'), { n })}</span></div><div class="sbslots">${a.sl.map((s) => s.st === 'free'
        ? `<button class="sbs" data-act="quick" data-t="${T.id}" data-d="${a.d}" data-s="${s.start}" data-e="${s.end}" aria-label="${esc(tn(T))} ${s.start}">${s.start}</button>`
        : `<span class="sbs off">${s.start}</span>`).join('')}</div></div>`;
    }).join('');
    return `<section class="night" style="--bg:url(${G.asset('terrain-1.jpg')})">${lamp('l')}${lamp('r')}<div class="wrap nhero">
      <div class="ntxt"><div class="nlogo"><img src="${G.asset('embleme.png')}" alt=""><span>${t('brand')}<br><b class="ltr">${first ? first.open_time + ' – ' + first.close_time : ''}</b></span></div>
       <h1>${t('h1a')}<em>${t('h1b')}</em></h1><p class="lead">${t('lead')}</p>
       <div class="cta"><a class="btn y xl" href="#book">${t('bBook')}</a><a class="btn w xl" href="#consult">${t('bConsult')}</a></div>
       <ul class="perks"><li>${t('perk1')}</li><li>${t('perk2')}</li><li>${t('perk3')}</li></ul></div>
      <div class="board"><div class="bhead"><span class="dot"></span><b>${t('tonightT')}</b><span class="ltr">${fmtShort(G.today())}</span></div>${board || `<p class="sbnone">${t('noFreeSoon')}</p>`}<p class="bnote">${t('tapSlot')}</p></div></div>
      <svg class="pline" viewBox="0 0 1200 90" preserveAspectRatio="none" aria-hidden="true"><path d="M0 88H1200M600 88V20M520 88a80 70 0 0 1 160 0" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/></svg></section>
     <section class="wrap steps3"><h2>${t('howT')}</h2><ol>${[1, 2, 3].map((i) => `<li><span>${i}</span><b>${t('how' + i)}</b></li>`).join('')}</ol></section>
     <section class="wrap ours"><h2>${t('ourT')}</h2><p class="muted">${t('ourTxt')}</p><div class="tgrid2">${all.map((T) => `<article class="tc2"><div class="tc2img">${timg(T)}<div class="tc2ov"><b>${esc(tn(T))}</b><span class="ltr">${T.open_time} – ${T.close_time}</span></div></div><div class="tc2body"><div class="chips"><span>${t('feat1')}</span><span>${t('feat2')}</span></div><p>${esc(td(T))}</p>${T.active
        ? `<button class="btn p" data-act="bookT" data-id="${T.id}">${t('bookThis')}</button>`
        : `<p class="note small">${t('terrainClosed')}${T.closed_reason ? ' — ' + esc(T.closed_reason) : ''}</p>`}</div></article>`).join('')}</div></section>
     <section class="wrap"><figure class="inaug"><img src="${G.asset('inauguration.jpg')}" alt="${t('photoCap')}" loading="lazy"><figcaption><b>${t('inaugT')}</b><span>${t('inaugTxt')}</span><small>${t('photoCap')}</small></figcaption></figure></section>`;
  }

  function stepper() {
    const STEPS = [1, 2, 3, 4, 6, 7], s = B.step, pos = STEPS.indexOf(s) + 1;
    return `<div class="stepper"><div class="sp-top">${t('step')} ${pos} ${t('of')} 6 · <b>${t('s' + s)}</b></div><ol style="grid-template-columns:repeat(6,minmax(0,1fr))">${STEPS.map((i, k) => `<li class="${i < s ? 'done' : i === s ? 'cur' : ''}"><span>${i < s ? '✓' : k + 1}</span><em>${t('s' + i)}</em></li>`).join('')}</ol></div>`;
  }
  function calendar() {
    const y = B.calY, m = B.calM, first = new Date(y, m, 1), off = (first.getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
    const ds = t('dshort'), map = S.cal[B.tid + '|' + y + '-' + m];
    let cells = [1, 2, 3, 4, 5, 6, 0].map((i) => `<div class="dn">${ds[i]}</div>`).join('') + '<div></div>'.repeat(off);
    for (let d = 1; d <= dim; d++) {
      const s = ymd(new Date(y, m, d)); const n = map ? map[s] : undefined; const known = n !== undefined;
      cells += `<button data-act="pickD" data-d="${s}" ${known && n > 0 ? '' : 'disabled'} class="${s === B.date ? 'sel' : ''} ${s === G.today() ? 'today' : ''} ${known && !n ? 'full' : ''}" aria-label="${fmtD(s)}">${d}${known ? `<small>${n ? n + ' ' + t('freeN') : t('fullD')}</small>` : ''}</button>`;
    }
    const now = G.now(), nowM = now.getFullYear() * 12 + now.getMonth(), cur = y * 12 + m;
    const maxD = addDays(now, S.settings.max_days_ahead || 30), maxM = maxD.getFullYear() * 12 + maxD.getMonth();
    return `<div class="cal"><div class="calh"><button class="btn gh sm" data-act="calM" data-v="-1" ${cur <= nowM ? 'disabled' : ''} aria-label="${t('prev')}">${arrowBack()}</button><b>${t('months')[m]} ${y}</b><button class="btn gh sm" data-act="calM" data-v="1" ${cur >= maxM ? 'disabled' : ''} aria-label="${t('nextP')}">${arrowNext()}</button></div>${map ? '' : `<p class="muted small" style="text-align:center">${t('loading')}</p>`}<div class="calg">${cells}</div></div>`;
  }
  const fld = (k, label, o = {}) => `<label class="f"><span>${label} *</span><input id="f_${k}" data-b="${k}" value="${esc(B[k])}" ${o.tel ? 'type="tel" inputmode="tel" autocomplete="tel" dir="ltr" maxlength="20"' : 'type="text" autocomplete="' + (k === 'assoc' ? 'organization' : 'name') + '" maxlength="' + (k === 'assoc' ? 120 : 80) + '"'}>${o.tel ? `<small>${t('phHint')} · ${t('phoneUse')}</small>` : ''}${B.err[k] ? `<em class="err">${B.err[k]}</em>` : ''}</label>`;

  function vBook() {
    const s = B.step, T = terr(B.tid); let body = '';
    const backBtn = `<button class="btn gh" data-act="back">${arrowBack()} ${t('back')}</button>`;
    if (s === 1) {
      body = `<h2>${t('chooseT')}</h2><div class="tgrid">${S.terrains.map((T) => T.active
        ? `<button class="tcard ${B.tid == T.id ? 'sel' : ''}" data-act="pickT" data-id="${T.id}"><div class="timg">${timg(T)}</div><b>${esc(tn(T))}</b><span>${esc(td(T))}</span><small class="ltr">${T.open_time} – ${T.close_time}</small></button>`
        : `<div class="tcard" style="opacity:.55;cursor:not-allowed"><div class="timg">${timg(T)}</div><b>${esc(tn(T))}</b><span>${t('terrainClosed')}${T.closed_reason ? ' — ' + esc(T.closed_reason) : ''}</span></div>`).join('')}</div>`;
    }
    if (s === 2) body = `<h2>${t('chooseD')}</h2><p class="muted">${t('terrain')} : <b>${esc(tn(T))}</b></p>${calendar()}<div class="nav2">${backBtn}</div>`;
    if (s === 3) {
      const sl = S.avail[B.tid + '|' + B.date];
      body = `<h2>${t('chooseS')}</h2><p class="muted">${esc(tn(T))} · ${fmtD(B.date)}</p>` + (!sl ? `<p class="muted">${t('loading')}</p>`
        : sl.some((x) => x.st === 'free') ? `<div class="slots">${sl.map((x) => `<button class="slot" data-act="pickS" data-s="${x.start}" data-e="${x.end}" ${x.st === 'free' ? '' : 'disabled'}><span class="ltr">${x.start}</span><small><span class="ltr">→ ${x.end}</span> · ${t(x.st === 'free' ? 'free' : x.st)}</small></button>`).join('')}</div>`
        : `<p class="note">${t('noSlots')}</p>`) + `<div class="nav2">${backBtn}</div>`;
    }
    if (s === 4) {
      body = `<h2>${t('info')}</h2><p class="muted small">${esc(tn(T))} · ${fmtD(B.date)} · <span class="ltr">${B.start} – ${B.end}</span></p><div class="small muted" style="margin-bottom:6px">${t('resType')}</div>
        <div class="seg" role="radiogroup"><button role="radio" aria-checked="${B.type === 'indiv'}" class="${B.type === 'indiv' ? 'on' : ''}" data-act="type" data-v="indiv">${t('tIndiv')}</button><button role="radio" aria-checked="${B.type === 'assoc'}" class="${B.type === 'assoc' ? 'on' : ''}" data-act="type" data-v="assoc">${t('tAssoc')}</button></div>
        <form id="infoF" novalidate>` + (B.type === 'indiv' ? fld('name', t('fullName')) + fld('phone', t('phone'), { tel: 1 })
          : fld('assoc', t('assocName')) + fld('name', t('respName')) + fld('phone', t('respPhone'), { tel: 1 })) +
        `<label class="chk"><input type="checkbox" id="f_consent" data-b="consent" ${B.consent ? 'checked' : ''}><span>${t('consent')} <a href="confidentialite.html" target="_blank" rel="noopener">${t('privacyLink')}</a></span></label>${B.err.consent ? `<em class="err">${B.err.consent}</em>` : ''}
        <div class="nav2">${backBtn}<button class="btn p">${t('next')} ${arrowNext()}</button></div></form>`;
    }
    if (s === 6) {
      body = `<h2>${t('recap')}</h2><dl class="recap"><dt>${t('terrain')}</dt><dd>${esc(tn(T))}</dd><dt>${t('date')}</dt><dd>${fmtD(B.date)}</dd><dt>${t('time')}</dt><dd class="ltr">${B.start} – ${B.end}</dd>${B.type === 'assoc' ? `<dt>${t('assoc')}</dt><dd>${esc(B.assoc)}</dd>` : ''}<dt>${B.type === 'assoc' ? t('resp') : t('fullName')}</dt><dd>${esc(B.name)}</dd><dt>${t('phone')}</dt><dd class="ltr">${G.showPhone(G.normPhone(B.phone))}</dd><dt>${t('resType')}</dt><dd>${tbadge(B.type)}</dd></dl>
        ${B.formErr ? `<p class="note" role="alert" style="margin-top:14px">${esc(B.formErr)}</p>` : ''}
        <div class="nav2"><button class="btn gh" data-act="goStep" data-v="4">${t('editB')}</button><button class="btn p xl" data-act="submit" ${B.busy ? 'disabled' : ''}>${B.busy ? t('loading') : t('send')}</button></div>`;
    }
    if (s === 7) {
      const r = B.res, dd = parse(r.date);
      body = `<div class="okbox"><div class="okic"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#0b6b3a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></div><h2>${t('ok')}</h2><p class="muted">${t('ticketT')}</p></div>
        <div class="ticket"><div class="tk-main"><div class="tk-top"><img src="${G.asset('embleme.png')}" alt=""><span>${t('brand')}<br><small>${t('title')}</small></span></div><div class="tk-num ltr">${esc(r.num)}</div>
         <dl><div><dt>${t('terrain')}</dt><dd>${esc(tn(terr(r.terrain_id)))}</dd></div><div><dt>${t('date')}</dt><dd>${fmtD(r.date)}</dd></div><div><dt>${r.type === 'assoc' ? t('assoc') : t('name')}</dt><dd>${esc(r.type === 'assoc' ? r.assoc : r.name)}</dd></div><div><dt>${t('status')}</dt><dd>${badge(r.status)}</dd></div></dl></div>
         <div class="tk-stub"><small>${t('kickoff')}</small><b class="ltr">${r.start_time}</b><span class="ltr">→ ${r.end_time}</span><em>${dd.getDate()} ${t('months')[dd.getMonth()]}</em></div></div>
        <div class="okbox"><button class="btn gh sm" data-act="copyNum" data-v="${esc(r.num)}">${t('copy')}</button><p class="small muted">${t('keep')} ${t('showTicket')}</p><p class="note">${t('pendNote')}</p>
        <div class="cta" style="justify-content:center"><button class="btn p" data-act="newRes">${t('newRes')}</button><a class="btn s" href="#home">${t('home')}</a></div></div>`;
    }
    return `<section class="wrap narrow">${s < 7 ? stepper() : ''}<div class="card">${body}</div></section>`;
  }

  function vConsult() {
    let body;
    if (C.rows) {
      body = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">${t('myRes')}</h2><button class="btn gh sm" data-act="cQuit">${t('quit')}</button></div>
        <p class="small muted">${t('only')} <span class="ltr">${esc(C.rows[0] ? C.rows[0].phone_masked : '')}</span></p><p class="small muted">${t('statusHelp')}</p>
        <div class="rlist">${C.rows.map((r) => { const T = terr(r.terrain_id); return `<div class="ritem"><div class="top"><b class="n">${esc(r.num)}</b>${badge(r.status)}</div><div><b>${esc(tn(T))}</b> · ${fmtD(r.date)} · <span class="ltr">${hm(r.start_time)} – ${hm(r.end_time)}</span></div><div class="small muted">${tbadge(r.type)} ${r.type === 'assoc' ? esc(r.assoc_name) + ' · ' : ''}${esc(r.full_name)}</div>${r.can_cancel ? `<div><button class="btn gh sm" data-act="cCancel" data-n="${esc(r.num)}">${t('askCancel')}</button></div>` : ''}</div>`; }).join('')}</div>`;
    } else {
      body = `<h2>${t('cTitle')}</h2><p class="muted">${t('cTxt')}</p><form id="consF" autocomplete="off"><label class="f"><span>${t('resNum')} *</span><input id="cnum" data-c="num" dir="ltr" value="${esc(C.num)}" style="text-transform:uppercase" maxlength="20"><small>${t('resHint')}</small></label>
        <label class="f"><span>${t('phone')} *</span><input id="cphone" data-c="phone" type="tel" inputmode="tel" dir="ltr" value="${esc(C.phone)}" maxlength="20"><small>${t('phHint')}</small></label>${C.err ? `<em class="err" role="alert" style="margin-bottom:12px">${esc(C.err)}</em>` : ''}<button class="btn p xl" style="width:100%" ${C.busy ? 'disabled' : ''}>${C.busy ? t('loading') : t('showRes')}</button></form>`;
    }
    return `<section class="wrap narrow"><div class="card" style="margin-top:28px">${body}</div></section>`;
  }

  /* ---------- rendu ---------- */
  const view = () => { const v = (location.hash || '#home').slice(1); return ['home', 'book', 'consult'].includes(v) ? v : 'home'; };
  function render() {
    const v = view();
    G.applyDir(t('title'));
    let main;
    if (!sb) main = G.notConfiguredView();
    else if (S.status === 'loading') main = G.loadingView();
    else if (S.status === 'error') main = G.errorView();
    else main = { home: vHome, book: vBook, consult: vConsult }[v]();
    G.paint(G.header(v, [['home', 'nHome'], ['book', 'nBook'], ['consult', 'nConsult']]) + '<main id="main">' + main + '</main>' + G.footer(S.settings));
  }

  /* ---------- actions ---------- */
  function startAt(tid, date, start, end) {
    B = freshB(); B.tid = tid; B.date = date; B.start = start; B.end = end;
    const d = parse(date); B.calY = d.getFullYear(); B.calM = d.getMonth(); B.step = 4;
    location.hash = '#book'; render(); scrollTo(0, 0);
  }
  function validateInfo() {
    const e = {}, req = B.type === 'assoc' ? ['assoc', 'name', 'phone'] : ['name', 'phone'];
    req.forEach((k) => { if (!String(B[k] || '').trim()) e[k] = t('errReq'); });
    if (B.name.trim() && (B.name.trim().length < 3 || /[<>{}]/.test(B.name))) e.name = t('e_BAD_NAME');
    if (B.type === 'assoc' && B.assoc.trim() && (B.assoc.trim().length < 2 || /[<>{}]/.test(B.assoc))) e.assoc = t('e_BAD_ASSOC');
    if (B.phone && !G.normPhone(B.phone)) e.phone = t('errPhone');
    if (!B.consent) e.consent = t('errConsent');
    return e;
  }
  async function goSlots() {
    B.step = 3; render();
    try { await loadAvail(B.tid, B.date, true); } catch (e) { G.toast(esc(G.errMsg(e)), 'err'); }
    render();
  }
  async function goCal() {
    B.step = 2; render();
    try { await loadCal(B.tid, B.calY, B.calM, true); } catch (e) { G.toast(esc(G.errMsg(e)), 'err'); }
    render();
  }
  async function submit() {
    if (B.busy) return;
    B.busy = true; B.formErr = ''; render();
    try {
      const r = await rpc('create_reservation', {
        p_terrain: B.tid, p_date: B.date, p_start: B.start, p_type: B.type, p_full_name: B.name.trim(),
        p_phone: B.phone, p_assoc_name: B.type === 'assoc' ? B.assoc.trim() : null, p_lang: G.lang, p_consent: !!B.consent
      });
      B.res = Object.assign({}, r, { type: B.type, name: B.name.trim(), assoc: B.assoc.trim() });
      B.step = 7; S.avail = {}; S.cal = {}; S.board = {}; loadBoard();
    } catch (e) {
      const c = G.errCode(e);
      if (['SLOT_TAKEN', 'SLOT_BLOCKED', 'SLOT_PAST', 'SLOT_CLOSED'].includes(c)) {
        B.busy = false; G.toast(esc(G.errMsg(e)), 'err', 5000); B.start = null; await goSlots(); return;
      }
      B.formErr = G.errMsg(e, { n: S.settings.max_active_per_phone || 3 });
    }
    B.busy = false; render(); scrollTo(0, 0);
  }
  async function lookup() {
    if (C.busy) return;
    C.err = '';
    if (!C.num.trim() || !C.phone.trim()) { C.err = t('errReq'); return render(); }
    if (!G.normPhone(C.phone)) { C.err = t('errPhone'); return render(); }
    C.busy = true; render();
    try {
      const rows = await rpc('lookup_reservations', { p_num: C.num.trim(), p_phone: C.phone });
      if (!rows || !rows.length) C.err = t('notFound'); else { C.rows = rows; C.num_ok = C.num.trim(); C.phone_ok = C.phone; }
    } catch (e) { C.err = G.errMsg(e); }
    C.busy = false; render();
  }

  const H = {
    lang() { G.setLang(G.lang === 'fr' ? 'ar' : 'fr'); render(); },
    retry() { loadConfig(); },
    bookT(el) { B = freshB(); B.tid = +el.dataset.id; const d = G.now(); B.calY = d.getFullYear(); B.calM = d.getMonth(); location.hash = '#book'; goCal(); scrollTo(0, 0); },
    quick(el) { startAt(+el.dataset.t, el.dataset.d, el.dataset.s, el.dataset.e); },
    pickT(el) { B.tid = +el.dataset.id; B.date = null; B.start = null; if (B.calY == null) { const d = G.now(); B.calY = d.getFullYear(); B.calM = d.getMonth(); } goCal(); },
    async calM(el) { let m = B.calM + +el.dataset.v, y = B.calY; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } B.calM = m; B.calY = y; render(); try { await loadCal(B.tid, y, m); } catch (e) { G.toast(esc(G.errMsg(e)), 'err'); } render(); },
    pickD(el) { B.date = el.dataset.d; B.start = null; goSlots(); },
    pickS(el) { B.start = el.dataset.s; B.end = el.dataset.e; B.step = 4; render(); },
    back() { B.err = {}; B.formErr = ''; if (B.step === 6) { B.step = 4; render(); } else if (B.step === 4) goSlots(); else if (B.step === 3) goCal(); else { B.step = 1; render(); } },
    goStep(el) { B.step = +el.dataset.v; B.formErr = ''; render(); },
    type(el) { B.type = el.dataset.v; B.err = {}; render(); },
    submit,
    copyNum(el) { const v = el.dataset.v; try { navigator.clipboard.writeText(v).then(() => G.toast(t('copied')), () => {}); } catch (e) {} },
    newRes() { B = freshB(); render(); },
    cQuit() { C = { num: '', phone: '', err: '', busy: false, rows: null }; render(); },
    cCancel(el) {
      const n = el.dataset.n;
      G.modal(`<h3>${fill(t('confCancel'), { n: esc(n) })}</h3><div class="nav2"><button class="btn gh" data-act="mClose">${t('no')}</button><button class="btn r" data-act="cDoCancel" data-n="${esc(n)}">${t('yes')}</button></div>`);
    },
    async cDoCancel(el) {
      G.closeModal();
      try {
        const r = await rpc('cancel_reservation', { p_num: el.dataset.n, p_phone: C.phone_ok });
        if (r === 'cancelled') { G.toast(t('cancelled')); S.board = {}; S.avail = {}; S.cal = {}; loadBoard(); }
        else G.toast(t('notFound'), 'err');
        const rows = await rpc('lookup_reservations', { p_num: C.num_ok, p_phone: C.phone_ok }); if (rows && rows.length) C.rows = rows;
      } catch (e) { G.toast(esc(G.errMsg(e, { h: S.settings.cancel_hours })), 'err', 6000); }
      render();
    },
    mClose() { G.closeModal(); }
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const f = H[el.dataset.act]; if (f) { e.preventDefault(); f(el); }
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.b) B[el.dataset.b] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.c) C[el.dataset.c] = el.value;
  });
  document.addEventListener('change', (e) => { const el = e.target; if (el.dataset.b && el.type === 'checkbox') B[el.dataset.b] = el.checked; });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'infoF') { e.preventDefault(); B.err = validateInfo(); if (Object.keys(B.err).length) { render(); const f = document.querySelector('.err'); f && f.parentElement.querySelector('input') && f.parentElement.querySelector('input').focus(); return; } B.step = 6; render(); scrollTo(0, 0); }
    if (e.target.id === 'consF') { e.preventDefault(); lookup(); }
  });
  addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

  if (sb) loadConfig(); else render();
  window.__citizen = { S, get B() { return B; }, get C() { return C; } };   // utilisé par les tests automatiques
})();
