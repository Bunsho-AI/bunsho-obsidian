# Bunsho for Obsidian

Find continuity errors in your novel: a character's eye colour that changes, a timeline that cannot work, someone who knows what they were never told. Each finding quotes both passages and jumps you to them.

## What you need

- A [Bunsho](https://bunsho.io) account (sign in with Google). Checks use your Bunsho credits, the same balance as the desktop app. New accounts start with a free allowance.
- Obsidian on desktop (macOS, Windows or Linux). The plugin is desktop-only.

## Your manuscript layout

Bunsho reads one layout. There is no other.

```
Manuscript/
  01 The Arrival.md
  02 The Letter.md
  03 ...
```

- One note per chapter, directly inside the manuscript folder (the folder name is a setting; the default is `Manuscript`).
- Chapters are read in name order, with numbers compared as numbers (`2` before `10`), so number your chapter notes.
- One paragraph per line.
- Frontmatter, `%%comments%%`, embeds and markdown marks are not part of the text that is checked.

## Using it

1. Install and enable the plugin, then open **Bunsho** from the ribbon or the command palette.
2. Sign in with Google.
3. Press **Check manuscript**. The panel shows the credit price first. A check takes a few minutes; keep Obsidian open while it runs.
4. Review findings. **Go to passage** selects the quoted text in your note; **Dismiss** hides a finding you have decided is fine.

Checking only ever runs when you press the button. Writing is never metered.

## Disclosures (Obsidian developer policies)

- **Account required.** Checking needs a Bunsho account and credits.
- **Payment.** A check is paid for with Bunsho credits. Credits are bought at bunsho.io, not inside the plugin.
- **Network use.** When you press **Check manuscript**, the plugin sends the text of your chapter notes to the Bunsho service (`engine.bunsho.io`) over an encrypted connection to be checked, and receives the findings. It also contacts Google and Firebase to sign you in, and the Bunsho service to read your credit balance. Nothing is sent at any other time.
- **Telemetry.** The plugin sends no analytics or telemetry. The Bunsho service keeps the account and billing records needed to charge credits; see the privacy policy at https://bunsho.io/privacy.
- **Stored on your machine.** Findings and dismissals live in the plugin's `data.json`. Your sign-in is kept in Obsidian's secret storage (or in `data.json` on Obsidian versions without it).
- **Open source.** The plugin is a thin client under the MIT license. Detection runs in the Bunsho service.

## Development

```
npm install
npm test            # unit tests and an integration test against a mock engine
npm run build       # typecheck + bundle main.js
node scripts/mock-engine.mjs 8799   # a stand-in engine, no model credits
```

Local sign-in settings are read at build time from `BUNSHO_FIREBASE_API_KEY`, `BUNSHO_GOOGLE_CLIENT_ID`, `BUNSHO_GOOGLE_CLIENT_SECRET` and `BUNSHO_ENGINE_URL` (see `src/authConfig.ts`).

`src/vendor/` holds modules copied from the Bunsho desktop app (the review wire contract, pricing, and citation grounding). They are one contract with the engine; change them together.
