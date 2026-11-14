# Spellhound for Word

Spellhound is a Microsoft Word add-in for contract review, native tracked changes, drafting, playbooks, and cited research. Based on the Apache-licensed Vaquill Word client. See [NOTICE](NOTICE).

## Development

Use Node 22. Run `npm ci`, then `npm test` and `npm run build`. The production pane opens with Sign in with Publik. To develop document features locally with your own AI provider, run `npm run dev:community` and sideload `manifest.localhost.xml` in Word.

## Hosted service

Publik-only sign-in is implemented for a single Word installation. After browser claim, users explicitly choose a Publik balance or their own provider. Documents and keys are not shared between installations. The server enforces a 30-day session limit and checks the wallet on paid requests. Optional content-free usage counts are off initially.

**Hosting and cross-device identity are unconfirmed.** A Publik listing links to an existing deployment. No alternative host, public listing or multi-device account is provided here. See the [private pilot guide](DEPLOY.md) for platform evidence, token handling, the Word manifest and the Iris-assisted installation checklist.

## Release status

The local document tools, Ask/Edit changes, branded manifests, and initial Publik gate are under development. Formerly hosted functions such as matters, approvals and research require independent Spellhound services before release. The project is not currently available from the Word store. See [Publik publishing](https://publikhq.com/skills/publish.md) and [Publik sign-in](https://publikhq.com/skills/api.md).
