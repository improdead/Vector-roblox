# app

Next.js App Router entrypoint and API routes.

## Structure
- `layout.tsx` – Root layout.
- `page.tsx` – Index route.
- `api/` – Serverless / edge API endpoints.

## API Routes
Organized by domain (assets, chat, checkpoints, proposals, stream, workflows). Each folder exports a `route.ts` implementing HTTP handlers.
