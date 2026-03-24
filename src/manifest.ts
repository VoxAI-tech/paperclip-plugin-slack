/**
 * Plugin manifest — exported as default, referenced by package.json paperclip.manifest.
 */

import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';

const manifest: PaperclipPluginManifestV1 = {
  id: 'voxai.slack',
  apiVersion: 1,
  version: '0.1.0-beta.1',
  displayName: 'Slack',
  description: 'Bidirectional Slack integration — notifications, reply routing, approve/reject buttons, and slash commands.',
  author: 'Vox AI <engineering@vox.ai>',
  categories: ['connector'],

  capabilities: [
    'companies.read',
    'issues.read',
    'issues.create',
    'issues.update',
    'issue.comments.read',
    'issue.comments.create',
    'agents.read',
    'goals.read',
    'projects.read',
    'costs.read',
    'events.subscribe',
    'plugin.state.read',
    'plugin.state.write',
    'http.outbound',
    'secrets.read-ref',
    'agent.tools.register',
    'jobs.schedule',
    'activity.log.write',
  ],

  entrypoints: {
    worker: './dist/worker.js',
  },

  instanceConfigSchema: {
    type: 'object',
    properties: {
      slackBotTokenRef: { type: 'string', description: 'Secret ref to xoxb-... bot token' },
      slackAppTokenRef: { type: 'string', description: 'Secret ref to xapp-... app token' },
      defaultChannelId: { type: 'string', description: 'Default Slack channel ID' },
      approvalsChannelId: { type: 'string', description: 'Approvals channel ID' },
      errorsChannelId: { type: 'string', description: 'Errors channel ID' },
      escalationsChannelId: { type: 'string', description: 'Escalations channel ID' },
      notifyIssueCreated: { type: 'boolean', default: true },
      notifyIssueUpdated: { type: 'boolean', default: true },
      notifyApprovalCreated: { type: 'boolean', default: true },
      notifyAgentError: { type: 'boolean', default: true },
      notifyRunFinished: { type: 'boolean', default: false },
      enableReplyRouting: { type: 'boolean', default: true },
      enableCommands: { type: 'boolean', default: true },
    },
    required: ['slackBotTokenRef', 'slackAppTokenRef', 'defaultChannelId'],
  },

  jobs: [
    {
      jobKey: 'daily-digest',
      displayName: 'Daily Digest',
      description: 'Posts daily summary of agent activity.',
      schedule: '0 7 * * *',
    },
    {
      jobKey: 'thread-cleanup',
      displayName: 'Thread Mapping Cleanup',
      description: 'Removes stale thread mappings older than 7 days.',
      schedule: '0 */6 * * *',
    },
  ],

  tools: [
    {
      name: 'escalate_to_human',
      displayName: 'Escalate to Human',
      description: 'Escalate an issue to a human via Slack with optional suggested replies.',
      parametersSchema: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          reason: { type: 'string' },
          suggestedReplies: { type: 'array', items: { type: 'string' } },
        },
        required: ['issueId', 'reason'],
      },
    },
    {
      name: 'post_to_channel',
      displayName: 'Post to Channel',
      description: 'Post a message to a specific Slack channel.',
      parametersSchema: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          text: { type: 'string' },
          threadTs: { type: 'string' },
        },
        required: ['channelId', 'text'],
      },
    },
  ],
};

export default manifest;
