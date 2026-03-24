/**
 * @voxai/paperclip-plugin-slack
 *
 * Bidirectional Slack integration for Paperclip.
 * - Outbound: agent events → Slack notifications
 * - Inbound: Slack replies → Paperclip issue comments
 * - Interactive: approve/reject buttons, escalation, slash commands
 */

export { default as manifest } from './manifest.js';
export { SlackAdapter } from './adapter.js';
export type { PlatformAdapter, MessageRef, ActionButton, SendOpts } from './adapter.js';
