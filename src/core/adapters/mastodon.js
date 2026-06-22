// src/core/adapters/mastodon.js
// -----------------------------------------------------------------------------
// PORTABILITY STUB. Mastodon / the Fediverse speaks ActivityPub. A boost
// (Announce) of a creator's post is an act of attention that can carry a
// nanopayment to the original author. Same core, third medium.
//
// Wire-up (future): consume the ActivityPub inbox, and on an `Announce`
// activity emit a 'reshare' event attributed to the `attributedTo` actor.
// -----------------------------------------------------------------------------

/**
 * @param {Object} activity  an ActivityPub activity
 * @returns {import('../types.js').CadenceEvent}
 */
export function normalizeReshare(activity) {
  const obj = activity.object || {};
  const author = obj.attributedTo || activity.actor || 'unknown-actor';
  return {
    type: 'reshare',
    mediaFileId: String(obj.id || activity.id || ''),
    userId: String(activity.actor || 'fediverse-user'),
    timestamp: activity.published ? Date.parse(activity.published) : Date.now(),
    playedSeconds: 9999,       // a boost is an explicit, deliberate signal
    trackDuration: 9999,
    clientId: 'activitypub',
    raw: { artist: String(author), title: obj.summary || obj.content || 'boosted post' },
    source: 'mastodon',
  };
}

export const mastodon = {
  name: 'mastodon',
  normalize: normalizeReshare,
  status: 'stub',
};

export default mastodon;
