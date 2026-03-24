/**
 * Main worker — handles Paperclip events, Slack interactions, and bidirectional routing.
 * Uses Socket Mode for real-time Slack events (no public URL needed).
 */

import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import type { PluginContext, PluginWorker } from '@paperclipai/plugin-sdk';
import { SlackAdapter } from './adapter.js';
import { ReplyRouter } from './reply-router.js';
import { EscalationManager } from './escalation.js';
import { getCommandHandler } from './commands.js';
import { ACTIONS } from './constants.js';
import {
  formatIssueCreated,
  formatIssueStatusChanged,
  formatIssueComment,
  formatApprovalCreated,
  formatAgentRunFailed,
  formatAgentRunCompleted,
  formatDailyDigest,
  type IssueEvent,
  type ApprovalEvent,
  type AgentRunEvent,
} from './formatters.js';

export default function createWorker(): PluginWorker {
  let webClient: WebClient;
  let socketClient: SocketModeClient;
  let adapter: SlackAdapter;
  let replyRouter: ReplyRouter;
  let escalationManager: EscalationManager;
  let settings: Record<string, unknown>;
  let baseUrl: string;

  function channelFor(type: 'approvals' | 'errors' | 'escalations'): string {
    const specific = settings[`${type}ChannelId`] as string | undefined;
    return specific || (settings['defaultChannelId'] as string);
  }

  return {
    async start(ctx: PluginContext) {
      settings = ctx.settings;
      baseUrl = ctx.serverUrl;

      // Initialize Slack clients
      const botToken = await ctx.secrets.resolve(settings['slackBotTokenRef'] as string);
      const appToken = await ctx.secrets.resolve(settings['slackAppTokenRef'] as string);

      webClient = new WebClient(botToken);
      socketClient = new SocketModeClient({ appToken });
      adapter = new SlackAdapter(webClient);

      // Initialize subsystems
      replyRouter = new ReplyRouter(ctx);
      await replyRouter.init();

      escalationManager = new EscalationManager(ctx, adapter);
      await escalationManager.init();

      // ── Socket Mode: handle Slack events ──

      // Message events (reply routing)
      socketClient.on('message', async ({ event, ack }) => {
        await ack();
        if (!settings['enableReplyRouting']) return;
        if (event.bot_id) return; // Ignore bot messages (our own)
        if (!event.thread_ts) return; // Only threaded replies

        const result = await replyRouter.routeReply(
          event.thread_ts,
          event.user,
          event.text
        );

        if (result) {
          // React to confirm routing
          await webClient.reactions.add({
            channel: event.channel,
            timestamp: event.ts,
            name: 'white_check_mark',
          });
        }
      });

      // Slash commands
      socketClient.on('slash_commands', async ({ command, ack, body }) => {
        const cmdName = command.replace('/', '');
        const handler = getCommandHandler(cmdName);

        if (!handler) {
          await ack({ text: `Unknown command: ${command}` });
          return;
        }

        await ack(); // Acknowledge immediately

        const companyId = settings['companyId'] as string || ctx.companyId;
        const response = await handler(body.text ?? '', {
          ctx,
          adapter,
          channelId: body.channel_id,
          userId: body.user_id,
          companyId,
        });

        await adapter.sendText(body.channel_id, response);
      });

      // Interactive buttons (approve/reject/escalation)
      socketClient.on('interactive', async ({ action, ack, body }) => {
        await ack();
        const actionId = action.action_id;

        // Approval buttons
        if (actionId.startsWith(ACTIONS.APPROVE) || actionId.startsWith(ACTIONS.REJECT)) {
          const approvalId = action.value;
          const resolution = actionId.startsWith(ACTIONS.APPROVE) ? 'approved' : 'rejected';

          await ctx.api.post(`/api/approvals/${approvalId}/resolve`, {
            resolution,
            resolvedBy: 'board',
          });

          // Update the message
          const ref = {
            channelId: body.channel.id,
            messageTs: body.message.ts,
          };
          await adapter.editMessage(
            ref,
            `✅ Approval *${resolution}* by <@${body.user.id}>`
          );
        }

        // Escalation buttons
        const parsed = EscalationManager.parseActionId(actionId);
        if (parsed) {
          const resolution = action.value === 'dismiss'
            ? 'Dismissed'
            : action.value;
          await escalationManager.resolveEscalation(parsed.escalationId, resolution);
        }
      });

      // Start Socket Mode connection
      await socketClient.start();
      ctx.log.info('Slack plugin started (Socket Mode connected)');
    },

    async stop() {
      if (socketClient) {
        await socketClient.disconnect();
      }
    },

    // ── Paperclip event handlers ──

    async onEvent(ctx: PluginContext, eventType: string, payload: unknown) {
      const data = payload as Record<string, unknown>;

      switch (eventType) {
        case 'issue.created': {
          if (!settings['notifyIssueCreated']) return;
          const text = formatIssueCreated(data as IssueEvent, baseUrl);
          const ref = await adapter.sendText(settings['defaultChannelId'] as string, text);
          const issue = (data as IssueEvent).issue;
          await replyRouter.registerThread(ref.messageTs, {
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            companyId: ctx.companyId,
            channelId: ref.channelId,
          });
          break;
        }

        case 'issue.status_changed': {
          if (!settings['notifyIssueStatusChanged']) return;
          const text = formatIssueStatusChanged(data as IssueEvent, baseUrl);
          await adapter.sendText(settings['defaultChannelId'] as string, text);
          break;
        }

        case 'issue.comment_created': {
          // Only forward agent comments, not board comments (avoid loops)
          const event = data as IssueEvent;
          if (!event.comment?.authorAgentId) return;
          const agents = await ctx.api.get<Array<{ id: string; name: string }>>(
            `/api/companies/${ctx.companyId}/agents`
          );
          const agent = agents.find((a) => a.id === event.comment!.authorAgentId);
          const text = formatIssueComment(event, agent?.name ?? null, baseUrl);
          await adapter.sendText(settings['defaultChannelId'] as string, text);
          break;
        }

        case 'approval.created': {
          if (!settings['notifyApprovalCreated']) return;
          const event = data as ApprovalEvent;
          const text = formatApprovalCreated(event, baseUrl);
          const buttons = [
            {
              text: 'Approve',
              action: ACTIONS.APPROVE,
              value: event.approval.id,
              style: 'primary' as const,
            },
            {
              text: 'Reject',
              action: ACTIONS.REJECT,
              value: event.approval.id,
              style: 'danger' as const,
            },
          ];
          const ref = await adapter.sendButtons(
            channelFor('approvals'),
            text,
            buttons
          );
          // Register thread so replies also route to the issue
          if (event.approval.issueId) {
            await replyRouter.registerThread(ref.messageTs, {
              issueId: event.approval.issueId,
              issueIdentifier: '',
              companyId: ctx.companyId,
              channelId: ref.channelId,
            });
          }
          break;
        }

        case 'agent.run.failed': {
          if (!settings['notifyAgentError']) return;
          const text = formatAgentRunFailed(data as AgentRunEvent, baseUrl);
          await adapter.sendText(channelFor('errors'), text);
          break;
        }

        case 'agent.run.completed': {
          if (!settings['notifyRunCompleted']) return;
          const text = formatAgentRunCompleted(data as AgentRunEvent, baseUrl);
          await adapter.sendText(settings['defaultChannelId'] as string, text);
          break;
        }

        case 'agent.paused': {
          const event = data as { agent: { id: string; name: string; pauseReason?: string } };
          const text = `⏸️ *${event.agent.name}* paused${event.agent.pauseReason ? `: ${event.agent.pauseReason}` : ''}`;
          await adapter.sendText(channelFor('errors'), text);
          break;
        }
      }
    },

    // ── Tool handlers (called by agents) ──

    async onToolCall(ctx: PluginContext, toolName: string, params: Record<string, unknown>) {
      switch (toolName) {
        case 'escalate_to_human': {
          const agents = await ctx.api.get<Array<{ id: string; name: string }>>(
            `/api/companies/${ctx.companyId}/agents`
          );
          const agent = agents.find((a) => a.id === (params['agentId'] as string));
          await escalationManager.createEscalation(channelFor('escalations'), {
            issueId: params['issueId'] as string,
            issueIdentifier: (params['issueIdentifier'] as string) ?? '',
            agentId: (params['agentId'] as string) ?? ctx.agentId,
            agentName: agent?.name ?? 'Unknown Agent',
            reason: params['reason'] as string,
            suggestedReplies: params['suggestedReplies'] as string[] | undefined,
          });
          return { success: true, message: 'Escalation posted to Slack' };
        }

        case 'post_to_channel': {
          const ref = await adapter.sendText(
            params['channelId'] as string,
            params['text'] as string,
            params['threadTs'] ? { threadTs: params['threadTs'] as string } : undefined
          );
          return { success: true, messageTs: ref.messageTs };
        }
      }

      return { error: `Unknown tool: ${toolName}` };
    },

    // ── Scheduled jobs ──

    async onJob(ctx: PluginContext, jobId: string) {
      switch (jobId) {
        case 'daily-digest': {
          const dashboard = await ctx.api.get<{
            agents: { total: number };
            issues: { created24h: number; closed24h: number };
            runs: { completed24h: number; failed24h: number };
            costs: { monthSpendCents: number };
            approvals: { pending: number };
          }>(`/api/companies/${ctx.companyId}/dashboard`);

          const text = formatDailyDigest({
            issuesCreated: dashboard.issues.created24h,
            issuesClosed: dashboard.issues.closed24h,
            runsCompleted: dashboard.runs.completed24h,
            runsFailed: dashboard.runs.failed24h,
            totalCostCents: dashboard.costs.monthSpendCents,
            activeAgents: dashboard.agents.total,
            pendingApprovals: dashboard.approvals.pending,
          });
          await adapter.sendText(settings['defaultChannelId'] as string, text);
          break;
        }

        case 'escalation-timeout': {
          const timeoutMs =
            ((settings['escalationTimeoutMinutes'] as number) ?? 30) * 60 * 1000;
          const defaultAction = (settings['escalationDefaultAction'] as string) ?? 'skip';
          if (timeoutMs > 0) {
            await escalationManager.checkTimeouts(timeoutMs, defaultAction);
          }
          // Also clean up old thread mappings
          await replyRouter.cleanup();
          break;
        }
      }
    },
  };
}
