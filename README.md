# 📊 Meridian Multi-Chain LP Analytics Suite (Meteora + Robinhood)

An institutional-grade real-time analytics & PnL tracking suite designed for multi-chain autonomous LP trading bots:
1. **🪐 Meteora DLMM Bot** (Solana Mainnet) — Dynamic Liquidity Market Maker
2. **🏹 Robinhood Chain CLMM Bot** (Arbitrum Orbit L2 / Chain ID: 4663) — Concentrated Liquidity Uniswap v3/v4
3. **🌐 Combined Portfolio Overview** — Unified Multi-Strategy Aggregate

Powered by **Node.js (ESM)**, **Tailwind CSS**, and **Chart.js**, featuring live on-chain quoting, DEXScreener real-time pricing, interactive monthly calendar heatmap matrices, pool efficiency breakdowns, and complete Paper vs. Real trading mode isolation.

---

## 🚀 Key Features

- 🌐 **Multi-Dashboard Architecture**:
  - `/meteora`: Dedicated Meteora DLMM analytics dashboard (Solana on-chain active bins, 50/50 and volatile baselines).
  - `/robinhood`: Dedicated Robinhood Chain CLMM analytics dashboard (Uniswap v3/v4 price bounds, continuous mark-to-market valuation, defensive exit monitoring).
  - `/combined`: Unified portfolio dashboard displaying aggregated equity, combined win rates, side-by-side strategy comparison cards, and integrated trade ledger.
- 📅 **Monthly PnL Calendar Matrix**: Interactive 7-column calendar grid (Mon-Sun) displaying daily net PnL, win/loss trade ratios, and click-to-filter capability across all views.
- ⚡ **Live Real-Time Quotes**:
  - Solana: Direct query via CLI to Meteora contracts for real-time active bins and pool depth.
  - Robinhood: Direct DEXScreener API integration for live pair prices, volume, and continuous CLMM valuation.
- 🔄 **Paper & Real Trading Mode Isolation**: Dynamic context switching between simulation datasets and live on-chain wallet tracking (Solana Mainnet & Arbitrum Orbit).
- 📱 **Mobile-First Responsive Design**: Optimized bottom-sheet modals, touch-friendly navigation drawer, and compact non-wrapping calendar cells for smartphone browsers.
- ⏱️ **Timezone Converter**: Instant one-click toggle between **WIB (UTC+7)** and **UTC**.
- 📥 **One-Click Export**: Download complete transaction and performance history in **CSV** and **JSON** formats tailored to the selected engine and mode.

---

## 🛠️ Architecture & Tech Stack

- **Backend**: Node.js (native http, ES Modules) with integrated CLI execution for Solana queries and DEXScreener for EVM L2.
- **Frontend**: Single-Page Application (SPA) powered by Tailwind CSS CDN, Chart.js, and Lucide Icons.
- **Reverse Proxy**: Traefik & Cloudflare Tunnel.

---

## 📦 Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/ghevary/dlmm-dashboard.git
cd dlmm-dashboard
```

### 2. Configure Environment (Optional)
```bash
export PORT=3888
export PAPER_PATH=/path/to/paper_positions.json
export REAL_STATE_PATH=/path/to/state.json
export ROBINHOOD_PAPER_PATH=/path/to/robinhood_paper_positions.json
export ROBINHOOD_REAL_PATH=/path/to/robinhood-state.json
export CRON_PATH=/path/to/jobs.json
export MERIDIAN_DIR=/path/to/meridian
```

### 3. Start the Server
```bash
node server.js
```
Open http://localhost:3888 in your browser.

---

## ⚙️ Production Deployment (systemd)

Create a systemd service unit `~/.config/systemd/user/meridian-dashboard.service`:

```ini
[Unit]
Description=Meridian DLMM & CLMM Multi-Chain PnL Analytics Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/meridian-dashboard
ExecStart=/usr/bin/node /root/meridian-dashboard/server.js
Restart=always
RestartSec=5
Environment=PORT=3888
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Enable and start the service:
```bash
systemctl --user daemon-reload
systemctl --user enable --now meridian-dashboard.service
```

---

## 📄 License
MIT License. Developed for Autonomous Multi-Chain Liquidity Research.
