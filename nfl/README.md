# NFL Live Sheet

A spreadsheet-style NFL website with live scores, season records, head-to-head results, lock picks, streak odds and a personal picks watchlist. It's a port of the MLB schedule site, adapted for football's weekly schedule.

**Live site:** https://housect2020-gif.github.io/NFL/

## Pages

| Page | What it shows |
|---|---|
| `index.html` | The main sheet. Every game this season, grouped by NFL week, with winner, records, head-to-head record and the H2H Outcome Winner. The "This week & live" view refreshes every 30 seconds while a game is live or about to kick off. Stat boxes track how often the H2H pick was right (Last Week, Last 3 Weeks, Season). Includes CSV export. |
| `guarantee.html` | Lock picks for the top-ranked teams (choose 5–12, default 10), plus up to 4 wildcard games shown with both outcomes so you can build combos. |
| `streaks.html` | Each team's longest and current win/loss streaks, the estimated chance of a win or losing streak over the rest of the 17-game season, and a close-game table (record in games decided by 8 points or fewer, plus point differential). |
| `picks.html` | Your watchlist of picks checked on the Schedule sheet and Guarantee pages. Can be exported to PDF. |

## How it works

- **Data source:** ESPN's public NFL scoreboard (`site.api.espn.com`), called directly from the browser. No API key and no server needed.
- **Season load:** each page loads the full season, one request per week, every time it opens.
- **Times:** shown in US Eastern (EDT/EST), so dates and kickoffs read the same for every viewer.
- **Head-to-head:** only counts meetings this season that happened *before* each game. When two teams haven't met or are tied, the pick falls back to the team with the better record entering that week, labeled "No H2H – TEAM" or "Tied – TEAM". These games are left out of the accuracy stat boxes.
- **Over/Under:** the main sheet has an Over / Under column. Upcoming games show the current total and spread, live games show the running score next to the line, and finished games show the closing line, the final total, and OVER, UNDER or PUSH. The "O/U Season" box counts how often games went over. Closing lines come from ESPN's per-game summary (its sportsbook partner) and are fetched once per game, then saved in your browser so later visits load instantly.
- **O/U Pick (column I):** a pre-game Over/Under verdict. It counts how often both teams' games this season went OVER their closing line, then picks the opposite: **BET** when that combined trend is 60/40 or stronger, **LEAN** at 55–60%, **SKIP** when it's closer to 50/50. It uses only games played before each kickoff. Backtest for weeks 1–11 of 2026: BET 26-18 (59.1%), BET+LEAN 42-31 (57.5%). Break-even at -110 odds is 52.4%. The sample is still small, so treat this as a test. The "O/U Pick" box keeps a live season record.
- **Ties:** count as half a win in winning percentage and break any streak.
- **My Picks:** stored only in your browser (localStorage, key `nfl_site_picks_v1`). They don't sync across devices and are kept separate from the MLB site's picks.
- **Version tag:** the bottom of each page shows the date and time that file was last updated, read automatically from GitHub Pages.

## Updating the site

1. In this repo, click **Add file → Upload files**.
2. Drag in the updated file(s) with the same name(s).
3. Click **Commit changes**. The live site updates in a minute or two.

All four HTML files must stay at the top level of the repo, since they link to each other by filename.

## First-time setup (already done)

**Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**

## Known limitations

- If ESPN starts blocking browser requests (as it did for MLB), the pages show an error message instead of data. The fix would be a scraper that saves the data into a file in this repo.
- Head-to-head covers the current season only, so most matchups have no H2H history until later in the year.
- Hit rates and "combined estimate" numbers are based on small samples and are rough math, not real odds.

---

*For entertainment only. Not betting advice.*
