# Applied Concepts — analytics Worker

Een kleine, gratis Cloudflare Worker + D1-database die bijhoudt hoeveel
unieke bezoekers de app per dag heeft en hoe vaak elk tabblad bekeken wordt.
Geen cookies, geen externe tracking-dienst, geen opgeslagen IP's — zie de
comments in `src/index.js` voor precies wat er wel/niet wordt bewaard.

Elke ochtend zet de GitHub Action `.github/workflows/analytics-digest.yml`
de cijfers van de vorige dag in een nieuw issue (label `analytics`).

## Eenmalig opzetten

Je hebt een gratis account op [cloudflare.com](https://cloudflare.com) nodig,
en Node.js + `npx` (heb je al, voor de andere onderdelen van deze repo).

```bash
cd analytics-worker
npx wrangler login          # opent een browserscherm om in te loggen
npx wrangler d1 create ac_analytics
```

Dat laatste commando geeft een `database_id` terug — zet die in
`wrangler.toml` op de plek van `REPLACE_AFTER_WRANGLER_D1_CREATE`.

Zet daarna het schema klaar en genereer de twee geheimen die de Worker zelf
gebruikt:

```bash
npx wrangler d1 execute ac_analytics --remote --file=schema.sql

# HASH_SALT: een willekeurige string, gebruikt om bezoeker-hashes te maken.
# REPORT_SECRET: het wachtwoord waarmee de dagelijkse GitHub Action het
# /report-endpoint mag uitlezen.
npx wrangler secret put HASH_SALT
npx wrangler secret put REPORT_SECRET

npx wrangler deploy
```

`wrangler deploy` print de URL van de Worker, iets als
`https://ac-analytics.<jouw-subdomein>.workers.dev`. Die heb je voor twee
dingen nodig:

1. **In de app zelf** (`js/app.js`, `AC_ANALYTICS_URL`): moet eindigen op
   `/track`, bijvoorbeeld `https://ac-analytics.<subdomein>.workers.dev/track`.
2. **Als GitHub Actions-secret** `ANALYTICS_REPORT_URL`, met `/report` erachter
   (bijv. `https://ac-analytics.<subdomein>.workers.dev/report`), plus
   `ANALYTICS_REPORT_SECRET` met dezelfde waarde als `REPORT_SECRET` hierboven.

Ga naar **Settings → Secrets and variables → Actions** op GitHub en voeg
`ANALYTICS_REPORT_URL` en `ANALYTICS_REPORT_SECRET` toe.

## Zelf testen

```bash
curl -X POST https://ac-analytics.<subdomein>.workers.dev/track \
  -H "Content-Type: application/json" \
  -d '{"event":"pageview"}'

curl -H "Authorization: Bearer <REPORT_SECRET>" \
  "https://ac-analytics.<subdomein>.workers.dev/report?date=$(date -u +%Y-%m-%d)"
```

## Later wijzigen

Iets aan `src/index.js` of `schema.sql` aangepast? `npx wrangler deploy`
(en voor een schemawijziging opnieuw `wrangler d1 execute ... --file=schema.sql`)
volstaat — geen doorlooptijd zoals bij GitHub Pages.
