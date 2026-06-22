// src/core/adapters/index.js
// -----------------------------------------------------------------------------
// Adapter registry. Every adapter implements the same SourceAdapter interface:
//
//   interface SourceAdapter {
//     name: string;
//     normalize(raw): CadenceEvent;   // raw source payload -> core event
//     status?: 'stable' | 'stub';
//   }
//
// The core consumes only CadenceEvent, so adding a medium is purely additive:
// implement normalize(), register it here, done.
// -----------------------------------------------------------------------------

import { subsonic } from './subsonic.js';
import { owncast } from './owncast.js';
import { mastodon } from './mastodon.js';

export const adapters = { subsonic, owncast, mastodon };

export function getAdapter(name) {
  return adapters[name] || subsonic;
}

export { subsonic, owncast, mastodon };
export default adapters;
