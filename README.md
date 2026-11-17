# Spellhound for Word

Somehow, legal tech turned editing a Word document in Word into a luxury. Spellhound is a free, open-source Word add-in for reviewing and drafting contracts.

Select a clause, ask for a rewrite, and apply the suggestion as **native Word tracked changes**. The next person who opens the document can accept or reject each edit in Word. You can also compare two drafts or look up a US legal citation from the sidebar.

## Install with Iris on Publik

1. Open [Spellhound on Publik](https://publikhq.com/spellhound-app) and create a Publik account. The add-in is free. If you want Publik to handle AI requests, you can use a plan or a prepaid balance. The seven-day Basic trial requires a card and renews at $8/month plus taxes and fees unless you cancel. [Publik pricing](https://publikhq.com/pricing)
2. Open [Iris](https://publikhq.com/iris), Publik’s desktop install assistant, and ask: **“Help me install Spellhound from vedantdas312-cell/Spellhound and open it inside Microsoft Word.”** The public listing currently offers a source install. Iris can guide you through running it locally and adding it to Word. [Mac guide](https://publikhq.com/spellhound-app/install/mac) · [Windows guide](https://publikhq.com/spellhound-app/install/windows)
3. Open a blank document in Word. On a Mac, choose **Home → Add-ins → Spellhound**, then **Open Spellhound**. Choose **Sign in with Publik → Continue in your browser → Link this device**. Return to Word and choose your Publik balance or your own provider key.

## Install without Iris

Spellhound runs on your own Mac or Windows PC. You do not need a hosting account or domain. You’ll need desktop Microsoft Word with add-ins enabled, [Git](https://git-scm.com/downloads), and [Node.js 22](https://nodejs.org/en/download/archive/v22). An internet connection and a Publik account are required. A paid Publik plan is not required when using your own provider key. AI usage may cost money with the provider you choose.

1. **Download and start Spellhound.** Open Terminal on Mac or Command Prompt on Windows and run:

   ```sh
   git clone https://github.com/vedantdas312-cell/Spellhound.git
   cd Spellhound
   npm ci
   npm run setup:local
   npm run start:local
   ```

   Approve Microsoft's localhost certificate installation when your computer asks. The certificate lets Word trust the local HTTPS connection. Keep this window open while using Spellhound. The server should show `https://localhost:3000`.

2. **Add Spellhound to Word.** Open a second terminal in the same `Spellhound` folder and run:

   ```sh
   npx office-addin-dev-settings sideload manifest.localhost.xml desktop --app word
   ```

   Microsoft’s tool registers the local add-in and opens a test document in Word. If the sidebar is closed, select **Home → Open Spellhound**. If your organization blocks custom add-ins, ask your Microsoft 365 administrator to enable or install it for you.

3. **Sign in and try it.** Choose **Sign in with Publik**, link this installation in your browser, and return to Word. Connect your Publik plan or balance, or choose **Use my own key**. Type a sample clause, select it, and ask Spellhound to suggest an edit. Apply it, then use Word’s **Review** tab to accept or reject the change.

The next time you use Spellhound, start the server again from the same folder with `npm run start:local`. Open the test document, or choose **Spellhound for Word** from Word’s add-ins menu.

Usage counts are optional; enable them during setup or in Account. No document or prompt is included in those counts. The public Publik app token is bundled; each Word installation gets its own private credential.

## Check the local installation

With the local server stopped, run `npm run self-test:local`. This starts the built app, registers a temporary installation, checks its real Publik wallet, and exits. Success prints `publik self-test: ok spellhound-app 0.1.0`. It makes no AI request and does not prove sign-in or editing in your particular Word installation.

The separate developer community build (`npm run dev:community`) uses your own provider without Publik sign-in. It is not the installation path for the Publik listing.

## Development and license

For the local setup, code layout, and hosting instructions, see [architecture.md](architecture.md).

Spellhound is forked from **Vaquill AI for Word** and distributed under the [Apache License 2.0](LICENSE). [Upstream and third-party credits](NOTICE)
