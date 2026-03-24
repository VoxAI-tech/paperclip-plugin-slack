/**
 * Slack platform adapter — implements the PlatformAdapter interface.
 * Handles sending messages, buttons, edits, and formatting for Slack's Block Kit.
 */

import type { WebClient } from '@slack/web-api';

export interface MessageRef {
  channelId: string;
  threadTs?: string;
  messageTs: string;
}

export interface ActionButton {
  text: string;
  action: string;
  value?: string;
  style?: 'primary' | 'danger';
}

export interface SendOpts {
  silent?: boolean;
  threadTs?: string;
}

export interface PlatformAdapter {
  sendText(channelId: string, text: string, opts?: SendOpts): Promise<MessageRef>;
  sendButtons(
    channelId: string,
    text: string,
    buttons: ActionButton[],
    opts?: SendOpts
  ): Promise<MessageRef>;
  editMessage(ref: MessageRef, text: string, buttons?: ActionButton[]): Promise<void>;
  formatAgentLabel(name: string, done?: boolean): string;
  formatMention(userId: string): string;
  formatCodeBlock(text: string): string;
  formatLink(url: string, label: string): string;
}

export class SlackAdapter implements PlatformAdapter {
  constructor(private client: WebClient) {}

  async sendText(channelId: string, text: string, opts?: SendOpts): Promise<MessageRef> {
    const result = await this.client.chat.postMessage({
      channel: channelId,
      text,
      mrkdwn: true,
      thread_ts: opts?.threadTs,
      unfurl_links: false,
      ...(opts?.silent ? { metadata: { event_type: 'silent', event_payload: {} } } : {}),
    });

    return {
      channelId,
      threadTs: opts?.threadTs ?? result.ts!,
      messageTs: result.ts!,
    };
  }

  async sendButtons(
    channelId: string,
    text: string,
    buttons: ActionButton[],
    opts?: SendOpts
  ): Promise<MessageRef> {
    const buttonElements = buttons.map((btn) => ({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: btn.text },
      action_id: btn.action,
      value: btn.value ?? btn.action,
      ...(btn.style ? { style: btn.style } : {}),
    }));

    // Group buttons into rows of 5 (Slack max per actions block)
    const actionBlocks = [];
    for (let i = 0; i < buttonElements.length; i += 5) {
      actionBlocks.push({
        type: 'actions' as const,
        elements: buttonElements.slice(i, i + 5),
      });
    }

    const result = await this.client.chat.postMessage({
      channel: channelId,
      text, // fallback for notifications
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text } },
        ...actionBlocks,
      ],
      thread_ts: opts?.threadTs,
      unfurl_links: false,
    });

    return {
      channelId,
      threadTs: opts?.threadTs ?? result.ts!,
      messageTs: result.ts!,
    };
  }

  async editMessage(ref: MessageRef, text: string, buttons?: ActionButton[]): Promise<void> {
    const blocks: Array<Record<string, unknown>> = [
      { type: 'section' as const, text: { type: 'mrkdwn' as const, text } },
    ];

    if (buttons?.length) {
      const buttonElements = buttons.map((btn) => ({
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: btn.text },
        action_id: btn.action,
        value: btn.value ?? btn.action,
        ...(btn.style ? { style: btn.style } : {}),
      }));
      blocks.push({ type: 'actions', elements: buttonElements });
    }

    await this.client.chat.update({
      channel: ref.channelId,
      ts: ref.messageTs,
      text,
      blocks: blocks as never[],
    });
  }

  formatAgentLabel(name: string, done?: boolean): string {
    return done ? `✅ *${name}*` : `🤖 *${name}*`;
  }

  formatMention(userId: string): string {
    return `<@${userId}>`;
  }

  formatCodeBlock(text: string): string {
    return `\`\`\`\n${text}\n\`\`\``;
  }

  formatLink(url: string, label: string): string {
    return `<${url}|${label}>`;
  }
}
