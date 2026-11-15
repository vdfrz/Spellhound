# Spellhound for Word

Spellhound is a Microsoft Word add-in for contract review, native tracked changes, drafting, playbooks, and cited research. Based on the Apache-licensed Vaquill Word client. See [NOTICE](NOTICE).

## Development

Use Node 22. Run `npm ci`, then `npm test` and `npm run build`. The production pane opens with Sign in with Publik. To develop document features locally with your own AI provider, run `npm run dev:community` and sideload `manifest.localhost.xml` in Word.

## Hosted service

Publik-only sign-in is implemented for a single Word installation. After browser claim, users explicitly choose a Publik balance or their own provider. Documents and keys are not shared between installations. The server enforces a 30-day session limit and checks the wallet on paid requests. Optional content-free usage counts are off initially.

The intended public deployment uses the dedicated Google Cloud project and Publik sign-in. Billing attachment, a live HTTPS address and a real sign-in test in Word are pending. The [Publik listing](https://publikhq.com/spellhound-app) currently offers the source version. Each Word installation currently has its own session. See the [private pilot guide](DEPLOY.md) for platform evidence, token handling, the Word manifest and the Iris-assisted installation checklist.

## Release status

The local document tools, Ask/Edit changes, branded manifests, and initial Publik gate are under development. Tools → Public legal research can retrieve public source passages and citations. Shared matters, role-checked approvals and the template library still require independent services. See the [research guide and Word action inventory](RESEARCH-AND-WORD-ACTIONS.md) for coverage and limits. The project is not currently available from the Word store. See [Publik publishing](https://publikhq.com/skills/publish.md) and [Publik sign-in](https://publikhq.com/skills/api.md).

A [private matter workspace preview](server/matters/README.md) is available locally with synthetic users and records. It is not mounted by the hosted service.
