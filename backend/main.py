"""
CompeteAI — FastAPI Backend
Fixed: use_mock=True now skips ALL scraping, including Playwright browser launch.
"""

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from .analyzer import run_full_analysis
    from .revenue_estimator import estimate_market_size
    from .scraper import get_mock_products, get_mock_reviews, scrape_market, scrape_reviews
except ImportError:
    from analyzer import run_full_analysis
    from revenue_estimator import estimate_market_size
    from scraper import get_mock_products, get_mock_reviews, scrape_market, scrape_reviews

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

jobs: dict[str, dict] = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("CompeteAI backend starting up")
    yield
    logger.info("CompeteAI backend shutting down")

app = FastAPI(title="CompeteAI", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    query: str
    use_mock: bool = False

async def run_analysis_job(job_id: str, query: str, use_mock: bool):
    job = jobs[job_id]
    job["status"] = "running"
    job["started_at"] = time.time()
    job["events"] = []

    async def progress_cb(message: str, pct: int):
        job["progress"] = pct
        job["message"] = message
        job["events"].append({"progress": pct, "message": message, "ts": time.time()})
        logger.info(f"[{job_id[:8]}] {pct}% — {message}")

    try:
        if use_mock:
            # ── MOCK PATH: skip ALL scraping, no browser launched ──
            await progress_cb("Loading demo data (no scraping)…", 10)
            products = get_mock_products(keyword=query)
            for p in products:
                p["data_source"] = "mock"

            await progress_cb("Generating demo reviews…", 30)
            reviews_by_asin = {
                p["asin"]: get_mock_reviews(p["asin"]) for p in products
            }

            await progress_cb("Estimating market size…", 50)
            market_data = estimate_market_size(products)

            await progress_cb("Running AI analysis on demo data…", 65)
            analysis = await run_full_analysis(
                keyword=query,
                products=products,
                reviews_by_asin=reviews_by_asin,
                market_data=market_data,
                progress_cb=progress_cb,
            )

            data_mode = "mock"
            live_products = 0
            mock_products = len(products)

        else:
            # ── LIVE PATH: full scraping pipeline ──
            await progress_cb("Fetching product listings from Amazon…", 5)
            products = await scrape_market(query, progress_cb)

            if not products:
                raise ValueError("No products found for the given query")

            await progress_cb(f"Found {len(products)} products. Fetching reviews…", 25)

            reviews_by_asin: dict[str, list] = {}
            for i, p in enumerate(products):
                asin = p.get("asin", "")
                if not asin:
                    continue
                pct = 25 + int((i + 1) / len(products) * 25)
                await progress_cb(f"Fetching reviews for product {i+1}/{len(products)}…", pct)

                if p.get("data_source") == "mock":
                    reviews_by_asin[asin] = get_mock_reviews(asin)
                else:
                    reviews = await scrape_reviews(asin, max_reviews=60)
                    reviews_by_asin[asin] = reviews if reviews else get_mock_reviews(asin)

            await progress_cb("Calculating market size and revenue estimates…", 52)
            market_data = estimate_market_size(products)

            analysis = await run_full_analysis(
                keyword=query,
                products=products,
                reviews_by_asin=reviews_by_asin,
                market_data=market_data,
                progress_cb=progress_cb,
            )

            live_products = sum(1 for p in products if p.get("data_source") == "live")
            mock_products = sum(1 for p in products if p.get("data_source") == "mock")
            data_mode = "mock" if live_products == 0 else "live_or_mixed"

        await progress_cb("Building your intelligence report…", 95)

        # Attach per-product review analysis
        for i, p in enumerate(market_data["products"]):
            if i < len(analysis["review_analyses"]):
                p["review_analysis"] = analysis["review_analyses"][i]

        job["result"] = {
            "query": query,
            "market": market_data,
            "aggregated_criteria": analysis["aggregated_criteria"],
            "strategic": analysis["strategic"],
            "product_count": len(products),
            "total_reviews_analyzed": sum(len(v) for v in reviews_by_asin.values()),
            "meta": {
                "data_mode": data_mode,
                "live_products": live_products,
                "mock_products": mock_products,
                "use_mock_requested": use_mock,
            },
        }
        job["status"] = "done"
        job["progress"] = 100
        job["message"] = "Analysis complete!"
        job["elapsed_seconds"] = round(time.time() - job["started_at"], 1)
        job["events"].append({"progress": 100, "message": "Analysis complete!", "status": "done", "done": True, "ts": time.time()})

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
        job["status"] = "error"
        job["message"] = f"Analysis failed: {str(e)}"
        job["progress"] = 0
        job["events"].append({"progress": 0, "message": f"Error: {str(e)}", "status": "error", "done": True, "ts": time.time()})

# ─── SSE Generator ────────────────────────────────────────────────────────────
async def sse_generator(job_id: str) -> AsyncGenerator[str, None]:
    last_idx = 0
    start = time.time()
    while time.time() - start < 300:
        job = jobs.get(job_id)
        if not job:
            yield f"data: {json.dumps({'error': 'Job not found'})}\n\n"
            return

        events = job.get("events", [])
        while last_idx < len(events):
            yield f"data: {json.dumps(events[last_idx])}\n\n"
            last_idx += 1

        if job["status"] in ("done", "error"):
            # Ensure final event was sent
            final = {
                "progress": job["progress"],
                "message": job["message"],
                "status": job["status"],
                "done": True,
            }
            yield f"data: {json.dumps(final)}\n\n"
            return

        await asyncio.sleep(0.4)

# ─── Routes ──────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "CompeteAI", "version": "1.0.0"}

@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "message": "Job queued…",
        "started_at": time.time(),
        "query": req.query,
        "result": None,
        "events": [],
    }
    asyncio.create_task(run_analysis_job(job_id, req.query, req.use_mock))
    return {"job_id": job_id, "status": "queued"}

@app.get("/stream/{job_id}")
async def stream_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return StreamingResponse(
        sse_generator(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    elapsed = round(time.time() - job["started_at"], 1) if job.get("started_at") else None
    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "elapsed_seconds": elapsed,
    }

@app.get("/results/{job_id}")
async def get_results(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "done":
        raise HTTPException(status_code=202, detail=f"Job status: {job['status']}")
    return job["result"]

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=False)