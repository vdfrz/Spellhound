# What the Word add-in can do

Implementation inventory for the research branch on top of foundation PR #1 (`98ed48f`). "Local" describes where an operation runs, not a claim that it has been tested inside Word. Both builds currently select the [local document router](src/community/edition.ts).

| Word action | Implemented path | Limit or missing replacement |
| --- | --- | --- |
| Public research | Tools → Public legal research offers public web and US case-law search through Publik, plus direct eCFR, U.S. Code and U.S. Reports lookups. | Search snippets require source review. |
| Document citation scan | Review → Citations searches each extracted US case citation with Publik. Exact U.S. Reports citations also go through the GovInfo reporter check. | Search results alone do not verify a case or its later treatment. |
| Draft grounding | [Upload/reference handling](src/community/localForm.ts) extracts DOCX/TXT/MD; [draft generation](src/community/draft.ts) includes reference text in the selected model's prompt. | References and generated rows are held in memory. No source-backed legal retrieval, citation-to-draft binding, quality score or persistent firm library. PDFs sent to chat are not drafting references. A manual research result does not silently ground a draft. |
| Compare | [Compare](src/features/compare/CompareView.tsx) selects the [on-device text comparison](src/features/compare/CommunityCompareView.tsx) and [Word changes](src/office/compareDiff.ts). Accepting all proposed edits would make the open text match the picked reference. | DOCX/TXT/MD, text only. No PDF conversion, formatting comparison, server redline download or AI summary. Check preview, apply, accept and reject against two synthetic files in Word. |
| Templates | [Draft](src/features/draft/DraftView.tsx) can generate an agreement. [Template list/export client](src/api/templates.ts) defines a different workflow. | No catalog, ownership checks or DOCX export service. Draft no longer links to a nonexistent library. Acceptance: list an authorized template, insert it in Word, deny access to another firm's template. |
| OCR | [OCR job client](src/api/ocr.ts) defines upload and polling. [Attachment extraction](src/community/extractText.ts) reads text formats locally and passes PDF bytes to chat where supported. | No OCR worker or active OCR job flow. A PDF attachment is not an extracted transcription. Acceptance: opt in with a synthetic scan, show progress/errors, verify text and deletion. |
| Vendor registry | [Review save flow](src/features/integration/SaveToVaquill.tsx) is gated; the [propose/create client](src/api/platform.ts) separates proposed fields from a confirmed record. | No independent vendor registry or saved draft linkage. Acceptance: preview a proposal, require explicit confirmation, prevent duplicate creation and enforce workspace access. |
| Approvals | [Governance](src/features/governance/useGovernance.ts) can record an in-file attestation; the [approval client](src/api/approvals.ts) expects a server-authorized role for a saved draft. | No independent approval service. An in-file attestation does not verify authority. Acceptance: deny an unauthorized signer, record an authorized decision once, and keep a failed enforced check from falling back to local approval. |

## Trying the research pane

Run the local community build as described in the README. Install Poppler's `pdftotext` on the server/development machine for opening-page extraction; the provided runtime Dockerfile includes it. The Vite dev server handles research at its local origin; the hosted Node server exposes the same route. An old static-only server won't handle the POST.

Open **Tools → Public legal research** or choose a research source under **Add context**. Only the public query goes to the selected source. In Review → Citations only the extracted citation is sent. Hosted searches use the signed-in installation’s Publik credential and payment choice. The personal preview uses its existing server-side key. For localhost community development, run the Vite server with PUBLIK_API_KEY in its environment.

| Source | Example | What to check |
| --- | --- | --- |
| eCFR | `privacy training` | A [search result](https://www.ecfr.gov/developers/documentation/api/v1) carries a section citation and excerpt. Follow its version date; a snippet may omit qualifications. |
| GovInfo U.S. Code | `17 U.S.C. § 107` | The [official resolver](https://www.govinfo.gov/link/uscode/17/107?link-type=html) selects its published edition. The adapter checks the title/section in the returned document before quoting its first paragraph. Editions may lag changes in law. |
| GovInfo U.S. Reports | `347 U.S. 483` | The official record's citation must match before extracting page one from the [published PDF](https://www.govinfo.gov/content/pkg/USREPORTS-347/pdf/USREPORTS-347-483.pdf). The opening page may be a syllabus. Image-only pages yield no passage. |
| Public web and US case law | Public keywords, case name or reporter citation | [Publik search](https://publikhq.com/skills/search.md) returns linked snippets at $0.01 per query. An exact U.S. Reports lookup also checks the official record. |

Use **Copy citation** on any result or **Insert footnote** on a primary source. Both carry the source URL and the unknown treatment label. Research does not send results to a model or change the document until a user requests a footnote. Formatting, cross-device sign-in, private matters, and production release are outside this slice.

The direct-source checks use public examples. Store deployment, sign-in on a second device and subsequent case treatment are outside this research check.
