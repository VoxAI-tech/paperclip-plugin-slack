/**
 * Constants for the Slack plugin.
 */

/** Max agents in a single thread conversation */
export const MAX_AGENTS_PER_THREAD = 5;

/** Stale detection: halt if identical outputs repeat this many times */
export const STALE_REPEAT_THRESHOLD = 3;

/** Action ID prefixes for button callbacks */
export const ACTIONS = {
  APPROVE: 'paperclip_approve',
  REJECT: 'paperclip_reject',
  ESCALATION_REPLY: 'paperclip_escalation_reply',
  ESCALATION_DISMISS: 'paperclip_escalation_dismiss',
} as const;

/** Emoji for message formatting */
export const EMOJI = {
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  RUNNING: '🔄',
  PAUSED: '⏸️',
  AGENT: '🤖',
  APPROVAL: '🔐',
  ESCALATION: '🚨',
  INFO: 'ℹ️',
  DONE: '✅',
} as const;
