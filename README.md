# @voxai/paperclip-plugin-slack

Bidirectional Slack integration for [Paperclip](https://github.com/paperclipai/paperclip). Based on the architecture of [paperclip-plugin-telegram](https://github.com/mvanhorn/paperclip-plugin-telegram).

## Features

- **Notifications** — issue created/updated, approvals, agent errors, run completed
- **Reply routing** — reply in a Slack thread → comment on the Paperclip issue
- **Approve/reject buttons** — inline buttons for approval requests
- **Escalation** — agents escalate to humans with suggested replies
- **Slash commands** — `/status`, `/issues`, `/agents`
- **Daily digest** — automated summary of agent activity
- **Socket Mode** — no public URL needed, works behind firewalls

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App
2. Enable **Socket Mode** (Settings → Socket Mode → Enable)
3. Create an **App-Level Token** with `connections:write` scope → save as `xapp-...`
4. Add **Bot Token Scopes** (OAuth & Permissions):
   - `chat:write` — post messages
   - `chat:write.customize` — custom bot name/icon
   - `reactions:write` — react to confirm reply routing
   - `commands` — slash commands
   - `channels:history` — read thread replies
   - `groups:history` — read private channel threads
5. **Install to workspace** → save the `xoxb-...` Bot Token
6. **Subscribe to events** (Event Subscriptions → Subscribe to bot events):
   - `message.channels`
   - `message.groups`
7. Invite the bot to your channels: `/invite @YourBotName`

### 2. Install the Plugin

```bash
npx paperclipai plugin install @voxai/paperclip-plugin-slack
```

### 3. Configure

In the Paperclip UI (Settings → Plugins → Slack):

| Setting | Value |
|---------|-------|
| Slack Bot Token | Secret ref to `xoxb-...` token |
| Slack App Token | Secret ref to `xapp-...` token |
| Default Channel ID | Your `#board` channel ID |
| Approvals Channel ID | Your `#approvals` channel ID |
| Errors Channel ID | Your `#ops-alerts` channel ID |

## How Reply Routing Works

```
1. Agent posts notification about issue VOX-42 to Slack #board
2. Plugin stores mapping: { slack_thread_ts → VOX-42 }
3. Maurice replies in the Slack thread: "Approved, go ahead"
4. Plugin receives the reply via Socket Mode
5. Plugin posts it as a comment on VOX-42 in Paperclip
6. Agent picks it up on next heartbeat
7. Plugin reacts with ✅ to confirm routing
```

## Architecture

```
src/
├── manifest.ts        # Plugin settings, events, capabilities, jobs
├── worker.ts          # Main event loop — Slack ↔ Paperclip bridge
├── adapter.ts         # Slack Block Kit adapter (PlatformAdapter interface)
├── reply-router.ts    # Slack thread → Paperclip issue comment mapping
├── escalation.ts      # Human-in-the-loop escalation with buttons
├── commands.ts        # Slash command handlers
├── formatters.ts      # Event → Slack message formatters
├── constants.ts       # Action IDs, emoji, limits
└── index.ts           # Exports
```
