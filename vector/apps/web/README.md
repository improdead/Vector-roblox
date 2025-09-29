# Web App

Next.js application providing the Vector web interface.

## Key Directories
- `app/` – App Router pages & API routes.
- `lib/` – Core logic (orchestration, diffing, tools, stores).
- `data/` – Static or seed data (if any).
- `types/` – TypeScript type declarations.

## Environment
Copy `.env.example` to `.env.local` and fill in required keys.

## Scripts
From this directory:
```sh
npm install
npm run dev
```

## Testing
Tests (currently minimal) are colocated (e.g. `index.test.ts`). Add more under the same pattern.

## Notes
- Keep server logic in `/app/api/*`.
- Use `/lib/orchestrator/providers` to add new model provider integrations.
