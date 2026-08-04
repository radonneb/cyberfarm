# Apply CyberFarm Phase 1 changes

1. Clone `radonneb/cyberfarm` with GitHub Desktop.
2. Create branch `feature/native-cyberfarm-integration` from `main`.
3. Copy the contents of this folder into the cloned repository root and allow file replacement/merge.
4. Delete every path listed in `DELETE_THESE_FILES.txt`.
5. Open Terminal in the repository and run:

```bash
npm install
npm run verify:bunker
npm run build
npx wrangler d1 migrations apply cyberfarm-db --local
```

6. Do not run the remote migration until the build succeeds.
7. Commit and publish the branch through GitHub Desktop.
8. After review, apply production migration and deploy:

```bash
npx wrangler d1 migrations apply cyberfarm-db --remote
npx wrangler pages deploy dist --project-name cyberfarm --branch CyberFarm
```
