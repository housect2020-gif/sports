/* cloud.js — login, approval gate, and cloud saving for the sports sites.
 * Include AFTER the supabase-js script and BEFORE the page's own script:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
 *   <script src="cloud.js"></script>
 * Only the project URL and the PUBLISHABLE key live here (safe to publish).
 * What each person can see/write is enforced by the database rules, not by this file.
 */
(function () {
  'use strict';

  // Folder this file lives in (the hub's home page), used for the "All sports" link.
  var HUB = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/cloud\.js.*$/, '') : '/';
  var SUPABASE_URL = 'https://owobaxyhkrdpgxclewzp.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_q2nOOuJTNJWPjPIUKCO0pg_2Ta3PteP';

  // localStorage keys that follow the person across browsers. Team-points and
  // records caches are re-derived from ESPN, so they stay local.
  // Keys that follow the person across browsers (all four sports share one login).
  var SYNC_RE = /^(?:(?:nba|wnba)_(?!teamPts_|records_|snap_)|mlb_site_picks_v1$|nfl_site_picks_v1$)/;
  var HISTORY_RE = /_history_v1$/;     // object keyed by game id -> merged field by field
  var PICKS_RE = /_site_picks_v1$/;    // array of {id,...} -> merged once per browser, then the cloud copy wins

  var sb = null, user = null, profile = null;
  var state = 'loading'; // loading | out | pending | approved | error
  var syncOn = false;
  var blockWrites = false;   // true while we're about to reload after merging, so the page can't overwrite the merge
  var settleAuth; var authSettled = new Promise(function (r) { settleAuth = r; });
  var pending = new Map();
  var timer = null;
  var seen = {};            // key -> updated_at last known (for live sync)
  var approvedWaiters = [];

  // ---- hook localStorage writes so synced keys are queued for the cloud ----
  var rawSet = Storage.prototype.setItem;
  var rawRemove = Storage.prototype.removeItem;
  function isLocal(self) { try { return self === window.localStorage; } catch (e) { return false; } }
  Storage.prototype.setItem = function (k, v) {
    if (blockWrites && isLocal(this) && SYNC_RE.test(k)) return;
    rawSet.call(this, k, v);
    if (syncOn && isLocal(this) && SYNC_RE.test(k)) queue(k, String(v));
  };
  Storage.prototype.removeItem = function (k) {
    if (blockWrites && isLocal(this) && SYNC_RE.test(k)) return;
    rawRemove.call(this, k);
    if (syncOn && isLocal(this) && SYNC_RE.test(k)) queue(k, null);
  };

  function queue(k, v) {
    pending.set(k, v);
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }

  async function flush() {
    if (!sb || !user || !pending.size) return;
    var items = Array.from(pending.entries());
    pending.clear();
    var ups = items.filter(function (e) { return e[1] !== null; }).map(function (e) {
      return { user_id: user.id, key: e[0], value: { v: e[1] }, updated_at: new Date().toISOString() };
    });
    var dels = items.filter(function (e) { return e[1] === null; }).map(function (e) { return e[0]; });
    try {
      ups.forEach(function (u) { seen[u.key] = u.updated_at; });
      if (ups.length) {
        var r1 = await sb.from('user_data').upsert(ups, { onConflict: 'user_id,key' });
        if (r1.error) throw r1.error;
      }
      if (dels.length) {
        var r2 = await sb.from('user_data').delete().eq('user_id', user.id).in('key', dels);
        if (r2.error) throw r2.error;
      }
      setSaved(true);
    } catch (e) {
      console.warn('[cloud] save failed, will retry', e);
      items.forEach(function (e2) { if (!pending.has(e2[0])) pending.set(e2[0], e2[1]); });
      setSaved(false);
      timer = setTimeout(flush, 15000);
    }
  }
  window.addEventListener('pagehide', function () { flush(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  // ---- pull from the cloud on sign-in; merge with what this browser has ----
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsKeys() {
    var out = [];
    try { for (var i = 0; i < window.localStorage.length; i++) out.push(window.localStorage.key(i)); } catch (e) {}
    return out;
  }

  function mergeHistory(cloudStr, localStr) {
    var c = {}, l = {};
    try { c = JSON.parse(cloudStr || '{}') || {}; } catch (e) {}
    try { l = JSON.parse(localStr || '{}') || {}; } catch (e) {}
    var out = {};
    Object.keys(c).concat(Object.keys(l)).forEach(function (id) {
      out[id] = Object.assign({}, c[id] || {}, l[id] || {});
    });
    return JSON.stringify(out);
  }

  function metaKey(k) { return 'cloudmeta_' + (user ? user.id : '') + '_' + k; }
  function mergePicks(cloudStr, localStr, firstTime) {
    if (!firstTime) return cloudStr;
    var c = [], l = [];
    try { c = JSON.parse(cloudStr || '[]') || []; } catch (e) {}
    try { l = JSON.parse(localStr || '[]') || []; } catch (e) {}
    var ids = {};
    c.forEach(function (p) { ids[p && p.id] = true; });
    return JSON.stringify(c.concat(l.filter(function (p) { return p && !ids[p.id]; })));
  }
  function mergeFor(k, cloudStr, localStr) {
    if (HISTORY_RE.test(k)) return mergeHistory(cloudStr, localStr);
    if (PICKS_RE.test(k)) {
      var first = lsGet(metaKey(k)) !== '1';
      var out = mergePicks(cloudStr, localStr, first);
      rawSet.call(window.localStorage, metaKey(k), '1');
      return out;
    }
    return cloudStr;
  }

  async function pull() {
    var res = await sb.from('user_data').select('key,value,updated_at');
    if (res.error) { console.warn('[cloud] load failed', res.error); return; }
    var cloud = {};
    (res.data || []).forEach(function (r) { cloud[r.key] = r.value && r.value.v; seen[r.key] = r.updated_at; });
    var changed = false;

    Object.keys(cloud).forEach(function (k) {
      if (!SYNC_RE.test(k) || typeof cloud[k] !== 'string') return;
      var local = lsGet(k);
      var next = mergeFor(k, cloud[k], local);
      if (next !== local) { rawSet.call(window.localStorage, k, next); changed = true; }
      if (next !== cloud[k]) queue(k, next);
    });
    // anything this browser has that the cloud doesn't -> upload it once
    lsKeys().forEach(function (k) {
      if (SYNC_RE.test(k) && !(k in cloud)) {
        queue(k, lsGet(k));
        if (PICKS_RE.test(k)) rawSet.call(window.localStorage, metaKey(k), '1');
      }
    });

    var flag = null;
    try { flag = sessionStorage.getItem('cloud_reloaded'); } catch (e) {}
    var willReload = changed && flag !== '1';
    if (willReload) blockWrites = true;
    // Upload anything merged above BEFORE the reload, so nothing is lost.
    if (pending.size) { clearTimeout(timer); await flush(); }
    if (willReload) {
      try { sessionStorage.setItem('cloud_reloaded', '1'); } catch (e) {}
      location.reload(); // re-render the page with the saved entries
    } else if (!changed) {
      try { sessionStorage.removeItem('cloud_reloaded'); } catch (e) {}
    }
  }

  // ---- live sync: every few seconds, look for entries changed on another device ----
  var POLL_MS = 8000;
  async function poll() {
    if (!syncOn || !sb || !user || document.hidden) return;
    try {
      var since = new Date(Date.now() - 2 * 86400000).toISOString();
      var r = await sb.from('user_data').select('key,updated_at').gte('updated_at', since);
      if (r.error || !r.data) return;
      var changed = r.data.filter(function (x) {
        return SYNC_RE.test(x.key) && seen[x.key] !== x.updated_at && !pending.has(x.key);
      }).map(function (x) { return x.key; });
      if (!changed.length) return;
      var v = await sb.from('user_data').select('key,value,updated_at').in('key', changed);
      if (v.error || !v.data) return;
      var applied = [];
      v.data.forEach(function (row) {
        seen[row.key] = row.updated_at;
        var val = row.value && row.value.v;
        if (typeof val !== 'string' || pending.has(row.key)) return;
        var local = lsGet(row.key);
        var next = HISTORY_RE.test(row.key) ? mergeHistory(val, local) : val;
        if (next !== local) { rawSet.call(window.localStorage, row.key, next); applied.push(row.key); }
      });
      if (applied.length) {
        var ev = new CustomEvent('cloud-keys', { detail: { keys: applied }, cancelable: true });
        var go = window.dispatchEvent(ev);
        // Pages without their own live-update code (MLB/NFL picks) just reload to show the change.
        if (go && window.CLOUD_RELOAD_ON_REMOTE) {
          var a = document.activeElement;
          if (!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) location.reload();
        }
      }
    } catch (e) { console.warn('[cloud] live sync check failed', e); }
  }
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  // ---- shared pre-game odds written by the server job ----
  async function fetchPreOdds(league, ids) {
    if (state === 'loading') {
      await Promise.race([authSettled, new Promise(function (r) { setTimeout(r, 4000); })]);
    }
    if (state !== 'approved' || !ids || !ids.length) return {};
    var res = await sb.from('games').select('game_id,pre_odds').eq('league', league)
      .in('game_id', ids.map(String));
    var out = {};
    if (res.error || !res.data) return out;
    res.data.forEach(function (r) { if (r.pre_odds != null) out[r.game_id] = Number(r.pre_odds); });
    return out;
  }

  // ---- UI: sign-in / waiting screen and the small account bar ----
  var css = '' +
    '#cloudGate{position:fixed;inset:0;z-index:99999;background:#f4f6f8;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}' +
    '#cloudGate .card{background:#fff;border:1px solid #d0d3d8;border-radius:10px;max-width:380px;width:100%;padding:22px;box-shadow:0 2px 10px rgba(0,0,0,.06);color:#202124}' +
    '#cloudGate h2{margin:0 0 6px;font-size:18px}#cloudGate p{margin:6px 0 12px;font-size:14px;color:#3c4043;line-height:1.4}' +
    '#cloudGate input{width:100%;box-sizing:border-box;padding:9px 10px;font-size:15px;border:1px solid #b9bdc3;border-radius:6px;margin-bottom:10px}' +
    '#cloudGate button,#cloudAdmin button,#cloudBar button{cursor:pointer;border:1px solid #1a73e8;background:#1a73e8;color:#fff;border-radius:6px;padding:8px 12px;font-size:14px}' +
    '#cloudGate button.sec,#cloudAdmin button.sec,#cloudBar button{background:#fff;color:#1a73e8}' +
    '#cloudGate .msg{font-size:13px;color:#188038;min-height:18px}#cloudGate .err{color:#c5221f}' +
    '#cloudBar{position:fixed;right:6px;bottom:6px;z-index:9000;background:rgba(255,255,255,.92);border:1px solid #d0d3d8;border-radius:6px;padding:3px 6px;font:11px system-ui,sans-serif;color:#3c4043;display:none;gap:6px;align-items:center}' +
    '#cloudBar button{padding:1px 6px;font-size:11px}' +
    '#cloudAdmin{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif}' +
    '#cloudAdmin .card{background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:80vh;overflow:auto;padding:16px;color:#202124}' +
    '#cloudAdmin table{width:100%;border-collapse:collapse;font-size:13px}#cloudAdmin td,#cloudAdmin th{border-bottom:1px solid #e3e5e8;padding:6px 4px;text-align:left}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var gate = document.createElement('div');
  gate.id = 'cloudGate';
  var bar = document.createElement('div');
  bar.id = 'cloudBar';
  var admin = document.createElement('div');
  admin.id = 'cloudAdmin';

  function mount() {
    document.body.appendChild(gate);
    document.body.appendChild(bar);
    document.body.appendChild(admin);
    render();
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var saved = true;
  function setSaved(ok) { saved = ok; renderBar(); }

  function render() {
    if (!document.body) return;
    if (state === 'approved') { gate.style.display = 'none'; renderBar(); return; }
    bar.style.display = 'none';
    gate.style.display = 'flex';
    var h = '<div class="card">';
    if (state === 'loading') {
      h += '<h2>Loading…</h2>';
    } else if (state === 'error') {
      h += '<h2>Couldn\'t reach the login service</h2><p>Check your connection and reload the page.</p>';
    } else if (state === 'out') {
      h += '<h2>Sign in</h2><p>Enter your email and we\'ll send you a sign-in link. New accounts need approval before they can use the site.</p>' +
        '<input id="cgEmail" type="email" placeholder="you@gmail.com" autocomplete="email">' +
        '<button id="cgSend">Send sign-in link</button><div class="msg" id="cgMsg"></div>';
    } else if (state === 'pending') {
      h += '<h2>Waiting for approval</h2><p>You\'re signed in as <b>' + esc(user && user.email) + '</b>. The site owner needs to approve your account before you can use it.</p>' +
        '<button id="cgRefresh">Check again</button> <button class="sec" id="cgOut">Sign out</button>';
    }
    h += '</div>';
    gate.innerHTML = h;
    var send = document.getElementById('cgSend');
    if (send) send.onclick = sendLink;
    var em = document.getElementById('cgEmail');
    if (em) em.onkeydown = function (e) { if (e.key === 'Enter') sendLink(); };
    var rf = document.getElementById('cgRefresh');
    if (rf) rf.onclick = function () { location.reload(); };
    var so = document.getElementById('cgOut');
    if (so) so.onclick = signOut;
  }

  function renderBar() {
    if (state !== 'approved') { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '<a href="' + HUB + '" style="color:#1a73e8;text-decoration:none;font-weight:600">⌂ All sports</a>' +
      '<span>' + (saved ? '☁ saved' : '☁ offline — will retry') + ' · ' + esc(user && user.email) + '</span>' +
      (profile && profile.is_admin ? '<button id="cbAdmin">Admin</button>' : '') +
      '<button id="cbOut">Sign out</button>';
    var o = document.getElementById('cbOut'); if (o) o.onclick = signOut;
    var a = document.getElementById('cbAdmin'); if (a) a.onclick = openAdmin;
  }

  async function sendLink() {
    var email = (document.getElementById('cgEmail').value || '').trim();
    var msg = document.getElementById('cgMsg');
    if (!email) { msg.className = 'msg err'; msg.textContent = 'Enter your email first.'; return; }
    msg.className = 'msg'; msg.textContent = 'Sending…';
    var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (r.error) { msg.className = 'msg err'; msg.textContent = r.error.message; return; }
    msg.textContent = 'Check your email and click the link. You can close this tab.';
  }

  async function signOut() {
    try { await flush(); } catch (e) {}
    await sb.auth.signOut();
    try { sessionStorage.removeItem('cloud_reloaded'); } catch (e) {}
    location.reload();
  }

  async function openAdmin() {
    admin.style.display = 'flex';
    admin.innerHTML = '<div class="card"><b>Loading…</b></div>';
    var r = await sb.from('profiles').select('id,email,approved,is_admin,created_at').order('created_at');
    if (r.error) { admin.innerHTML = '<div class="card">' + esc(r.error.message) + ' <button class="sec" id="adClose">Close</button></div>'; document.getElementById('adClose').onclick = closeAdmin; return; }
    var rows = (r.data || []).map(function (p) {
      var st = p.is_admin ? 'Admin' : (p.approved ? 'Approved' : 'Pending');
      var btn = p.is_admin ? '' : (p.approved
        ? '<button class="sec" data-id="' + p.id + '" data-v="0">Revoke</button>'
        : '<button data-id="' + p.id + '" data-v="1">Approve</button>');
      return '<tr><td>' + esc(p.email) + '</td><td>' + st + '</td><td>' + btn + '</td></tr>';
    }).join('');
    admin.innerHTML = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Users</b><button class="sec" id="adClose">Close</button></div>' +
      '<table><tr><th>Email</th><th>Status</th><th></th></tr>' + rows + '</table></div>';
    document.getElementById('adClose').onclick = closeAdmin;
    admin.querySelectorAll('button[data-id]').forEach(function (b) {
      b.onclick = async function () {
        var u = await sb.from('profiles').update({ approved: b.getAttribute('data-v') === '1' }).eq('id', b.getAttribute('data-id'));
        if (u.error) alert(u.error.message);
        openAdmin();
      };
    });
  }
  function closeAdmin() { admin.style.display = 'none'; }

  // ---- session handling ----
  async function loadProfile() {
    for (var i = 0; i < 3; i++) {
      var r = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (r.data) return r.data;
      await new Promise(function (res) { setTimeout(res, 600); });
    }
    return null;
  }

  var handling = false;
  async function handle(session) {
    if (handling) return;
    if (session && state === 'approved' && user && session.user.id === user.id) return; // token refresh etc.
    handling = true;
    try {
      if (!session) { user = null; profile = null; syncOn = false; state = 'out'; render(); return; }
      user = session.user;
      profile = await loadProfile();
      if (profile && profile.approved) {
        state = 'approved';
        render();
        approvedWaiters.splice(0).forEach(function (f) { f(); });
        await pull();
        syncOn = true;
        flush();
      } else {
        state = 'pending';
        render();
      }
    } catch (e) {
      console.error('[cloud]', e);
      state = 'error';
      render();
    } finally { handling = false; settleAuth(); }
  }

  if (!window.supabase) {
    state = 'error'; settleAuth();
  } else {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    sb.auth.onAuthStateChange(function (evt, session) {
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN') handle(session);
      else if (evt === 'SIGNED_OUT') handle(null);
    });
  }

  window.cloud = {
    fetchPreOdds: fetchPreOdds,
    whenApproved: function () { return state === 'approved' ? Promise.resolve() : new Promise(function (res) { approvedWaiters.push(res); }); },
    get sb() { return sb; },
    get state() { return state; },
    get user() { return user; }
  };
})();
