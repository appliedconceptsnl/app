# Zero Laser Calculator — archived

Removed from the live app on 18-09-2026 (last shipped as a working tab in v1.31).
Removed on request, not because of a bug — the goal was just to simplify the
active app. Nothing here was deleted for good; this folder is everything
needed to bring it back.

## What's here

- `panel-laser.html` — the full `<div id="panel-laser">` tab panel markup,
  exactly as it was in `index.html` (lines 157–267 at removal time), including
  the leading `<!-- LASER TAB -->` comment.
- `laser-logic.js` — every laser-specific JS symbol that was in `js/app.js`:
  `LASERS`, `LASER_DIST`, `initLaser()`, `MOUNTPOS_HINTS`,
  `updateMountPosHint()`, `updateZeroMethodHint()`, `getStateLaser()`,
  `renderLaser()`.

## How to restore

1. Paste the contents of `panel-laser.html` back into `index.html`, right
   before the `<!-- WAPENPROFIELEN TAB -->` comment (i.e. right after the
   Optic tab's closing `</div>`).
2. Add the nav button back to the tab bar in `index.html`:
   `<button class="tabbtn" data-tab="laser">Zero Laser Calculator</button>`
3. Paste the contents of `laser-logic.js` (skip the header comment) back into
   `js/app.js` — it originally lived right after the `OPTIC_PLATFORMS` block
   / right before `renderOptic()`'s "document.querySelectorAll('.tabbtn...'"
   wiring. Exact position doesn't matter much, as long as it's after the
   shared helpers it depends on (see below) are already defined.
4. In `switchTab()` in `js/app.js`, add back:
   `el('panel-laser').classList.toggle('active', tab==='laser');`
   and in the tab-dispatch chain: `else if(tab==='laser') renderLaser();`
5. In the bootstrap `try { ... }` block at the bottom of `js/app.js`, add
   back `initLaser();` and `renderLaser();` (they ran right after
   `initOptic();`).
6. Bump the version badge in `index.html` and the `CACHE` name in
   `service-worker.js`, and add a changelog entry — same as any other change
   in this app.

## Dependencies (still live in `js/app.js` — do not duplicate these)

The Laser Calculator was never a standalone module — it reused the same
print/preview engine as the Zero Optic Calculator:

`buildTargetSVG`, `offsetAxis`, `hobInches`, `applyAutoHOB`, `fitPreview`,
`refreshWorkDistOptions`, `refreshClickOptions`, `requestPrint`,
`populateSelect`, `fmtLen`, `el`, `PAGE_DIMS`, `SIGHTS`, `MOUNTS`, `CLICKS`,
`CM_IN`.

If any of these have changed shape since 18-09-2026 (e.g. `buildTargetSVG`'s
`cfg` contract, or the `refreshWorkDistOptions` fix from v1.30 that filters
the controle-afstand `<select>`), re-check `getStateLaser()` /
`initLaser()` against the current version of those functions before
restoring — don't assume they're still 1:1 compatible.

No CSS is archived here: the Laser tab never had its own stylesheet rules,
it fully reused the generic `.app`/`.controls`/`.preview`/`.row2`/etc. classes
that the Optic tab still uses.
