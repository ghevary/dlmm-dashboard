# 📊 Meteora DLMM Meridian PnL Dashboard

An institutional-grade real-time analytics & PnL tracking dashboard designed for the **Meteora DLMM Meridian Autonomous LP Trading Bot** (Hermes Agent: *Agus Profit*).

Built with **Node.js (ESM)**, **Tailwind CSS**, and **Chart.js**, featuring live on-chain quoting, interactive monthly calendar heatmap matrices, pool efficiency breakdowns, and complete Paper vs. Real trading mode isolation.

---

## 🚀 Key Features

- 📅 **Monthly PnL Calendar Matrix**: Interactive 7-column calendar grid (Mon-Sun) displaying daily net PnL, win/loss trade ratios, and click-to-filter capability.
- ⚡ **Live Real-Time On-Chain Sync**: Direct integration with Meteora DLMM smart contracts and Solana pool APIs to compute real-time active bins, current token prices, and live unrealized PnL on demand.
- 🔍 **Pool Efficiency Analytics**: Comprehensive metrics per pool pair (SOL-USDC, JUP-USDC, JUP-SOL, etc.) comparing DLMM fee yields vs 50/50 HODL vs Volatile HODL baselines.
- 🔄 **Paper & Real Trading Mode Isolation**: Dynamic context switching between simulation datasets and live on-chain wallet tracking.
- 📱 **Mobile-First Responsive Design**: Optimized bottom-sheet modals, touch-friendly navigation drawer, and compact non-wrapping calendar cells for smartphone browsers.
- ⏱️ **Timezone Converter**: Instant one-click toggle between **WIB (UTC+7)** and **UTC**.
- 📥 **One-Click Export**: Download complete transaction and performance history in **CSV** and **JSON** formats.

---

## 🛠️ Architecture & Tech Stack

- **Backend**: Node.js (native http, ES Modules) with integrated CLI execution for Solana on-chain queries.
- **Frontend**: Single-Page Application (SPA) powered by Tailwind CSS CDN, Chart.js, and Lucide Icons.
- **Reverse Proxy**: Traefik with automatic SSL certificate management.

---

## 📦 Installation & Setup

### 1. Clone the Repository
`ash
git clone https://github.com/ghevary/dlmm-dashboard.git
cd dlmm-dashboard
`

### 2. Configure Environment (Optional)
`ash
export PORT=3888
export PAPER_PATH=/path/to/paper_positions.json
export REAL_STATE_PATH=/path/to/state.json
export CRON_PATH=/path/to/jobs.json
export MERIDIAN_DIR=/path/to/meridian
`

### 3. Start the Server
`ash
node server.js
`
Open http://localhost:3888 in your browser.

---

## ⚙️ Production Deployment (systemd)

Create a systemd service unit ~/.config/systemd/user/meridian-dashboard.service:

`ini
[Unit]
Description=Meridian DLMM PnL Analytics Dashboard
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
`

Enable and start the service:
`ash
systemctl --user daemon-reload
systemctl --user enable --now meridian-dashboard.service
`

---

## 📄 License
MIT License. Developed for Meteora DLMM Automated Liquidity Research.
