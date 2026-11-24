/* Espace Administration — connexion sécurisée Supabase Auth + Row Level Security */
(function () {
  'use strict';
  const { t, esc, fill, fmtD, fmtShort, fmtTs, ymd, parse, addDays, toMin, toHM, hm, badge, tbadge, tn, timg, monday, $ } = G;
  G.base = '../';
  const sb = G.configured() ? G.client(true) : null;

  /* ---------- état ---------- */
  const A = {
    status: 'boot', session: null, me: null, tab: 'dash', live: false, recovery: false, busy: false, loginErr: '', info: '',
    q: '', fDate: '', fTerr: '', fType: '', fStatus: '', pView: 'week', pDate: null, pTerr: '', pStatus: '',
    rPeriod: 'month', rDate: null, bT: null, bD: null, accErr: {}, audit: null
  };
  const D = { terrains: [], settings: {}, closures: [], blocks: [], res: [] };
  const ACTIVE = ['pending', 'confirmed'];
  const ov = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  const terr = (id) => D.terrains.find((x) => x.id == id);
  const can = () => A.me && A.me.role === 'superadmin';
  const slot = () => D.settings.slot_minutes || 60;

  /* ---------- normalisation des lignes ---------- */
  const nRes = (r) => Object.assign(r, { start: hm(r.start_time), end: hm(r.end_time), date: String(r.date).slice(0, 10) });
  const nBlock = (b) => Object.assign(b, { start: hm(b.start_time), end: hm(b.end_time), date: String(b.date).slice(0, 10) });
  const nTerr = (T) => Object.assign(T, { open: hm(T.open_time), close: hm(T.close_time), days: T.open_days || [] });

  /* ---------- chargement ---------- */
  async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
  async function fetchAll(build) {
    const out = []; for (let i = 0; i < 50; i++) { const rows = await q(build().range(i * 1000, i * 1000 + 999)); out.push(...rows); if (rows.length < 1000) break; } return out;
  }
  async function loadAll() {
    A.status = 'loading'; render();
    try {
      const cfg = await q(sb.rpc('get_public_config')); G.syncNow(cfg.now);
      if (!A.pDate) A.pDate = G.today(); if (!A.rDate) A.rDate = G.today(); if (!A.bD) A.bD = G.today();
      await q(sb.rpc('admin_mark_done'));
      const since = ymd(addDays(G.now(), -400));
      const [T, S, C, Bl, R] = await Promise.all([
        q(sb.from('terrains').select('*').order('sort', { ascending: true })),
        q(sb.from('settings').select('*').limit(1)),
        q(sb.from('closures').select('*').order('date_from', { ascending: true })),
        q(sb.from('blocks').select('*').gte('date', ymd(addDays(G.now(), -31))).order('date', { ascending: true })),
        fetchAll(() => sb.from('reservations').select('*').gte('date', since).order('date', { ascending: false }).order('start_time', { ascending: false }))
      ]);
      D.terrains = T.map(nTerr); D.settings = S[0] || {}; D.closures = C; D.blocks = Bl.map(nBlock); D.res = R.map(nRes);
      if (!A.bT && D.terrains[0]) A.bT = D.terrains[0].id;
      A.status = 'ready';
    } catch (e) { console.error(e); A.status = 'error'; }
    render();
  }
  async function reloadRes() {
    try {
      const since = ymd(addDays(G.now(), -400));
      D.res = (await fetchAll(() => sb.from('reservations').select('*').gte('date', since).order('date', { ascending: false }).order('start_time', { ascending: false }))).map(nRes);
      if (A.status === 'ready') render();
    } catch (e) { console.warn(e); }
  }

  /* ---------- temps réel ---------- */
  let channel = null, poll = null;
  function startLive() {
    stopLive();
    try {
      channel = sb.channel('reservations-admin')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (p) => {
          if (p.eventType === 'INSERT') { const r = nRes(p.new); if (!D.res.some((x) => x.id === r.id)) D.res.unshift(r); G.toast(fill(t('newReq'), { num: esc(r.num) }), 'sms', 6000); }
          else if (p.eventType === 'UPDATE') { const r = nRes(p.new); const i = D.res.findIndex((x) => x.id === r.id); if (i >= 0) D.res[i] = r; else D.res.unshift(r); }
          else if (p.eventType === 'DELETE') { D.res = D.res.filter((x) => x.id !== (p.old && p.old.id)); }
          if (A.status === 'ready' && !document.querySelector('#modal.on')) render();
        })
        .subscribe((s) => { A.live = s === 'SUBSCRIBED'; if (A.status === 'ready') paintLive(); });
    } catch (e) { A.live = false; }
    poll = setInterval(reloadRes, 60000);   // filet de sécurité si le temps réel est coupé
  }
  function stopLive() { if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; } if (poll) { clearInterval(poll); poll = null; } A.live = false; }
  const liveBadge = () => `<span id="liveB" class="live ${A.live ? '' : 'off'}"><i></i>${t('live')}</span>`;
  const paintLive = () => { const n = document.getElementById('liveB'); if (n) n.outerHTML = liveBadge(); };

  /* ---------- session ---------- */
  async function afterLogin(session) {
    A.session = session;
    try {
      const me = await q(sb.rpc('admin_whoami'));
      if (!me) { await sb.auth.signOut(); A.session = null; A.status = 'login'; A.loginErr = t('notAllowed'); return render(); }
      A.me = me; await loadAll(); startLive();
    } catch (e) { console.error(e); A.status = 'error'; render(); }
  }
  async function boot() {
    if (!sb) { A.status = 'noconf'; return render(); }
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'PASSWORD_RECOVERY') { A.recovery = true; A.tab = 'account'; if (session && !A.me) afterLogin(session); else render(); }
      if (ev === 'SIGNED_OUT') { stopLive(); A.session = null; A.me = null; A.status = 'login'; render(); }
    });
    const { data } = await sb.auth.getSession();
    if (data && data.session) afterLogin(data.session); else { A.status = 'login'; render(); }
  }

  /* ---------- créneaux calculés localement ---------- */
  function slotsOf(T) { const out = []; for (let m = toMin(T.open); m + slot() <= toMin(T.close); m += slot()) out.push({ start: toHM(m), end: toHM(m + slot()) }); return out; }
  const isClosed = (T, date) => !T.active || !T.days.includes(parse(date).getDay()) || D.closures.some((c) => date >= c.date_from && date <= c.date_to && (!c.terrain_id || c.terrain_id === T.id));

  /* ---------- vues ---------- */
  function vLogin() {
    return `<section class="wrap"><div class="card login"><h2>${t('login')}</h2><p class="small muted">${t('restricted')}</p>
      <form id="loginF"><label class="f"><span>${t('email')}</span><input id="lu" type="email" autocomplete="username" dir="ltr" required></label>
      <label class="f"><span>${t('password')}</span><input id="lp" type="password" autocomplete="current-password" dir="ltr" required></label>
      ${A.loginErr ? `<em class="err" role="alert">${esc(A.loginErr)}</em>` : ''}${A.info ? `<p class="note small">${esc(A.info)}</p>` : ''}
      <button class="btn p" style="width:100%;margin-top:8px" ${A.busy ? 'disabled' : ''}>${A.busy ? t('loading') : t('signIn')}</button></form>
      <p style="margin-top:14px"><button class="btn gh sm" data-act="forgot">${t('forgotPw')}</button></p></div></section>`;
  }
  function vAdmin() {
    const tabs = A.recovery ? ['account'] : ['dash', 'res', 'plan', 'terr', 'rules', 'rep', 'log', 'account'];
    const pend = D.res.filter((r) => r.status === 'pending').length;
    const side = `<aside class="side">${tabs.map((k) => `<button class="${A.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${t('t_' + k)}${k === 'res' && pend ? ` <span class="badge b-pending">${pend}</span>` : ''}</button>`).join('')}
      <div class="who">${liveBadge()}<br>${esc(A.me.display_name)} · ${t('role_' + A.me.role)}<br><button class="btn gh sm" data-act="logout" style="margin-top:6px">${t('logout')}</button></div></aside>`;
    const P = { dash: aDash, res: aRes, plan: aPlan, terr: aTerr, rules: aRules, rep: aRep, log: aLog, account: aAccount }[A.tab]();
    return `<section class="wrap"><div class="adm">${side}<div>${P}</div></div></section>`;
  }

  const rowActs = (r, inModal) => `<div class="acts">${r.status === 'pending' ? `<button class="btn p sm" data-act="setSt" data-id="${r.id}" data-v="confirmed">${t('accept')}</button><button class="btn r sm" data-act="askSt" data-id="${r.id}" data-v="refused">${t('refuse')}</button>` : ''}${ACTIVE.includes(r.status) ? `<button class="btn gh sm" data-act="askSt" data-id="${r.id}" data-v="cancelled">${t('cancel')}</button><button class="btn gh sm" data-act="edit" data-id="${r.id}">${t('editB')}</button>` : ''}${inModal ? '' : `<button class="btn gh sm" data-act="openRes" data-id="${r.id}">${t('details')}</button>`}</div>`;
  function resTable(list) {
    if (!list.length) return `<p class="muted">${t('nothing')}</p>`;
    return `<table class="stack"><thead><tr><th>${t('num')}</th><th>${t('date')}</th><th>${t('terrain')}</th><th>${t('name')}</th><th>${t('phone')}</th><th>${t('status')}</th><th>${t('actions')}</th></tr></thead><tbody>${list.map((r) => `<tr><td class="num">${esc(r.num)}</td><td>${fmtShort(r.date)} <span class="ltr">${r.start}</span></td><td>${esc(tn(terr(r.terrain_id)))}</td><td>${tbadge(r.type)}<br>${r.type === 'assoc' ? '<b>' + esc(r.assoc_name) + '</b><br>' : ''}${esc(r.full_name)}</td><td class="num"><a href="tel:${esc(r.phone)}">${G.showPhone(r.phone)}</a></td><td>${badge(r.status)}</td><td>${rowActs(r)}</td></tr>`).join('')}</tbody></table>`;
  }

  function aDash() {
    const R = D.res, ts = G.today(), now = G.now(), live = ['pending', 'confirmed', 'done'];
    const today = R.filter((r) => r.date === ts && live.includes(r.status));
    const cnt = (s) => R.filter((r) => r.status === s).length;
    const mon = monday(now), days = [...Array(7)].map((_, i) => ymd(addDays(mon, i)));
    let cap = 0; days.forEach((d) => D.terrains.forEach((T) => { if (!isClosed(T, d)) cap += slotsOf(T).length; }));
    const used = R.filter((r) => days.includes(r.date) && live.includes(r.status)).length; const pct = cap ? Math.round(used / cap * 100) : 0;
    const C = 2 * Math.PI * 52, greet = now.getHours() < 17 ? t('hello') : t('evening');
    const ic = { cal: '<path d="M5 6h14v13H5z M5 10h14 M9 4v4 M15 4v4"/>', wait: '<path d="M7 4h10 M7 20h10 M8 4c0 5 8 6 8 8s-8 3-8 8 M16 4c0 5-8 6-8 8"/>', ok: '<path d="M5 12l4 4 10-10"/>', x: '<path d="M6 6l12 12 M18 6L6 18"/>' };
    const svg = (p) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const kp = [['tod', 'cal', today.length, t('k_today')], ['pen', 'wait', cnt('pending'), t('k_pend')], ['ok', 'ok', cnt('confirmed'), t('k_conf')], ['can', 'x', cnt('cancelled'), t('k_can')]];
    const track = (T) => {
      if (isClosed(T, ts)) return `<div class="trk closed">${t('closedToday')}${!T.active && T.closed_reason ? ' — ' + esc(T.closed_reason) : ''}</div>`;
      return `<div class="trk">${slotsOf(T).map((s) => {
        const r = R.find((x) => x.terrain_id === T.id && x.date === ts && live.includes(x.status) && x.start === s.start);
        const b = D.blocks.find((x) => x.terrain_id === T.id && x.date === ts && ov(toMin(s.start), toMin(s.end), toMin(x.start), toMin(x.end)));
        const cls = r ? r.status : b ? 'blocked' : 'free', who = r ? (r.type === 'assoc' ? r.assoc_name : r.full_name) : b ? (b.reason || t('blocked')) : t('free');
        return r ? `<button data-act="openRes" data-id="${r.id}" class="sl s-${cls}"><b class="ltr">${s.start}</b><span>${esc(who)}</span></button>` : `<div class="sl s-${cls}"><b class="ltr">${s.start}</b><span>${esc(who)}</span></div>`;
      }).join('')}</div>`;
    };
    const pend = R.filter((r) => r.status === 'pending').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 6);
    const wk = days.map((d) => ({ d, n: R.filter((r) => r.date === d && live.includes(r.status)).length })), wm = Math.max(3, ...wk.map((x) => x.n));
    const perT = D.terrains.map((T) => { let c = 0; days.forEach((d) => { if (!isClosed(T, d)) c += slotsOf(T).length; }); const u = R.filter((r) => r.terrain_id === T.id && days.includes(r.date) && live.includes(r.status)); return { T, c, u: u.length, a: u.filter((r) => r.type === 'assoc').length }; });
    const latest = [...R].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 6);
    const first = D.terrains[0];
    return `<div class="dhero"><div class="dh-txt"><small>${fmtD(ts)}</small><h2>${greet}, ${esc(A.me.display_name)}</h2><p>${fill(t('dSummary'), { p: cnt('pending'), n: today.length })}</p><div class="cta" style="margin-top:14px"><button class="btn sm dbtn" data-act="tab" data-v="res">${t('t_res')}</button><button class="btn sm dbtn o" data-act="tab" data-v="plan">${t('t_plan')}</button><button class="btn sm dbtn o" data-act="refresh">${t('refresh')}</button></div></div>
      <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="12"/><circle cx="60" cy="60" r="52" fill="none" stroke="#f3c316" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C * pct / 100} ${C}" transform="rotate(-90 60 60)"/></svg><div><b>${pct}%</b><small>${t('occWeek')}</small><small class="ltr">${used} / ${cap}</small></div></div></div>
     <div class="kp2">${kp.map((k) => `<div class="k k-${k[0]}"><i>${svg(ic[k[1]])}</i><b>${k[2]}</b><span>${k[3]}</span></div>`).join('')}</div>
     <div class="dgrid"><section class="panel"><div class="ph"><h3>${t('tonight')}</h3><span class="small muted ltr">${first ? first.open + ' – ' + first.close : ''}</span></div>
       ${D.terrains.map((T) => `<div class="trow"><div class="tname"><span class="tth">${timg(T)}</span><b>${esc(tn(T))}</b></div>${track(T)}</div>`).join('')}
       <div class="legend">${['free', 'pending', 'confirmed', 'blocked'].map((s) => `<span><i class="lg-${s}"></i>${s === 'free' ? t('free') : t('st_' + s)}</span>`).join('')}</div></section>
      <section class="panel"><div class="ph"><h3>${t('toDo')}</h3>${pend.length ? `<span class="badge b-pending">${cnt('pending')}</span>` : ''}</div>
       ${pend.length ? pend.map((r) => `<div class="pc"><div class="pd"><b>${parse(r.date).getDate()}</b><small>${t('months')[parse(r.date).getMonth()].slice(0, G.lang === 'ar' ? 9 : 3)}</small></div><div class="pi"><b>${r.type === 'assoc' ? esc(r.assoc_name) : esc(r.full_name)}</b><small>${esc(tn(terr(r.terrain_id)))} · <span class="ltr">${r.start}–${r.end}</span> · ${tbadge(r.type)}</small></div><div class="acts"><button class="btn p sm" data-act="setSt" data-id="${r.id}" data-v="confirmed" aria-label="${t('accept')}" title="${t('accept')}">✓</button><button class="btn r sm" data-act="askSt" data-id="${r.id}" data-v="refused" aria-label="${t('refuse')}" title="${t('refuse')}">✕</button></div></div>`).join('')
        : `<div class="empty"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#e4f2e8"/><path d="M20 33l8 8 16-17" fill="none" stroke="#0b6b3a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg><p>${t('allDone')}</p></div>`}</section></div>
     <div class="dgrid"><section class="panel"><div class="ph"><h3>${t('weekPlan')}</h3></div><div class="wk2">${wk.map((x) => `<div class="${x.d === ts ? 'now' : ''}"><em>${x.n}</em><i style="height:${Math.max(4, x.n / wm * 100)}%"></i><span>${t('dshort')[parse(x.d).getDay()]}</span></div>`).join('')}</div></section>
      <section class="panel"><div class="ph"><h3>${t('perT')}</h3></div>${perT.map((x) => { const p = x.c ? Math.round(x.u / x.c * 100) : 0; return `<div class="tocc"><div class="tth big">${timg(x.T)}</div><div><b>${esc(tn(x.T))}</b><div class="meter"><i style="width:${p}%"></i></div><small class="muted">${p}% · ${x.u} ${t('slotsBooked')} · ${x.a} ${t('assocs').toLowerCase()}</small></div></div>`; }).join('')}</section></div>
     <section class="panel"><div class="ph"><h3>${t('latest')}</h3>${latest.length ? `<button class="btn gh sm" data-act="tab" data-v="res">${t('seeAll')}</button>` : ''}</div>${latest.length ? resTable(latest) : `<div class="empty"><p>${t('noYet')}</p></div>`}</section>`;
  }

  function filtered() {
    const qq = A.q.trim().toLowerCase(), qd = qq.replace(/\D/g, '');
    return D.res.filter((r) => (!qq || r.full_name.toLowerCase().includes(qq) || (r.assoc_name || '').toLowerCase().includes(qq) || String(r.num).toLowerCase().includes(qq) || (qd.length >= 3 && r.phone.includes(qd)))
      && (!A.fDate || r.date === A.fDate) && (!A.fTerr || r.terrain_id == A.fTerr) && (!A.fType || r.type === A.fType) && (!A.fStatus || r.status === A.fStatus))
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  }
  const tOpts = (v, allK) => `<option value="">${t(allK)}</option>` + D.terrains.map((T) => `<option value="${T.id}" ${v == T.id ? 'selected' : ''}>${esc(tn(T))}</option>`).join('');
  const sOpts = (v, extra) => `<option value="">${t('allS')}</option>` + ['pending', 'confirmed', 'refused', 'cancelled', 'done'].concat(extra || []).map((s) => `<option value="${s}" ${v === s ? 'selected' : ''}>${t('st_' + s)}</option>`).join('');
  function aRes() {
    const list = filtered();
    return `<h2>${t('t_res')}</h2><div class="card"><div class="tools"><input type="search" id="q" data-f="q" placeholder="${t('search')}" value="${esc(A.q)}" aria-label="${t('search')}"><input type="date" data-f="fDate" value="${A.fDate}" aria-label="${t('date')}"><select data-f="fTerr" aria-label="${t('terrain')}">${tOpts(A.fTerr, 'allT')}</select><select data-f="fType" aria-label="${t('type')}"><option value="">${t('allTy')}</option><option value="indiv" ${A.fType === 'indiv' ? 'selected' : ''}>${t('tIndiv')}</option><option value="assoc" ${A.fType === 'assoc' ? 'selected' : ''}>${t('tAssoc')}</option></select><select data-f="fStatus" aria-label="${t('status')}">${sOpts(A.fStatus)}</select><button class="btn gh sm" data-act="fReset">${t('reset')}</button></div><p class="small muted">${list.length} · ${t('contactNeeded')}</p><div id="resList">${resTable(list.slice(0, 300))}</div></div>`;
  }

  function aPlan() {
    const v = A.pView, d = parse(A.pDate); let head, grid;
    const resF = (tid, date) => D.res.filter((r) => r.date === date && (!tid || r.terrain_id == tid) && (!A.pTerr || r.terrain_id == A.pTerr) && (!A.pStatus || r.status === A.pStatus));
    const blkF = (tid, date) => (!A.pStatus || A.pStatus === 'blocked') ? D.blocks.filter((b) => b.date === date && (!tid || b.terrain_id == tid) && (!A.pTerr || b.terrain_id == A.pTerr)) : [];
    const terrs = D.terrains; if (!terrs.length) return `<p class="muted">${t('nothing')}</p>`;
    const minO = Math.min(...terrs.map((T) => toMin(T.open))), maxC = Math.max(...terrs.map((T) => toMin(T.close))); const rows = []; for (let m = minO; m + slot() <= maxC; m += slot()) rows.push(m);
    const short = (T) => 'T' + T.id;
    const chips = (tid, date, m, withT) => { const e = m + slot(); return resF(tid, date).filter((r) => ov(m, e, toMin(r.start), toMin(r.end)) && toMin(r.start) >= m).map((r) => `<button class="chip c-${r.status}" data-act="openRes" data-id="${r.id}" title="${esc(r.full_name)}">${withT ? short(terr(r.terrain_id)) + ' · ' : ''}${r.type === 'assoc' ? esc(r.assoc_name) : esc(r.full_name)}</button>`).join('') + blkF(tid, date).filter((b) => ov(m, e, toMin(b.start), toMin(b.end))).map((b) => `<span class="chip c-blocked">${withT ? short(terr(b.terrain_id)) + ' · ' : ''}${esc(b.reason || t('blocked'))}</span>`).join(''); };
    if (v === 'day') { head = fmtD(A.pDate); const cols = terrs.filter((T) => !A.pTerr || T.id == A.pTerr); grid = `<div class="scroll"><table class="pg"><thead><tr><th></th>${cols.map((T) => `<th>${esc(tn(T))}</th>`).join('')}</tr></thead><tbody>${rows.map((m) => `<tr><td class="h ltr">${toHM(m)}</td>${cols.map((T) => `<td>${chips(T.id, A.pDate, m, false)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
    else if (v === 'week') { const mon = monday(d), days = [...Array(7)].map((_, i) => ymd(addDays(mon, i))); head = fmtShort(days[0]) + ' – ' + fmtShort(days[6]) + ' ' + mon.getFullYear(); grid = `<div class="scroll"><table class="pg"><thead><tr><th></th>${days.map((x) => `<th style="${x === G.today() ? 'color:var(--g)' : ''}">${t('dshort')[parse(x).getDay()]} ${parse(x).getDate()}</th>`).join('')}</tr></thead><tbody>${rows.map((m) => `<tr><td class="h ltr">${toHM(m)}</td>${days.map((x) => `<td>${chips(null, x, m, true)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
    else {
      const y = d.getFullYear(), mo = d.getMonth(); head = t('months')[mo] + ' ' + y; const st = monday(new Date(y, mo, 1)); const ds = t('dshort'); let cells = [1, 2, 3, 4, 5, 6, 0].map((i) => `<div class="dn">${ds[i]}</div>`).join('');
      for (let i = 0; i < 42; i++) { const x = addDays(st, i), s = ymd(x); if (i >= 35 && x.getMonth() !== mo) break; const rs = resF(null, s); const c = {}; rs.forEach((r) => (c[r.status] = (c[r.status] || 0) + 1)); const nb = blkF(null, s).length; cells += `<button class="${x.getMonth() !== mo ? 'out' : ''} ${s === G.today() ? 'today' : ''}" data-act="goDay" data-d="${s}"><b>${x.getDate()}</b><span class="dots">${Object.entries(c).map(([k, n]) => `<span class="c-${k}">${n}</span>`).join('')}${nb ? `<span class="c-blocked">${nb}</span>` : ''}</span></button>`; }
      grid = `<div class="mgrid">${cells}</div>`;
    }
    const lg = ['pending', 'confirmed', 'blocked', 'cancelled', 'refused', 'done'].map((s) => `<span><i class="c-${s}"></i>${t('st_' + s)}</span>`).join('');
    const ar = G.lang === 'ar';
    return `<h2>${t('t_plan')}</h2><div class="card"><div class="tools"><span style="display:flex;gap:6px">${['day', 'week', 'month'].map((x) => `<button class="btn sm ${v === x ? 'p' : 'gh'}" data-act="pView" data-v="${x}">${t(x)}</button>`).join('')}</span><button class="btn gh sm" data-act="pMove" data-v="-1" aria-label="${t('prev')}">${ar ? '→' : '←'}</button><button class="btn gh sm" data-act="pMove" data-v="0">${t('today')}</button><button class="btn gh sm" data-act="pMove" data-v="1" aria-label="${t('nextP')}">${ar ? '←' : '→'}</button><b style="flex:1 1 200px">${head}</b><select data-f="pTerr">${tOpts(A.pTerr, 'allT')}</select><select data-f="pStatus">${sOpts(A.pStatus, ['blocked'])}</select></div><div class="legend">${lg}</div>${grid}</div>`;
  }

  function aTerr() {
    const dis = can() ? '' : 'disabled', ds = t('days');
    const forms = D.terrains.map((T) => `<div class="card"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><div class="thumb">${timg(T)}</div><h3 style="margin:0">${esc(tn(T))}</h3>${T.active ? '' : `<span class="badge b-blocked">${t('terrainClosed')}</span>`}</div>
      <div class="tform"><label class="f"><span>${t('nameFr')}</span><input id="tf${T.id}_nf" value="${esc(T.name_fr)}" maxlength="60" ${dis}></label><label class="f"><span>${t('nameAr')}</span><input id="tf${T.id}_na" dir="rtl" value="${esc(T.name_ar)}" maxlength="60" ${dis}></label>
      <label class="f"><span>${t('descFr')}</span><input id="tf${T.id}_df" value="${esc(T.desc_fr)}" maxlength="200" ${dis}></label><label class="f"><span>${t('descAr')}</span><input id="tf${T.id}_da" dir="rtl" value="${esc(T.desc_ar)}" maxlength="200" ${dis}></label>
      <label class="f"><span>${t('open')}</span><input type="time" id="tf${T.id}_o" value="${T.open}" ${dis}></label><label class="f"><span>${t('closeH')}</span><input type="time" id="tf${T.id}_c" value="${T.close}" ${dis}></label>
      <label class="f"><span>${t('img')}</span><input type="file" accept="image/jpeg,image/png,image/webp" data-img="${T.id}" ${dis}></label><label class="f"><span>${t('closedReason')}</span><input id="tf${T.id}_r" value="${esc(T.closed_reason || '')}" maxlength="120" ${dis}></label></div>
      <div class="small" style="font-weight:700;margin-bottom:6px">${t('daysOpen')}</div><div class="days">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<label><input type="checkbox" id="tf${T.id}_d${i}" ${T.days.includes(i) ? 'checked' : ''} ${dis}>${ds[i]}</label>`).join('')}</div>
      <label class="chk"><input type="checkbox" id="tf${T.id}_a" ${T.active ? 'checked' : ''} ${dis}><span>${t('active')}</span></label><button class="btn p" data-act="saveT" data-id="${T.id}" ${dis}>${t('save')}</button></div>`).join('');
    const up = D.blocks.filter((b) => b.date >= G.today()).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const bT = terr(A.bT) || D.terrains[0]; const opts = bT ? slotsOf(bT).map((x) => `<option value="${x.start}">${x.start} – ${x.end}</option>`).join('') : '';
    return `<h2>${t('t_terr')}</h2>${can() ? '' : `<p class="note">${t('noRight')}</p>`}${forms}
      <div class="card"><h3>${t('blockSlot')}</h3><div class="tools"><select id="bT" data-f="bT">${D.terrains.map((T) => `<option value="${T.id}" ${A.bT == T.id ? 'selected' : ''}>${esc(tn(T))}</option>`).join('')}</select><input type="date" id="bD" data-f="bD" value="${A.bD}" min="${G.today()}"><select id="bS">${opts}</select><input id="bR" placeholder="${t('reason')}" maxlength="120"><button class="btn p sm" data-act="addBlock">${t('block')}</button></div>
      <h3 style="margin-top:16px">${t('blocks')}</h3>${up.length ? `<table class="stack"><thead><tr><th>${t('terrain')}</th><th>${t('date')}</th><th>${t('time')}</th><th>${t('reason')}</th><th></th></tr></thead><tbody>${up.map((b) => `<tr><td>${esc(tn(terr(b.terrain_id)))}</td><td>${fmtShort(b.date)}</td><td class="num">${b.start} – ${b.end}</td><td>${esc(b.reason)}</td><td><button class="btn gh sm" data-act="delBlock" data-id="${b.id}">${t('remove')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="muted">${t('nothing')}</p>`}</div>`;
  }

  function aRules() {
    const r = D.settings, dis = can() ? '' : 'disabled';
    return `<h2>${t('t_rules')}</h2>${can() ? '' : `<p class="note">${t('noRight')}</p>`}<div class="card"><p class="small muted">${t('rulesNote')}</p><div class="tform">
      <label class="f"><span>${t('slot')}</span><select id="r_slot" ${dis}>${[30, 45, 60, 90, 120].map((v) => `<option ${r.slot_minutes === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f"><span>${t('minDelay')}</span><input type="number" min="0" max="168" id="r_min" value="${r.min_delay_hours}" ${dis}></label>
      <label class="f"><span>${t('maxDays')}</span><input type="number" min="1" max="365" id="r_max" value="${r.max_days_ahead}" ${dis}></label>
      <label class="f"><span>${t('cancelH')}</span><input type="number" min="0" max="168" id="r_can" value="${r.cancel_hours}" ${dis}></label>
      <label class="f"><span>${t('maxPerPhone')}</span><input type="number" min="1" max="20" id="r_lim" value="${r.max_active_per_phone}" ${dis}></label>
      <label class="f"><span>${t('contactPhone')}</span><input id="r_tel" dir="ltr" value="${esc(r.contact_phone || '')}" maxlength="30" ${dis}></label>
      <label class="f"><span>${t('addrFr')}</span><input id="r_af" value="${esc(r.contact_address_fr || '')}" maxlength="200" ${dis}></label>
      <label class="f"><span>${t('addrAr')}</span><input id="r_aa" dir="rtl" value="${esc(r.contact_address_ar || '')}" maxlength="200" ${dis}></label></div>
      <button class="btn p" data-act="saveRules" ${dis}>${t('save')}</button></div>
      <div class="card"><h3>${t('closures')}</h3><div class="tools"><select id="c_t" ${dis}>${tOpts('', 'allT')}</select><label class="small">${t('from')} <input type="date" id="c_f" ${dis}></label><label class="small">${t('to')} <input type="date" id="c_to" ${dis}></label><input id="c_r" placeholder="${t('reason')}" maxlength="120" ${dis}><button class="btn p sm" data-act="addClos" ${dis}>${t('add')}</button></div>
      ${D.closures.length ? `<table class="stack"><thead><tr><th>${t('terrain')}</th><th>${t('from')}</th><th>${t('to')}</th><th>${t('reason')}</th><th></th></tr></thead><tbody>${D.closures.map((c) => `<tr><td>${c.terrain_id ? esc(tn(terr(c.terrain_id))) : t('allT')}</td><td>${fmtShort(c.date_from)}</td><td>${fmtShort(c.date_to)}</td><td>${esc(c.reason)}</td><td><button class="btn gh sm" data-act="delClos" data-id="${c.id}" ${dis}>${t('remove')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="muted">${t('nothing')}</p>`}</div>`;
  }

  function repRange() {
    const d = parse(A.rDate); let a, b;
    if (A.rPeriod === 'day') a = b = A.rDate;
    else if (A.rPeriod === 'week') { const m = monday(d); a = ymd(m); b = ymd(addDays(m, 6)); }
    else if (A.rPeriod === 'month') { a = ymd(new Date(d.getFullYear(), d.getMonth(), 1)); b = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
    else { a = d.getFullYear() + '-01-01'; b = d.getFullYear() + '-12-31'; }
    return [a, b];
  }
  function repData() {
    const [a, b] = repRange(); const R = D.res.filter((r) => r.date >= a && r.date <= b); const c = (f) => R.filter(f).length;
    return { a, b, R, rows: [[t('total'), R.length], [t('indiv'), c((r) => r.type === 'indiv')], [t('assocs'), c((r) => r.type === 'assoc')], [t('accepted'), c((r) => ['confirmed', 'done'].includes(r.status))], [t('refused'), c((r) => r.status === 'refused')], [t('cancelledR'), c((r) => r.status === 'cancelled')], [t('pendingR'), c((r) => r.status === 'pending')]], perT: D.terrains.map((T) => [tn(T), c((r) => r.terrain_id === T.id)]) };
  }
  function aRep() {
    const R = repData(), mx = Math.max(1, ...R.perT.map((x) => x[1]));
    return `<h2>${t('t_rep')}</h2><div class="card noprint"><div class="tools"><select data-f="rPeriod">${['day', 'week', 'month', 'year'].map((p) => `<option value="${p}" ${A.rPeriod === p ? 'selected' : ''}>${t('p_' + p)}</option>`).join('')}</select><label class="small">${t('ref')} <input type="date" data-f="rDate" value="${A.rDate}"></label><button class="btn p sm" data-act="csv">${t('xls')}</button><button class="btn gh sm" data-act="print">${t('pdf')}</button></div></div>
      <div class="card" id="printArea"><h3>${t('brand')} — ${t('report')} ${t('p_' + A.rPeriod).toLowerCase()}</h3><p class="muted">${fill(t('periodFromTo'), { a: fmtD(R.a), b: fmtD(R.b) })}</p><div class="two"><table><tbody>${R.rows.map((r) => `<tr><td>${r[0]}</td><td style="text-align:end;font-weight:700">${r[1]}</td></tr>`).join('')}</tbody></table><div><h3>${t('perT')}</h3>${R.perT.map((x) => `<div class="bar"><span>${esc(x[0])}</span><i style="width:${x[1] / mx * 100}%"></i><em>${x[1]}</em></div>`).join('')}</div></div></div>`;
  }
  function aLog() {
    if (!A.audit) { loadAudit(); return `<h2>${t('t_log')}</h2><div class="card"><p class="muted">${t('loading')}</p></div>`; }
    return `<h2>${t('t_log')}</h2><div class="card">${A.audit.length ? `<table class="stack"><thead><tr><th>${t('when')}</th><th>${t('who')}</th><th>${t('what')}</th><th>${t('detail')}</th></tr></thead><tbody>${A.audit.map((g) => `<tr><td class="num">${fmtTs(g.at)}</td><td>${g.actor ? (g.actor === A.me.user_id ? esc(A.me.display_name) : t('role_admin')) : t('citizen')}</td><td>${t('op_' + g.op)} · ${t('tbl_' + g.table_name)}</td><td class="small">${esc(describe(g))}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">${t('nothing')}</p>`}</div>`;
  }
  function describe(g) {
    const d = g.data || {};
    if (g.table_name === 'reservations') {
      const r = D.res.find((x) => x.id === g.reservation_id); const num = (r && r.num) || d.num || ('#' + g.row_id);
      if (g.op === 'UPDATE' && d.status) return num + ' : ' + t('st_' + d.status[0]) + ' → ' + t('st_' + d.status[1]);
      if (g.op === 'UPDATE') return num + ' : ' + Object.keys(d).join(', ');
      return num;
    }
    if (g.op === 'UPDATE') return Object.keys(d).join(', ');
    return d.reason || d.name_fr || '';
  }
  async function loadAudit() { try { A.audit = await q(sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300)); } catch (e) { A.audit = []; G.toast(esc(G.errMsg(e)), 'err'); } render(); }

  function aAccount() {
    const e = A.accErr || {}, ef = (k) => (e[k] ? `<em class="err">${e[k]}</em>` : '');
    return `<h2>${t('t_account')}</h2><div class="card" style="max-width:560px"><h3>${t('password')}</h3><p class="small muted">${t('signedAs')} <b class="ltr">${esc(A.session && A.session.user ? A.session.user.email : '')}</b> · ${t('role_' + A.me.role)}</p><p class="small muted">${t('accTxt')}</p>
      <form id="accF" autocomplete="off">${A.recovery ? '' : `<label class="f"><span>${t('curPass')} *</span><input type="password" id="a_cur" autocomplete="current-password" dir="ltr">${ef('cur')}</label>`}
      <label class="f"><span>${t('newPass')} *</span><input type="password" id="a_p1" autocomplete="new-password" dir="ltr"><small>${t('passRule')}</small>${ef('p1')}</label>
      <label class="f"><span>${t('newPass2')} *</span><input type="password" id="a_p2" autocomplete="new-password" dir="ltr">${ef('p2')}</label>
      <button class="btn p">${t('save')}</button></form></div>`;
  }

  /* ---------- rendu ---------- */
  function render() {
    G.applyDir(t('adminSpace'));
    let main;
    if (A.status === 'noconf') main = G.notConfiguredView();
    else if (A.status === 'boot' || A.status === 'loading') main = G.loadingView();
    else if (A.status === 'login') main = vLogin();
    else if (A.status === 'error') main = G.errorView();
    else main = vAdmin();
    G.paint(G.header('admin', null, t('adminSpace')) + '<main id="main">' + main + '</main>' + G.footer(D.settings));
  }

  /* ---------- actions ---------- */
  const resById = (id) => D.res.find((x) => x.id == id);
  async function setStatus(id, st) {
    try {
      const rows = await q(sb.from('reservations').update({ status: st }).eq('id', id).select());
      if (!rows || !rows.length) throw new Error('FORBIDDEN');
      const i = D.res.findIndex((x) => x.id == id); if (i >= 0) D.res[i] = nRes(rows[0]);
      G.toast(t('saved') + ' — ' + t('contactNeeded'));
    } catch (e) { G.toast(esc(e.message === 'FORBIDDEN' ? t('e_FORBIDDEN') : G.errMsg(e)), 'err', 6000); }
    render();
  }
  function resDetail(id) {
    const r = resById(id); if (!r) return;
    G.modal(`<h3>${esc(r.num)} ${badge(r.status)}</h3><dl class="recap"><dt>${t('terrain')}</dt><dd>${esc(tn(terr(r.terrain_id)))}</dd><dt>${t('date')}</dt><dd>${fmtD(r.date)}</dd><dt>${t('time')}</dt><dd class="ltr">${r.start} – ${r.end}</dd><dt>${t('type')}</dt><dd>${tbadge(r.type)}</dd>${r.type === 'assoc' ? `<dt>${t('assoc')}</dt><dd>${esc(r.assoc_name)}</dd>` : ''}<dt>${t('name')}</dt><dd>${esc(r.full_name)}</dd><dt>${t('phone')}</dt><dd class="ltr"><a href="tel:${esc(r.phone)}">${G.showPhone(r.phone)}</a></dd><dt>${t('created')}</dt><dd class="ltr">${fmtTs(r.created_at)}</dd>${r.decided_at ? `<dt>${t('decided')}</dt><dd class="ltr">${fmtTs(r.decided_at)}</dd>` : ''}${r.admin_note ? `<dt>${t('note')}</dt><dd>${esc(r.admin_note)}</dd>` : ''}</dl>
      <div style="margin-top:16px">${rowActs(r, true)}</div>
      <div class="nav2"><span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gh sm" data-act="hist" data-id="${r.id}">${t('hist')}</button>${can() ? `<button class="btn gh sm" data-act="askDel" data-id="${r.id}" style="color:var(--red)">${t('del')}</button>` : ''}</span><button class="btn gh" data-act="mClose">${t('close')}</button></div>`);
  }
  function editForm(id) {
    const r = resById(id); if (!r) return; const T = terr(r.terrain_id);
    G.modal(`<h3>${t('editRes')} · ${esc(r.num)}</h3><form id="editF" data-id="${r.id}"><label class="f"><span>${t('terrain')}</span><select id="e_t">${D.terrains.map((x) => `<option value="${x.id}" ${x.id === r.terrain_id ? 'selected' : ''}>${esc(tn(x))}</option>`).join('')}</select></label>
      <div class="tform"><label class="f"><span>${t('date')}</span><input type="date" id="e_d" value="${r.date}"></label><label class="f"><span>${t('start')}</span><select id="e_s">${slotsOf(T).map((s) => `<option ${s.start === r.start ? 'selected' : ''}>${s.start}</option>`).join('')}</select></label></div>
      ${r.type === 'assoc' ? `<label class="f"><span>${t('assocName')}</span><input id="e_a" value="${esc(r.assoc_name)}" maxlength="120"></label>` : ''}<label class="f"><span>${t('name')}</span><input id="e_n" value="${esc(r.full_name)}" maxlength="80"></label><label class="f"><span>${t('phone')}</span><input id="e_p" dir="ltr" value="${esc(r.phone)}" maxlength="20"></label>
      <label class="f"><span>${t('note')}</span><input id="e_note" value="${esc(r.admin_note || '')}" maxlength="300"></label><em class="err" id="e_err"></em>
      <div class="nav2"><button type="button" class="btn gh" data-act="mClose">${t('close')}</button><button class="btn p">${t('save')}</button></div></form>`);
  }
  async function saveEdit(id) {
    const r = resById(id), tid = +$('#e_t').value, d = $('#e_d').value, s = $('#e_s').value, n = $('#e_n').value.trim(), p = G.normPhone($('#e_p').value);
    if (!n || !d) { $('#e_err').textContent = t('errReq'); return; }
    if (!p) { $('#e_err').textContent = t('errPhone'); return; }
    const patch = { terrain_id: tid, date: d, start_time: s, end_time: toHM(toMin(s) + slot()), full_name: n, phone: p, admin_note: $('#e_note').value.trim() || null };
    if ($('#e_a')) patch.assoc_name = $('#e_a').value.trim();
    try {
      const rows = await q(sb.from('reservations').update(patch).eq('id', r.id).select());
      if (!rows.length) throw new Error('FORBIDDEN');
      Object.assign(r, nRes(rows[0])); G.closeModal(); G.toast(t('saved') + ' — ' + t('contactNeeded')); render();
    } catch (e) { $('#e_err').textContent = e.message === 'FORBIDDEN' ? t('e_FORBIDDEN') : G.errMsg(e); }
  }
  async function saveAccount() {
    const cur = $('#a_cur') ? $('#a_cur').value : '', p1 = $('#a_p1').value, p2 = $('#a_p2').value, e = {};
    if (p1.length < 10 || !/[A-Za-z؀-ۿ]/.test(p1) || !/\d/.test(p1)) e.p1 = t('errPass');
    else if (p1 !== p2) e.p2 = t('errMatch');
    if (!A.recovery) {
      if (!cur) e.cur = t('errReq');
      else if (!Object.keys(e).length) { const { error } = await sb.auth.signInWithPassword({ email: A.session.user.email, password: cur }); if (error) e.cur = t('errCur'); }
    }
    A.accErr = e; if (Object.keys(e).length) return render();
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) { A.accErr = { p1: esc(error.message) }; return render(); }
    A.recovery = false; A.tab = 'dash'; A.accErr = {}; G.toast(t('pwChanged')); render();
  }
  function csv() {
    const R = repData(), qv = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [[t('brand'), t('report') + ' ' + t('p_' + A.rPeriod)], [t('period'), R.a + ' → ' + R.b], [], ...R.rows, [], [t('perT')], ...R.perT, [],
      [t('num'), t('date'), t('time'), t('terrain'), t('type'), t('assoc'), t('name'), t('phone'), t('status')],
      ...R.R.map((r) => [r.num, r.date, r.start + '-' + r.end, tn(terr(r.terrain_id)), r.type === 'assoc' ? t('tAssoc') : t('tIndiv'), r.assoc_name, r.full_name, r.phone, t('st_' + r.status)])];
    const blob = new Blob(['﻿' + lines.map((l) => l.map(qv).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'rapport-guerdane-' + R.a + '_' + R.b + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  async function uploadImg(tid, file) {
    if (!can() || !file) return;
    if (file.size > 3 * 1024 * 1024) { G.toast('3 Mo max', 'err'); return; }
    G.toast(t('imgUploading'));
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '');
      const path = 'terrain-' + tid + '-' + Date.now() + '.' + ext;
      const up = await sb.storage.from('terrains').upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) throw up.error;
      const url = sb.storage.from('terrains').getPublicUrl(path).data.publicUrl;
      const rows = await q(sb.from('terrains').update({ image_url: url }).eq('id', tid).select());
      if (rows[0]) Object.assign(terr(tid), nTerr(rows[0]));
      G.toast(t('imgOk')); render();
    } catch (e) { G.toast(esc(G.errMsg(e)), 'err'); }
  }

  const H = {
    lang() { G.setLang(G.lang === 'fr' ? 'ar' : 'fr'); render(); },
    retry() { A.session ? afterLogin(A.session) : boot(); },
    refresh() { loadAll(); },
    async forgot() {
      const email = ($('#lu') && $('#lu').value.trim()) || '';
      if (!email) { A.loginErr = t('errReq') + ' (' + t('email') + ')'; return render(); }
      await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      A.loginErr = ''; A.info = t('resetSent'); render();
    },
    async logout() { stopLive(); await sb.auth.signOut(); A.session = null; A.me = null; A.status = 'login'; A.audit = null; render(); },
    tab(el) { A.tab = el.dataset.v; A.accErr = {}; if (A.tab === 'log') A.audit = null; render(); },
    setSt(el) { G.closeModal(); setStatus(el.dataset.id, el.dataset.v); },
    askSt(el) {
      const r = resById(el.dataset.id); const v = el.dataset.v;
      G.modal(`<h3>${t(v === 'refused' ? 'refuse' : 'cancel')} · ${esc(r.num)} ?</h3><p>${esc(r.type === 'assoc' ? r.assoc_name + ' — ' : '')}${esc(r.full_name)} · ${fmtD(r.date)} · <span class="ltr">${r.start}</span></p><p class="small muted">${t('contactNeeded')}</p><div class="nav2"><button class="btn gh" data-act="mClose">${t('no')}</button><button class="btn r" data-act="setSt" data-id="${r.id}" data-v="${v}">${t(v === 'refused' ? 'refuse' : 'cancel')}</button></div>`);
    },
    askDel(el) { const r = resById(el.dataset.id); G.modal(`<h3>${fill(t('confDelete'), { n: esc(r.num) })}</h3><div class="nav2"><button class="btn gh" data-act="mClose">${t('no')}</button><button class="btn r" data-act="doDel" data-id="${r.id}">${t('del')}</button></div>`); },
    async doDel(el) {
      G.closeModal();
      try { const rows = await q(sb.from('reservations').delete().eq('id', el.dataset.id).select()); if (!rows.length) throw new Error('FORBIDDEN'); D.res = D.res.filter((x) => x.id != el.dataset.id); G.toast(t('deleted')); }
      catch (e) { G.toast(esc(e.message === 'FORBIDDEN' ? t('e_FORBIDDEN') : G.errMsg(e)), 'err'); }
      render();
    },
    openRes(el) { resDetail(el.dataset.id); },
    edit(el) { editForm(el.dataset.id); },
    async hist(el) {
      const r = resById(el.dataset.id);
      try {
        const rows = await q(sb.from('audit_log').select('*').eq('reservation_id', r.id).order('at', { ascending: true }));
        G.modal(`<h3>${t('hist')} · ${esc(r.num)}</h3><table><tbody>${rows.map((h) => `<tr><td class="num">${fmtTs(h.at)}</td><td>${h.actor ? t('role_admin') : t('citizen')}</td><td>${t('op_' + h.op)}${h.data && h.data.status && Array.isArray(h.data.status) ? ' : ' + t('st_' + h.data.status[0]) + ' → ' + t('st_' + h.data.status[1]) : ''}</td></tr>`).join('')}</tbody></table><div class="nav2"><span></span><button class="btn gh" data-act="mClose">${t('close')}</button></div>`);
      } catch (e) { G.toast(esc(G.errMsg(e)), 'err'); }
    },
    fReset() { Object.assign(A, { q: '', fDate: '', fTerr: '', fType: '', fStatus: '' }); render(); },
    pView(el) { A.pView = el.dataset.v; render(); },
    pMove(el) { const v = +el.dataset.v, d = parse(A.pDate); if (!v) A.pDate = G.today(); else if (A.pView === 'day') A.pDate = ymd(addDays(d, v)); else if (A.pView === 'week') A.pDate = ymd(addDays(d, 7 * v)); else A.pDate = ymd(new Date(d.getFullYear(), d.getMonth() + v, 1)); render(); },
    goDay(el) { A.pDate = el.dataset.d; A.pView = 'day'; render(); },
    async saveT(el) {
      if (!can()) return G.toast(t('noRight'), 'err');
      const id = +el.dataset.id, g = (k) => $('#tf' + id + '_' + k);
      if (!g('nf').value.trim() || g('o').value >= g('c').value) return G.toast(t('errReq'), 'err');
      const patch = { name_fr: g('nf').value.trim(), name_ar: g('na').value.trim() || g('nf').value.trim(), desc_fr: g('df').value.trim(), desc_ar: g('da').value.trim(),
        open_time: g('o').value, close_time: g('c').value, open_days: [0, 1, 2, 3, 4, 5, 6].filter((i) => g('d' + i).checked), active: g('a').checked, closed_reason: g('r').value.trim() || null };
      try { const rows = await q(sb.from('terrains').update(patch).eq('id', id).select()); if (!rows.length) throw new Error('FORBIDDEN'); Object.assign(terr(id), nTerr(rows[0])); G.toast(t('saved')); }
      catch (e) { G.toast(esc(e.message === 'FORBIDDEN' ? t('e_FORBIDDEN') : G.errMsg(e)), 'err'); }
      render();
    },
    async addBlock() {
      const tid = +$('#bT').value, d = $('#bD').value, s = $('#bS').value;
      if (!d || !s) return G.toast(t('errReq'), 'err');
      try { const rows = await q(sb.from('blocks').insert({ terrain_id: tid, date: d, start_time: s, end_time: toHM(toMin(s) + slot()), reason: $('#bR').value.trim() || null }).select()); D.blocks.push(...rows.map(nBlock)); G.toast(t('saved')); }
      catch (e) { G.toast(esc(G.errMsg(e)), 'err'); }
      render();
    },
    async delBlock(el) { try { await q(sb.from('blocks').delete().eq('id', el.dataset.id)); D.blocks = D.blocks.filter((b) => b.id != el.dataset.id); } catch (e) { G.toast(esc(G.errMsg(e)), 'err'); } render(); },
    async saveRules() {
      if (!can()) return;
      const num = (id, lo, hi) => Math.min(hi, Math.max(lo, parseInt($(id).value, 10) || lo));
      const patch = { slot_minutes: +$('#r_slot').value, min_delay_hours: num('#r_min', 0, 168), max_days_ahead: num('#r_max', 1, 365), cancel_hours: num('#r_can', 0, 168), max_active_per_phone: num('#r_lim', 1, 20),
        contact_phone: $('#r_tel').value.trim() || null, contact_address_fr: $('#r_af').value.trim() || null, contact_address_ar: $('#r_aa').value.trim() || null };
      try { const rows = await q(sb.from('settings').update(patch).eq('id', true).select()); if (!rows.length) throw new Error('FORBIDDEN'); D.settings = rows[0]; G.toast(t('saved')); }
      catch (e) { G.toast(esc(e.message === 'FORBIDDEN' ? t('e_FORBIDDEN') : G.errMsg(e)), 'err'); }
      render();
    },
    async addClos() {
      const f = $('#c_f').value, to = $('#c_to').value || f; if (!f) return G.toast(t('errReq'), 'err');
      try { const rows = await q(sb.from('closures').insert({ terrain_id: $('#c_t').value ? +$('#c_t').value : null, date_from: f <= to ? f : to, date_to: f <= to ? to : f, reason: $('#c_r').value.trim() || null }).select()); D.closures.push(...rows); G.toast(t('saved')); }
      catch (e) { G.toast(esc(G.errMsg(e)), 'err'); }
      render();
    },
    async delClos(el) { try { await q(sb.from('closures').delete().eq('id', el.dataset.id)); D.closures = D.closures.filter((c) => c.id != el.dataset.id); } catch (e) { G.toast(esc(G.errMsg(e)), 'err'); } render(); },
    csv,
    print() { try { window.print(); } catch (e) {} },
    mClose() { G.closeModal(); }
  };

  document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (!el || el.disabled) return; const f = H[el.dataset.act]; if (f) { e.preventDefault(); f(el); } });
  document.addEventListener('input', (e) => { const el = e.target; if (el.dataset.f === 'q') { A.q = el.value; const n = $('#resList'); if (n) n.innerHTML = resTable(filtered().slice(0, 300)); } });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.f && el.dataset.f !== 'q') { A[el.dataset.f] = el.dataset.f === 'bT' ? +el.value : el.value; render(); }
    if (el.dataset.img) uploadImg(+el.dataset.img, el.files[0]);
    if (el.id === 'e_t') { const T = terr(+el.value); $('#e_s').innerHTML = slotsOf(T).map((s) => `<option>${s.start}</option>`).join(''); }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'loginF') {
      e.preventDefault(); if (A.busy) return;
      const email = $('#lu') ? $('#lu').value.trim() : '', password = $('#lp') ? $('#lp').value : '';
      A.busy = true; A.loginErr = ''; A.info = ''; render();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      A.busy = false;
      if (error || !data || !data.session) { A.loginErr = t('badLogin'); return render(); }
      afterLogin(data.session);
    }
    if (e.target.id === 'accF') { e.preventDefault(); saveAccount(); }
    if (e.target.id === 'editF') { e.preventDefault(); saveEdit(e.target.dataset.id); }
  });

  boot();
  window.__admin = { A, D };   // utilisé par les tests automatiques
})();
