# The Ledger

A decision tracker for the Office of Joe Liemandt. Two-role app: a card-stack
"Answer Mode" for the principal to clear the queue, and a sortable "Workspace"
view for the team. Auto-handoff to Meeting Tracker for accepted meeting requests.

## Stack

- Vite + React + Express + SQLite (better-sqlite3) + Drizzle
- Token-based auth (no cookies — designed to run in a proxied iframe)
- Claude API for inbox parsing

## Deploy on Railway

1. New project → Deploy from GitHub repo → pick this repo
2. Set env vars (see `.env.example`)
3. Railway auto-detects Node, runs `npm install` → `npm run build` → `npm start`
4. Set the start command if needed: `npm start`
5. Generate a public domain in Settings → Networking

## Required env vars

| Name | What it is |
|---|---|
| `CLAUDE_API_KEY` | Anthropic key for the parser |
| `SESSION_SECRET` | Any 32+ char random string |
| `LEDGER_PRINCIPAL_PASSWORD` | Joe's password |
| `LEDGER_TEAM_PASSWORD` | Team password |
| `LEDGER_TO_TRACKER_TOKEN` | Shared secret with Meeting Tracker |
| `MEETING_TRACKER_URL` | https://meeting-tracker-production.up.railway.app |
| `INTERNAL_DOMAINS` | `alpha.school,trilogy.com` |

## Local dev

```
npm install
npm run dev
```

Opens on port 5000.
