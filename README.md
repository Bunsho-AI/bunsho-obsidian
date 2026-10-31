<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/bunsho-logo-white.png">
    <img src="docs/bunsho-logo-dark.png" alt="Bunsho" width="260">
  </picture>
</p>

# Bunsho for Obsidian

Find continuity errors in your novel: a character's eye colour that changes, a timeline that cannot work, someone who knows what they were never told. Each finding quotes both passages and jumps you to them.

## What you need

- A [Bunsho](https://bunsho.io) account (sign in with Google). Checks use your Bunsho credits, the same balance as the desktop app. New accounts start with a free allowance.
- Obsidian 1.11.4 or later on desktop (macOS, Windows or Linux). The plugin is desktop-only.

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

The plugin does nothing until you sign in: the panel and settings show only the sign-in until then.

1. Install and enable the plugin, then open **Bunsho** from the ribbon or the command palette.
2. Sign in with Google.
3. Press **Check manuscript** (or run it from the command palette). Bunsho shows the credit price and asks before anything is spent. A check takes a few minutes; keep Obsidian open while it runs.
4. Review findings. **Go to passage** selects the quoted text in your note; **Dismiss** hides a finding you have decided is fine.

Checking only ever runs when you press the button. Writing is never metered.

## Disclosures (Obsidian developer policies)

- **Account required.** Checking needs a Bunsho account and credits.
- **Payment.** A check is paid for with Bunsho credits. Credits are bought at bunsho.io, not inside the plugin.
- **Network use.** When you confirm a check, the plugin sends the text of your chapter notes to the Bunsho service (`engine.bunsho.io`) over an encrypted connection to be checked, and receives the findings. While you are signed in it also reads your credit balance and the current price from the Bunsho service (when Obsidian starts, when the panel opens and after a check), and it contacts Google and Firebase to sign you in and keep you signed in. Requests carry a random install id generated on this machine and the plugin version; the install id protects the free starter allowance from abuse. Your notes are not sent at any other time.
- **Telemetry.** The plugin sends no analytics or telemetry. The Bunsho service keeps the account and billing records needed to charge credits; see the privacy policy at https://bunsho.io/privacy.
- **Stored on your machine.** Findings and dismissals live in the plugin's `data.json`. Your sign-in is kept in Obsidian's secret storage, never in `data.json`.
- **Open source.** The plugin is a thin client under the MIT license. Detection runs in the Bunsho service.

## Development

```
npm install
npm run lint        # Obsidian's official plugin guidelines linter (eslint-plugin-obsidianmd)
npm test            # unit tests and an integration test against a mock engine
npm run build       # typecheck + bundle main.js
node scripts/mock-engine.mjs 8799   # a stand-in engine, no model credits
```

Local sign-in settings are read at build time from `BUNSHO_FIREBASE_API_KEY`, `BUNSHO_GOOGLE_CLIENT_ID`, `BUNSHO_GOOGLE_CLIENT_SECRET` and `BUNSHO_ENGINE_URL` (see `src/authConfig.ts`).

Releasing: bump `version` in `manifest.json` and `package.json`, add it to `versions.json`, then push a tag equal to the version (no leading `v`). The release workflow lints, tests, builds from source and attaches `main.js`, `manifest.json` and `styles.css` to a draft GitHub release.

## Code structure

Atomic layers. A file may import from layers below it in this list, never above:

```
src/
  main.ts            plugin entry: icon, view, commands, settings; hands everything to the controller
  pages/             what Obsidian mounts: ContinuityView (panel), SettingsTab, ConfirmCheckModal
  organisms/         SignInPanel, ManuscriptHelp, FindingCard, FindingsList
  molecules/         BrandHeader, StatusRow, GroupHeader, Passage, AlertCard, EmptyState
  atoms/             TextAction, FillButton, QuietButton, Fact, SeverityLabel, BunshoWordmark
  controllers/       ContinuityController: state and actions (the "hooks" layer for a non-React app)
  types/             shared state and persisted-data types
  lib/obsidian/      Obsidian API glue: vault reading, secret storage, selecting a passage
  lib/services/      engine access: auth (Google sign-in), engine (HTTP), review (WebSocket), project (free plan)
  helpers/           Bunsho domain logic, pure: chapters, quote location, progress, one-project state
  lib/contract/      the engine wire contract, copied from the desktop app (change with the engine)
  assets/            the wordmark images (inlined into main.js) and the ribbon icon (SVG)
  utils/             generic pure functions: markdown projection, hashing, formatting, URLs
```

- Only `pages/` read the controller; organisms, molecules and atoms take plain props and callbacks.
- Atoms import nothing app-specific except the logo asset; nothing below `controllers/` touches the Obsidian UI.
- Only `lib/services/` and `lib/contract/` talk to the network.
- Each component lives in its own folder with an `index.ts`. Imports use the `@/` alias for `src/`.

`src/lib/contract/` holds modules copied from the Bunsho desktop app (the review wire contract, pricing, and citation grounding). They are one contract with the engine; change them together.
