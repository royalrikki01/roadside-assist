/**
 * JARVIS — Just A Rather Very Intelligent System
 * MCP server with: system diagnostics, weather, web search, reminders,
 * notes, calculator, unit converter, file ops, shell runner, jokes, IP info.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fetch from 'node-fetch';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── JARVIS PERSONALITY ────────────────────────────────────────────────────────

const RESPONSES = [
  'At your service, sir.',
  'Certainly, sir.',
  'Of course, sir.',
  'Right away, sir.',
  'Analysis complete, sir.',
  'Task executed, sir.',
  'As you wish, sir.',
];

function j(content) {
  const line = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];
  return `${line}\n\n${content}`;
}

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────

function load(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── MATH EVALUATOR (safe — no eval) ─────────────────────────────────────────

const MATH = {
  abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
  sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow,
  log: Math.log, log2: Math.log2, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  max: Math.max, min: Math.min, hypot: Math.hypot,
  PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
};

function safeCalc(expr) {
  const clean = expr.replace(/\s/g, '').replace(/\^/g, '**');
  if (!/^[0-9+\-*/().%,a-zA-Z_]+$/.test(clean)) throw new Error('Invalid characters in expression');
  return new Function(...Object.keys(MATH), `"use strict"; return (${clean})`)(...Object.values(MATH));
}

// ─── UNIT CONVERSIONS ─────────────────────────────────────────────────────────

const CONVERSIONS = {
  // Length
  km_mi: v => v * 0.621371,    mi_km: v => v * 1.60934,
  m_ft:  v => v * 3.28084,     ft_m:  v => v * 0.3048,
  cm_in: v => v * 0.393701,    in_cm: v => v * 2.54,
  m_yd:  v => v * 1.09361,     yd_m:  v => v * 0.9144,
  // Weight
  kg_lb: v => v * 2.20462,     lb_kg: v => v * 0.453592,
  g_oz:  v => v * 0.035274,    oz_g:  v => v * 28.3495,
  kg_g:  v => v * 1000,        g_kg:  v => v / 1000,
  // Temperature
  c_f: v => (v * 9 / 5) + 32, f_c: v => (v - 32) * 5 / 9,
  c_k: v => v + 273.15,        k_c: v => v - 273.15,
  // Speed
  kmh_mph: v => v * 0.621371,  mph_kmh: v => v * 1.60934,
  ms_kmh:  v => v * 3.6,       kmh_ms:  v => v / 3.6,
  // Volume
  l_gal: v => v * 0.264172,   gal_l: v => v * 3.78541,
  ml_oz: v => v * 0.033814,   oz_ml: v => v * 29.5735,
  // Data
  mb_gb: v => v / 1024,  gb_mb: v => v * 1024,
  gb_tb: v => v / 1024,  tb_gb: v => v * 1024,
  // Area
  m2_ft2: v => v * 10.7639,   ft2_m2: v => v * 0.0929,
  km2_mi2: v => v * 0.386102, mi2_km2: v => v * 2.58999,
};

// ─── BACKGROUND: mark due reminders ──────────────────────────────────────────

setInterval(() => {
  const reminders = load(REMINDERS_FILE);
  const now = Date.now();
  let dirty = false;
  for (const r of reminders) {
    if (r.status === 'pending' && r.dueAt && new Date(r.dueAt).getTime() <= now) {
      r.status = 'due';
      dirty = true;
    }
  }
  if (dirty) save(REMINDERS_FILE, reminders);
}, 60_000);

// ─── SYSTEM HELPERS ───────────────────────────────────────────────────────────

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function memGB(bytes) { return (bytes / 1_073_741_824).toFixed(2); }

// ─── MCP SERVER ───────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'JARVIS', version: '1.0.0' });

// ── greet ──────────────────────────────────────────────────────────────────────
server.tool(
  'greet',
  'JARVIS startup greeting with live system summary',
  {},
  async () => {
    const mem = ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(1);
    const uptime = formatUptime(os.uptime());
    const due = load(REMINDERS_FILE).filter(r => r.status === 'due').length;

    const lines = [
      `Good ${timeOfDay()}, sir. All systems are fully operational.`,
      '',
      `  Host    : ${os.hostname()}`,
      `  OS      : ${os.type()} ${os.release()} (${os.arch()})`,
      `  Uptime  : ${uptime}`,
      `  CPU     : ${os.cpus()[0].model} × ${os.cpus().length}`,
      `  Memory  : ${mem}% used (${memGB(os.freemem())} GB free of ${memGB(os.totalmem())} GB)`,
      `  Load    : ${os.loadavg().map(v => v.toFixed(2)).join(' / ')} (1/5/15 min)`,
      due > 0 ? `\n  ⚠️  ${due} reminder(s) due — call check_due_reminders.` : '',
    ].filter(l => l !== undefined).join('\n');

    return { content: [{ type: 'text', text: lines }] };
  }
);

// ── system_status ─────────────────────────────────────────────────────────────
server.tool(
  'system_status',
  'Full system diagnostics: CPU, memory, network interfaces, platform details',
  {},
  async () => {
    const cpus = os.cpus();
    const nets = Object.entries(os.networkInterfaces())
      .flatMap(([name, addrs]) =>
        (addrs || [])
          .filter(a => !a.internal && a.family === 'IPv4')
          .map(a => `  ${name.padEnd(12)}: ${a.address}`)
      );

    const report = [
      '╔══ SYSTEM STATUS ════════════════════════════╗',
      `  Hostname   : ${os.hostname()}`,
      `  Platform   : ${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
      `  Uptime     : ${formatUptime(os.uptime())}`,
      `  Node.js    : ${process.version}`,
      '├── CPU ─────────────────────────────────────┤',
      `  Model      : ${cpus[0].model}`,
      `  Cores      : ${cpus.length} × ${cpus[0].speed} MHz`,
      `  Load avg   : ${os.loadavg().map(v => v.toFixed(2)).join(' / ')} (1/5/15 min)`,
      '├── MEMORY ──────────────────────────────────┤',
      `  Total      : ${memGB(os.totalmem())} GB`,
      `  Free       : ${memGB(os.freemem())} GB`,
      `  Used       : ${memGB(os.totalmem() - os.freemem())} GB (${((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(1)}%)`,
      '├── NETWORK ─────────────────────────────────┤',
      ...(nets.length ? nets : ['  (no external interfaces)']),
      '╚═════════════════════════════════════════════╝',
    ].join('\n');

    return { content: [{ type: 'text', text: j(report) }] };
  }
);

// ── get_weather ───────────────────────────────────────────────────────────────
server.tool(
  'get_weather',
  'Get current weather for any city in the world',
  { city: z.string().describe('City name e.g. "Mumbai", "London", "New York"') },
  async ({ city }) => {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=v2`,
      { headers: { 'User-Agent': 'JARVIS-MCP/1.0', 'Accept-Language': 'en' } }
    );
    if (!res.ok) throw new Error(`Weather service returned HTTP ${res.status}`);
    const text = await res.text();
    return { content: [{ type: 'text', text: j(`Meteorological report for ${city}:\n\n${text}`) }] };
  }
);

// ── web_search ────────────────────────────────────────────────────────────────
server.tool(
  'web_search',
  'Search the web using DuckDuckGo instant answers',
  { query: z.string().describe('Search query') },
  async ({ query }) => {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'JARVIS-MCP/1.0' } }
    );
    const d = await res.json();

    const parts = [];
    if (d.Answer)     parts.push(`⚡ ${d.Answer}`);
    if (d.Abstract)   parts.push(`📖 ${d.Abstract}\n   — ${d.AbstractSource} (${d.AbstractURL})`);
    if (d.Definition) parts.push(`📚 ${d.Definition}\n   — ${d.DefinitionSource}`);

    const related = (d.RelatedTopics || []).slice(0, 6)
      .filter(t => t.Text)
      .map((t, i) => `  ${i + 1}. ${t.Text}${t.FirstURL ? `\n     ${t.FirstURL}` : ''}`);
    if (related.length) parts.push(`🔗 Related:\n${related.join('\n')}`);

    const result = parts.length
      ? parts.join('\n\n')
      : `No instant answer found for "${query}". Try a more specific query.`;

    return { content: [{ type: 'text', text: j(result) }] };
  }
);

// ── get_time ──────────────────────────────────────────────────────────────────
server.tool(
  'get_time',
  'Get current date and time, optionally in any timezone',
  {
    timezone: z.string().optional()
      .describe('IANA timezone e.g. "Asia/Kolkata", "America/New_York" (default: system)'),
  },
  async ({ timezone }) => {
    const opts = {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'long',
    };
    if (timezone) opts.timeZone = timezone;

    const now = new Date();
    return {
      content: [{
        type: 'text',
        text: j([
          `🕐 ${now.toLocaleString('en-US', opts)}`,
          `   Unix: ${Math.floor(now.getTime() / 1000)}`,
          timezone ? `   Zone: ${timezone}` : '',
        ].filter(Boolean).join('\n')),
      }],
    };
  }
);

// ── calculate ─────────────────────────────────────────────────────────────────
server.tool(
  'calculate',
  'Evaluate a mathematical expression. Supports +, -, *, /, ^, sqrt, sin, cos, log, PI, E, etc.',
  { expression: z.string().describe('e.g. "sqrt(144) + 2^10", "(sin(PI/6))^2 + (cos(PI/6))^2"') },
  async ({ expression }) => {
    const result = safeCalc(expression);
    return { content: [{ type: 'text', text: j(`${expression} = ${result}`) }] };
  }
);

// ── convert_units ─────────────────────────────────────────────────────────────
server.tool(
  'convert_units',
  'Convert between units. Supported pairs: km↔mi, m↔ft, cm↔in, kg↔lb, g↔oz, c↔f/k, kmh↔mph, l↔gal, mb↔gb, gb↔tb, m2↔ft2',
  {
    value: z.number().describe('Value to convert'),
    from:  z.string().describe('Source unit e.g. "km", "kg", "c"'),
    to:    z.string().describe('Target unit e.g. "mi", "lb", "f"'),
  },
  async ({ value, from, to }) => {
    const key = `${from.toLowerCase()}_${to.toLowerCase()}`;
    const fn = CONVERSIONS[key];
    if (!fn) {
      const supported = Object.keys(CONVERSIONS).map(k => k.replace('_', '→')).join(', ');
      throw new Error(`No conversion for "${from} → ${to}".\nSupported: ${supported}`);
    }
    const result = fn(value);
    return { content: [{ type: 'text', text: j(`${value} ${from} = ${+result.toFixed(6)} ${to}`) }] };
  }
);

// ── set_reminder ──────────────────────────────────────────────────────────────
server.tool(
  'set_reminder',
  'Set a reminder. Due time accepts ISO strings or natural language like "in 30 minutes".',
  {
    message: z.string().describe('What to remind you about'),
    dueAt:   z.string().optional()
      .describe('When e.g. "in 2 hours", "in 30 minutes", "2025-06-01T09:00:00"'),
  },
  async ({ message, dueAt }) => {
    let dueDate = null;
    if (dueAt) {
      const natural = dueAt.match(/in\s+(\d+)\s+(second|minute|hour|day)s?/i);
      if (natural) {
        const units = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };
        dueDate = new Date(Date.now() + parseInt(natural[1]) * units[natural[2].toLowerCase()]);
      } else {
        dueDate = new Date(dueAt);
        if (isNaN(dueDate)) throw new Error(`Cannot parse due time: "${dueAt}"`);
      }
    }

    const reminder = {
      id: crypto.randomUUID().slice(0, 8),
      message,
      dueAt: dueDate?.toISOString() ?? null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const all = load(REMINDERS_FILE);
    all.push(reminder);
    save(REMINDERS_FILE, all);

    return {
      content: [{
        type: 'text',
        text: j([
          `Reminder set [${reminder.id}]: "${message}"`,
          dueDate ? `Due: ${dueDate.toLocaleString('en-IN')}` : '(no specific time — I\'ll remember it)',
        ].join('\n')),
      }],
    };
  }
);

// ── list_reminders ────────────────────────────────────────────────────────────
server.tool(
  'list_reminders',
  'List reminders filtered by status',
  { status: z.enum(['pending', 'due', 'done', 'all']).optional().default('all') },
  async ({ status }) => {
    const all = load(REMINDERS_FILE);
    const list = status === 'all' ? all : all.filter(r => r.status === status);

    if (!list.length) return { content: [{ type: 'text', text: j(`No ${status === 'all' ? '' : status + ' '}reminders on record.`) }] };

    const rows = list.map(r => {
      const icon = { due: '🔔', done: '✅', pending: '⏰' }[r.status] ?? '❓';
      return `${icon} [${r.id}] ${r.message}  [${r.status.toUpperCase()}]` +
        (r.dueAt ? `\n   Due: ${new Date(r.dueAt).toLocaleString('en-IN')}` : '');
    });

    return { content: [{ type: 'text', text: j(rows.join('\n\n')) }] };
  }
);

// ── check_due_reminders ───────────────────────────────────────────────────────
server.tool(
  'check_due_reminders',
  'Check which reminders are currently due',
  {},
  async () => {
    const all = load(REMINDERS_FILE);
    const now = Date.now();
    let dirty = false;
    for (const r of all) {
      if (r.status === 'pending' && r.dueAt && new Date(r.dueAt).getTime() <= now) {
        r.status = 'due'; dirty = true;
      }
    }
    if (dirty) save(REMINDERS_FILE, all);

    const due = all.filter(r => r.status === 'due');
    if (!due.length) return { content: [{ type: 'text', text: j('No reminders are due at this time, sir.') }] };

    const rows = due.map(r =>
      `🔔 [${r.id}] ${r.message}` +
      (r.dueAt ? `\n   Was due: ${new Date(r.dueAt).toLocaleString('en-IN')}` : '')
    );
    return { content: [{ type: 'text', text: j(`${due.length} reminder(s) require your attention, sir:\n\n${rows.join('\n\n')}`) }] };
  }
);

// ── done_reminder ─────────────────────────────────────────────────────────────
server.tool(
  'done_reminder',
  'Mark a reminder as done',
  { id: z.string().describe('Reminder ID or "all" to mark all due as done') },
  async ({ id }) => {
    const all = load(REMINDERS_FILE);
    let n = 0;
    for (const r of all) {
      if (r.status !== 'done' && (id === 'all' || r.id === id)) { r.status = 'done'; n++; }
    }
    if (!n) throw new Error(`No reminder found with ID "${id}"`);
    save(REMINDERS_FILE, all);
    return { content: [{ type: 'text', text: j(`${n} reminder(s) marked as done.`) }] };
  }
);

// ── delete_reminder ───────────────────────────────────────────────────────────
server.tool(
  'delete_reminder',
  'Permanently delete a reminder',
  { id: z.string().describe('Reminder ID') },
  async ({ id }) => {
    const all = load(REMINDERS_FILE);
    const i = all.findIndex(r => r.id === id);
    if (i === -1) throw new Error(`Reminder "${id}" not found`);
    const [r] = all.splice(i, 1);
    save(REMINDERS_FILE, all);
    return { content: [{ type: 'text', text: j(`Deleted: "${r.message}"`) }] };
  }
);

// ── add_note ──────────────────────────────────────────────────────────────────
server.tool(
  'add_note',
  'Save a note with optional tags',
  {
    title:   z.string().describe('Note title'),
    content: z.string().describe('Note body'),
    tags:    z.array(z.string()).optional().describe('Tags e.g. ["idea", "work"]'),
  },
  async ({ title, content, tags }) => {
    const notes = load(NOTES_FILE);
    const note = {
      id: crypto.randomUUID().slice(0, 8),
      title, content,
      tags: tags ?? [],
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    save(NOTES_FILE, notes);
    return { content: [{ type: 'text', text: j(`Note saved [${note.id}]: "${title}"`) }] };
  }
);

// ── list_notes ────────────────────────────────────────────────────────────────
server.tool(
  'list_notes',
  'List all notes, optionally filtered by tag',
  { tag: z.string().optional().describe('Filter by tag') },
  async ({ tag }) => {
    const notes = load(NOTES_FILE);
    const list = tag ? notes.filter(n => n.tags.includes(tag)) : notes;
    if (!list.length) return { content: [{ type: 'text', text: j('No notes found.') }] };

    const rows = list.map(n =>
      `📝 [${n.id}] ${n.title}${n.tags.length ? `  [${n.tags.join(', ')}]` : ''}` +
      `\n   ${n.content.slice(0, 120)}${n.content.length > 120 ? '…' : ''}`
    );
    return { content: [{ type: 'text', text: j(rows.join('\n\n')) }] };
  }
);

// ── get_note ──────────────────────────────────────────────────────────────────
server.tool(
  'get_note',
  'Read the full content of a note by ID',
  { id: z.string().describe('Note ID from list_notes') },
  async ({ id }) => {
    const note = load(NOTES_FILE).find(n => n.id === id);
    if (!note) throw new Error(`Note "${id}" not found`);
    return {
      content: [{
        type: 'text',
        text: j([
          `📝 ${note.title}`,
          `Tags   : ${note.tags.join(', ') || 'none'}`,
          `Created: ${new Date(note.createdAt).toLocaleString('en-IN')}`,
          '',
          note.content,
        ].join('\n')),
      }],
    };
  }
);

// ── delete_note ───────────────────────────────────────────────────────────────
server.tool(
  'delete_note',
  'Delete a note by ID',
  { id: z.string().describe('Note ID') },
  async ({ id }) => {
    const notes = load(NOTES_FILE);
    const i = notes.findIndex(n => n.id === id);
    if (i === -1) throw new Error(`Note "${id}" not found`);
    const [n] = notes.splice(i, 1);
    save(NOTES_FILE, notes);
    return { content: [{ type: 'text', text: j(`Deleted note: "${n.title}"`) }] };
  }
);

// ── get_joke ──────────────────────────────────────────────────────────────────
server.tool(
  'get_joke',
  'Retrieve a joke — even JARVIS appreciates levity',
  {
    type: z.enum(['programming', 'dad', 'any']).optional().default('any')
      .describe('Category of joke'),
  },
  async ({ type }) => {
    let joke;
    if (type === 'dad') {
      const res = await fetch('https://icanhazdadjoke.com/', {
        headers: { Accept: 'application/json', 'User-Agent': 'JARVIS-MCP/1.0' },
      });
      joke = (await res.json()).joke;
    } else {
      const cat = type === 'programming' ? 'Programming' : 'Any';
      const res = await fetch(`https://v2.jokeapi.dev/joke/${cat}?blacklistFlags=nsfw,racist,sexist`, {
        headers: { 'User-Agent': 'JARVIS-MCP/1.0' },
      });
      const d = await res.json();
      joke = d.type === 'single' ? d.joke : `${d.setup}\n\n— ${d.delivery}`;
    }
    return {
      content: [{
        type: 'text',
        text: `If I may, sir:\n\n${joke}\n\n…I find occasional levity improves cognitive performance by 11.4%, sir.`,
      }],
    };
  }
);

// ── run_command ───────────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /rm\s+-[rRf]+.*[/\\]/, /mkfs/, /dd\s+if=/, />\s*\/dev\/[^n]/, /:\(\)\{.*\}/, /format\s+[cC]:/,
];

server.tool(
  'run_command',
  'Execute a shell command and return its output (dangerous commands are blocked)',
  {
    command: z.string().describe('Shell command to run'),
    cwd:     z.string().optional().describe('Working directory (default: project root)'),
  },
  async ({ command, cwd }) => {
    if (BLOCKED_PATTERNS.some(p => p.test(command))) {
      return { content: [{ type: 'text', text: `I\'m afraid I can\'t execute that, sir. That command poses a significant risk to system integrity.` }] };
    }
    try {
      const out = execSync(command, {
        cwd: cwd ?? process.cwd(),
        timeout: 15_000,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      });
      return { content: [{ type: 'text', text: j(`$ ${command}\n\n${out}`) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Command failed, sir:\n\n${err.message}` }] };
    }
  }
);

// ── list_files ────────────────────────────────────────────────────────────────
server.tool(
  'list_files',
  'List files and directories at a given path',
  {
    dirPath:    z.string().optional().default('.').describe('Directory to list'),
    showHidden: z.boolean().optional().default(false).describe('Include hidden files'),
  },
  async ({ dirPath, showHidden }) => {
    const resolved = path.resolve(dirPath);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const filtered = entries.filter(e => showHidden || !e.name.startsWith('.'));
    filtered.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const lines = filtered.map(e => {
      const icon = e.isDirectory() ? '📁' : e.isSymbolicLink() ? '🔗' : '📄';
      return `${icon} ${e.name}`;
    });

    return { content: [{ type: 'text', text: j(`${resolved}  (${lines.length} items)\n\n${lines.join('\n')}`) }] };
  }
);

// ── read_file ─────────────────────────────────────────────────────────────────
server.tool(
  'read_file',
  'Read the contents of a file',
  {
    filePath: z.string().describe('File path'),
    encoding: z.enum(['utf8', 'base64', 'hex']).optional().default('utf8'),
  },
  async ({ filePath, encoding }) => {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
    const content = fs.readFileSync(resolved, encoding);
    const { size } = fs.statSync(resolved);
    return { content: [{ type: 'text', text: j(`📄 ${resolved}  (${(size / 1024).toFixed(1)} KB)\n\n${content}`) }] };
  }
);

// ── write_file ────────────────────────────────────────────────────────────────
server.tool(
  'write_file',
  'Write or append content to a file',
  {
    filePath: z.string().describe('File path'),
    content:  z.string().describe('Content to write'),
    append:   z.boolean().optional().default(false).describe('Append instead of overwrite'),
  },
  async ({ filePath, content, append }) => {
    const resolved = path.resolve(filePath);
    append ? fs.appendFileSync(resolved, content, 'utf8') : fs.writeFileSync(resolved, content, 'utf8');
    const { size } = fs.statSync(resolved);
    return { content: [{ type: 'text', text: j(`${append ? 'Appended to' : 'Written to'} ${resolved}  (${(size / 1024).toFixed(1)} KB total)`) }] };
  }
);

// ── get_ip_info ───────────────────────────────────────────────────────────────
server.tool(
  'get_ip_info',
  'Get public IP address and geolocation/ISP details',
  {},
  async () => {
    const res = await fetch('https://ipapi.co/json/', { headers: { 'User-Agent': 'JARVIS-MCP/1.0' } });
    const d = await res.json();
    if (d.error) throw new Error(d.reason ?? 'IP lookup failed');

    const report = [
      `IP Address : ${d.ip}`,
      `Location   : ${d.city}, ${d.region}, ${d.country_name} (${d.country})`,
      `ISP / Org  : ${d.org}`,
      `Timezone   : ${d.timezone}`,
      `Coordinates: ${d.latitude}, ${d.longitude}`,
      `Postal     : ${d.postal}`,
    ].join('\n');

    return { content: [{ type: 'text', text: j(`Network Intelligence:\n\n${report}`) }] };
  }
);

// ─── LAUNCH ───────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
