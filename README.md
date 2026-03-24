# @voxai/paperclip-plugin-slack

Bidirectional Slack integration for [Paperclip](https://github.com/paperclipai/paperclip). Built by [Vox AI](https://vox.ai).

[![npm version](https://img.shields.io/npm/v/@voxai/paperclip-plugin-slack)](https://www.npmjs.com/package/@voxai/paperclip-plugin-slack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What It Does

Connects your Paperclip AI agent organization to Slack with full bidirectional communication:

- **Notifications** — issue created/updated, approvals, agent errors, run completed
- **Reply routing** — reply in a Slack thread and it becomes a Paperclip issue comment
- **Approve/reject buttons** — inline buttons for agent approval requests
- **Escalation** — agents escalate to humans with suggested reply buttons
- **Slash commands** — `/hq-status`, `/hq-issues`, `/hq-agents`
- **Daily digest** — automated summary of agent activity
- **Socket Mode** — no public URL needed, works behind firewalls

## Quick Start

### Step 1: Create the Slack App (2 minutes)

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** -> **Create New App** -> **From a manifest**
2. Select your workspace
3. Switch to the **YAML** tab
4. Paste the contents of [`slack-app-manifest.yaml`](./slack-app-manifest.yaml) included in this package
5. Click **Create**

### Step 2: Get Your Tokens (1 minute)

1. **App Token**: Basic Information -> App-Level Tokens -> **Generate Token**
   - Name: `socket-mode`
   - Scope: `connections:write`
   - Copy the `xapp-...` token

2. **Bot Token**: OAuth & Permissions -> **Install to Workspace**
   - Copy the `xoxb-...` Bot User OAuth Token

### Step 3: Install the Plugin

```bash
npx paperclipai plugin install @voxai/paperclip-plugin-slack
```

### Step 4: Store Tokens as Paperclip Secrets

```bash
npx paperclipai secret set slack-bot-token    # paste your xoxb-... token
npx paperclipai secret set slack-app-token    # paste your xapp-... token
```

### Step 5: Configure in Paperclip UI

Go to **Instance Settings -> Plugins -> Slack** and fill in:

| Setting | Value |
|---------|-------|
| Slack Bot Token | `slack-bot-token` (secret ref) |
| Slack App Token | `slack-app-token` (secret ref) |
| Default Channel ID | Your main channel ID (e.g., `C0ABC123DEF`) |

Optional channel routing:

| Setting | Description |
|---------|-------------|
| Approvals Channel ID | Where approval requests go (falls back to default) |
| Errors Channel ID | Where agent errors go (falls back to default) |
| Escalations Channel ID | Where human escalations go (falls back to default) |

### Step 6: Invite the Bot

In each Slack channel you want the bot in:

```
/invite @HQ Bot
```

That's it. The plugin starts automatically.

## How Reply Routing Works

This is the key feature — your Slack replies become Paperclip issue comments:

```
1. Agent posts notification about issue VOX-42 to Slack
2. Plugin stores mapping: { slack_thread_ts -> VOX-42 }
3. You reply in the Slack thread: "Approved, go ahead"
4. Plugin receives the reply via Socket Mode
5. Plugin posts your reply as a comment on VOX-42 in Paperclip
6. Plugin reacts with checkmark to confirm routing
7. Agent sees your comment on next heartbeat and acts on it
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/hq-status` | Company dashboard: agents, issues, spend, pending approvals |
| `/hq-issues` | List open issues across all projects |
| `/hq-agents` | List all agents and their current status |

## Approval Buttons

When an agent requests approval, the plugin posts a message with inline buttons:

```
APPROVAL NEEDED: merge-to-main
Bug Hunter wants to merge PR #42 to main

[Approve]  [Reject]
```

Click a button -> approval resolves in Paperclip -> agent is notified.

## Agent Escalation

Agents can escalate to humans with suggested quick-reply buttons:

```
ESCALATION from Pay Specialist

Issue: VOX-15
Reason: Merchant requesting $2,500 refund - exceeds auto-approve threshold

[Approve refund]  [Request more info]  [Deny]  [Dismiss]
```

Escalations auto-resolve after a configurable timeout (default: 30 minutes).

## Configuration Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `slackBotTokenRef` | secret | *required* | Bot token (`xoxb-...`) |
| `slackAppTokenRef` | secret | *required* | App token (`xapp-...`) for Socket Mode |
| `defaultChannelId` | string | *required* | Default notification channel |
| `approvalsChannelId` | string | | Approval requests channel |
| `errorsChannelId` | string | | Agent error notifications |
| `escalationsChannelId` | string | | Human escalation channel |
| `notifyIssueCreated` | boolean | `true` | Notify on new issues |
| `notifyIssueStatusChanged` | boolean | `true` | Notify on status changes |
| `notifyApprovalCreated` | boolean | `true` | Notify on approval requests |
| `notifyAgentError` | boolean | `true` | Notify on agent errors |
| `notifyRunCompleted` | boolean | `false` | Notify when agent runs complete |
| `enableCommands` | boolean | `true` | Enable slash commands |
| `enableReplyRouting` | boolean | `true` | Route thread replies to Paperclip |
| `enableDailyDigest` | boolean | `false` | Enable daily activity digest |
| `dailyDigestCron` | string | `0 7 * * *` | Digest schedule (cron) |
| `escalationTimeoutMinutes` | number | `30` | Auto-resolve escalation timeout |
| `escalationDefaultAction` | string | `skip` | Timeout action: approve/reject/skip |

## Architecture

```
Slack (Socket Mode)              Paperclip
     |                                |
     |  <- notifications ------------ | events (issue, approval, error)
     |  -> thread replies ----------> | issue comments
     |  -> button clicks -----------> | approval resolutions
     |  -> slash commands              | dashboard/issues/agents queries
     |                                |
     |  reply-router.ts               | worker.ts (event bridge)
     |  escalation.ts                 | adapter.ts (Block Kit)
     |  commands.ts                   | formatters.ts
```

## Credits

Built by [Vox AI](https://vox.ai). Based on the architecture of [paperclip-plugin-telegram](https://github.com/mvanhorn/paperclip-plugin-telegram) by [@mvanhorn](https://github.com/mvanhorn).

## License

MIT
