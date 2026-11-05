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

The plugin does nothing until you sign in: the panel shows only the sign-in until then.

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

The **World** tab lists the people, places, things and groups a check found, with the passage each fact comes from. **Events** lists what changes between chapters, such as where someone is, and each place opens its passage. It costs nothing extra.

### Your canon

The World is also your story record, and writing in it costs nothing. **Make canon** on anything a check found declares it true, keeping the passage it came from; **Revert** takes that back. **Add character** (or place, object, group), **Add a fact**, **Add alias** and **Rename** let you write the record by hand, before any check if you like. Renaming keeps the old name as an alias, because your prose still says it. Bunsho never merges two people: if a name is already taken it asks whether this is someone new or another name for them.

Every check holds your prose against the facts you declared, on the chapters it checks, for free. A passage that disagrees becomes a card with the page on one side and canon on the other, and you decide which is wrong. **Revert** on its Resolve screen withdraws the fact; the card goes at your next check.

Facts that can change, such as where someone is, and what someone knows, are kept in your record but are not checked against your prose.

When your canon has changed since the whole book was last checked against it, **Check canon** appears with its price on the button: the book's characters at the canon rate, and a small charge per fact. It checks your declared facts alone, and only once every chapter has been read. If your plan has ended, everything you declared stays and shows, and you can change it again when you renew.

### The Director

Say what happens in a scene and who is there, and Bunsho plans it as beats you can change before anything is written. **Plan scene**, **Write scene**, **Regenerate** and **Rewrite this beat** each show their price on the button, and are charged only when you press them. Rewording, reordering (drag a beat's grip, or use the arrow keys on it), removing and adding beats costs nothing. Type `@` in the direction to name someone from your cast.

The draft stays in the panel until you press **Keep**. Nothing reaches your note before that, and **Discard** leaves it untouched. Keep puts the scene at the end of the chapter, or where your cursor was when you pressed Write scene:

- A chapter is a line of your reading plan, so "the end" of a section in a long note is the end of that section, not of the note.
- A scene goes in at the next line boundary, never through the middle of a line. A cursor in the middle of a paragraph means after that paragraph.
- If the text before that cursor has changed since, the scene goes at the end of the chapter, and the panel says so.
- In a note open for editing, one Undo takes the whole scene back out. In a closed note, or one in reading view, the scene goes straight into the file: the panel says so, and Undo cannot take it back.

After Keep, Bunsho offers to check the chapter, with the price on the button. It never checks by itself. Earlier scenes stay in the tab, and a kept one opens read-only. The Director needs a plan with AI: Quill shows what it would take to add it, and the Bunsho service decides in every case.

Once you are signed in, the top of the panel shows your plan and your credit balance whenever Bunsho can read them.

Need a person? Once you are signed in, **Contact support**, at the foot of the panel and in the plugin's settings, opens an email to support@bunsho.io in your mail app. The plugin adds only its version, in the subject. You can also write to that address directly. Guides are at https://bunsho.io/docs.

On the free plan your vault is your one project. You can change what it reads at any time, and you can switch your free project to another vault as often as you like.

Checking only ever runs when you press the button. Writing is never metered.

## Disclosures (Obsidian developer policies)

- **Account required.** Checking needs a Bunsho account and credits.
- **Payment.** A check is paid for with Bunsho credits. Credits are bought at bunsho.io, not inside the plugin.
- **Network use.** When you confirm a check, the plugin sends the text of the notes and sections on your reading plan to the Bunsho service (`engine.bunsho.io`) over an encrypted connection to be checked, and receives the findings. A check of the whole book sends all of that text. When you press a priced Director button, the plugin sends your direction, up to the last 20,000 characters of that chapter or of the text before your cursor, the scene's plan, and what checks read from your book and what you declared (names, facts, quotes), and receives the plan or the prose. A check of one chapter, of changed chapters or Check if fixed sends those chapters in full, the paragraphs of other chapters that mention the same people, and what earlier checks read from your book (facts, quotes and names). Every check also sends the facts you declared that a check can test (a name, what it is about, and its value), and Check canon sends your whole book and those facts. Declaring a fact sends nothing, except that a free account's first one makes this vault its one project, sending the vault's name. While you are signed in it also reads your plan, your credit balance and the current price from the Bunsho service (when Obsidian starts, when the panel opens, after a check, and when you come back to Obsidian, at most once a minute), and it contacts Google and Firebase to sign you in and keep you signed in. Sign-in opens a page served from your own computer in your browser; that page loads Firebase's sign-in code from Google. Requests carry a random install id generated on this machine and the plugin version; the install id protects the free starter allowance from abuse. Your notes are not sent at any other time.
- **Telemetry.** The plugin sends no analytics or telemetry. The Bunsho service keeps the account and billing records needed to charge credits; see the privacy policy at https://bunsho.io/privacy.
- **Stored on your machine.** Findings and dismissals live in the plugin's `data.json`, what checks read (facts, quotes and the cast, used by the World tab and sent back on chapter checks) in `world.json` beside it, your canon in `canon.json`, and each Director scene as one JSON file in a `scenes` folder (your direction, the plan, any draft and, until you keep it, the stretch of your chapter it continues from), all in your vault's plugin folder. Your sign-in is kept in Obsidian's secret storage, never in `data.json`.
- **Signing out keeps your data.** Signing out stops a running check and ends your session. Your findings, decisions, World, canon and scenes stay on your machine, so they are there when you sign back in. To remove them, use **Delete my Bunsho data** in the plugin's settings, which also works signed out and says exactly what it removes first. If a different Bunsho account signs in on this vault, it sees none of that data and sends none of it; the data is kept, and returns when the first account signs back in. **Delete my Bunsho data** removes every account's data on this vault.
- **Writing into your notes.** The plugin changes a note only when you press **Keep**, and only by adding the scene. Nothing else in the plugin writes to your notes.
- **Uninstalling deletes your canon and scenes.** Obsidian removes the whole plugin folder when a plugin is uninstalled, and `canon.json`, the `scenes` folder, your findings and the World go with it, so any draft you have not kept goes too. Disabling the plugin keeps them. Copy `canon.json` and `scenes` somewhere safe first if you want to keep them. Scenes you have kept are in your notes and stay.
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
  pages/             what Obsidian mounts: ContinuityView (panel, with WorldPen and DirectorTab), SettingsTab, ConfirmCheckModal, ConfirmDeleteDataModal, JumpPickerModal
  organisms/         SignInPanel, ManuscriptHelp, FindingCard, FindingsList, ResolverPanel, JumpPicker, WorldList, CanonConflictCard, CanonEntityComposer, CanonFactComposer, CanonFactEdit, CanonEntityRename, DirectionBox, SceneCard, SceneDraft, DraftFoot, DirectorUpsell
  molecules/         BrandHeader, PanelFoot, TimelineRow, StatusRow, GroupHeader, Passage, AlertCard, EmptyState, SpectrumChips, SpectrumPill, CheckChapterControl, ChangedChaptersRow, CanonFactRow, CanonAliasRow, CanonAddControl, IdentityPrompt, CanonReadOnlyCard, CanonStartInvitation, SceneAnchorLine, SceneBeatRow, SceneNoteSlot, SceneRecordLine, SceneFailureLine, SceneOutOfCredits, SceneRow, CardShape
  atoms/             TextAction, FillButton, QuietButton, Fact, SeverityLabel, BunshoWordmark, GoogleSignInButton, PenField, PenArea
  controllers/       ContinuityController and DirectorController: state and actions (the "hooks" layer for a non-React app)
  types/             shared state and persisted-data types
  lib/obsidian/      Obsidian API glue: vault reading, secret storage, selecting a passage, what is kept in world.json, canon.json and scenes/, and Keep, the one write into a note
  lib/services/      engine access: auth (Google sign-in), engine (HTTP), review (WebSocket), director (HTTP), project (free plan)
  helpers/           Bunsho domain logic, pure: chapters, quote location, progress, one-project state, the review merge, passages, the account line, whose data this is, support, and canon/ (the desktop's pen, pins, vocabulary and ids, what a World card shows, how a canon finding reads) and director/ (the tracking a request carries, the desktop's scene transitions and view, where Keep places a scene)
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
