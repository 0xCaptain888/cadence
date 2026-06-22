// src/core/budget.js
// -----------------------------------------------------------------------------
// Per-listener budgeting. The core promise of Cadence: YOUR subscription money
// is split only across the artists YOU actually listened to. Each play draws a
// small nanopayment from the listener's remaining monthly budget; once the
// budget is exhausted, further plays still attribute (for analytics) but settle
// $0 until the cycle resets.
// -----------------------------------------------------------------------------

import { config } from './config.js';
import { store } from './store.js';

/**
 * @param {string} userId
 * @returns {{amountUsd:number, remainingBudget:number, capped:boolean}}
 */
export function allocate(userId) {
  const spent = store.getUserSpend(userId);
  const remaining = Math.max(0, config.monthlyBudgetUsd - spent);
  const amountUsd = Math.min(config.perPlayUsd, remaining);
  const capped = amountUsd < config.perPlayUsd;
  if (amountUsd > 0) store.addUserSpend(userId, amountUsd);
  return {
    amountUsd: Number(amountUsd.toFixed(6)),
    remainingBudget: Number((remaining - amountUsd).toFixed(6)),
    capped,
  };
}

export default allocate;
