/**
 * Slash command handlers for Slack.
 * Supports: /status, /issues, /agents, /approve, /reject
 */

import type { PluginContext } from '@paperclipai/plugin-sdk';
import type { SlackAdapter } from './adapter.js';
import { EMOJI } from './constants.js';

interface CommandContext {
  ctx: PluginContext;
  adapter: SlackAdapter;
  channelId: string;
  threadTs?: string;
  userId: string;
  companyId: string;
}

type CommandHandler = (args: string, cmdCtx: CommandContext) => Promise<string>;

const commands: Record<string, CommandHandler> = {
  async status(_args, { ctx, companyId }) {
    const dashboard = await ctx.api.get<{
      agents: { total: number; running: number; paused: number; errored: number };
      issues: { open: number; inProgress: number; blocked: number };
      costs: { monthSpendCents: number };
      approvals: { pending: number };
    }>(`/api/companies/${companyId}/dashboard`);

    const { agents, issues, costs, approvals } = dashboard;
    const spend = `$${(costs.monthSpendCents / 100).toFixed(2)}`;

    return [
      `${EMOJI.INFO} *Company Status*`,
      '',
      `*Agents:* ${agents.total} total | ${agents.running} running | ${agents.paused} paused | ${agents.errored} errored`,
      `*Issues:* ${issues.open} open | ${issues.inProgress} in progress | ${issues.blocked} blocked`,
      `*Spend:* ${spend} this month`,
      approvals.pending > 0
        ? `${EMOJI.APPROVAL} *${approvals.pending} pending approvals*`
        : `${EMOJI.SUCCESS} No pending approvals`,
    ].join('\n');
  },

  async issues(_args, { ctx, companyId }) {
    const issues = await ctx.api.get<
      Array<{ identifier: string; title: string; status: string; priority?: string }>
    >(`/api/companies/${companyId}/issues?status=todo,in_progress,blocked&limit=10`);

    if (!issues.length) return `${EMOJI.SUCCESS} No open issues.`;

    const lines = issues.map((i) => {
      const emoji =
        i.status === 'blocked'
          ? EMOJI.WARNING
          : i.status === 'in_progress'
            ? EMOJI.RUNNING
            : '📋';
      const prio = i.priority ? ` [${i.priority}]` : '';
      return `${emoji} *${i.identifier}* ${i.title}${prio} — _${i.status}_`;
    });

    return [`*Open Issues* (${issues.length})`, '', ...lines].join('\n');
  },

  async agents(_args, { ctx, companyId }) {
    const agents = await ctx.api.get<
      Array<{ name: string; status: string; role: string; lastHeartbeatAt?: string }>
    >(`/api/companies/${companyId}/agents`);

    const lines = agents.map((a) => {
      const emoji =
        a.status === 'running'
          ? EMOJI.RUNNING
          : a.status === 'paused'
            ? EMOJI.PAUSED
            : a.status === 'error'
              ? EMOJI.ERROR
              : EMOJI.AGENT;
      return `${emoji} *${a.name}* (${a.role}) — _${a.status}_`;
    });

    return [`*Agents* (${agents.length})`, '', ...lines].join('\n');
  },
};

export function getCommandHandler(command: string): CommandHandler | undefined {
  return commands[command.toLowerCase()];
}

export function getAvailableCommands(): string[] {
  return Object.keys(commands);
}
