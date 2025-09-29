# vector (monorepo root)

This directory contains the main source for the Vector project. It is structured as a monorepo containing web application code and a Roblox plugin.

## Structure
- `apps/` – End-user or deployable applications.
- `plugin/` – Roblox Studio plugin and supporting Lua source.

## Development
See the repository root `README.md` for installation and global instructions.

### Adding Packages / Apps
Follow existing naming (`apps/<name>`). Keep shared code (if introduced later) in a `packages/` directory.

## Scripts
Project-wide scripts live under the top-level `scripts/` directory (outside this folder).
