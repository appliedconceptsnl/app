# Applied Concepts — Zero Calculator (installeerbare app)

Dit is de app als "PWA" (progressive web app): eenmaal ergens online gezet,
kan iedereen 'm openen in de browser en met één tik toevoegen aan het
beginscherm van telefoon, tablet of laptop — met eigen icoon, eigen naam,
en zonder adresbalk (voelt als een normale app).

## Inhoud van deze map
- `index.html` — de pagina-structuur van de app
- `css/styles.css` — de opmaak/stijl
- `js/app.js` — de rekenlogica en interactie
- `manifest.json` — vertelt de browser hoe de app heet en welk icoon te gebruiken
- `service-worker.js` — zorgt dat de app ook offline blijft werken na de eerste keer
- `icons/` — het Applied Concepts-icoon en logo in de juiste formaten
- `assets/` — overige media (achtergrondafbeelding)

**Belangrijk:** deze map moet als geheel (met dezelfde bestandsnamen en
mapstructuur) online komen te staan. Alleen `index.html` los delen werkt
niet meer voor de "toevoegen aan beginscherm"-functie.

## Stap 1 — ergens online zetten
Elke gewone webhosting werkt, bijvoorbeeld ook een bestaande
Applied Concepts-website/server. Geen eigen server? Gratis en simpel via
**GitHub Pages**:

1. Maak een gratis account op github.com (indien nog niet aanwezig).
2. Maak een nieuwe (public) repository, bijvoorbeeld `zero-calculator`.
3. Upload de complete inhoud van deze map (dus `index.html`,
   `manifest.json`, `service-worker.js` en de map `icons/` met alle
   bestanden erin) naar die repository.
4. Ga naar **Settings → Pages** in die repository, zet "Source" op de
   branch waar je net naar hebt geüpload (meestal `main`), map `/ (root)`.
5. Na ongeveer een minuut staat de app live op een adres als:
   `https://<jouw-gebruikersnaam>.github.io/zero-calculator/`

Dat is de link die je met iedereen deelt.

## Stap 2 — installeren op een telefoon/laptop
Stuur onderstaande stukje door aan collega's, of installeer 'm zelf:

**iPhone / iPad (Safari):**
1. Open de link.
2. Tik op het deel-icoon (vierkantje met pijl omhoog) onderin.
3. Kies "Zet op beginscherm" ("Add to Home Screen").
4. Het Applied Concepts-icoon verschijnt nu op het beginscherm.

**Android (Chrome):**
1. Open de link.
2. Tik op de drie puntjes rechtsboven.
3. Kies "App installeren" of "Toevoegen aan startscherm".

**Windows/Mac (Chrome, Edge):**
1. Open de link.
2. Klik op het installatie-icoontje rechts in de adresbalk (of via het
   menu: "App installeren").

Elke keer dat de app wordt geopend, wordt nog steeds om de pass phrase
gevraagd — dat gedrag verandert niet door de installatie.

## Updaten
Werk je de app later bij? Vervang gewoon `index.html` (en eventueel
`icons/`) in dezelfde hosting-map. Iedereen die de app al op zijn
beginscherm heeft, krijgt de nieuwe versie automatisch de eerstvolgende
keer dat hij de app opent met internetverbinding.
