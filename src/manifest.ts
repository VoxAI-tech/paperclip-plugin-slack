/**
 * Plugin manifest — settings schema, event subscriptions, capabilities, and jobs.
 * Follows the same pattern as paperclip-plugin-telegram.
 */

import type { PluginManifest } from '@paperclipai/plugin-sdk';

const manifest: PluginManifest = {
  id: 'slack',
  name: 'Slack',
  version: '0.1.0',
  description:
    'Bidirectional Slack integration — notifications, reply routing, approve/reject buttons, and bot commands.',

  settings: {
    // ── Required ──
    slackBotTokenRef: {
      type: 'secret',
      label: 'Slack Bot Token',
      description: 'xoxb-... token from your Slack app. Store as a Paperclip secret.',
      required: true,
    },
    slackAppTokenRef: {
      type: 'secret',
      label: 'Slack App-Level Token',
      description: 'xapp-... token for Socket Mode. Store as a Paperclip secret.',
      required: true,
    },
    defaultChannelId: {
      type: 'string',
      label: 'Default Channel ID',
      description: 'Slack channel ID for general notifications (e.g., C0ABC123DEF).',
      required: true,
    },

    // ── Optional channel routing ──
    approvalsChannelId: {
      type: 'string',
      label: 'Approvals Channel ID',
      description: 'Channel for approval requests. Falls back to default.',
    },
    errorsChannelId: {
      type: 'string',
      label: 'Errors Channel ID',
      description: 'Channel for agent errors. Falls back to default.',
    },
    escalationsChannelId: {
      type: 'string',
      label: 'Escalations Channel ID',
      description: 'Channel for human escalations. Falls back to default.',
    },

    // ── Feature toggles ──
    notifyIssueCreated: {
      type: 'boolean',
      label: 'Notify on issue created',
      default: true,
    },
    notifyIssueStatusChanged: {
      type: 'boolean',
      label: 'Notify on issue status change',
      default: true,
    },
    notifyApprovalCreated: {
      type: 'boolean',
      label: 'Notify on approval request',
      default: true,
    },
    notifyAgentError: {
      type: 'boolean',
      label: 'Notify on agent error',
      default: true,
    },
    notifyRunCompleted: {
      type: 'boolean',
      label: 'Notify on run completed',
      default: false,
    },
    enableCommands: {
      type: 'boolean',
      label: 'Enable slash commands',
      description: 'Allow /status, /issues, /agents commands in Slack.',
      default: true,
    },
    enableReplyRouting: {
      type: 'boolean',
      label: 'Enable reply routing',
      description: 'Route Slack thread replies back as Paperclip issue comments.',
      default: true,
    },
    enableDailyDigest: {
      type: 'boolean',
      label: 'Enable daily digest',
      default: false,
    },
    dailyDigestCron: {
      type: 'string',
      label: 'Daily digest schedule',
      description: 'Cron expression for daily digest.',
      default: '0 7 * * *',
    },

    // ── Escalation ──
    escalationTimeoutMinutes: {
      type: 'number',
      label: 'Escalation timeout (minutes)',
      description: 'Auto-resolve escalations after this time. 0 = no timeout.',
      default: 30,
    },
    escalationDefaultAction: {
      type: 'string',
      label: 'Escalation default action',
      description: 'Action when escalation times out: approve, reject, or skip.',
      default: 'skip',
    },
  },

  events: [
    'issue.created',
    'issue.updated',
    'issue.status_changed',
    'issue.comment_created',
    'approval.created',
    'approval.resolved',
    'agent.run.started',
    'agent.run.completed',
    'agent.run.failed',
    'agent.paused',
  ],

  capabilities: [
    'companies.read',
    'issues.read',
    'issues.write',
    'issues.comments.read',
    'issues.comments.write',
    'agents.read',
    'agents.write',
    'approvals.read',
    'approvals.write',
    'goals.read',
    'projects.read',
    'runs.read',
    'costs.read',
    'events.read',
  ],

  jobs: [
    {
      id: 'daily-digest',
      name: 'Daily Digest',
      description: 'Posts a daily summary of agent activity and issue metrics.',
      cron: '0 7 * * *',
    },
    {
      id: 'escalation-timeout',
      name: 'Escalation Timeout Check',
      description: 'Resolves timed-out escalations with default action.',
      cron: '*/5 * * * *',
    },
  ],

  tools: [
    {
      name: 'escalate_to_human',
      description: 'Escalate an issue to a human via Slack with optional suggested replies.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string', description: 'The issue ID to escalate' },
          reason: { type: 'string', description: 'Why this needs human attention' },
          suggestedReplies: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional quick-reply buttons for the human',
          },
        },
        required: ['issueId', 'reason'],
      },
    },
    {
      name: 'post_to_channel',
      description: 'Post a message to a specific Slack channel.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: 'Slack channel ID' },
          text: { type: 'string', description: 'Message text (supports mrkdwn)' },
          threadTs: { type: 'string', description: 'Optional thread timestamp to reply in' },
        },
        required: ['channelId', 'text'],
      },
    },
  ],
};

export default manifest;
