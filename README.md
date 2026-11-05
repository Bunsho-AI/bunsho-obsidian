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

## Your manuscript, in any layout

Bunsho works with the way you already keep your book. Pick a folder or a single note:

- One note per chapter or scene, in any number of nested folders.
- One long note holding the whole book, with or without headings.

Before your first check, Bunsho shows a **reading plan**: exactly what it will read, in which order, and for how many credits. Move anything that is out of order and untick anything that is not story, such as research notes. Your plan is saved, and shown again only when the notes change. Notes marked `wordcount: false` or tagged `#exclude-from-word-count` start unticked.

- Notes are first listed by name, with numbers compared as numbers (`2` before `10`), folder by folder.
- A long note is listed by its headings, so a section can be left out.
- Each line of a note counts as one paragraph.
- Frontmatter, `%%comments%%`, embeds and markdown marks are not part of the text that is checked.

Findings always point to your own note and passage.

## Using it

The plugin does nothing until you sign in: the panel and settings show only the sign-in until then.

1. Install and enable the plugin, then open **Bunsho** from the ribbon or the command palette.
2. Sign in with Google.
3. Choose the folder or note that holds your book, and confirm the reading plan.
4. Press **Check manuscript** (or run it from the command palette). Bunsho shows the credit price and asks before anything is spent. A check takes a few minutes; keep Obsidian open while it runs.
5. Review findings. Click a passage to select it in your note; **Not an error** hides a finding you have decided is fine.

Bunsho uses AI and can make mistakes. Check findings against your story.

After that first check of the whole book, Bunsho can check parts of it, each priced before you press anything:

- **Check chapter** checks the chapter your cursor is in against the rest of the story. It asks first and names the price.
- **Review changed chapters** appears when chapters have changed, or moved, since their last check. The price is on the button. It also clears findings that have gone.
- **Check if fixed**, on a finding's Resolve screen, reads every chapter the finding cites again. The finding closes only if the check finishes, nothing changed while it ran, you changed one of those chapters, and the problem does not come back. If it comes back in a reworded sentence, it is still the same finding.

A check is charged for the text it reads in full. If a review stops, your findings stay as they were, and a retry is a new review, charged again.

Filter findings by kind with the chips above the list, or use **Jump to issue**. Both are free.

The **World** tab lists the people, places, things and groups a check found, with the passage each fact comes from. **Events** lists what changes between chapters, such as where someone is, and each place opens its passage. It costs nothing extra, and it is read-only for now.

The top of the panel always shows your plan and your credit balance.

Need a person? **Contact support**, at the foot of the panel and in the plugin's settings, opens an email to support@bunsho.io in your mail app. The plugin attaches nothing. Guides are at https://bunsho.io/docs.

On the free plan your vault is your one project. You can change what it reads at any time, and you can switch your free project to another vault as often as you like.

Checking only ever runs when you press the button. Writing is never metered.

## Disclosures (Obsidian developer policies)

- **Account required.** Checking needs a Bunsho account and credits.
- **Payment.** A check is paid for with Bunsho credits. Credits are bought at bunsho.io, not inside the plugin.
- **Network use.** When you confirm a check, the plugin sends the text of the notes and sections on your reading plan to the Bunsho service (`engine.bunsho.io`) over an encrypted connection to be checked, and receives the findings. A check of the whole book sends all of that text. A check of one chapter, of changed chapters or Check if fixed sends those chapters in full, the paragraphs of other chapters that mention the same people, and what earlier checks read from your book (facts, quotes and names). While you are signed in it also reads your plan, your credit balance and the current price from the Bunsho service (when Obsidian starts, when the panel opens and after a check), and it contacts Google and Firebase to sign you in and keep you signed in. Sign-in opens a page served from your own computer in your browser; that page loads Firebase's sign-in code from Google. Requests carry a random install id generated on this machine and the plugin version; the install id protects the free starter allowance from abuse. Your notes are not sent at any other time.
- **Telemetry.** The plugin sends no analytics or telemetry. The Bunsho service keeps the account and billing records needed to charge credits; see the privacy policy at https://bunsho.io/privacy.
- **Stored on your machine.** Findings and dismissals live in the plugin's `data.json`, and what checks read (facts, quotes and the cast, used by the World tab and sent back on chapter checks) in `world.json` beside it, in your vault's plugin folder. Your sign-in is kept in Obsidian's secret storage, never in `data.json`.
- **Open source.** The plugin is a thin client under the MIT license. Detection runs in the Bunsho service.

## Development

```
npm install
npm run lint        # Obsidian's official plugin guidelines linter (eslint-plugin-obsidianmd)
npm test            # unit tests and integration tests against a mock engine
npm run test:coverage
npm run build       # typecheck + bundle main.js
node scripts/mock-engine.mjs 8799   # a stand-in engine, no model credits
```

Local sign-in settings are read at build time from `BUNSHO_FIREBASE_API_KEY`, `BUNSHO_FIREBASE_AUTH_DOMAIN`, `BUNSHO_FIREBASE_APP_ID` and `BUNSHO_ENGINE_URL`; `npm run build:stage` builds against stage (see `src/lib/services/auth/authConfig.ts`). A release uses only the committed values, and `npm run check:release` fails while any of them is empty.

Releasing: bump `version` in `manifest.json` and `package.json`, add it to `versions.json`, then push a tag equal to the version (no leading `v`). The release workflow lints, tests, builds from source and attaches `main.js`, `manifest.json` and `styles.css` to a draft GitHub release.

## Code structure

Atomic layers. A file may import from layers below it in this list, never above:

```
src/
  main.ts            plugin entry: icon, view, commands, settings; hands everything to the controller
  pages/             what Obsidian mounts: ContinuityView (panel), SettingsTab, ConfirmCheckModal, JumpPickerModal
  organisms/         SignInPanel, ManuscriptHelp, FindingCard, FindingsList, ResolverPanel, JumpPicker
  molecules/         BrandHeader, PanelFoot, TimelineRow, StatusRow, GroupHeader, Passage, AlertCard, EmptyState, SpectrumChips, SpectrumPill, CheckChapterControl, ChangedChaptersRow
  atoms/             TextAction, FillButton, QuietButton, Fact, SeverityLabel, BunshoWordmark, GoogleSignInButton
  controllers/       ContinuityController: state and actions (the "hooks" layer for a non-React app)
  types/             shared state and persisted-data types
  lib/obsidian/      Obsidian API glue: vault reading, secret storage, selecting a passage
  lib/services/      engine access: auth (Google sign-in), engine (HTTP), review (WebSocket), project (free plan)
  helpers/           Bunsho domain logic, pure: chapters, quote location, progress, one-project state, the review merge, passages, the account line, support
  lib/contract/      the engine wire contract, copied from the desktop app (change with the engine)
  assets/            the wordmark images (inlined into main.js), the ribbon icon and Google's G (SVG)
  utils/             generic pure functions: markdown projection, hashing, formatting, URLs
```

- Only `pages/` read the controller; organisms, molecules and atoms take plain props and callbacks.
- Atoms import nothing app-specific except the logo asset; nothing below `controllers/` touches the Obsidian UI.
- Only `lib/services/` and `lib/contract/` talk to the network.
- Each component lives in its own folder with an `index.ts`. Imports use the `@/` alias for `src/`.

`src/lib/contract/` holds modules copied from the Bunsho desktop app (the review wire contract, pricing, and citation grounding). They are one contract with the engine; change them together.

## Fonts

`styles.css` embeds Literata, IBM Plex Sans and Courier Prime under the SIL Open Font License 1.1. Their copyright notices and the license text are in that file.
