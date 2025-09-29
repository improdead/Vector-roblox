# apps

Deployable applications in the Vector monorepo.

## Current Apps
- `web/` – Next.js based web interface.

## Guidelines
- Each app manages its own `package.json` (or equivalent).
- Cross-app shared code (if added) should be extracted to a `packages/` directory at `vector/` level.
