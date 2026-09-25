# Health check

Automatische controle van de Applied Concepts-app: één Playwright-script
tegen de live site + de volledige app lokaal, plus een GitHub Actions-
workflow die het dagelijks/na elke deploy draait en bij problemen een issue
aanmaakt.

## Wat wordt gecheckt

**Sectie A — live (`https://appliedconceptsnl.github.io/app/`, door de echte
pass phrase-gate heen, niet ingelogd):**
- HTTP 200 via HTTPS + laadtijd
- Logo/achtergrond/CSS/JS/fonts laden zonder 404
- Het pass phrase-scherm verschijnt correct, geen console-fouten
- Live masthead-versie vs. dezelfde string in de lokaal uitgecheckte
  `index.html` (zie "Waarom geen build-hash" hieronder)

**Sectie B — de volledige app (lokaal via `dev-server.py`, testmodus aan —
zie hieronder):**
- Geen console-/netwerkfouten op alle 7 tabbladen
- HOB-data-integriteit: elk richtmiddel/elke montage in `SIGHTS`/`MOUNTS`
  (`js/app.js`) heeft een unieke id, een niet-lege label, en een HOB die
  ofwel `null` is (handmatig in te vullen) of een realistisch getal
  (1"–8"). Numerieke HOB zonder bronvermelding (`src`) is een aparte,
  lichte waarschuwing.
- Alle richtmiddel×montage-combinaties (10×9 = 90 stuks) geven een geldige
  offset-berekening; alle 4 wapenplatformen geven een geldige
  kogelbaan-berekening (of terecht `null`, zie code-comment in
  `lib/appChecks.js`)
- Standaardeenheden bij openen: metrisch (cm), klikken op MIL
- Printuitvoer (Zero Optic Calculator op A4 én Letter, Turret Tape, Train):
  de SVG heeft exact de juiste papierafmeting, en niets valt buiten het vel
  (via `getBBox()` van de hele schijf — kan nooit kleiner zijn dan de
  paginavullende achtergrond, dus dit vangt alleen echte overflow)
- Responsive op 375/768/1280px: geen horizontale scroll, screenshots naar
  `artifacts/`
- Changelog-paneel opent, en de masthead-versie komt overeen met de
  nieuwste changelog-regel
- Links (op dit moment alleen het mailto-adres in Contact — WhatsApp-links
  worden dynamisch in JS gebouwd en met opzet NIET aangeklikt, dat zou een
  echt bericht versturen)
- Geen restant van de gearchiveerde Zero Laser Calculator in de tabbar

**Alles wat HOB-data, berekeningen of printschaal raakt is altijd ernst
"hoog"**, ongeacht of het een `warn` of `fail` is.

## Testmodus (alleen lokaal)

`js/app.js` slaat de pass phrase-gate over zodra `location.hostname` exact
`localhost` of `127.0.0.1` is — zie de comment daar voor waarom dit op de
live site (een ander hostname) structureel onbereikbaar is. Er is geen
query-parameter, cookie of localStorage-vlag die dit ergens anders
activeert.

## Waarom geen build-hash voor "live = laatste commit"

Er is geen build-stap (GitHub Pages deployt hier direct vanuit de branch),
dus geen plek om een commit-SHA in te bakken. De lichte oplossing: de
CI-job heeft de repo toch al lokaal uitgecheckt, dus sectie A vergelijkt de
`#versionLink`-tekst van de live pagina met dezelfde string in het lokale
`index.html`. Een verschil is een `warn`, geen `fail` — CDN-vertraging na
een deploy is normaal en lost zichzelf op bij de volgende run.

## Zelf draaien

```bash
cd healthcheck
npm install
npx playwright install --with-deps chromium   # eenmalig
npm test
```

Schrijft `healthcheck/report.json` en screenshots naar
`healthcheck/artifacts/`. Exitcode 1 bij minstens één `fail`, anders 0 (ook
als er alleen `warn`s zijn — zie hieronder waarom dat losstaat van of de
GitHub Actions-run zelf "rood" wordt).

## De workflow

`.github/workflows/healthcheck.yml`, drie jobs:

1. **`check`** — draait altijd (schedule 06:00 NL-tijd, na elke succesvolle
   Pages-deploy, of handmatig via "Run workflow"). Kost geen Claude-gebruik.
   Upload't `report.json` + screenshots als artifact.
2. **`analyze`** — alleen als er minstens één `warn` of `fail` in het
   rapport staat. Claude leest het rapport en de code, en maakt één issue
   aan met het label `healthcheck` (of comment't op een al bestaand open
   healthcheck-issue — nooit duplicaten). Mag uitsluitend issues
   lezen/aanmaken/bijwerken: dat wordt zowel via de workflow-permissions
   (`contents: read`, `issues: write` — geen `pull-requests`/`contents:
   write`) als via `--allowedTools` in `claude_args` afgedwongen.
3. **`resolve`** — alleen als alles `ok` is. Puur `gh`-CLI, geen Claude:
   sluit een eventueel open healthcheck-issue met een commentaar dat naar
   de run linkt.

### Benodigd secret

Precies één van de twee:
- `ANTHROPIC_API_KEY` — een Anthropic API-key, of
- `CLAUDE_CODE_OAUTH_TOKEN` — voor Claude Pro/Max-accounts, lokaal te
  genereren met `claude setup-token`.

De eenvoudigste weg voor beide: draai `/install-github-app` in Claude Code
op je eigen machine — dat installeert de officiële Claude GitHub App op
deze repo én zet de secret voor je klaar.

Het label `healthcheck` hoef je niet zelf aan te maken — de workflow
(job `analyze`) maakt het aan als het nog niet bestaat.

## Checks toevoegen

- Live-check (tegen de publieke URL): `lib/liveChecks.js`
- App-check (lokaal, testmodus): `lib/appChecks.js`, een nieuwe
  `async function checkX(page, report) { ... }`, aangeroepen vanuit
  `runAppChecks()` onderaan hetzelfde bestand
- Gebruik `report.ok(id, details, file?)` / `report.warn(id, severity,
  details, file?)` / `report.fail(...)` — zie `lib/report.js` voor de
  exacte signatuur
- Severity is altijd `'hoog' | 'midden' | 'laag'`; gebruik `'hoog'` voor
  alles dat HOB-data, berekeningen of printschaal raakt
