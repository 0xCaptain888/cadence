// src/core/config.js
// -----------------------------------------------------------------------------
// Central configuration for Cadence. Everything is read from environment
// variables with sane MOCK-mode defaults so the project runs end-to-end with
// ZERO secrets, ZERO network and ZERO chain access. A reviewer can clone and
// run immediately; live USDC settlement turns on only when the operator
// supplies real credentials.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Load .env if present (zero-dep, no dotenv needed) ────────────────────────
const __configDir = dirname(fileURLToPath(import.meta.url));
const __envPath = join(__configDir, '..', '..', '.env');
if (existsSync(__envPath)) {
  const env = readFileSync(__envPath, 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (val && !process.env[key]) process.env[key] = val;
  }
}

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

// "mock"  -> deterministic, in-memory, synthetic tx hashes (default)
// "real"  -> sign EIP-3009 authorizations + POST to Circle Gateway
const settlementMode = str('CADENCE_SETTLEMENT_MODE', 'mock').toLowerCase();

export const config = {
  // ---- settlement mode -----------------------------------------------------
  settlementMode,                                  // 'mock' | 'real'
  isReal: settlementMode === 'real',

  // ---- money model ---------------------------------------------------------
  // Each listener funds their OWN pool. Their monthly budget is split only
  // across the artists THEY actually listened to.
  monthlyBudgetUsd: num('CADENCE_MONTHLY_BUDGET_USD', 5.0),
  perPlayUsd:       num('CADENCE_PER_PLAY_USD', 0.002),
  minPlaySeconds:   num('CADENCE_MIN_PLAY_SECONDS', 30),

  // ---- role weights (normalised at attribution time) -----------------------
  roleWeights: {
    performer: 0.50,
    writer:    0.30,   // split across all writers/composers
    producer:  0.12,
    featured:  0.08,
  },

  // ---- anti-fraud thresholds ----------------------------------------------
  fraud: {
    maxPlaysPerTrackPerHour: num('CADENCE_MAX_PLAYS_PER_HOUR', 20),
    minIntervalSeconds:      num('CADENCE_MIN_INTERVAL_SECONDS', 5),
    loopWindowSeconds:       num('CADENCE_LOOP_WINDOW_SECONDS', 3600),
  },

  // ---- external services (all optional) -----------------------------------
  hasAnthropicKey:   Boolean(str('ANTHROPIC_API_KEY', '')),
  anthropicKey:      str('ANTHROPIC_API_KEY', ''),
  anthropicModel:    str('CADENCE_LLM_MODEL', 'claude-sonnet-4-6'),
  musicbrainzLive:   str('CADENCE_MUSICBRAINZ', 'off').toLowerCase() === 'on',

  // ---- on-chain / Circle (only used when settlementMode === 'real') --------
  usdcAddress:       str('CADENCE_USDC_ADDRESS', ''),
  splitterAddress:   str('CADENCE_SPLITTER_ADDRESS', ''),
  chainId:           num('CADENCE_CHAIN_ID', 0),
  rpcUrl:            str('CADENCE_RPC_URL', ''),
  operatorKey:       str('CADENCE_OPERATOR_PRIVATE_KEY', ''),
  circleApiKey:      str('CIRCLE_API_KEY', ''),
  circleGatewayUrl:  str('CIRCLE_GATEWAY_URL', 'https://api.circle.com/v1/w3s/gateway'),
  identityRegistry:  str('ERC8004_REGISTRY', ''),
  // Arc Testnet uses native USDC (no separate ERC-20 token)
  nativeUsdc:        str('CADENCE_USDC_ADDRESS', '').toLowerCase() === 'native',

  // ---- server --------------------------------------------------------------
  port: num('PORT', 3000),
};

export function modeLabel() {
  if (config.isReal) return 'LIVE · Arc testnet · Circle Gateway';
  return 'MOCK · deterministic · no chain';
}

// Short human summary used by the dashboard header and /api/stats.
export function summarize() {
  return {
    mode: config.settlementMode,
    modeLabel: modeLabel(),
    monthlyBudgetUsd: config.monthlyBudgetUsd,
    perPlayUsd: config.perPlayUsd,
    minPlaySeconds: config.minPlaySeconds,
    llmBackend: config.hasAnthropicKey ? 'anthropic' : 'deterministic',
    musicbrainz: config.musicbrainzLive ? 'live' : 'bundled-cache',
    splitterAddress: config.splitterAddress || null,
    explorerBase: config.chainId === 5042002 ? 'https://testnet.arcscan.app' : null,
  };
}

export default config;
