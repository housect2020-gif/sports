// Shared by the Matchup Lab page and the live sheet: season quarter data, tiers, matchup types and the projected total.
(function(){
const ABBR3 = { NY:"NYK", GS:"GSW", NO:"NOP", SA:"SAS", UTAH:"UTA", WSH:"WAS" };
const abbr3 = a => (a && ABBR3[a]) || a;
const SEASON_START = '2026-10-01';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const CACHE_KEY = 'nba_q4_cache_v1';
const PROXIES = [
  url => url,
  url => "https://corsproxy.io/?url=" + encodeURIComponent(url),
  url => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
  url => "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(url)
];
const TYPE_NAMES = { GG:'Good vs Good', GM:'Good vs Mid', GB:'Good vs Bad', MM:'Mid vs Mid', MB:'Mid vs Bad', BB:'Bad vs Bad' };
const TYPE_ORDER = ['GG','GM','GB','MM','MB','BB'];
const RANKV = { G:3, M:2, B:1 };

function todayStr(){ return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); }
function sportsDay(){ return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 4 * 3600 * 1000)); }
function ymd(s){ return s.replaceAll('-', ''); }
function addDays(s, n){ const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function loadCache(){ try{ return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }catch(e){ return {}; } }
function saveCache(c){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }catch(e){} }
const f1 = v => (v == null || isNaN(v)) ? '–' : v.toFixed(1);

async function getJson(url){
  for(const wrap of PROXIES){
    try{
      const res = await fetch(wrap(url), { cache: 'no-store' });
      if(!res.ok) continue;
      return await res.json();
    }catch(e){}
  }
  return null;
}

// one day of ESPN games -> { done: [finished games with quarter scores], today: [all games] }
function parseDay(json, dateStr){
  const done = [], all = [];
  (json.events || []).forEach(ev => {
    const comp = ev.competitions && ev.competitions[0]; if(!comp) return;
    const st = ev.season && ev.season.type;
    if(st === 1) return;
    const away = (comp.competitors || []).find(c => c.homeAway === 'away');
    const home = (comp.competitors || []).find(c => c.homeAway === 'home');
    if(!away || !home) return;
    const state = comp.status && comp.status.type && comp.status.type.state;
    const a = abbr3(away.team.abbreviation), h = abbr3(home.team.abbreviation);
    let line = null;
    const o = comp.odds && comp.odds[0];
    if(o && typeof o.overUnder === 'number') line = o.overUnder;
    all.push({ id: String(ev.id || ''), away: a, home: h, state, start: ev.date, line, details: (o && o.details) || '', playoff: st === 3, text: (comp.status && comp.status.type && comp.status.type.shortDetail) || '' });
    if(state !== 'post' || st === 3) return;
    const q = c => (c.linescores || []).slice(0, 4).map(x => Number(x.value));
    const qa = q(away), qh = q(home);
    if(qa.length < 4 || qh.length < 4 || qa.concat(qh).some(isNaN)) return;
    done.push({ date: dateStr, away: a, home: h, qa, qh, sa: Number(away.score), sh: Number(home.score) });
  });
  return { done, all };
}

async function loadSeason(){
  const cache = loadCache(), today = todayStr(), games = [];
  let cursor = SEASON_START, fetched = 0, failed = 0;
  while(cursor < today){
    if(cache[cursor] !== undefined){ games.push(...cache[cursor]); }
    else {
      const json = await getJson(`${BASE}?dates=${ymd(cursor)}`);
      if(json){ const d = parseDay(json, cursor).done; cache[cursor] = d; games.push(...d); fetched++; if(fetched % 10 === 0) saveCache(cache); }
      else failed++;
      const rs = document.getElementById('rangeSub'); if(rs) rs.textContent = `Loading season… ${cursor} (${games.length} games)`;
    }
    cursor = addDays(cursor, 1);
  }
  saveCache(cache);
  return { games, failed };
}

// ---------- tiers & profiles ----------
function buildProfiles(games){
  const P = {};
  const t = x => (P[x] = P[x] || { team:x, g:0, w:0, l:0, pf:0, pa:0, q:[0,0,0,0], qa:[0,0,0,0] });
  games.forEach(g => {
    [[g.away, g.qa, g.qh, g.sa, g.sh], [g.home, g.qh, g.qa, g.sh, g.sa]].forEach(([tm, mine, theirs, s, o]) => {
      const p = t(tm); p.g++; p.pf += s; p.pa += o; if(s > o) p.w++; else p.l++;
      for(let i = 0; i < 4; i++){ p.q[i] += mine[i]; p.qa[i] += theirs[i]; }
    });
  });
  Object.values(P).forEach(p => {
    p.ppg = p.pf / p.g; p.opp = p.pa / p.g; p.pct = p.w / p.g; p.diff = p.ppg - p.opp;
    p.qAvg = p.q.map(v => v / p.g); p.qaAvg = p.qa.map(v => v / p.g);
    p.q4 = p.qAvg[3]; p.q4a = p.qaAvg[3]; p.q4net = p.q4 - p.q4a;
    p.f3 = p.qAvg[0] + p.qAvg[1] + p.qAvg[2]; p.f3a = p.qaAvg[0] + p.qaAvg[1] + p.qaAvg[2];
    p.q4share = p.q4 / p.ppg * 100;
  });
  return P;
}
function assignTiers(P, standingsRows){
  // order by win% then point differential; use the ESPN standings feed when it is available
  const rows = Object.values(P).map(p => ({ team:p.team, pct:p.pct, diff:p.diff }));
  if(standingsRows){ standingsRows.forEach(s => { const r = rows.find(x => x.team === s.team); if(r){ r.pct = s.pct; r.diff = s.diff != null ? s.diff : r.diff; } }); }
  rows.sort((a, b) => b.pct - a.pct || b.diff - a.diff);
  const n = rows.length;
  rows.forEach((r, i) => {
    const p = P[r.team]; p.rank = i + 1;
    p.tier = i < Math.round(n / 3) ? 'G' : (i >= n - Math.round(n / 3) ? 'B' : 'M');
  });
}
function typeOf(P, a, b){
  const ta = P[a] && P[a].tier, tb = P[b] && P[b].tier;
  if(!ta || !tb) return null;
  const [hi, lo] = RANKV[ta] >= RANKV[tb] ? [ta, tb] : [tb, ta];
  return hi + lo;
}

const TIERWORD = { G:'Good', M:'Mid', B:'Bad' };
// Display label in game order: away team's tier first, then home team's ("Mid vs Good" for MID @ GOOD)
function typeLabel(P, away, home, type){
  const ta = P && P[away] && P[away].tier, tb = P && P[home] && P[home].tier;
  const w = t => TIERWORD[String(t).charAt(0).toUpperCase()];
  if(w(ta) && w(tb)) return w(ta) + ' vs ' + w(tb);
  return type ? TYPE_NAMES[type] : null;
}

function buildTypeStats(P, games){
  const S = {};
  TYPE_ORDER.forEach(k => S[k] = { n:0, tot:0, f3:0, q4:0, strongQ4:0, weakQ4:0, strongN:0, margin:0 });
  games.forEach(g => {
    const k = typeOf(P, g.away, g.home); if(!k) return;
    const s = S[k], q4 = g.qa[3] + g.qh[3];
    s.n++; s.tot += g.sa + g.sh; s.q4 += q4; s.f3 += (g.sa + g.sh) - q4; s.margin += Math.abs(g.sa - g.sh);
    const ta = RANKV[P[g.away].tier], th = RANKV[P[g.home].tier];
    if(ta !== th){ const strongIsAway = ta > th; s.strongQ4 += strongIsAway ? g.qa[3] : g.qh[3]; s.weakQ4 += strongIsAway ? g.qh[3] : g.qa[3]; s.strongN++; }
  });
  return S;
}

// ---------- projection ----------
function project(P, TS, a, b){
  const A = P[a], B = P[b]; if(!A || !B || A.g < 3 || B.g < 3) return null;
  const f3 = (A.f3 + B.f3a) / 2 + (B.f3 + A.f3a) / 2;
  const q4team = (A.q4 + B.q4a) / 2 + (B.q4 + A.q4a) / 2;
  const k = typeOf(P, a, b), ts = k && TS[k];
  const q4label = ts && ts.n >= 8 ? ts.q4 / ts.n : q4team;
  const q4 = 0.5 * q4team + 0.5 * q4label;
  return { total: f3 + q4, f3, q4, q4team, q4label, type: k };
}

async function standingsRows(){
  const j = await getJson(STANDINGS_URL); if(!j) return null;
  const out = [];
  try{
    (j.children || []).forEach(c => ((c.standings && c.standings.entries) || []).forEach(e => {
      const st = n => { const s = (e.stats || []).find(x => x.name === n); return s ? s.value : null; };
      const w = st('wins'), l = st('losses');
      if(w == null || l == null || w + l === 0) return;
      out.push({ team: abbr3(e.team.abbreviation), pct: w / (w + l), diff: st('avgPointsFor') != null && st('avgPointsAgainst') != null ? st('avgPointsFor') - st('avgPointsAgainst') : null });
    }));
  }catch(e){ return null; }
  return out.length >= 20 ? out : null;
}



// ---------- the pre-game verdict ----------
// Rule: favorite (from the spread text) at home -> Under, on the road -> Over. No pick when the spread is 0 / even.
function rulePick(details, away, home){
  const m = /([A-Za-z]{2,4})\s*([+-]?\d+(?:\.\d+)?)/.exec(details || '');
  if(!m) return null;
  const spread = Math.abs(parseFloat(m[2]));
  if(!spread) return null;
  const fav = abbr3(m[1].toUpperCase());
  if(fav === home) return 'Under';
  if(fav === away) return 'Over';
  return null;
}
// BET = rule and model agree and the model is 3+ points from the book total; LEAN = agree but closer;
// SKIP = they disagree; NONE = no edge (model within 1 point of the book) or something missing.
function verdict(rule, proj, ref){
  if(proj == null || ref == null) return { code:'NONE', side:null, gap:null, label:'NO DATA', why:'Not enough data yet for a model total or book total.' };
  const gap = proj - ref, mside = Math.abs(gap) < 1 ? null : (gap > 0 ? 'Over' : 'Under');
  if(!rule) return { code:'NONE', side:null, gap, mside, label:'NO EDGE', why:'The rule has no pick (even spread).' };
  if(!mside) return { code:'NONE', side:null, gap, mside, label:'NO EDGE', why:'The model total is within 1 point of the book total.' };
  if(mside === rule) return Math.abs(gap) >= 3
    ? { code:'BET', side:rule, gap, mside, label:'BET ' + rule.toUpperCase(), why:'Rule and model agree, and the model is ' + Math.abs(gap).toFixed(1) + ' points ' + (gap > 0 ? 'above' : 'below') + ' the book.' }
    : { code:'LEAN', side:rule, gap, mside, label:'LEAN ' + rule.toUpperCase(), why:'Rule and model agree, but the model is only ' + Math.abs(gap).toFixed(1) + ' points from the book.' };
  return { code:'SKIP', side:null, gap, mside, label:'SKIP', why:'Mixed signals: the rule says ' + rule + ', the model says ' + mside + '.' };
}

// ---------- injuries (ESPN injuries feed + player minutes from the players table) ----------
const INJ_KEY = 'nba_inj_v1', INJ_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries', PL_KEY = 'nba_players_v2';
let PLAYERS = null;   // { playerId: [gp, starts, minutes, points] } built by the server job from box scores
async function loadPlayers(){
  try{
    if(PLAYERS) return PLAYERS;
    const c = JSON.parse(localStorage.getItem(PL_KEY) || 'null');
    if(c && Date.now() - c.t < 6 * 3600 * 1000){ PLAYERS = c.data; return PLAYERS; }
  }catch(e){}
  try{
    const sb = window.cloud && window.cloud.sb; if(!sb) return null;
    if(window.cloud.whenApproved) await Promise.race([ window.cloud.whenApproved(), new Promise(r => setTimeout(r, 8000)) ]);
    const r = await sb.from('players').select('player_id,gp,starts,min,pts,team').eq('league', 'NBA').limit(2000);
    if(!r || r.error || !Array.isArray(r.data) || !r.data.length) return null;
    const data = {}; r.data.forEach(x => { data[x.player_id] = [Number(x.gp), Number(x.starts), Number(x.min), Number(x.pts), abbr3(x.team || '')]; });
    PLAYERS = data;
    try{ localStorage.setItem(PL_KEY, JSON.stringify({ t: Date.now(), data })); }catch(e){}
    return PLAYERS;
  }catch(e){ return null; }
}
// "Core" player = started at least half his games, or plays 24+ minutes a game (needs 3+ games on file).
function impact(o){
  const st = PLAYERS && o.id ? PLAYERS[o.id] : null;
  if(!st || st[0] < 3) return { ...o, core: null };
  const mpg = st[2] / st[0], ppg = st[3] / st[0], sr = st[1] / st[0];
  return { ...o, mpg: Math.round(mpg * 10) / 10, ppg: Math.round(ppg * 10) / 10, core: sr >= 0.5 || mpg >= 24 };
}
// { ABBR: { out:[{n,id,p}], dtd:[names], long: n } } -- "Out" players posted in the last 48h; older ones are counted in long.
async function loadInjuries(force){
  try{ await loadPlayers(); }catch(e){}
  try{
    if(!force){ const c = JSON.parse(localStorage.getItem(INJ_KEY) || 'null'); if(c && c.v === 2 && Date.now() - c.t < 20 * 60 * 1000) return c.data; }
  }catch(e){}
  const j = await getJson(INJ_URL);
  if(!j || !j.injuries) return null;
  const data = {}, fresh = Date.now() - 48 * 3600 * 1000;
  j.injuries.forEach(t => (t.injuries || []).forEach(i => {
    const ab = i.athlete && i.athlete.team && i.athlete.team.abbreviation; if(!ab) return;
    const k = abbr3(ab), e = data[k] = data[k] || { out: [], dtd: [], long: 0 };
    const isFresh = !i.date || new Date(i.date).getTime() >= fresh;
    const name = i.athlete.shortName || i.athlete.displayName;
    let pid = null;
    for(const l of i.athlete.links || []){ const m = /\/id\/(\d+)\//.exec(l.href || ''); if(m){ pid = m[1]; break; } }
    if(i.status === 'Out'){ if(isFresh) e.out.push({ n: name, id: pid, p: i.athlete.position && i.athlete.position.abbreviation }); else e.long++; }
    else if(isFresh) e.dtd.push(name);
  }));
  try{ localStorage.setItem(INJ_KEY, JSON.stringify({ t: Date.now(), v: 2, data })); }catch(e){}
  return data;
}
const NOINJ = { out: [], dtd: [], long: 0 };
const withImpact = e => ({ ...e, out: (e.out || []).map(o => impact(typeof o === 'string' ? { n: o } : o)) });
function injSnapshot(data, a, b){ return data ? { at: new Date().toISOString(), a: withImpact(data[a] || NOINJ), h: withImpact(data[b] || NOINJ) } : null; }
// Players who matter: core players. If no player stats are loaded yet, fall back to "2 or more out".
function coreOut(e){
  const out = (e && e.out) || [];
  const known = out.some(o => o && typeof o === 'object' && o.core != null);
  return known ? out.filter(o => o && o.core === true) : (out.length >= 2 ? out : []);
}
function injWarn(snap){
  if(!snap) return null;
  const w = [];
  if(coreOut(snap.a).length) w.push('away');
  if(coreOut(snap.h).length) w.push('home');
  return w.length ? w : null;
}
const nm = o => typeof o === 'string' ? o : o.n;
function injWarnText(snap, away, home){
  const w = injWarn(snap); if(!w) return '';
  const part = (ab, e) => `${ab}: ${coreOut(e).map(nm).join(', ')} out`;
  return '⚠ ' + [w.includes('away') ? part(away, snap.a) : null, w.includes('home') ? part(home, snap.h) : null].filter(Boolean).join(' | ');
}
function injText(snap, away, home){
  if(!snap) return '';
  const d = o => typeof o === 'string' ? o : (o.core === true ? `${o.n} (${o.p || ''} ${o.mpg} min, ${o.ppg} pts)` : (o.core === false ? `${o.n} (bench ${o.mpg} min)` : o.n));
  const one = (ab, e) => `${ab}: ` + ((e.out || []).length ? e.out.map(d).join(', ') + ' out' : 'no one out') + ((e.dtd || []).length ? ' · ' + e.dtd.join(', ') + ' day-to-day' : '');
  return one(away, snap.a) + '  |  ' + one(home, snap.h);
}

// ---------- who is on the court right now (from ESPN's summary: box score starters + substitution plays) ----------
// Returns { teams: [{ abbr, onCourt: [names], starters: n, bench: [names] }], ok } or null.
function courtFromSummary(d){
  try{
    const ct = {}, byTeam = {};
    ((d.boxscore && d.boxscore.players) || []).forEach(t => {
      const id = String(t.team.id), st = (t.statistics || [])[0]; if(!st) return;
      ct[id] = { abbr: abbr3(t.team.abbreviation), on: new Set(), starters: new Set(), names: {} };
      (st.athletes || []).forEach(a => {
        const aid = String(a.athlete.id); ct[id].names[aid] = a.athlete.shortName || a.athlete.displayName;
        if(a.starter){ ct[id].on.add(aid); ct[id].starters.add(aid); }
      });
      byTeam[id] = true;
    });
    const plays = (d.plays || []).slice().sort((a, b) => Number(a.sequenceNumber) - Number(b.sequenceNumber));
    plays.forEach(p => {
      if(!p.type || p.type.text !== 'Substitution' || !p.team || !p.participants || p.participants.length < 2) return;
      const t = ct[String(p.team.id)]; if(!t) return;
      t.on.delete(String(p.participants[1].athlete.id));
      t.on.add(String(p.participants[0].athlete.id));
    });
    const teams = Object.values(ct).map(t => {
      const on = [...t.on];
      return { abbr: t.abbr, ids: on, n: on.length, starters: on.filter(i => t.starters.has(i)).length,
               bench: on.filter(i => !t.starters.has(i)).map(i => t.names[i] || '?'), onCourt: on.map(i => t.names[i] || '?') };
    });
    if(teams.length !== 2) return null;
    return { teams, ok: teams.every(t => t.n === 5) };
  }catch(e){ return null; }
}

// ---------- lineup projection: points the five players on the floor are expected to score in the time left ----------
// Each player's scoring rate = season points / minutes (from the players table). The five on the floor are added up and
// multiplied by the minutes left; beyond the next 6 minutes the team's usual scoring pace is used.
function lineupProjection(court, P, awayAbbr, homeAbbr, scoreA, scoreH, period, minsLeftInPeriod){
  if(!court || !PLAYERS) return null;
  const remaining = Math.max(0, (period >= 4 ? 0 : (4 - period) * 12) + minsLeftInPeriod);
  if(remaining <= 0) return null;
  const lineMin = Math.min(6, remaining), restMin = remaining - lineMin;
  const one = (abbr, side) => {
    const t = court.teams.find(x => x.abbr === abbr); if(!t || !P[abbr]) return null;
    const teamPpm = P[abbr].ppg / 48;
    let known = 0, sum = 0;
    t.ids.forEach(id => { const st = PLAYERS[id]; if(st && st[0] >= 3 && st[2] > 0){ sum += st[3] / st[2]; known++; } else sum += teamPpm / 5 * 0.8; });
    const lineRate = sum;                        // points per minute with these five
    const add = lineRate * lineMin + teamPpm * restMin;
    return { abbr, rate: lineRate, teamPpm, add, known, bench: t.bench, starters: t.starters };
  };
  const a = one(awayAbbr), h = one(homeAbbr); if(!a || !h) return null;
  return { a, h, remaining, final: scoreA + scoreH + a.add + h.add, scoreNow: scoreA + scoreH };
}

let CACHEDLAB = null, CACHEDAT = 0, PENDING = null;
async function load(force){
  if(!force && CACHEDLAB && Date.now() - CACHEDAT < 5 * 60 * 1000) return CACHEDLAB;
  if(PENDING) return PENDING;
  PENDING = (async () => {
    try{
      const [season, st] = await Promise.all([ loadSeason(), standingsRows() ]);
      const P = buildProfiles(season.games);
      if(Object.keys(P).length === 0) return null;
      assignTiers(P, st);
      const TS = buildTypeStats(P, season.games);
      CACHEDLAB = { P, TS, failed: season.failed, standingsOk: !!st, games: season.games.length };
      CACHEDAT = Date.now();
      return CACHEDLAB;
    } finally { PENDING = null; }
  })();
  return PENDING;
}
window.NBALab = { loadSeason, buildProfiles, assignTiers, buildTypeStats, courtFromSummary, lineupProjection, load, project, typeOf, typeLabel, rulePick, verdict, loadInjuries, loadPlayers, injSnapshot, injWarn, injWarnText, coreOut, injText, parseDay, getJson, f1, TYPE_NAMES, TYPE_ORDER, BASE, sportsDay, ymd, abbr3 };
})();
