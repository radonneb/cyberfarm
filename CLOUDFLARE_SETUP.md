# CyberFarms — Cloudflare setup

This revamp uses the existing Cloudflare resources already declared in `wrangler.jsonc`:

- D1 binding: `DB` → `cyberfarm-db`
- R2 binding: `FILES` → `cyberfarm-files`
- Pages project: `cyberfarm`

## 1. Create the administrator credentials

Set these as **encrypted Pages secrets**, not normal repository files:

```bash
npx wrangler pages secret put ADMIN_EMAIL --project-name cyberfarm
npx wrangler pages secret put ADMIN_PASSWORD --project-name cyberfarm
```

Use the email and password entered here for the first administrator login. On that first successful login, the administrator record is created in D1 automatically.

The same values can be added in the Cloudflare dashboard under:

`Workers & Pages → cyberfarm → Settings → Variables and Secrets → Add → Encrypt`

Create exactly these two secrets:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

For local development, create an untracked `.dev.vars` file:

```dotenv
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="replace-with-a-long-password"
```

## 2. Apply the database migration

```bash
npx wrangler d1 migrations apply cyberfarm-db --remote
```

The updated GitHub Actions workflow also runs this command automatically before deployment.

The new migration creates:

- email/password users;
- administrator and read-only viewer roles;
- server sessions;
- project-level viewing permissions;
- file metadata and project/file links.

Existing projects remain available to the administrator. Viewers see nothing until the administrator explicitly grants access to a project.

## 3. Deploy

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name cyberfarm
```

A push to `main` triggers the included workflow and performs migration, build and deployment.

## 4. First use

1. Open CyberFarms.
2. Sign in using `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
3. Import a GIS/ISOXML file or create a new map.
4. Open **Access** to create viewer accounts.
5. Open a project and grant each viewer access individually.
6. Open **Files** to add or download project materials stored in R2.

## Security action required

The old repository contained a tracked `.env` file with a Google Maps API key. The revamp removes `.env` and prevents environment files and local Wrangler state from being committed again. Rotate or revoke the exposed key in the relevant Google Cloud project before continuing to use it.
