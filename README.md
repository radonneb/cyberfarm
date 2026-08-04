# CyberFarm

CyberFarm is a Cloudflare-hosted precision-agriculture workspace built with React, TypeScript, Vite, Leaflet, Cloudflare Pages Functions, D1 and R2.

## Current native-integration stage

This working branch introduces the Farm foundation and the first two native agricultural tools:

- **Farm-scoped workspaces** — every field, source file and calculation belongs to one active farm.
- **Farm switcher** — the active farm is changed from the profile menu and stored in D1.
- **Farm-aware import** — create a new farm from an imported file or add fields to the active farm.
- **No geometry in localStorage** — legacy `gargha_import_history` and full task snapshots are cleared and no longer written.
- **Automatic cloud saving** — manual `Save to cloud` was removed; project data is saved after edits with a debounce.
- **Farm file deletion** — uploaded files can be removed by a manager and are deleted from R2 when no longer referenced.
- **Native Pivot Track** — existing-field mode, automatic starting center, manual center adjustment, individual wheel widths and enabled states, irrigation sweep and track-area metrics.
- **Native Grain Bunker** — simple and advanced calculations, original combine/crop/profile datasets and formulas, selected-field area integration and TXT export.
- **English-only interface** — the previous RU/AZ runtime dictionaries were removed.
- **Dark green glass UI** — compact icon rail, glass drawers and yellow action accents.

See [`NATIVE_INTEGRATION_STATUS.md`](./NATIVE_INTEGRATION_STATUS.md) for the exact scope and remaining modules.

## Development

```bash
npm install
npm run verify:bunker
npm run build
npm run dev
```

## Cloudflare local development

```bash
npx wrangler d1 migrations apply cyberfarm-db --local
npm run build
npx wrangler pages dev dist
```

## Production deployment

Apply migrations before deploying the updated Functions:

```bash
npx wrangler d1 migrations apply cyberfarm-db --remote
npm run build
npx wrangler pages deploy dist --project-name cyberfarm --branch CyberFarm
```

Do not apply the remote migration until the code has passed `npm run build` on a machine with npm registry access.
