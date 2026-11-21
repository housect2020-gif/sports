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
    all.push({ id: String(ev.id || ''), away: a, home: h, state, start: ev.date, line, playoff: st === 3, text: (comp.status && comp.status.type && comp.status.type.shortDetail) || '' });
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
window.NBALab = { load, project, typeOf, parseDay, getJson, f1, TYPE_NAMES, TYPE_ORDER, BASE, sportsDay, ymd, abbr3 };
})();
