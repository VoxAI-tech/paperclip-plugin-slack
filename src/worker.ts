/**
 * Main worker — uses definePlugin + runWorker from @paperclipai/plugin-sdk.
 * Socket Mode for real-time Slack events, ctx.events.on() for Paperclip events.
 */

import { definePlugin, runWorker } from '@paperclipai/plugin-sdk';
import type { PluginContext, PluginEvent, ScopeKey } from '@paperclipai/plugin-sdk';
import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import { SlackAdapter } from './adapter.js';
import { ACTIONS } from './constants.js';
import {
  formatIssueCreated,
  formatIssueStatusChanged,
  formatApprovalCreated,
  formatAgentRunFailed,
  formatAgentRunCompleted,
  formatDailyDigest,
} from './formatters.js';

function scopeKey(stateKey: string): ScopeKey {
  return { scopeKind: 'instance', stateKey };
}

interface ThreadMapping {
  issueId: string;
  issueIdentifier: string;
  companyId: string;
  channelId: string;
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const config = await ctx.config.get();

    // Guard: if not configured yet, register events/tools but skip Slack connection
    const botTokenRef = config['slackBotTokenRef'] as string | undefined;
    const appTokenRef = config['slackAppTokenRef'] as string | undefined;
    const defaultChannel = (config['defaultChannelId'] as string) || '';

    if (!botTokenRef || !appTokenRef || !defaultChannel) {
      ctx.logger.info('Slack plugin not yet configured — waiting for settings');
      return;
    }

    // Resolve secrets — support both Paperclip secret refs (UUIDs) and direct token values
    async function resolveTokenOrSecret(value: string): Promise<string> {
      if (value.startsWith('xoxb-') || value.startsWith('xapp-')) return value;
      try { return await ctx.secrets.resolve(value); } catch { return value; }
    }
    const botToken = await resolveTokenOrSecret(botTokenRef);
    const appToken = await resolveTokenOrSecret(appTokenRef);

    const webClient = new WebClient(botToken);
    const socketClient = new SocketModeClient({ appToken });
    const adapter = new SlackAdapter(webClient);

    function channelFor(type: 'approvals' | 'errors' | 'escalations'): string {
      return (config[`${type}ChannelId`] as string) || defaultChannel;
    }

    // ── Thread mapping state ──

    async function getMappings(): Promise<Record<string, ThreadMapping>> {
      const stored = await ctx.state.get(scopeKey('thread_mappings'));
      return (stored as Record<string, ThreadMapping> | null) ?? {};
    }

    async function setMapping(threadTs: string, mapping: ThreadMapping): Promise<void> {
      const mappings = await getMappings();
      mappings[threadTs] = mapping;
      await ctx.state.set(scopeKey('thread_mappings'), mappings);
    }

    // Helper to get first company ID
    async function getCompanyId(): Promise<string | null> {
      const companies = await ctx.companies.list();
      return companies.length > 0 ? companies[0].id : null;
    }

    // ── Slack Socket Mode: inbound ──

    socketClient.on('message', async ({ event, ack }: { event: Record<string, string>; ack: () => Promise<void> }) => {
      await ack();
      if (!config['enableReplyRouting']) return;
      if (event['bot_id']) return;
      if (!event['thread_ts']) return;

      const mappings = await getMappings();
      const mapping = mappings[event['thread_ts']];
      if (!mapping) return;

      await ctx.issues.createComment(
        mapping.issueId,
        `**Board** (via Slack <@${event['user']}>):\n\n${event['text']}`,
        mapping.companyId
      );

      await webClient.reactions.add({
        channel: event['channel'],
        timestamp: event['ts'],
        name: 'white_check_mark',
      });
    });

    socketClient.on('interactive', async ({ action, ack, body }: { action: Record<string, string>; ack: () => Promise<void>; body: Record<string, Record<string, string>> }) => {
      await ack();
      const actionId = action['action_id'];

      if (actionId === ACTIONS.APPROVE || actionId === ACTIONS.REJECT) {
        const approvalId = action['value'];
        const resolution = actionId === ACTIONS.APPROVE ? 'approved' : 'rejected';

        await ctx.http.fetch(`/api/approvals/${approvalId}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolution, resolvedBy: 'board' }),
        });

        await adapter.editMessage(
          { channelId: body['channel']['id'], messageTs: body['message']['ts'] },
          `Approval *${resolution}* by <@${body['user']['id']}>`
        );
      }
    });

    socketClient.on('slash_commands', async ({ command, ack, body }: { command: string; ack: (r?: { text: string }) => Promise<void>; body: Record<string, string> }) => {
      const cmdName = command.replace(/^\/hq-/, '');
      const companyId = await getCompanyId();
      if (!companyId) { await ack({ text: 'No companies found.' }); return; }

      if (cmdName === 'status') {
        await ack();
        const agents = await ctx.agents.list({ companyId });
        const issues = await ctx.issues.list({ companyId });
        await adapter.sendText(body['channel_id'], [
          '*HQ Status*',
          `*Agents:* ${agents.length}`,
          `*Issues:* ${issues.length}`,
        ].join('\n'));
      } else if (cmdName === 'issues') {
        await ack();
        const issues = await ctx.issues.list({ companyId });
        if (!issues.length) { await adapter.sendText(body['channel_id'], 'No open issues.'); return; }
        const lines = issues.slice(0, 10).map((i) => `*${i.identifier}* ${i.title} — _${i.status}_`);
        await adapter.sendText(body['channel_id'], `*Open Issues* (${issues.length})\n\n${lines.join('\n')}`);
      } else if (cmdName === 'agents') {
        await ack();
        const agents = await ctx.agents.list({ companyId });
        const lines = agents.map((a) => `*${a.name}* (${a.role}) — _${a.status}_`);
        await adapter.sendText(body['channel_id'], `*Agents* (${agents.length})\n\n${lines.join('\n')}`);
      } else {
        await ack({ text: `Unknown command: ${command}` });
      }
    });

    // Start Socket Mode in the background — don't block setup()
    socketClient.start().then(
      () => ctx.logger.info('Slack Socket Mode connected'),
      (err) => ctx.logger.error('Slack Socket Mode failed to connect', { error: String(err) })
    );

    // ── Paperclip events ──

    ctx.events.on('issue.created', async (event: PluginEvent) => {
      if (!config['notifyIssueCreated']) return;
      const text = formatIssueCreated(event.payload as Parameters<typeof formatIssueCreated>[0], '');
      const ref = await adapter.sendText(defaultChannel, text);
      const payload = event.payload as { issue: { id: string; identifier: string } };
      await setMapping(ref.messageTs, {
        issueId: payload.issue.id,
        issueIdentifier: payload.issue.identifier,
        companyId: event.companyId,
        channelId: ref.channelId,
      });
    });

    ctx.events.on('issue.updated', async (event: PluginEvent) => {
      if (!config['notifyIssueUpdated']) return;
      const text = formatIssueStatusChanged(event.payload as Parameters<typeof formatIssueStatusChanged>[0], '');
      await adapter.sendText(defaultChannel, text);
    });

    ctx.events.on('approval.created', async (event: PluginEvent) => {
      if (!config['notifyApprovalCreated']) return;
      const payload = event.payload as Parameters<typeof formatApprovalCreated>[0];
      const text = formatApprovalCreated(payload, '');
      const ref = await adapter.sendButtons(channelFor('approvals'), text, [
        { text: 'Approve', action: ACTIONS.APPROVE, value: payload.approval.id, style: 'primary' },
        { text: 'Reject', action: ACTIONS.REJECT, value: payload.approval.id, style: 'danger' },
      ]);
      if (payload.approval.issueId) {
        await setMapping(ref.messageTs, {
          issueId: payload.approval.issueId, issueIdentifier: '',
          companyId: event.companyId, channelId: ref.channelId,
        });
      }
    });

    ctx.events.on('agent.run.failed', async (event: PluginEvent) => {
      if (!config['notifyAgentError']) return;
      await adapter.sendText(channelFor('errors'), formatAgentRunFailed(event.payload as Parameters<typeof formatAgentRunFailed>[0], ''));
    });

    ctx.events.on('agent.run.finished', async (event: PluginEvent) => {
      if (!config['notifyRunFinished']) return;
      await adapter.sendText(defaultChannel, formatAgentRunCompleted(event.payload as Parameters<typeof formatAgentRunCompleted>[0], ''));
    });

    ctx.events.on('agent.status_changed', async (event: PluginEvent) => {
      const payload = event.payload as { agent: { name: string; status: string; pauseReason?: string } };
      if (payload.agent.status === 'paused') {
        await adapter.sendText(channelFor('errors'), `*${payload.agent.name}* paused${payload.agent.pauseReason ? `: ${payload.agent.pauseReason}` : ''}`);
      }
    });

    // ── Tools ──

    ctx.tools.register('escalate_to_human', {
      displayName: 'Escalate to Human',
      description: 'Escalate an issue to a human via Slack.',
      parametersSchema: { type: 'object', properties: { issueId: { type: 'string' }, reason: { type: 'string' }, suggestedReplies: { type: 'array', items: { type: 'string' } } }, required: ['issueId', 'reason'] },
    }, async (params: unknown, toolCtx) => {
      const p = params as Record<string, unknown>;
      const agents = await ctx.agents.list({ companyId: toolCtx.companyId });
      const agent = agents.find((a) => a.id === toolCtx.agentId);
      const text = [
        `*Escalation from ${agent?.name ?? 'Unknown'}*`,
        `*Issue:* ${p['issueIdentifier'] ?? p['issueId']}`,
        `*Reason:* ${p['reason']}`,
        '_Reply in this thread or use the buttons below._',
      ].join('\n');
      const buttons = [
        ...(p['suggestedReplies'] as string[] ?? []).map((reply, i) => ({
          text: reply.length > 30 ? reply.slice(0, 27) + '...' : reply,
          action: `${ACTIONS.ESCALATION_REPLY}_${i}`, value: reply, style: 'primary' as const,
        })),
        { text: 'Dismiss', action: ACTIONS.ESCALATION_DISMISS, value: 'dismiss', style: 'danger' as const },
      ];
      const ref = await adapter.sendButtons(channelFor('escalations'), text, buttons);
      if (p['issueId']) {
        await setMapping(ref.messageTs, {
          issueId: p['issueId'] as string, issueIdentifier: (p['issueIdentifier'] as string) ?? '',
          companyId: toolCtx.companyId, channelId: ref.channelId,
        });
      }
      return { content: 'Escalation posted to Slack.' };
    });

    ctx.tools.register('post_to_channel', {
      displayName: 'Post to Channel',
      description: 'Post a message to a Slack channel.',
      parametersSchema: { type: 'object', properties: { channelId: { type: 'string' }, text: { type: 'string' }, threadTs: { type: 'string' } }, required: ['channelId', 'text'] },
    }, async (params: unknown) => {
      const p = params as Record<string, unknown>;
      const ref = await adapter.sendText(p['channelId'] as string, p['text'] as string,
        p['threadTs'] ? { threadTs: p['threadTs'] as string } : undefined);
      return { content: `Message posted (ts: ${ref.messageTs})` };
    });

    // ── Jobs ──

    ctx.jobs.register('daily-digest', async () => {
      const companyId = await getCompanyId();
      if (!companyId) return;
      const agents = await ctx.agents.list({ companyId });
      await adapter.sendText(defaultChannel, formatDailyDigest({
        issuesCreated: 0, issuesClosed: 0, runsCompleted: 0, runsFailed: 0,
        totalCostCents: 0, activeAgents: agents.length, pendingApprovals: 0,
      }));
    });

    ctx.jobs.register('thread-cleanup', async () => {
      const mappings = await getMappings();
      const cutoff = (Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000;
      let cleaned = 0;
      for (const ts of Object.keys(mappings)) {
        if (parseFloat(ts) < cutoff) { delete mappings[ts]; cleaned++; }
      }
      if (cleaned > 0) {
        await ctx.state.set(scopeKey('thread_mappings'), mappings);
        ctx.logger.info(`Cleaned ${cleaned} stale thread mappings`);
      }
    });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
