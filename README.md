# Alcove by hicya: browser extension

The source of the [Alcove](https://alcove.hicya.org) extension for Chrome, Edge and Firefox. It
saves the article you're reading to Alcove, so you can read it later on any device.

This code is public so you can check what the extension does. It is **source-available, not open
source**: see [LICENSE](LICENSE). Each release here matches a version published in the stores.

## What it does and doesn't do

- **Reads a page only when you ask.** It has no content scripts and no access to all sites. It
  reads the current tab only after you click the toolbar button, press Alt+Shift+S, or pick
  "Save page/link to Alcove" from the right-click menu (the browser's `activeTab` permission).
- **Talks only to Alcove's own servers**, `auth.hicya.org` (sign-in) and `sync.hicya.org` (saving),
  plus anonymous usage counts in Chrome and Edge (below).
- **Encrypts what you save.** Each article is sealed on your device to your account's inbox key
  before it's uploaded, so the server stores it encrypted (`packages/sync/src/crypto/inbox.ts`).
- **Usage counts:** the Chrome and Edge store builds send a few anonymous events (an article was
  saved, a save failed and why, sign-in) to Google Analytics, without any URL, title or text
  (`apps/alcove-extension/lib/analytics.ts`). The Firefox build sends none. Builds you make from
  this repository send none.

## Layout

- `apps/alcove-extension/`: the extension (WXT, Manifest V3). `entrypoints/` holds the background
  worker, the injected capture script and the options page; `lib/` holds the logic and its tests.
- `packages/`: the parts of hicya's shared code the extension uses (sign-in helpers, sync
  encryption, analytics events, the hicya wordmark). Only the files it imports are included.

## Build it yourself

Requirements: Node.js 24 and pnpm 10 (through Corepack).

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build            # Chrome and Edge → apps/alcove-extension/.output/chrome-mv3/
pnpm build:firefox    # Firefox → apps/alcove-extension/.output/firefox-mv3/
pnpm test
```

The Firefox build matches the published add-on. The Chrome and Edge builds match the store
versions except for the analytics key, which is added only to store releases.

## Issues and contributions

Bug reports and security reports are welcome as GitHub issues. For anything private, write to
hi@hicya.org. Pull requests aren't accepted.
