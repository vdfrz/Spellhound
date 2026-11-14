# Spellhound for Word

Spellhound is a Microsoft Word add-in for contract review, native tracked changes, drafting, playbooks, and cited research. Based on the Apache-licensed Vaquill Word client. See [NOTICE](NOTICE).

## Development

Use Node 22. Run `npm ci`, then `npm test` and `npm run build`. The production pane opens with Sign in with Publik. To develop document features locally with your own AI provider, run `npm run dev:community` and sideload `manifest.localhost.xml` in Word.

## Hosted service

Provide `SPELLHOUND_ORIGIN` (the HTTPS origin that serves the pane), `PUBLIK_APP_TOKEN` for the Spellhound listing, and a private persistent volume at `/data/spellhound`. Terminate HTTPS at the ingress and route the pane and API to the same origin. The example Dockerfile serves both. Generate the release manifest with `npm run manifest -- https://your-real-host.example` after building. It writes `dist/manifest.xml`. The included root manifest uses a reserved example host until then.

The server provisions a separate Publik installation credential for each browser session, verifies its wallet before AI calls, and stores the key server-side. A claimed install grants AI access only. A durable cross-device identity contract and a Publik deployment target are still required for shared private workspaces. No real app token or hosting URL is included.

## Release status

The local document tools, Ask/Edit changes, branded manifests, and initial Publik gate are under development. Formerly hosted functions such as matters, approvals and research require independent Spellhound services before release. The project is not currently available from the Word store. See [Publik publishing](https://publikhq.com/skills/publish.md) and [Publik sign-in](https://publikhq.com/skills/api.md).

A [private matter workspace preview](server/matters/README.md) is available locally with synthetic users and records. It is not mounted by the hosted service.
