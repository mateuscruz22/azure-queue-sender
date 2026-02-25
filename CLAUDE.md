# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start development server (Express + Vite middleware) on port 3001
npm run build     # Build frontend with Vite (outputs to dist/)
npm run preview   # Preview production build
npm run lint      # TypeScript type check (tsc --noEmit)
npm run clean     # Remove dist/
```

No test framework is configured.

## Architecture

This is a full-stack TypeScript app: an Express backend (`server.ts`) that integrates with Azure Service Bus, serving a React 19 frontend (`src/App.tsx`) built with Vite.

**Request flow:**
1. React frontend → `GET /api/queues` to list available queues (returns only `id` + `label`, no credentials)
2. React frontend → `POST /api/send` with `{ queueId, payload, isBatch }` to send messages
3. Express backend looks up the queue's connection string in `QUEUE_CONFIGS` (server-side only), opens a `ServiceBusClient`, sends message(s), then closes the client

**Batch mode:** When `isBatch` is true and `payload` is a JSON array, each element is sent as a separate message. Otherwise a single message is sent.

**Dev vs. Production:** In development (`NODE_ENV !== "production"`), Vite runs as Express middleware (HMR enabled). In production, Express serves the static `dist/` folder.

## Queue Configuration

Queues are defined in the `QUEUE_CONFIGS` array in `server.ts`. Each entry has:
- `id` — identifier sent between frontend and backend
- `label` — display name shown in the UI
- `connectionString` — Azure Service Bus connection string (falls back to `process.env.SERVICEBUS_CONNECTION_STRING_1` / `_2` for the first two queues)
- `queueName` — actual Azure queue name

To add or modify queues, edit `QUEUE_CONFIGS` in `server.ts`.

## Key Files

- `server.ts` — All backend logic (Express routes + Azure Service Bus integration)
- `src/App.tsx` — Entire frontend UI (queue selector, payload editor, batch toggle, send button)
- `vite.config.ts` — Vite config; sets up React plugin, Tailwind, path alias `@/` → project root, and injects `GEMINI_API_KEY` env var
- `.env` — Local environment variables (not committed); copy from `.env.example`
