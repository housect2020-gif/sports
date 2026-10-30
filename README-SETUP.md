# Sports Hub — 3 steps

1. **GitHub:** New repository named `sports` (public). Settings → Pages → Deploy from a branch → main / (root).
   Then "Add file → Upload files", drag in EVERYTHING from this folder (the 4 files + the nba, wnba, mlb, nfl folders), Commit.
2. **Supabase:** Authentication → URL Configuration:
   - Site URL: `https://housect2020-gif.github.io/sports/`
   - Add redirect URL: `https://housect2020-gif.github.io/sports/**`
3. Open `https://housect2020-gif.github.io/sports/` and sign in.

Your old repos (NBA, wnba-scores, MLB, NFL) can stay as they are or be deleted later.
The NBA scheduled job (GitHub Actions) keeps running in the NBA repo and does not need to change.
