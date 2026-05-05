// CompeteAI — Frontend App Logic
// Fixed: ID mismatches, demo toggle, data source notice

const API = 'http://localhost:8000';
let currentJobId = null;
let eventSource = null;
let revenueChart = null;

// ─── Example chips ───────────────────────────────────────────────────────────
document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.getElementById('queryInput').value = chip.dataset.query;
  });
});

// ─── Analyze ─────────────────────────────────────────────────────────────────
document.getElementById('analyzeBtn').addEventListener('click', startAnalysis);
document.getElementById('queryInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') startAnalysis();
});

async function startAnalysis() {
  const query = document.getElementById('queryInput').value.trim();
  if (!query) return;
  const useMock = document.getElementById('mockToggle').checked;

  if (eventSource) { eventSource.close(); eventSource = null; }

  // Reset UI
  document.getElementById('dashboard').style.display = 'none';

  // Fix: reset the notice section properly (don't leave stale content)
  const noticeSection = document.getElementById('dataSourceNotice');
  noticeSection.style.display = 'none';
  noticeSection.innerHTML = '<div id="noticeInner"></div>';

  document.getElementById('progressSection').style.display = 'block';
  document.getElementById('analyzeBtn').disabled = true;
  setProgress(0, useMock ? 'Loading demo data…' : 'Starting analysis…');

  try {
    const res = await fetch(`${API}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, use_mock: useMock })
    });
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const data = await res.json();
    currentJobId = data.job_id;
    connectSSE(currentJobId);
  } catch (err) {
    setProgress(0, `❌ ${err.message} — Is the backend running on port 8000?`);
    document.getElementById('analyzeBtn').disabled = false;
  }
}

// ─── SSE ─────────────────────────────────────────────────────────────────────
function connectSSE(jobId) {
  eventSource = new EventSource(`${API}/stream/${jobId}`);

  eventSource.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    if (data.error) {
      setProgress(0, `❌ ${data.error}`);
      document.getElementById('analyzeBtn').disabled = false;
      eventSource.close();
      return;
    }
    setProgress(data.progress, data.message);
    if (data.done) {
      eventSource.close();
      eventSource = null;
      if (data.status === 'error') {
        setProgress(0, `❌ ${data.message}`);
        document.getElementById('analyzeBtn').disabled = false;
        return;
      }
      try {
        const results = await fetch(`${API}/results/${jobId}`).then(r => r.json());
        renderDashboard(results);
      } catch (err) {
        setProgress(0, `❌ Failed to load results: ${err.message}`);
        document.getElementById('analyzeBtn').disabled = false;
      }
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    eventSource = null;
    fallbackPoll(jobId);
  };
}

// ─── Polling fallback ─────────────────────────────────────────────────────────
function fallbackPoll(jobId) {
  const iv = setInterval(async () => {
    try {
      const res = await fetch(`${API}/status/${jobId}`);
      const data = await res.json();
      setProgress(data.progress, data.message);
      if (data.status === 'done') {
        clearInterval(iv);
        const results = await fetch(`${API}/results/${jobId}`).then(r => r.json());
        renderDashboard(results);
      } else if (data.status === 'error') {
        clearInterval(iv);
        setProgress(0, `❌ ${data.message}`);
        document.getElementById('analyzeBtn').disabled = false;
      }
    } catch (err) { console.error('Poll error:', err); }
  }, 1500);
}

function setProgress(pct, msg) {
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressMsg').textContent = msg;
  document.getElementById('progressPct').textContent = pct + '%';
}

// ─── RENDER DASHBOARD ─────────────────────────────────────────────────────────
function renderDashboard(data) {
  document.getElementById('progressSection').style.display = 'none';
  document.getElementById('analyzeBtn').disabled = false;

  const { market, aggregated_criteria, strategic, total_reviews_analyzed, meta } = data;

  // ── Data source notice (fix: replace inner div content, not outerHTML)
  const noticeSection = document.getElementById('dataSourceNotice');
  noticeSection.style.display = 'block';
  const isLive = meta?.data_mode !== 'mock';

  if (isLive) {
    noticeSection.innerHTML = `
      <div style="border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.07);
                  color:#6EE7B7;border-radius:12px;padding:10px 16px;font-size:13px">
        ✅ <strong>Live data scraped successfully.</strong>
        ${meta?.live_products || 0} products analyzed from Amazon in real time.
      </div>`;
  } else {
    noticeSection.innerHTML = `
      <div style="border:1px solid rgba(245,158,11,.45);background:rgba(245,158,11,.08);
                  color:#FDE68A;border-radius:12px;padding:10px 14px;font-size:13px">
        ⚠️ <strong>Demo data shown.</strong>
        Amazon scraping skipped — using sample data to demonstrate the full analysis pipeline.
      </div>`;
  }

  // ── KPI Cards — using EXACT IDs from index.html
  setText('kpiMarketSize', fmt(market.total_monthly_revenue));
  setText('kpiAnnual',     fmt(market.total_annual_revenue));
  setText('kpiProducts',   market.product_count);           // was kpiCount — fixed
  setText('kpiReviews',    total_reviews_analyzed.toLocaleString());
  setText('kpiAvgPrice',   `$${market.avg_price}`);         // was kpiPrice — fixed
  setText('kpiOppScore',   strategic.opportunity_score || '—'); // was kpiOpp — fixed

  // ── Render all sections
  renderCompetitors(market.products);
  renderChart(market.products);
  renderCriteria(aggregated_criteria);
  renderStrategic(strategic);

  // ── Show dashboard with animation
  const dash = document.getElementById('dashboard');
  dash.style.display = 'block';
  dash.classList.remove('fade-in');
  void dash.offsetWidth;
  dash.classList.add('fade-in');
  setTimeout(() => dash.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}

// ─── Competitors table ────────────────────────────────────────────────────────
function renderCompetitors(products) {
  if (!products?.length) {
    document.getElementById('competitorsTbody').innerHTML =
      '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">No data available</td></tr>';
    return;
  }

  // Sort by rank so table always shows #1, #2, #3...
  const sorted = [...products].sort((a, b) => (a.rank || 0) - (b.rank || 0));
  const maxRev = Math.max(...sorted.map(p => p.monthly_revenue || 0), 1);

  document.getElementById('competitorsTbody').innerHTML = sorted.map((p, i) => {
    const barW = Math.max(4, ((p.monthly_revenue || 0) / maxRev) * 140);
    const isTop = i === 0;
    const stars = '★'.repeat(Math.min(5, Math.round(parseFloat(p.rating) || 0))) +
                  '☆'.repeat(Math.max(0, 5 - Math.min(5, Math.round(parseFloat(p.rating) || 0))));
    const dataTag = p.data_source === 'live'
      ? '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;background:rgba(6,182,212,.12);color:#06b6d4;margin-left:4px">LIVE</span>'
      : '<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(100,116,139,.1);color:#64748b;margin-left:4px">DEMO</span>';
    const positives = p.review_analysis?.top_positives?.[0] || '';

    return `<tr>
      <td>
        <span class="${isTop ? 'rank-badge gold' : 'rank-badge'}">${p.rank}</span>
      </td>
      <td style="max-width:260px">
        <div style="font-weight:600;font-size:13px;line-height:1.4">
          ${(p.title || '').substring(0, 62)}${(p.title || '').length > 62 ? '…' : ''}${dataTag}
        </div>
        ${positives ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">✓ ${positives}</div>` : ''}
      </td>
      <td>$${(p.price || 0).toFixed(2)}</td>
      <td>
        <span class="stars">${stars}</span><br>
        <span style="font-size:11px;color:var(--muted)">${p.rating} (${(p.review_count || 0).toLocaleString()})</span>
      </td>
      <td>
        <div class="rev-bar-wrap">
          <div class="rev-bar" style="width:${barW}px"></div>
          <span style="font-size:12px;font-weight:600;color:var(--green)">${fmt(p.monthly_revenue)}</span>
        </div>
        <div style="font-size:11px;color:var(--muted)">${(p.monthly_sales || 0).toLocaleString()} units/mo</div>
      </td>
    </tr>`;
  }).join('');
}

// ─── Revenue chart ────────────────────────────────────────────────────────────
function renderChart(products) {
  const ctx = document.getElementById('revenueChart')?.getContext('2d');
  if (!ctx || !products?.length) return;
  if (revenueChart) revenueChart.destroy();

  const sorted = [...products].sort((a, b) => (a.rank || 0) - (b.rank || 0));

  revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(p => `#${p.rank} ${(p.title || '').substring(0, 22)}…`),
      datasets: [{
        label: 'Monthly Revenue ($)',
        data: sorted.map(p => p.monthly_revenue || 0),
        backgroundColor: sorted.map((_, i) =>
          i === 0 ? 'rgba(99,102,241,0.85)' : 'rgba(99,102,241,0.3)'
        ),
        borderColor: 'rgba(99,102,241,0.5)',
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${fmt(c.raw)}/month` } }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: {
          ticks: {
            color: '#64748b', font: { size: 11 },
            callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)
          },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    }
  });
}

// ─── Purchase criteria ────────────────────────────────────────────────────────
function renderCriteria(criteria) {
  if (!criteria?.length) {
    document.getElementById('criteriaList').innerHTML =
      '<div style="color:var(--muted);font-size:13px">No purchase criteria data available</div>';
    return;
  }
  const maxF = Math.max(...criteria.map(c => c.frequency || 0), 1);
  document.getElementById('criteriaList').innerHTML = criteria.map(c => {
    const pct = Math.round(((c.frequency || 0) / maxF) * 100);
    const barClass = c.sentiment === 'negative' ? 'bar-negative'
                   : c.sentiment === 'mixed'    ? 'bar-mixed'
                   : 'bar-positive';
    return `<div class="criteria-item">
      <div class="criteria-header">
        <span class="criteria-name">${c.criterion}</span>
        <span class="criteria-count">mentioned ${c.frequency}×</span>
      </div>
      <div class="criteria-bar-wrap">
        <div class="criteria-bar ${barClass}" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');
}

// ─── Strategic section ────────────────────────────────────────────────────────
function renderStrategic(s) {
  if (!s) return;

  setText('marketSummary',   s.market_summary || 'Analysis unavailable');
  setText('dominantDriver',  s.dominant_purchase_driver || '—');
  setText('heroAngle',       s.content_strategy?.hero_angle || '—');
  setText('emotionalTrigger', s.content_strategy?.emotional_trigger || '—');
  setText('pixiiRec',        s.pixii_ai_recommendation || '—');

  // Keywords pills
  const kwEl = document.getElementById('topKeywords');
  if (kwEl) {
    const kws = s.content_strategy?.top_keywords_to_use || [];
    kwEl.innerHTML = kws.length
      ? kws.map(k => `<span class="pill pill-yellow">${k}</span>`).join('')
      : '<span style="color:var(--muted);font-size:13px">No keywords available</span>';
  }

  // Opportunity score — appears in BOTH kpiOppScore and oppScore
  const score = s.opportunity_score || 0;
  setText('kpiOppScore', score || '—');  // KPI card
  const oppEl = document.getElementById('oppScore');  // Big score display
  if (oppEl) {
    oppEl.textContent = score || '—';
    const grad = score >= 75
      ? 'linear-gradient(135deg,#10b981,#34d399)'
      : score >= 50
      ? 'linear-gradient(135deg,#f59e0b,#fcd34d)'
      : 'linear-gradient(135deg,#ef4444,#f87171)';
    oppEl.style.backgroundImage = grad;
    oppEl.style.webkitBackgroundClip = 'text';
    oppEl.style.webkitTextFillColor = 'transparent';
  }

  // Weakest competitor
  const wk = s.weakest_competitor;
  const wkEl = document.getElementById('weakestComp');
  if (wkEl) {
    wkEl.innerHTML = wk
      ? `<strong>Rank #${wk.rank}</strong> — ${wk.reason}`
      : 'Analysis unavailable';
  }

  // Key insights
  const icons = ['💡', '🎯', '📊', '🔍', '⚡'];
  const insightsEl = document.getElementById('insightsList');
  if (insightsEl) {
    const insights = s.key_insights || [];
    insightsEl.innerHTML = insights.length
      ? insights.map((ins, i) => `
          <div class="insight-card">
            <div class="insight-icon">${icons[i % icons.length]}</div>
            <div class="insight-text">${ins}</div>
          </div>`).join('')
      : '<div style="color:var(--muted);font-size:13px;padding:12px 0">No insights available</div>';
  }

  // Competitive gaps
  const gapsEl = document.getElementById('gapsList');
  if (gapsEl) {
    const gaps = s.competitive_gaps || [];
    gapsEl.innerHTML = gaps.length
      ? gaps.map(g => `
          <div class="gap-item">
            <span class="gap-badge badge-${(g.opportunity_size || 'medium').toLowerCase()}">
              ${(g.opportunity_size || 'MEDIUM').toUpperCase()}
            </span>
            <div class="gap-content">
              <div class="gap-title">${g.gap}</div>
              <div class="gap-action">→ ${g.action}</div>
            </div>
          </div>`).join('')
      : '<div style="color:var(--muted);font-size:13px;padding:12px 0">No gaps identified</div>';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function fmt(n) {
  if (!n && n !== 0) return '$—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}