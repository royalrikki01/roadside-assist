import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALERTS_FILE = path.join(__dirname, 'alerts.json');
const CONFIG_FILE = path.join(__dirname, 'scraper-config.json');

// ─── DEFAULT CONFIG ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  baseUrl: 'http://www.jalanjewels.com',
  liveRatePath: '/',
  // CSS selectors for each metal — update these after inspecting the page
  selectors: {
    gold_24k: '#gold24k, .gold24, [id*="24k"], [class*="24k"]',
    gold_22k: '#gold22k, .gold22, [id*="22k"], [class*="22k"]',
    gold_18k: '#gold18k, .gold18, [id*="18k"], [class*="18k"]',
    silver:   '#silver, .silver, [id*="silver"], [class*="silver"]',
  },
  // Fallback: regex over full page text when selectors find nothing
  usePatternMatch: true,
  pollIntervalMinutes: 5,
};

// ─── PERSISTENCE HELPERS ───────────────────────────────────────────────────────

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadAlerts() {
  if (fs.existsSync(ALERTS_FILE)) {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
  }
  return [];
}

function saveAlerts(alerts) {
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

// ─── SCRAPER ───────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
};

function extractNumber(text) {
  const cleaned = text.replace(/[₹,\s ]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

async function fetchLiveRates() {
  const config = loadConfig();
  const url = config.baseUrl.replace(/\/$/, '') + config.liveRatePath;

  const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Referer: config.baseUrl } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — try configure_scraper to fix the URL`);

  const html = await res.text();
  const $ = cheerio.load(html);
  const rates = {};

  // Step 1: try configured selectors
  for (const [metal, selector] of Object.entries(config.selectors)) {
    $(selector).each((_, el) => {
      if (rates[metal] !== undefined) return;
      const num = extractNumber($(el).text());
      if (num !== null && num > 100) rates[metal] = num; // sanity: rates > ₹100
    });
  }

  // Step 2: pattern-match over full page text as fallback
  if (config.usePatternMatch) {
    const pageText = $.text().replace(/\s+/g, ' ');
    const patterns = [
      { key: 'gold_24k', re: /24\s*[kKक][^0-9₹]*[₹\s]*([\d,]+)/g },
      { key: 'gold_22k', re: /22\s*[kKक][^0-9₹]*[₹\s]*([\d,]+)/g },
      { key: 'gold_18k', re: /18\s*[kKक][^0-9₹]*[₹\s]*([\d,]+)/g },
      { key: 'silver',   re: /[Ss]ilver\s*[:\-]?\s*[₹\s]*([\d,]+)/g },
    ];

    for (const { key, re } of patterns) {
      if (rates[key] !== undefined) continue;
      re.lastIndex = 0;
      const m = re.exec(pageText);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(num) && num > 100) rates[key] = num;
      }
    }
  }

  return {
    ...rates,
    _fetchedAt: new Date().toISOString(),
    _sourceUrl: url,
    _rawSnippet: $.text().slice(0, 500).replace(/\s+/g, ' ').trim(),
  };
}

// ─── ALERT ENGINE ──────────────────────────────────────────────────────────────

function evaluateAlerts(rates) {
  const alerts = loadAlerts();
  let changed = false;

  for (const alert of alerts) {
    if (alert.status !== 'active') continue;
    const current = rates[alert.commodity];
    if (current === undefined) continue;

    const hit =
      alert.direction === 'below' ? current <= alert.triggerPrice :
      alert.direction === 'above' ? current >= alert.triggerPrice : false;

    if (hit) {
      alert.status = 'triggered';
      alert.triggeredAt = new Date().toISOString();
      alert.triggeredRate = current;
      changed = true;
    }
  }

  if (changed) saveAlerts(alerts);
  return alerts.filter(a => a.status === 'triggered');
}

// ─── BACKGROUND POLL ───────────────────────────────────────────────────────────

let pollTimer = null;

function startPolling() {
  const config = loadConfig();
  const ms = Math.max(1, config.pollIntervalMinutes) * 60_000;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const rates = await fetchLiveRates();
      evaluateAlerts(rates);
    } catch {
      // silent — errors surface when user calls tools
    }
  }, ms);
}

startPolling();

// ─── MCP SERVER ────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'jalan-stoploss', version: '1.0.0' });

// ── check_rate ─────────────────────────────────────────────────────────────────
server.tool(
  'check_rate',
  'Fetch current live gold/silver rates from jalanjewels.com and check all active alerts',
  {
    commodity: z.enum(['gold_24k', 'gold_22k', 'gold_18k', 'silver', 'all'])
      .optional().default('all')
      .describe('Which rate to return. "all" returns every commodity.'),
  },
  async ({ commodity }) => {
    const rates = await fetchLiveRates();
    const triggered = evaluateAlerts(rates);

    let display = commodity === 'all'
      ? rates
      : { [commodity]: rates[commodity], _fetchedAt: rates._fetchedAt, _sourceUrl: rates._sourceUrl };

    let text = JSON.stringify(display, null, 2);
    if (triggered.length > 0) {
      text += `\n\n⚠️  ${triggered.length} ALERT(S) TRIGGERED — call check_triggered_alerts for details.`;
    }
    return { content: [{ type: 'text', text }] };
  }
);

// ── set_stop_loss_alert ────────────────────────────────────────────────────────
server.tool(
  'set_stop_loss_alert',
  'Set a stop-loss (or take-profit) price alert for gold or silver',
  {
    commodity: z.enum(['gold_24k', 'gold_22k', 'gold_18k', 'silver'])
      .describe('Metal to watch'),
    triggerPrice: z.number().positive()
      .describe('Price in ₹ per 10g (gold) or per kg (silver) at which the alert fires'),
    direction: z.enum(['below', 'above'])
      .describe('"below" = stop-loss (fires when price drops to/below level); "above" = take-profit (fires when price rises to/above level)'),
    note: z.string().optional()
      .describe('Optional label e.g. "protect 5g gold position"'),
  },
  async ({ commodity, triggerPrice, direction, note }) => {
    const alerts = loadAlerts();
    const alert = {
      id: crypto.randomUUID().slice(0, 8),
      commodity,
      triggerPrice,
      direction,
      note: note || '',
      status: 'active',
      createdAt: new Date().toISOString(),
      triggeredAt: null,
      triggeredRate: null,
    };
    alerts.push(alert);
    saveAlerts(alerts);

    const arrow = direction === 'below' ? '↓' : '↑';
    return {
      content: [{
        type: 'text',
        text: [
          `Alert created [ID: ${alert.id}]`,
          `${commodity.toUpperCase()} — fire when price ${direction} ₹${triggerPrice.toLocaleString('en-IN')} ${arrow}`,
          note ? `Note: ${note}` : '',
          `Polling every ${loadConfig().pollIntervalMinutes} min. Call check_triggered_alerts anytime.`,
        ].filter(Boolean).join('\n'),
      }],
    };
  }
);

// ── list_alerts ────────────────────────────────────────────────────────────────
server.tool(
  'list_alerts',
  'List all stop-loss alerts',
  {
    status: z.enum(['active', 'triggered', 'acknowledged', 'all'])
      .optional().default('all'),
  },
  async ({ status }) => {
    const alerts = loadAlerts();
    const list = status === 'all' ? alerts : alerts.filter(a => a.status === status);

    if (list.length === 0) {
      return { content: [{ type: 'text', text: `No ${status === 'all' ? '' : status + ' '}alerts.` }] };
    }

    const rows = list.map(a => {
      const tag = a.status === 'active' ? '🟢' : a.status === 'triggered' ? '🔴' : '⚪';
      const line = `${tag} [${a.id}] ${a.commodity.toUpperCase()} ${a.direction} ₹${a.triggerPrice.toLocaleString('en-IN')}` +
        (a.note ? `  — ${a.note}` : '');
      const extra = a.triggeredAt
        ? `   Triggered at ₹${a.triggeredRate?.toLocaleString('en-IN')} on ${new Date(a.triggeredAt).toLocaleString('en-IN')}`
        : `   Set ${new Date(a.createdAt).toLocaleString('en-IN')}`;
      return line + '\n' + extra;
    });

    return { content: [{ type: 'text', text: rows.join('\n\n') }] };
  }
);

// ── check_triggered_alerts ─────────────────────────────────────────────────────
server.tool(
  'check_triggered_alerts',
  'See all alerts that have fired. Also fetches fresh rates to catch any new triggers.',
  {},
  async () => {
    try {
      const rates = await fetchLiveRates();
      evaluateAlerts(rates);
    } catch {
      // use stored state
    }

    const triggered = loadAlerts().filter(a => a.status === 'triggered');
    if (triggered.length === 0) {
      return { content: [{ type: 'text', text: 'No alerts triggered yet.' }] };
    }

    const rows = triggered.map(a =>
      `🔴 [${a.id}] ${a.commodity.toUpperCase()} hit ₹${a.triggeredRate?.toLocaleString('en-IN')}` +
      ` (alert: ${a.direction} ₹${a.triggerPrice.toLocaleString('en-IN')})` +
      (a.note ? `\n   Note: ${a.note}` : '') +
      `\n   Triggered: ${new Date(a.triggeredAt).toLocaleString('en-IN')}\n   Call acknowledge_alert to dismiss.`
    );

    return { content: [{ type: 'text', text: rows.join('\n\n') }] };
  }
);

// ── acknowledge_alert ──────────────────────────────────────────────────────────
server.tool(
  'acknowledge_alert',
  'Dismiss a triggered alert (marks it as acknowledged)',
  {
    id: z.string().describe('Alert ID from list_alerts, or "all" to dismiss every triggered alert'),
  },
  async ({ id }) => {
    const alerts = loadAlerts();
    let count = 0;

    for (const a of alerts) {
      if (a.status === 'triggered' && (id === 'all' || a.id === id)) {
        a.status = 'acknowledged';
        count++;
      }
    }

    if (count === 0) throw new Error(`No triggered alert found with ID "${id}"`);
    saveAlerts(alerts);
    return { content: [{ type: 'text', text: `Acknowledged ${count} alert(s).` }] };
  }
);

// ── delete_alert ───────────────────────────────────────────────────────────────
server.tool(
  'delete_alert',
  'Permanently delete an alert by ID',
  { id: z.string().describe('Alert ID from list_alerts') },
  async ({ id }) => {
    const alerts = loadAlerts();
    const idx = alerts.findIndex(a => a.id === id);
    if (idx === -1) throw new Error(`Alert ID "${id}" not found`);
    const [removed] = alerts.splice(idx, 1);
    saveAlerts(alerts);
    return {
      content: [{
        type: 'text',
        text: `Deleted [${id}]: ${removed.commodity} ${removed.direction} ₹${removed.triggerPrice}`,
      }],
    };
  }
);

// ── configure_scraper ──────────────────────────────────────────────────────────
server.tool(
  'configure_scraper',
  'Update the URL and CSS selectors used to fetch live rates (use after inspecting jalanjewels.com in your browser)',
  {
    baseUrl:             z.string().url().optional().describe('Base URL e.g. "http://www.jalanjewels.com"'),
    liveRatePath:        z.string().optional().describe('Path to the live rate page, default "/"'),
    selector_gold_24k:   z.string().optional().describe('CSS selector for 24K gold rate value'),
    selector_gold_22k:   z.string().optional().describe('CSS selector for 22K gold rate value'),
    selector_gold_18k:   z.string().optional().describe('CSS selector for 18K gold rate value'),
    selector_silver:     z.string().optional().describe('CSS selector for silver rate value'),
    pollIntervalMinutes: z.number().int().min(1).max(60).optional()
      .describe('How often to poll in minutes (default 5)'),
  },
  async (args) => {
    const config = loadConfig();
    if (args.baseUrl)             config.baseUrl = args.baseUrl;
    if (args.liveRatePath)        config.liveRatePath = args.liveRatePath;
    if (args.selector_gold_24k)   config.selectors.gold_24k = args.selector_gold_24k;
    if (args.selector_gold_22k)   config.selectors.gold_22k = args.selector_gold_22k;
    if (args.selector_gold_18k)   config.selectors.gold_18k = args.selector_gold_18k;
    if (args.selector_silver)     config.selectors.silver   = args.selector_silver;
    if (args.pollIntervalMinutes) config.pollIntervalMinutes = args.pollIntervalMinutes;
    saveConfig(config);
    startPolling();
    return { content: [{ type: 'text', text: `Config saved:\n${JSON.stringify(config, null, 2)}` }] };
  }
);

// ── show_config ────────────────────────────────────────────────────────────────
server.tool(
  'show_config',
  'Show current scraper configuration',
  {},
  async () => {
    return { content: [{ type: 'text', text: JSON.stringify(loadConfig(), null, 2) }] };
  }
);

// ── start ──────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
