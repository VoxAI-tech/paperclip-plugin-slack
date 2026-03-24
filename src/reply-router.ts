/**
 * Reply router — maps Slack thread replies to Paperclip issue comments.
 * This is the core bidirectional feature.
 *
 * When an agent posts a notification about an issue to Slack, we store
 * the mapping: { slack_thread_ts → paperclip_issue_id }
 *
 * When a user replies in that Slack thread, we pick it up and create
 * a comment on the corresponding Paperclip issue.
 */

import type { PluginContext } from '@paperclipai/plugin-sdk';

export interface ThreadMapping {
  issueId: string;
  issueIdentifier: string;
  companyId: string;
  channelId: string;
  agentId?: string;
}

const STATE_KEY = 'thread_mappings';

export class ReplyRouter {
  private mappings: Map<string, ThreadMapping> = new Map();

  constructor(private ctx: PluginContext) {}

  /** Load mappings from plugin state on startup */
  async init(): Promise<void> {
    const stored = await this.ctx.state.get<Record<string, ThreadMapping>>(STATE_KEY);
    if (stored) {
      this.mappings = new Map(Object.entries(stored));
    }
  }

  /** Store a thread → issue mapping when we post a notification */
  async registerThread(threadTs: string, mapping: ThreadMapping): Promise<void> {
    this.mappings.set(threadTs, mapping);
    await this.persist();
  }

  /** Look up which issue a thread reply belongs to */
  getMapping(threadTs: string): ThreadMapping | undefined {
    return this.mappings.get(threadTs);
  }

  /** Route a Slack reply to a Paperclip issue comment */
  async routeReply(
    threadTs: string,
    userId: string,
    text: string
  ): Promise<{ issueId: string; issueIdentifier: string } | null> {
    const mapping = this.mappings.get(threadTs);
    if (!mapping) return null;

    // Post as a board comment (human replies are from the board)
    await this.ctx.api.post(`/api/issues/${mapping.issueId}/comments`, {
      body: `💬 **Board** (via Slack <@${userId}>):\n\n${text}`,
      authorType: 'board',
    });

    return { issueId: mapping.issueId, issueIdentifier: mapping.issueIdentifier };
  }

  /** Clean up old mappings (>7 days) to prevent unbounded growth */
  async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    // Thread timestamps in Slack are Unix epoch seconds with microseconds
    const cutoff = (Date.now() - maxAgeMs) / 1000;
    let removed = 0;
    for (const [ts] of this.mappings) {
      const threadEpoch = parseFloat(ts);
      if (threadEpoch < cutoff) {
        this.mappings.delete(ts);
        removed++;
      }
    }
    if (removed > 0) await this.persist();
    return removed;
  }

  private async persist(): Promise<void> {
    await this.ctx.state.set(STATE_KEY, Object.fromEntries(this.mappings));
  }
}
