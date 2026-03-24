/**
 * Escalation manager — handles human-in-the-loop via Slack.
 * When an agent escalates, posts to Slack with suggested replies as buttons.
 * Human response is routed back as an issue comment.
 */

import type { PluginContext } from '@paperclipai/plugin-sdk';
import type { SlackAdapter, MessageRef } from './adapter.js';
import { ACTIONS, EMOJI } from './constants.js';

export interface EscalationEvent {
  issueId: string;
  issueIdentifier: string;
  agentId: string;
  agentName: string;
  reason: string;
  suggestedReplies?: string[];
}

export interface EscalationRecord {
  id: string;
  event: EscalationEvent;
  messageRef: MessageRef;
  createdAt: number;
  resolved: boolean;
  resolution?: string;
}

const STATE_KEY = 'escalations';

export class EscalationManager {
  private escalations: Map<string, EscalationRecord> = new Map();

  constructor(
    private ctx: PluginContext,
    private adapter: SlackAdapter
  ) {}

  async init(): Promise<void> {
    const stored = await this.ctx.state.get<Record<string, EscalationRecord>>(STATE_KEY);
    if (stored) {
      this.escalations = new Map(Object.entries(stored));
    }
  }

  async createEscalation(
    channelId: string,
    event: EscalationEvent
  ): Promise<EscalationRecord> {
    const id = crypto.randomUUID();

    // Build buttons: suggested replies + dismiss
    const buttons = [
      ...(event.suggestedReplies ?? []).map((reply, i) => ({
        text: reply.length > 30 ? reply.slice(0, 27) + '...' : reply,
        action: `${ACTIONS.ESCALATION_REPLY}_${id}_${i}`,
        value: reply,
        style: 'primary' as const,
      })),
      {
        text: 'Dismiss',
        action: `${ACTIONS.ESCALATION_DISMISS}_${id}`,
        value: 'dismiss',
        style: 'danger' as const,
      },
    ];

    const text = [
      `${EMOJI.ESCALATION} *Escalation from ${event.agentName}*`,
      '',
      `*Issue:* ${event.issueIdentifier}`,
      `*Reason:* ${event.reason}`,
      '',
      '_Reply in this thread or use the buttons below._',
    ].join('\n');

    const messageRef = await this.adapter.sendButtons(channelId, text, buttons);

    const record: EscalationRecord = {
      id,
      event,
      messageRef,
      createdAt: Date.now(),
      resolved: false,
    };

    this.escalations.set(id, record);
    await this.persist();

    return record;
  }

  async resolveEscalation(id: string, resolution: string): Promise<EscalationRecord | null> {
    const record = this.escalations.get(id);
    if (!record || record.resolved) return null;

    record.resolved = true;
    record.resolution = resolution;

    // Update the Slack message to show resolved state
    await this.adapter.editMessage(
      record.messageRef,
      `${EMOJI.SUCCESS} *Escalation resolved*: ${record.event.issueIdentifier}\n_${resolution}_`
    );

    // Post resolution as issue comment
    await this.ctx.api.post(`/api/issues/${record.event.issueId}/comments`, {
      body: `${EMOJI.SUCCESS} **Escalation resolved** by Board:\n\n${resolution}`,
      authorType: 'board',
    });

    await this.persist();
    return record;
  }

  /** Check for timed-out escalations */
  async checkTimeouts(timeoutMs: number, defaultAction: string): Promise<number> {
    const now = Date.now();
    let resolved = 0;

    for (const [, record] of this.escalations) {
      if (record.resolved) continue;
      if (now - record.createdAt > timeoutMs) {
        await this.resolveEscalation(
          record.id,
          `Auto-resolved after timeout: ${defaultAction}`
        );
        resolved++;
      }
    }

    return resolved;
  }

  getById(id: string): EscalationRecord | undefined {
    return this.escalations.get(id);
  }

  /** Extract escalation ID from a button action_id */
  static parseActionId(actionId: string): { escalationId: string; replyIndex?: number } | null {
    if (actionId.startsWith(ACTIONS.ESCALATION_DISMISS)) {
      const id = actionId.replace(`${ACTIONS.ESCALATION_DISMISS}_`, '');
      return { escalationId: id };
    }
    if (actionId.startsWith(ACTIONS.ESCALATION_REPLY)) {
      const parts = actionId.replace(`${ACTIONS.ESCALATION_REPLY}_`, '').split('_');
      return { escalationId: parts[0], replyIndex: parseInt(parts[1], 10) };
    }
    return null;
  }

  private async persist(): Promise<void> {
    await this.ctx.state.set(STATE_KEY, Object.fromEntries(this.escalations));
  }
}
