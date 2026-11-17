# Spellhound architecture

Spellhound has two entry points. In the community build, Word opens a locally served React sidebar and the user selects an AI provider. In the Publik pilot, a Node server serves the installation page, Word manifest, and sidebar from the same HTTPS address. Word edits the open document in both builds. The public Publik listing currently distributes the source version.

## From a suggestion to a tracked change

1. Word reads the add-in manifest to find the sidebar URL and ribbon command. The sidebar waits for Office.js to initialize before mounting the React app. [Word manifest](manifest.xml) · [Sidebar entry point](src/main.tsx)
2. The sidebar gathers the document context for the requested action and sends the prompt to the selected provider. In the pilot, Publik requests go through the Node server with that installation’s credential. The own-key path uses the provider configured in the pane. [Document tools](src/community/) · [Provider implementations](src/ai/providers/)
3. When the user applies a suggested redline, Spellhound locates the quoted text in the open document. It uses Office.js and office-word-diff to record insertions and deletions and restores the previous tracking setting. If it cannot locate the passage, the user can review the suggestion manually. Word handles accepting and rejecting the changes. [Redline implementation](src/office/redline.ts) · [Document comparison](src/office/compareDiff.ts)

## Sign-in, storage, and billing

The pilot server uses a listing-specific Publik app token to register each Word installation. The user links that installation to a Publik account in the browser. Word polls the server for confirmation and then offers a payment choice. When the user chooses Publik, the server checks the installation’s wallet and saved choice before forwarding a chat request. [Sign-in pane](src/features/auth/PublikGate.tsx) · [Publik routes](server/publik.mjs)

The server stores installation credentials and payment choices in its private session directory. Word holds a secure HTTP-only session cookie. Sessions expire after 30 days and a second installation gets a separate session. A user-supplied provider key lives in the pane’s local storage. It stays out of the Word file. Usage reporting is opt-in. [Session store](server/sessions.mjs) · [Provider settings](src/ai/keys.ts)

## Research and matter storage

Public research sends a search query or citation to the selected source. The server can look up federal regulations through eCFR, retrieve US Code and US Reports material from GovInfo, or search through Publik. The user can inspect the linked source before inserting a footnote. [Research routes](server/research.mjs) · [Coverage and limits](RESEARCH-AND-WORD-ACTIONS.md)

The private matter workspace runs as a separate local preview with synthetic records. The pilot server does not expose its routes. [Matter workspace design](server/matters/README.md)

## Run locally

Use Node 22 and run these commands from the repository root:

```sh
npm ci
npm run setup:local
npm run start:local
```

Keep the local server running at `https://localhost:3000` and add [manifest.localhost.xml](manifest.localhost.xml) to Word. On a Mac, copy the file to `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`, restart Word, and choose **Home → Add-ins → Spellhound for Word**. [Microsoft’s Mac instructions](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)

Local mode serves the production Publik build, binds only to `127.0.0.1:3000`, and rejects a different Host header. It reads the public `publik-app-token.txt` (or an explicit `PUBLIK_APP_TOKEN` override). Private installation credentials stay outside the repository in the user's application-data directory. `npm run self-test:local` checks registration and the wallet through the built app's HTTPS routes. No cloud host is required.

## Optional hosted pilot

Run `npm test` and `npm run build` to test the app and produce the Publik build in `dist/`. The Node server serves the install guide at `/`, generates `/manifest.xml` for the configured HTTPS origin, and serves the Word pane at `/index.html`. The pilot needs a registered app token, HTTPS, and persistent private session storage. The CI workflow tests changes and publishes a container image from main. Hosting that image is a separate deployment. [Server entry point](server/start.mjs) · [CI workflow](.github/workflows/ci.yml) · [Deployment and pilot checks](DEPLOY.md)
