# CyberFarm — Cloudflare setup

The project uses the existing bindings from `wrangler.jsonc`:

- D1: `DB` → `cyberfarm-db`
- R2: `FILES` → `cyberfarm-files`
- Pages project: `cyberfarm`

## 1. Administrator secrets

Store administrator credentials as encrypted Cloudflare Pages secrets:

```bash
npx wrangler pages secret put ADMIN_EMAIL --project-name cyberfarm
npx wrangler pages secret put ADMIN_PASSWORD --project-name cyberfarm
```

For local work, create an untracked `.dev.vars` file:

```dotenv
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="replace-with-a-long-password"
```

## 2. Database migrations

The migrations are sequential:

1. `0001_init.sql` — legacy project table.
2. `0002_auth_permissions.sql` — users, sessions, project permissions and files.
3. `0003_farms_foundation.sql` — farms, farm memberships, module permissions, active-farm preferences and farm import records.

Test locally first:

```bash
npx wrangler d1 migrations apply cyberfarm-db --local
```

Apply to production only after a successful application build:

```bash
npx wrangler d1 migrations apply cyberfarm-db --remote
```

The Farm migration does not immediately split every field into a separate D1 row. Existing project JSON remains compatible while the application gains a farm boundary around projects and files. A later migration can normalize fields, routes and raster metadata without breaking the current importer/exporter.

## 3. R2 layout

New uploads use farm-scoped keys:

```text
farms/{farmId}/uploads/{fileId}-{safeFileName}
```

The source file is removed from R2 when an administrator/editor deletes its final project reference.

## 4. Build and local Pages Functions

```bash
npm install
npm run verify:bunker
npm run build
npx wrangler pages dev dist
```

## 5. Deploy

```bash
npx wrangler pages deploy dist --project-name cyberfarm --branch CyberFarm
```

## 6. First use after migration

1. Sign in with the administrator credentials.
2. Open the profile menu.
3. Create a farm, or import an ISOXML/SHP/KML package and choose **Create a new farm**.
4. Keep that farm active while adding fields, files and calculations.
5. Switch farms only from the profile menu.

## Security note

The repository history previously contained a Google Maps API key in `.env`. Keep environment files untracked and rotate any key that may still be active.
