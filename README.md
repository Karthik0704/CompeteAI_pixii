# CompeteAI 🧠
### Amazon Market Intelligence Platform — Built for Pixii.ai

> **"Know your market before you make your content."**

Paste any Amazon keyword or Best Sellers URL. CompeteAI scrapes the top 10 competitors in real time, analyzes customer reviews using Groq AI, estimates monthly revenue for each product, and delivers a strategic content brief — powered by Gemini (with automatic Groq fallback).

**Live demo:** `http://localhost:3000/frontend/` (after setup below)

---

## What It Does

| Feature | Details |
|---|---|
| 🏆 **Live Competitor Scraping** | Top 10 products scraped in real time using Playwright (bypasses Amazon bot detection) |
| 💰 **Revenue Estimation** | BSR × price model — same methodology as Jungle Scout |
| 🎯 **Purchase Criteria Mining** | Groq AI extracts what customers *actually* buy for from real reviews |
| 🤖 **Content Strategy** | Exact hero angle, emotional trigger, top keywords — specific to your keyword |
| 🕳️ **Gap Analysis** | Unmet needs no competitor is currently addressing |
| 🔮 **Pixii.ai Brief** | Direct content generation brief for AI photo/hook/copy |
| ⚡ **Opportunity Score** | 0–100 AI-rated market attractiveness |
| 📡 **Real-Time Progress** | Server-Sent Events (SSE) stream — live progress bar, no polling |

---

## Architecture

```
User Input (keyword or Amazon URL)
         │
         ▼
┌─────────────────────────────────────────┐
│           FastAPI Backend               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Playwright Browser Scraper     │    │
│  │  • Real Chromium — bypasses     │    │
│  │    Amazon bot detection         │    │
│  │  • Search results (10 products) │    │
│  │  • Product page reviews         │    │
│  └──────────────┬──────────────────┘    │
│                 │                       │
│  ┌──────────────▼──────────────────┐    │
│  │  Revenue Estimator              │    │
│  │  BSR × price → monthly revenue  │    │
│  └──────────────┬──────────────────┘    │
│                 │                       │
│  ┌──────────────▼──────────────────┐    │
│  │  Groq AI — Stage 1              │    │
│  │  llama-3.3-70b per-product      │    │
│  │  review analysis (parallel)     │    │
│  └──────────────┬──────────────────┘    │
│                 │                       │
│  ┌──────────────▼──────────────────┐    │
│  │  Gemini — Stage 2               │    │
│  │  Strategic market synthesis     │    │
│  │  → auto-fallback to Groq        │    │
│  │    if quota exceeded            │    │
│  └──────────────┬──────────────────┘    │
│                 │                       │
│  SSE stream → real-time progress        │
└─────────────────┼───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│        Pure HTML/CSS/JS Frontend        │
│  • KPI cards      • Revenue chart       │
│  • Competitor table (live/demo tags)    │
│  • Purchase criteria frequency bars     │
│  • Strategic intelligence cards        │
│  • Pixii.ai content brief              │
└─────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend | Python 3.11 + FastAPI | Async API with job queue |
| Scraping | Playwright + BeautifulSoup4 | Real browser — bypasses Amazon bot detection |
| AI Stage 1 | Groq API (`llama-3.3-70b-versatile`) | Fast per-product review analysis |
| AI Stage 2 | Google Gemini (`gemini-2.0-flash`) | Strategic synthesis + content strategy |
| Fallback AI | Groq (auto) | When Gemini quota is exceeded |
| Streaming | Server-Sent Events (SSE) | Real-time progress without polling |
| Frontend | Vanilla HTML + CSS + Chart.js | Zero framework, instant load |
| Deployment | Railway (backend) + Vercel (frontend) | Both free tiers |

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/yourusername/competeai
cd competeai

pip install -r backend/requirements.txt

# Install Playwright browser (one time, ~130MB)
playwright install chromium
```

### 2. Get free API keys

| API | Free Tier | Get Key |
|---|---|---|
| **Groq** | 14,400 requests/day | [console.groq.com](https://console.groq.com) |
| **Gemini** | 1,500 requests/day | [aistudio.google.com](https://aistudio.google.com) |

> **Important:** Create a fresh Google AI Studio project for each new Gemini key to avoid exhausted quotas.

### 3. Configure environment

```bash
# Create backend/.env
GROQ_API_KEY=your_groq_key_here
GEMINI_API_KEY=your_gemini_key_here
```

### 4. Start backend

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### 5. Open frontend

```bash
# In a separate terminal
python -m http.server 3000
```

Then open: [http://localhost:3000/frontend/](http://localhost:3000/frontend/)

> **Tip:** Check "Use demo data" for an instant result without scraping (takes ~5 seconds).

---

## Requirements

```
# backend/requirements.txt
fastapi
uvicorn
python-dotenv
pydantic
httpx
beautifulsoup4
playwright
groq
google-genai
```

Install all:
```bash
pip install fastapi uvicorn python-dotenv pydantic httpx beautifulsoup4 playwright groq google-genai
playwright install chromium
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/analyze` | Start analysis job |
| `GET` | `/stream/{job_id}` | SSE real-time progress stream |
| `GET` | `/status/{job_id}` | Poll job status (fallback) |
| `GET` | `/results/{job_id}` | Fetch full results when done |
| `GET` | `/health` | Health check |

**POST /analyze request body:**
```json
{
  "query": "magnesium glycinate supplements",
  "use_mock": false
}
```

**SSE stream events:**
```json
{"progress": 25, "message": "Found 10 products. Fetching reviews...", "ts": 1234567890}
{"progress": 100, "message": "Analysis complete!", "status": "done", "done": true}
```

---

## How Scraping Works

Amazon aggressively blocks server-side scrapers. CompeteAI bypasses this using **Playwright** — a real Chromium browser that:

- Sets genuine browser headers and user agent
- Removes `navigator.webdriver` automation flags
- Scrolls pages like a real user
- Adds human-like random delays between requests
- Detects CAPTCHA/bot pages and falls back to demo data gracefully

**Review scraping strategy (3-tier):**
1. Product page inline reviews (`/dp/{asin}`) — always accessible
2. Alternative review URL with `showViewpoints=1` parameter
3. Mock data fallback — generic reviews when both above fail

---

## How AI Analysis Works

**Stage 1 — Groq (per product, parallel):**
Each product's reviews are sent to `llama-3.3-70b` with a structured prompt asking for:
- Purchase criteria with frequency counts
- Top positives and negatives
- Key customer quotes
- Unmet needs

**Stage 2 — Gemini (market-wide synthesis):**
All 10 products' data is aggregated and sent to `gemini-2.0-flash` for:
- Executive market summary
- Dominant purchase driver
- Content strategy (hero angle, emotional trigger, keywords)
- Competitive gap analysis
- Pixii.ai content generation brief
- Opportunity score (0–100)

**Automatic fallback:**
If Gemini quota is exceeded (free tier: 1,500 req/day), the synthesis automatically falls back to Groq. Results are keyword-specific either way — not generic templates.

---

## Demo Mode

Check "Use demo data" in the UI to run a full analysis instantly without scraping:

- Generates keyword-specific mock products based on your search term
- Runs real Groq + Gemini AI analysis on the mock data
- Full dashboard renders in ~10 seconds
- Shows clearly labeled "DEMO" tags on all data

Demo mode is useful for:
- Testing the UI and AI output quality
- Demos when Amazon is blocking your IP
- Rapid iteration on prompts

---

## Deploy to Production (Free)

### Backend → Railway.app

```bash
# railway.json is already configured
# Just push to GitHub and connect to Railway
```

1. Push `backend/` folder to GitHub
2. New project on [railway.app](https://railway.app)
3. Add environment variables: `GROQ_API_KEY`, `GEMINI_API_KEY`
4. Railway auto-detects Python and deploys

> **Note:** Update `const API = 'http://localhost:8000'` in `frontend/app.js` to your Railway URL before deploying the frontend.

### Frontend → Vercel

1. Push `frontend/` folder to GitHub
2. Import on [vercel.com](https://vercel.com)
3. Deploy — `vercel.json` handles SPA routing

---

## Known Limitations

| Limitation | Reason | Mitigation |
|---|---|---|
| Amazon occasionally blocks review pages | Server IP detection | Falls back to product page reviews |
| Gemini free tier: 1,500 req/day | Google quota | Auto-fallback to Groq |
| Groq rate limits on burst usage | Free tier TPM limits | Built-in retry with backoff |
| BSR-based revenue is an estimate | No access to actual sales data | Same methodology used by Jungle Scout |
| Results vary by time of day | Amazon search results change | Run multiple times for consistency |

---

## The Pixii.ai Connection

> Before generating a viral product photo or listing hook, you need to know:
> **What do customers actually care about? What are competitors failing at?**
>
> CompeteAI answers both — and outputs a ready-to-use content brief that tells Pixii.ai's AI exactly what photos, hooks, and copy to generate.
>
> This turns Pixii from a *content tool* into a *conversion tool* — one that understands the market before it generates anything.

---

## If I Had More Time

- [ ] Chrome extension — analyze any Amazon page with one click
- [ ] Perplexity API as a 4th intelligence source (growing fast for product discovery)
- [ ] Weekly automated monitoring — email alerts when competitor rankings shift
- [ ] Pipe CompeteAI briefs directly into Pixii.ai's generation API
- [ ] Multi-marketplace support (Amazon UK, DE, IN, JP)
- [ ] Trend detection — identify rising products before they peak in BSR

---

## Project Structure

```
competeai/
├── backend/
│   ├── main.py              # FastAPI app + SSE streaming + job queue
│   ├── scraper.py           # Playwright browser scraper (search + reviews)
│   ├── analyzer.py          # Groq + Gemini AI pipeline with fallback
│   ├── revenue_estimator.py # BSR × price → monthly revenue model
│   ├── .env                 # API keys (not committed)
│   └── .env.example         # Template
├── frontend/
│   ├── index.html           # Single-page app
│   ├── styles.css           # Dark theme UI
│   └── app.js               # SSE client + dashboard rendering
├── railway.json             # Railway deployment config
├── vercel.json              # Vercel SPA routing config
└── README.md
```

---

*Built by [Your Name] for the Pixii.ai Founding Engineer challenge · May 2025*