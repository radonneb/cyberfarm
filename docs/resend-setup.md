# Resend invitation email setup

CyberFarm sends account invitations from the Cloudflare Pages Function through
the Resend HTTPS API. No Cloudflare Email Sending binding is required.

## One-time production setup

1. Create a Resend account and add the domain `cyberfarms.org` under **Domains**.
2. Add the DNS records shown by Resend to Cloudflare DNS. Resend can connect to
   Cloudflare automatically, or the records can be copied manually.
3. Wait until the domain is marked **Verified** in Resend.
4. In **API Keys**, create a sending key. Restrict it to `cyberfarms.org` when
   that option is available.
5. In Cloudflare, open **Workers & Pages → cyberfarm → Settings → Variables and
   Secrets** and add a production secret named `RESEND_API_KEY` containing the
   new key.
6. Confirm that `EMAIL_FROM` is `access@cyberfarms.org`. This non-secret value is
   already defined in `wrangler.jsonc`.
7. Redeploy the Pages project so the Function receives the new secret.

Never put the Resend API key in `wrangler.jsonc`, `.env`, a GitHub issue, or a
committed file. For local Pages development, put it in the ignored `.dev.vars`
file:

```dotenv
RESEND_API_KEY=re_replace_with_local_key
```

After deployment, send one test invitation from **Access** and verify that its
status changes to **Email sent**. If delivery fails, confirm the domain is
verified and the key has permission to send from `cyberfarms.org`.
