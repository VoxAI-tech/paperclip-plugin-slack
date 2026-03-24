/**
 * Message formatters — convert Paperclip events into Slack Block Kit messages.
 */

import { EMOJI } from './constants.js';

export interface IssueEvent {
  issue: {
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority?: string;
    assigneeAgentId?: string;
  };
  comment?: { body: string; authorAgentId?: string };
}

export interface ApprovalEvent {
  approval: {
    id: string;
    type: string;
    description: string;
    requestingAgentId: string;
    issueId?: string;
  };
}

export interface AgentRunEvent {
  agent: { id: string; name: string };
  run: { id: string; status: string; error?: string; durationMs?: number; costCents?: number };
}

export function formatIssueCreated(event: IssueEvent, baseUrl: string): string {
  const { identifier, title, priority } = event.issue;
  const prio = priority ? ` [${priority}]` : '';
  const url = `${baseUrl}/issues/${event.issue.id}`;
  return `${EMOJI.INFO} *New issue* <${url}|${identifier}>: ${title}${prio}`;
}

export function formatIssueStatusChanged(event: IssueEvent, baseUrl: string): string {
  const { identifier, title, status } = event.issue;
  const emoji =
    status === 'done'
      ? EMOJI.SUCCESS
      : status === 'blocked'
        ? EMOJI.WARNING
        : status === 'in_progress'
          ? EMOJI.RUNNING
          : EMOJI.INFO;
  const url = `${baseUrl}/issues/${event.issue.id}`;
  return `${emoji} <${url}|${identifier}> → *${status}*: ${title}`;
}

export function formatIssueComment(
  event: IssueEvent,
  agentName: string | null,
  baseUrl: string
): string {
  const { identifier } = event.issue;
  const author = agentName ? `🤖 *${agentName}*` : 'Board';
  const body = event.comment?.body ?? '';
  const truncated = body.length > 500 ? body.slice(0, 497) + '...' : body;
  const url = `${baseUrl}/issues/${event.issue.id}`;
  return `${author} commented on <${url}|${identifier}>:\n>${truncated.replace(/\n/g, '\n>')}`;
}

export function formatApprovalCreated(event: ApprovalEvent, baseUrl: string): string {
  const { id, type, description } = event.approval;
  const url = `${baseUrl}/approvals/${id}`;
  return `${EMOJI.APPROVAL} *Approval needed*: <${url}|${type}>\n${description}`;
}

export function formatApprovalResolved(
  event: ApprovalEvent & { resolution: string },
  baseUrl: string
): string {
  const { id, type } = event.approval;
  const emoji = event.resolution === 'approved' ? EMOJI.SUCCESS : EMOJI.ERROR;
  const url = `${baseUrl}/approvals/${id}`;
  return `${emoji} Approval <${url}|${type}> *${event.resolution}*`;
}

export function formatAgentRunFailed(event: AgentRunEvent, baseUrl: string): string {
  const { name } = event.agent;
  const { id, error } = event.run;
  const url = `${baseUrl}/agents/${event.agent.id}/runs`;
  return `${EMOJI.ERROR} *${name}* <${url}|run ${id.slice(0, 8)}> failed${error ? `:\n\`\`\`${error.slice(0, 300)}\`\`\`` : ''}`;
}

export function formatAgentRunCompleted(event: AgentRunEvent, baseUrl: string): string {
  const { name } = event.agent;
  const { durationMs, costCents } = event.run;
  const duration = durationMs ? `${Math.round(durationMs / 1000)}s` : '?';
  const cost = costCents ? `$${(costCents / 100).toFixed(2)}` : '$0';
  const url = `${baseUrl}/agents/${event.agent.id}/runs`;
  return `${EMOJI.SUCCESS} *${name}* <${url}|run completed> in ${duration} (${cost})`;
}

export function formatDailyDigest(stats: {
  issuesCreated: number;
  issuesClosed: number;
  runsCompleted: number;
  runsFailed: number;
  totalCostCents: number;
  activeAgents: number;
  pendingApprovals: number;
}): string {
  const cost = `$${(stats.totalCostCents / 100).toFixed(2)}`;
  return [
    `📊 *Daily Digest*`,
    '',
    `*Issues:* ${stats.issuesCreated} created, ${stats.issuesClosed} closed`,
    `*Runs:* ${stats.runsCompleted} completed, ${stats.runsFailed} failed`,
    `*Agents:* ${stats.activeAgents} active`,
    `*Cost:* ${cost}`,
    stats.pendingApprovals > 0
      ? `\n${EMOJI.APPROVAL} *${stats.pendingApprovals} pending approvals* need your attention`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
