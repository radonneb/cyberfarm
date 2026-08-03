# CyberFarms revamp

## Included

- One-page workspace with map, create, edit, line generation, export, file library and access management.
- Light minimal visual system using white, green and yellow.
- Email/password authentication with HttpOnly sessions.
- Administrator and read-only viewer roles.
- Per-project viewer permissions.
- Imported and additional files stored in Cloudflare R2.
- Project data and authorization records stored in Cloudflare D1.
- Server-side authorization checks for every project, user and file API.
- AI Export and the shared unlock code removed.
- Automated D1 migrations in the Cloudflare deployment workflow.

## Deliberately unchanged

The existing GIS parsers, field editing, guidance-line generation and machine export implementations remain in place. They are presented inside the new workspace rather than rewritten.
