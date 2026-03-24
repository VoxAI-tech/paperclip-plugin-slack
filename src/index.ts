/**
 * @voxai/paperclip-plugin-slack
 *
 * Bidirectional Slack integration for Paperclip.
 * - Outbound: agent events → Slack notifications
 * - Inbound: Slack replies → Paperclip issue comments
 * - Interactive: approve/reject buttons, escalation, slash commands
 */

export { default } from './manifest.js';
export { SlackAdapter } from './adapter.js';
export type { PlatformAdapter, MessageRef, ActionButton, SendOpts } from './adapter.js';
export { EscalationManager } from './escalation.js';
export type { EscalationEvent, EscalationRecord } from './escalation.js';
export { ReplyRouter } from './reply-router.js';
export type { ThreadMapping } from './reply-router.js';
