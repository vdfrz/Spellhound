# Spellhound for Word

Somehow, legal tech turned editing a Word document in Word into a luxury. Spellhound is a free, open-source Word add-in for reviewing and drafting contracts.

Select a clause, ask for a rewrite, and apply the suggestion as **native Word tracked changes**. The next person who opens the document can accept or reject each edit in Word. You can also compare two drafts or look up a US legal citation from the sidebar.

## Install with Iris on Publik

1. Open [Spellhound on Publik](https://publikhq.com/spellhound-app) and create a Publik account. The add-in is free. If you want Publik to handle AI requests, you can use a plan or a prepaid balance. The seven-day Basic trial requires a card and renews at $8/month plus taxes and fees unless you cancel. [Publik pricing](https://publikhq.com/pricing)
2. Open [Iris](https://publikhq.com/iris), Publik’s desktop install assistant, and ask: **“Help me install Spellhound from vedantdas312-cell/Spellhound and open it inside Microsoft Word.”** The public listing currently offers a source install. Iris can guide you through running it locally and adding it to Word. [Mac guide](https://publikhq.com/spellhound-app/install/mac) · [Windows guide](https://publikhq.com/spellhound-app/install/windows)
3. Open a blank document in Word. On a Mac, choose **Home → Add-ins → Spellhound**, then **Open Spellhound**. In the local community version, choose your own AI provider. If you have the Publik pilot version, choose **Sign in with Publik → Continue in your browser → Link this device**. Return to Word and choose your Publik balance or your own provider key.

## Install without Iris

You can run the community version on your own Mac or Windows PC. You’ll need desktop Microsoft Word with add-ins enabled, [Git](https://git-scm.com/downloads), and [Node.js 22](https://nodejs.org/en/download/archive/v22). This version works with your own AI provider and does not require a Publik account or plan.

1. **Download and start Spellhound.** Open Terminal on Mac or Command Prompt on Windows and run:

   ```sh
   git clone https://github.com/vedantdas312-cell/Spellhound.git
   cd Spellhound
   npm ci
   npx office-addin-dev-certs install
   npm run dev:community -- --port 3000 --strictPort
   ```

   The certificate lets Word trust the local HTTPS connection. Keep this window open while using Spellhound. The server should show `https://localhost:3000`.

2. **Add Spellhound to Word.** Open a second terminal in the same `Spellhound` folder and run:

   ```sh
   npx office-addin-dev-settings sideload manifest.localhost.xml desktop --app word
   ```

   Microsoft’s tool registers the local add-in and opens a test document in Word. If the sidebar is closed, select **Home → Open Spellhound**. If your organization blocks custom add-ins, ask your Microsoft 365 administrator to enable or install it for you.

3. **Try it.** Choose your AI provider in the sidebar and enter your key if prompted. Type a sample clause, select it, and ask Spellhound to suggest an edit. Apply it, then use Word’s **Review** tab to accept or reject the change.

The next time you use Spellhound, start the server again from the same folder with `npm run dev:community -- --port 3000 --strictPort`. Open the test document, or choose **Spellhound for Word (Community, local)** from Word’s add-ins menu.

## Development and license

For the local setup, code layout, and hosting instructions, see [architecture.md](architecture.md).

Spellhound is forked from **Vaquill AI for Word** and distributed under the [Apache License 2.0](LICENSE). [Upstream and third-party credits](NOTICE)
