# Private matter workspace (synthetic preview)

Create a matter, file a reference, note or decision, and reopen it after switching matters or reloading the pane. Reference import stores extracted text and a filename, not the original file. Decisions remain available exactly as filed. Summarizing one is a separate action; an empty or unavailable memory result does not replace or delete a decision. The preview uses a deterministic model stand-in, not Publik or a remote AI service.

## Try it locally

Use Node 22 and Python 3.11 on macOS or Linux. In this checkout:

```sh
npm ci
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r server/matters/requirements.txt
npm run build:matters-preview
.venv/bin/python -m server.matters.preview
```

Open the printed loopback URL. Create two fictional matters. In the first, import a `.txt`, `.md` or `.docx` reference, file a note and file a decision. Expand the decision to summarize it. Select the other matter, then reload, reopen the first and compare its exact decision and summary. The displayed Word filename is simulated in this preview; the pane component takes the active Word filename as a separate, display-only input. Filing a reference never changes that target. Ctrl+C stops the preview and discards the temporary workspace. The preview issues a synthetic cookie to its local browser; anyone with access to that local preview acts as its fictional user.

## Integration contract

- `private_api(root, resolve_principal, origin, memory)` is an unmounted WSGI application. A future identity adapter must verify a server session on **every** request and return `Principal(issuer_qualified_immutable_subject)` or `None`. Never use a client-supplied subject, installation, wallet handle or service credential. Two independently verified sessions may resolve to the same subject; session revocation belongs to the resolver.
- `GET/POST /spellhound/matters` list/create owned matters (`{name}`). `GET/POST /spellhound/matters/:id/entries` read/file exact records (`{kind,title,body}`). `GET /spellhound/matters/:id/memory` returns the latest 50 derived working experiences; `POST` accepts only `{decisionId}` and resolves the source decision inside the authorized matter. Writes require the configured pane origin and JSON. Responses are not cacheable.
- The server selects the owner catalog from the verified subject, checks matter ownership, then opens that matter's own records database. The Hy-Memory adapter also gives the matter a separate worker home, working directory, data directory, user, workspace and session. Each operation starts a worker with an allowlisted environment. SDK writes/reads are serialized per matter. Setting a shared store with different workspace labels is not a supported configuration.
- The host can supply `<App privateMattersAvailable />` **only once a private service and verified session are available**. Remount the app on account change/sign-out to discard displayed private data. The prop controls the Assistant's workspace button, not authorization. The shipped pane omits it, and the production server has no matter handler. Nothing here connects the Publik wallet check to private data. Hosting, verified cross-device identity, provider configuration and production data retention remain separate work.

## Checks

```sh
npm test
npm run build
.venv/bin/python -m unittest -v server.matters.test_workspace server.matters.test_memory
# With the disposable preview running and Chrome installed:
uv run --no-project --python 3.11 --with playwright python server/matters/browser_check.py http://127.0.0.1:PORT
```

The API test uses different authenticated fixture sessions, including an unauthorized owner and two sessions mapped to the same fictional owner. The regression uses real `hy-memory==2.0.16` working experiences with a loopback chat/embedding fixture. The fake model echoes **both** synthetic markers if both arrive in its prompt. The test asserts the exact reopened experience text, so a contaminated summary cannot pass just because its matter label is correct. This does not test real Word, Publik identity, hosted storage, or model quality.
