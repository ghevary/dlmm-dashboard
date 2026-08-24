import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3888;
const PAPER_POSITIONS_PATH = process.env.PAPER_PATH || '/root/.hermes/profiles/ghepappo/home/.meridian/paper_positions.json';
const REAL_STATE_PATH = process.env.REAL_STATE_PATH || '/root/projects/meridian/state.json';
const CRON_JOBS_PATH = process.env.CRON_PATH || '/root/.hermes/profiles/ghepappo/cron/jobs.json';
const MERIDIAN_PROJECT_DIR = process.env.MERIDIAN_DIR || '/root/projects/meridian';
const PUBLIC_DIR = path.join(__dirname, 'public');

function getWibDate(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  const wibTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return {
    iso: d.toISOString(),
    wibString: wibTime.toISOString().replace('Z', '+07:00').replace('T', ' ').slice(0, 19),
    wibDate: wibTime.toISOString().slice(0, 10),
    wibMonth: wibTime.toISOString().slice(0, 7),
    wibDay: wibTime.getUTCDate(),
    utcDate: d.toISOString().slice(0, 10),
    utcMonth: d.toISOString().slice(0, 7),
  };
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return fallback;
}

// Live pool cache to avoid spamming CLI if requested in quick succession
const poolQuoteCache = new Map();
async function fetchLivePoolQuote(poolAddress) {
  if (!poolAddress) return null;
  const now = Date.now();
  const cached = poolQuoteCache.get(poolAddress);
  if (cached && (now - cached.timestamp < 15000)) {
    return cached.data;
  }

  try {
    const cmdActiveBin = `node ${path.join(MERIDIAN_PROJECT_DIR, 'cli.js')} active-bin --pool ${poolAddress} 2>/dev/null`;
    const cmdPoolDetail = `node ${path.join(MERIDIAN_PROJECT_DIR, 'cli.js')} pool-detail --pool ${poolAddress} --timeframe 5m 2>/dev/null`;
    
    const [binRes, detailRes] = await Promise.allSettled([
      execPromise(cmdActiveBin),
      execPromise(cmdPoolDetail)
    ]);

    let binData = null;
    let detailData = null;

    if (binRes.status === 'fulfilled' && binRes.value?.stdout) {
      try { binData = JSON.parse(binRes.value.stdout.trim()); } catch (e) {}
    }
    if (detailRes.status === 'fulfilled' && detailRes.value?.stdout) {
      try { detailData = JSON.parse(detailRes.value.stdout.trim()); } catch (e) {}
    }

    const quote = {
      activeBin: binData?.binId ?? null,
      price: binData?.price ? Number(binData.price) : (detailData?.pool_price ? Number(detailData.pool_price) : null),
      tvlUsd: detailData?.tvl ? Number(detailData.tvl) : null,
      activeTvlUsd: detailData?.active_tvl ? Number(detailData.active_tvl) : null,
      volume24hUsd: detailData?.volume ? Number(detailData.volume) : null,
      fee24hUsd: detailData?.fee ? Number(detailData.fee) : null,
      feeActiveTvlRatioPct: detailData?.fee_active_tvl_ratio ? Number(detailData.fee_active_tvl_ratio) * 100 : null,
      timestamp: now,
      fetchedAtIso: new Date().toISOString(),
    };

    poolQuoteCache.set(poolAddress, { timestamp: now, data: quote });
    return quote;
  } catch (err) {
    console.error(`Error fetching live pool quote for ${poolAddress}:`, err.message);
    return null;
  }
}

// Process Positions Data Generic with Live Quote Integration
async function processPositionsData(rawPositions, isPaper = true) {
  let list = [];
  if (Array.isArray(rawPositions)) {
    list = rawPositions;
  } else if (rawPositions && typeof rawPositions === 'object') {
    list = rawPositions.positions ? Object.values(rawPositions.positions) : (rawPositions.paper_positions || []);
  }

  const baseCapital = isPaper ? 60.0 : 0.0;
  let realizedPnl = 0.0;
  let openPnl = 0.0;
  let totalVolume = 0.0;
  let totalFees = 0.0;
  let winCount = 0;
  let lossCount = 0;
  let totalGainUsd = 0.0;
  let totalLossUsd = 0.0;

  const poolStats = {};
  const dailyPnlMap = {};
  const monthlyStatsMap = {};

  const enrichedTrades = [];

  for (let index = 0; index < list.length; index++) {
    const pos = list[index];
    const status = pos.status || (pos.closed_at_utc ? (isPaper ? 'CLOSED_PAPER' : 'CLOSED_REAL') : (isPaper ? 'OPEN_PAPER' : 'OPEN_REAL'));
    const isClosed = status.includes('CLOSED');
    const isOpen = status.includes('OPEN');
    const closeReport = pos.close_report || {};
    const monitorChecks = pos.monitor_checks || [];
    const lastCheck = monitorChecks.length > 0 ? monitorChecks[monitorChecks.length - 1] : null;

    const entryDateInfo = getWibDate(pos.created_at_utc || pos.opened_at || pos.deployed_at);
    const closeDateInfo = getWibDate(closeReport.closed_at_utc || closeReport.checked_at_utc || pos.closed_at_utc);
    const tradeDateInfo = closeDateInfo || entryDateInfo;

    let pnlUsd = 0.0;
    let pnlPct = 0.0;
    let feeUsd = 0.0;
    let holdingHours = 0.0;
    let exitReason = isClosed ? 'CLOSED' : 'ACTIVE';
    let liveQuote = null;

    const capital = Number(pos.paper_capital_usd || pos.capital_usd || pos.amount_sol || 60.0);
    const entryPrice = Number(pos.baselines?.strategy_A_DLMM_paper?.entry_price_sol_usdc || pos.entry_metrics?.pool_price || pos.entry_price || 0.0);

    if (isClosed) {
      pnlUsd = Number(closeReport.dlmm_pnl_usd ?? closeReport.estimated?.dlmm_pnl_usd ?? pos.pnl_usd ?? 0.0);
      pnlPct = Number(closeReport.dlmm_pnl_pct ?? closeReport.estimated?.dlmm_pnl_pct ?? pos.pnl_pct ?? 0.0);
      feeUsd = Number(closeReport.rough_fee_est_usd ?? closeReport.estimated?.rough_fee_est_usd ?? pos.fee_usd ?? 0.0);
      holdingHours = Number(closeReport.elapsed_hours ?? closeReport.estimated?.elapsed_hours ?? pos.holding_hours ?? 0.0);
      exitReason = closeReport.close_reason || pos.close_reason || 'CLOSED';

      realizedPnl += pnlUsd;
      if (pnlUsd >= 0) {
        winCount++;
        totalGainUsd += pnlUsd;
      } else {
        lossCount++;
        totalLossUsd += Math.abs(pnlUsd);
      }
    } else if (isOpen) {
      // For open positions, fetch live on-chain/pool metrics!
      const poolAddr = pos.pool_address || pos.pool;
      if (poolAddr) {
        liveQuote = await fetchLivePoolQuote(poolAddr);
      }

      const entryTimeMs = entryDateInfo ? new Date(entryDateInfo.iso).getTime() : Date.now();
      const elapsedHoursLive = Math.max(0.1, (Date.now() - entryTimeMs) / (1000 * 60 * 60));
      holdingHours = Number(elapsedHoursLive.toFixed(1));

      if (liveQuote && liveQuote.price) {
        const currentPrice = liveQuote.price;
        const priceChangePct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0.0;
        
        // Estimate rough fee accumulation based on live fee/activeTVL ratio
        const feeRatio24h = liveQuote.feeActiveTvlRatioPct ? liveQuote.feeActiveTvlRatioPct / 100 : 0.005;
        const estFees = capital * feeRatio24h * (holdingHours / 24);
        feeUsd = Number(estFees.toFixed(4));

        // Estimate DLMM return with 50/50 initial split + fee yield
        const inventoryPnlUsd = (capital * (priceChangePct / 100 * 0.5));
        pnlUsd = Number((inventoryPnlUsd + feeUsd).toFixed(4));
        pnlPct = Number(((pnlUsd / capital) * 100).toFixed(2));
        
        const inRangeNow = liveQuote.activeBin != null && pos.lower_bin != null && pos.upper_bin != null
          ? (liveQuote.activeBin >= pos.lower_bin && liveQuote.activeBin <= pos.upper_bin)
          : true;

        exitReason = inRangeNow 
          ? `LIVE_ACTIVE: Bin ${liveQuote.activeBin} in-range. PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct}% (Quote live dari on-chain DLMM)`
          : `LIVE_WARNING: Bin ${liveQuote.activeBin} out-of-range (${pos.lower_bin}..${pos.upper_bin})`;
      } else if (lastCheck) {
        const est = lastCheck.estimated || {};
        pnlUsd = Number(est.dlmm_pnl_usd ?? lastCheck.dlmm_pnl_usd ?? 0.0);
        pnlPct = Number(est.dlmm_pnl_pct ?? lastCheck.dlmm_pnl_pct ?? 0.0);
        feeUsd = Number(est.rough_fee_est_usd ?? 0.0);
        holdingHours = Number(est.elapsed_hours ?? holdingHours);
        exitReason = lastCheck.exit_rule_evaluation || 'IN_PROGRESS';
      }

      openPnl += pnlUsd;
    }

    const poolName = pos.pool_name || pos.name || pos.pair || 'UNKNOWN';
    const volume24h = Number(liveQuote?.volume24hUsd ?? closeReport.volume_24h_usd ?? lastCheck?.volume_24h_usd ?? pos.entry_metrics?.tvl_usd ?? 0.0);
    totalVolume += volume24h;
    totalFees += feeUsd;

    let baseline5050Pct = Number(closeReport.baseline_50_50_pnl_pct ?? closeReport.estimated?.baseline_50_50_pnl_pct ?? 0.0);
    let baselineVolatilePct = Number(closeReport.baseline_volatile_only_pnl_pct ?? closeReport.baseline_jup_only_pnl_pct ?? closeReport.baseline_sol_only_pnl_pct ?? 0.0);

    if (isOpen && liveQuote?.price && entryPrice > 0) {
      const priceChangePct = ((liveQuote.price - entryPrice) / entryPrice) * 100;
      baseline5050Pct = Number((priceChangePct * 0.5).toFixed(2));
      baselineVolatilePct = Number(priceChangePct.toFixed(2));
    }

    if (!poolStats[poolName]) {
      poolStats[poolName] = {
        name: poolName,
        address: pos.pool_address || pos.pool || '',
        totalTrades: 0,
        openTrades: 0,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        realizedPnlUsd: 0.0,
        openPnlUsd: 0.0,
        totalPnlUsd: 0.0,
        totalFeesUsd: 0.0,
        totalVolumeUsd: 0.0,
        totalHoldingHours: 0.0,
        bestTradePnl: -Infinity,
        worstTradePnl: Infinity,
        trades: [],
      };
    }

    const pStat = poolStats[poolName];
    pStat.totalTrades++;
    if (isClosed) {
      pStat.closedTrades++;
      pStat.realizedPnlUsd += pnlUsd;
      pStat.totalHoldingHours += holdingHours;
      if (pnlUsd >= 0) pStat.wins++;
      else pStat.losses++;
      if (pnlUsd > pStat.bestTradePnl) pStat.bestTradePnl = pnlUsd;
      if (pnlUsd < pStat.worstTradePnl) pStat.worstTradePnl = pnlUsd;
    } else {
      pStat.openTrades++;
      pStat.openPnlUsd += pnlUsd;
    }
    pStat.totalPnlUsd = pStat.realizedPnlUsd + pStat.openPnlUsd;
    pStat.totalFeesUsd += feeUsd;
    pStat.totalVolumeUsd += volume24h;

    if (tradeDateInfo) {
      const dateKey = tradeDateInfo.wibDate;
      const monthKey = tradeDateInfo.wibMonth;

      if (!dailyPnlMap[dateKey]) {
        dailyPnlMap[dateKey] = {
          date: dateKey,
          month: monthKey,
          day: tradeDateInfo.wibDay,
          pnlUsd: 0.0,
          tradeCount: 0,
          winCount: 0,
          lossCount: 0,
          trades: [],
        };
      }
      const dayEntry = dailyPnlMap[dateKey];
      if (isClosed) {
        dayEntry.pnlUsd += pnlUsd;
        dayEntry.tradeCount++;
        if (pnlUsd >= 0) dayEntry.winCount++;
        else dayEntry.lossCount++;
      } else {
        dayEntry.tradeCount++;
      }

      if (!monthlyStatsMap[monthKey]) {
        monthlyStatsMap[monthKey] = {
          month: monthKey,
          pnlUsd: 0.0,
          tradeCount: 0,
          winCount: 0,
          lossCount: 0,
          bestDayPnl: -Infinity,
          worstDayPnl: Infinity,
          bestDayDate: null,
          worstDayDate: null,
          activeDaysCount: 0,
          greenDaysCount: 0,
          redDaysCount: 0,
        };
      }
    }

    const currentBin = liveQuote?.activeBin ?? (closeReport.close_active_bin ?? (lastCheck?.active_bin ?? pos.entry_active_bin));
    const inRange = isClosed 
      ? (closeReport.in_range_at_close ?? true)
      : (liveQuote ? (liveQuote.activeBin >= pos.lower_bin && liveQuote.activeBin <= pos.upper_bin) : (lastCheck?.in_range ?? true));

    const enrichedTrade = {
      id: `trade_${index + 1}`,
      rawIndex: index,
      status,
      isPaper,
      poolName,
      poolAddress: pos.pool_address || pos.pool || '',
      strategy: pos.strategy || 'spot',
      capitalUsd: capital,
      entryPrice: entryPrice > 0 ? entryPrice : null,
      currentPrice: liveQuote?.price || null,
      pnlUsd: Number(pnlUsd.toFixed(4)),
      pnlPct: Number(pnlPct.toFixed(2)),
      feeUsd: Number(feeUsd.toFixed(4)),
      holdingHours: Number(holdingHours.toFixed(1)),
      exitReason,
      entryDateInfo,
      closeDateInfo,
      tradeDateInfo,
      isLiveRealtime: Boolean(liveQuote),
      liveQuote,
      bins: {
        entryActiveBin: pos.entry_active_bin,
        lowerBin: pos.lower_bin,
        upperBin: pos.upper_bin,
        binStepBps: pos.bin_step_bps,
        closeActiveBin: currentBin,
        inRange,
      },
      inventory: pos.paper_inventory || pos.inventory || {},
      entryMetrics: pos.entry_metrics || {},
      baselines: {
        baseline5050Pct: Number(baseline5050Pct.toFixed(2)),
        baselineVolatilePct: Number(baselineVolatilePct.toFixed(2)),
      },
      checksCount: monitorChecks.length,
      monitorChecks: monitorChecks.map((c) => ({
        checkedAtUtc: c.checked_at_utc,
        checkedAtWib: c.checked_at_wib,
        activeBin: c.active_bin,
        inRange: c.in_range,
        poolPrice: c.pool_price_jup_usdc || c.pool_price_jup_sol || c.pool_price_sol_usdc || c.pool_price_sol_usdt || c.price,
        tvlUsd: c.tvl_usd,
        activeTvlUsd: c.active_tvl_usd,
        volume24hUsd: c.volume_24h_usd,
        fee24hUsd: c.fee_24h_usd,
        feeActiveTvlRatioPct: c.fee_active_tvl_ratio_24h_pct,
        pnlUsd: c.estimated?.dlmm_pnl_usd ?? c.dlmm_pnl_usd,
        pnlPct: c.estimated?.dlmm_pnl_pct ?? c.dlmm_pnl_pct,
        evalReason: c.exit_rule_evaluation,
      })),
      closeReport,
    };

    pStat.trades.push(enrichedTrade);
    if (tradeDateInfo && dailyPnlMap[tradeDateInfo.wibDate]) {
      dailyPnlMap[tradeDateInfo.wibDate].trades.push(enrichedTrade);
    }

    enrichedTrades.push(enrichedTrade);
  }

  Object.values(dailyPnlMap).forEach((day) => {
    const monthKey = day.month;
    if (monthlyStatsMap[monthKey]) {
      const m = monthlyStatsMap[monthKey];
      m.pnlUsd += day.pnlUsd;
      m.tradeCount += day.tradeCount;
      m.winCount += day.winCount;
      m.lossCount += day.lossCount;
      m.activeDaysCount++;

      if (day.pnlUsd > 0) m.greenDaysCount++;
      else if (day.pnlUsd < 0) m.redDaysCount++;

      if (day.pnlUsd > m.bestDayPnl) {
        m.bestDayPnl = day.pnlUsd;
        m.bestDayDate = day.date;
      }
      if (day.pnlUsd < m.worstDayPnl) {
        m.worstDayPnl = day.pnlUsd;
        m.worstDayDate = day.date;
      }
    }
  });

  const poolsList = Object.values(poolStats).map((p) => {
    const winRate = p.closedTrades > 0 ? (p.wins / p.closedTrades) * 100 : 0;
    const avgDuration = p.closedTrades > 0 ? p.totalHoldingHours / p.closedTrades : 0;
    const avgPnl = p.closedTrades > 0 ? p.realizedPnlUsd / p.closedTrades : 0;
    return {
      name: p.name,
      address: p.address,
      totalTrades: p.totalTrades,
      openTrades: p.openTrades,
      closedTrades: p.closedTrades,
      wins: p.wins,
      losses: p.losses,
      winRatePct: Number(winRate.toFixed(1)),
      realizedPnlUsd: Number(p.realizedPnlUsd.toFixed(4)),
      openPnlUsd: Number(p.openPnlUsd.toFixed(4)),
      totalPnlUsd: Number(p.totalPnlUsd.toFixed(4)),
      totalFeesUsd: Number(p.totalFeesUsd.toFixed(4)),
      totalVolumeUsd: Number(p.totalVolumeUsd.toFixed(2)),
      avgDurationHours: Number(avgDuration.toFixed(1)),
      avgPnlUsd: Number(avgPnl.toFixed(4)),
      bestTradePnl: p.bestTradePnl === -Infinity ? 0 : Number(p.bestTradePnl.toFixed(4)),
      worstTradePnl: p.worstTradePnl === Infinity ? 0 : Number(p.worstTradePnl.toFixed(4)),
    };
  });

  const totalClosed = winCount + lossCount;
  const winRatePct = totalClosed > 0 ? (winCount / totalClosed) * 100 : 0;
  const profitFactor = totalLossUsd > 0 ? totalGainUsd / totalLossUsd : totalGainUsd > 0 ? 99.0 : 0.0;
  const currentEquity = baseCapital + realizedPnl + openPnl;

  let runningPnl = 0.0;
  const equityGrowthSeries = [];
  enrichedTrades.forEach((t) => {
    if (t.status.includes('CLOSED')) {
      runningPnl += t.pnlUsd;
      equityGrowthSeries.push({
        tradeId: t.id,
        poolName: t.poolName,
        date: t.tradeDateInfo?.wibString || t.entryDateInfo?.wibString,
        tradePnl: t.pnlUsd,
        cumulativePnl: Number(runningPnl.toFixed(4)),
        equity: Number((baseCapital + runningPnl).toFixed(4)),
      });
    }
  });

  return {
    kpis: {
      baseCapitalUsd: baseCapital,
      realizedPnlUsd: Number(realizedPnl.toFixed(4)),
      openPnlUsd: Number(openPnl.toFixed(4)),
      totalEquityUsd: Number(currentEquity.toFixed(4)),
      roiPct: baseCapital > 0 ? Number(((realizedPnl / baseCapital) * 100).toFixed(2)) : 0.0,
      totalTrades: enrichedTrades.length,
      closedTrades: totalClosed,
      openTrades: enrichedTrades.length - totalClosed,
      wins: winCount,
      losses: lossCount,
      winRatePct: Number(winRatePct.toFixed(1)),
      profitFactor: Number(profitFactor.toFixed(2)),
      totalGainUsd: Number(totalGainUsd.toFixed(4)),
      totalLossUsd: Number(totalLossUsd.toFixed(4)),
      totalVolumeUsd: Number(totalVolume.toFixed(2)),
      totalFeesUsd: Number(totalFees.toFixed(4)),
      currentCompoundingSize: isPaper ? Number(Math.max(60.0, baseCapital + realizedPnl - 5.0).toFixed(2)) : 0.0,
    },
    pools: poolsList,
    dailyPnl: dailyPnlMap,
    monthlyStats: Object.values(monthlyStatsMap).sort((a, b) => b.month.localeCompare(a.month)),
    equityGrowthSeries,
    trades: enrichedTrades.reverse(),
  };
}

async function getRealTradingPayload() {
  const stateData = readJsonSafe(REAL_STATE_PATH, { positions: {}, recentEvents: [] });
  
  let liveWalletData = {
    wallet: '9uNSXiB9wN3uummTzkhoPpQBaMD35nVLeWVW3VDR6SBR',
    solBalance: 0,
    usdcBalance: 0,
    totalUsd: 0,
    positionsCount: 0,
    status: 'STANDBY_PAPER_ONLY',
  };

  try {
    const { stdout } = await execPromise(`node ${path.join(MERIDIAN_PROJECT_DIR, 'cli.js')} wallet-positions --wallet 9uNSXiB9wN3uummTzkhoPpQBaMD35nVLeWVW3VDR6SBR 2>/dev/null`);
    const parsed = JSON.parse(stdout.trim());
    if (parsed && !parsed.error) {
      liveWalletData.onChainPositions = parsed.positions || [];
      liveWalletData.totalPositions = parsed.total_positions || 0;
    }
  } catch (err) {}

  const processed = await processPositionsData(stateData.positions || [], false);
  processed.wallet = liveWalletData;
  return processed;
}

function getBotInfo() {
  const cronData = readJsonSafe(CRON_JOBS_PATH, { jobs: [] });
  const job = cronData.jobs && cronData.jobs[0] ? cronData.jobs[0] : null;

  return {
    agentName: 'Agus Profit (Meteora DLMM / Meridian)',
    profile: 'ghepappo',
    cronSchedule: job?.schedule?.expr || '0 0,4,8,12,16,20 * * *',
    cronDisplay: 'Setiap 4 jam (03:00, 07:00, 11:00, 15:00, 19:00, 23:00 WIB)',
    nextRunAtUtc: job?.next_run_at || null,
    lastRunAtUtc: job?.last_run_at || null,
    lastStatus: job?.last_status || 'ok',
    runsCompleted: job?.repeat?.completed || 0,
    enabled: job?.enabled ?? true,
  };
}

async function getFullDashboardData() {
  const rawPaper = readJsonSafe(PAPER_POSITIONS_PATH, []);
  const processedPaper = await processPositionsData(rawPaper, true);
  const processedReal = await getRealTradingPayload();
  const botInfo = getBotInfo();

  return {
    timestamp: new Date().toISOString(),
    botInfo,
    paper: processedPaper,
    real: processedReal,
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (pathname === '/api/data' || pathname === '/api/trades' || pathname === '/api/sync') {
      const data = await getFullDashboardData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    if (pathname === '/api/status') {
      const botInfo = getBotInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', botInfo, timestamp: new Date().toISOString() }));
      return;
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(filePath).pipe(res);
    } else {
      const indexFile = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexFile).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    }
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DLMM Meridian Dashboard running at http://0.0.0.0:${PORT}`);
});