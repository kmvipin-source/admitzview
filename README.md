# AdmitzView

Every entrance exam date a student cares about, on one 4‑month map. Clashes show up in red. Dates update by themselves every morning, and students can add them to their phone calendar, which also updates by itself. Free, no sign‑up, no tracking.

## How it works

1. **A robot reads official exam websites every morning** (`scraper/`). It runs free on GitHub Actions, respects each site's robots.txt, finds dates next to words like "registration", "exam", "counselling", and saves them with the exact sentence as proof.
2. **Free AI tidies the results** using GitHub Models with the built‑in token. It can only remove junk or give an event a clearer name. It can't add or change a date. If the AI isn't available, the robot uses its own rules.
3. **The website** (`site/`) shows the season map, clashes, a plain‑words summary and what changed.
4. **The calendar feed** (`functions/cal.js`) lets students subscribe once; their phone re‑checks every few hours.

## Set it up once (about 15 minutes, ₹0)

**GitHub (stores the code, runs the robot)**
1. Sign up at github.com. Click **New repository**, name it `admitzview`, choose **Public**, create it.
2. Click **uploading an existing file** and drag in everything from this folder **except** `daily-update.yml`.
   Then click **Add file → Create new file**, type `.github/workflows/daily-update.yml` as the name, open `daily-update.yml` from this folder in Notepad, copy everything, paste it in, and click **Commit changes**. (This file has to live in a hidden `.github` folder that GitHub creates for you this way.)
3. Go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, save.
4. Go to the **Actions** tab, enable workflows, open **Daily date check**, click **Run workflow**. In about 5 minutes `site/data.json` will hold real dates.

**Cloudflare (puts the website online)**
5. Sign up at dash.cloudflare.com (no card needed). Go to **Workers & Pages → Create → Pages → Connect to Git**, pick `admitzview`.
6. Leave **Build command** empty. Set **Build output directory** to `site`. Click **Save and Deploy**.
7. Your site is live at `something.pages.dev`. From now on, every morning's robot run updates it automatically.

## Changing things

- **Your name in the footer:** edit `CONFIG` at the top of `site/app.js`.
- **Add an exam:** add a line to `sources.json` with its official website. The robot picks it up on the next run.
- **Turn the AI off:** in `.github/workflows/daily-update.yml` set `ADMITZVIEW_AI: "off"`.
- **Next admission year:** change `cycle` and `window` in `sources.json`.

## What it costs at 1,000 students a day

| Piece | Free allowance | Your use |
|---|---|---|
| Cloudflare Pages (website) | Unlimited static visits | ~5,000 page loads/day |
| Cloudflare Functions (calendar feed) | 100,000 requests/day | ~4–8 per subscriber/day |
| GitHub Actions (robot) | Unlimited for public repos | ~5 min/day |
| GitHub Models (AI tidy‑up) | Free with daily limits | ~25 requests/day |

If the calendar ever passed ~100,000 requests a day (roughly 15,000+ subscribers), the feed pauses until midnight UTC. Nothing is ever charged; the free plan has no card attached.

## Rules the robot follows

- Never invents a date. Every date shows the official sentence it came from.
- Says "Couldn't read today" when a site fails, never guesses.
- Labels everything "Auto‑read", never "Verified".
- Collects nothing about students. Their exam choices stay in their own browser.
