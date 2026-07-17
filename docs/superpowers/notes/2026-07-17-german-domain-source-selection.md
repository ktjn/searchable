# German domain source selection for relevance corpus

Date: 2026-07-17
Task: Task 1 of `docs/superpowers/plans/2026-07-17-relevance-domain-german.md`

## Candidates checked and rejected

All three candidates named in the task brief were re-verified live and rejected. In every case the site's actual legal-notice page either withholds an open license from narrative text (reserving it for datasets only) or forbids the kind of modification/extraction this project's normalization pipeline performs.

### 1. Kraftfahrt-Bundesamt (KBA), `www.kba.de` — rejected

- Fetched `https://www.kba.de/DE/Service/Hinweise/Datenlizenz/datenlizenz_deutschland_inhalt.html`: confirms `Datenlizenz Deutschland – Namensnennung – Version 2.0` (dl-de/by-2-0), but the license text itself scopes to *"Daten und Statistiken des Kraftfahrt-Bundesamtes"* (data and statistics) — not general page prose.
- Fetched `https://www.kba.de/DE/Service/Hinweise/urheberrechtliche_inhalt.html` (the site's general copyright notice): *"Die Vervielfältigung und Verbreitung dieser Veröffentlichung, auch auszugsweise und in digitalisierter Form, ist nur mit Quellenangabe gestattet."* This is a standard rights-reserved notice (reproduction/distribution permitted with attribution, but no explicit permission to modify/adapt), and it also reserves the right to prohibit inbound links. The narrative help/FAQ pages on kba.de are **not** covered by the open dataset license — confirms the brief's own caution.
- **Verdict:** disqualified on license scope (Step 1 fails).

### 2. GovData, `www.govdata.de` — rejected

- Fetched `https://www.govdata.de/nutzungsbestimmungen`: *"Icons, Bilder ... und Texte des Herausgebers stehen unter der Lizenz Creative Commons Namensnennung 3.0 Deutschland (CC BY 3.0)"* — this **does** cover the publisher's own site text (a genuine pass on Step 1, unlike KBA).
- However, Step 2 (content depth) fails: the site's own informational section (`/informationen/...`) has only ~9 real pages (Open Government, Open Government Data, Datenlizenzen, FAQ, Hochwertige Datensätze, Das Portal/Hilfe, Metadaten-Struktur, OGD-DACHLI, Datenbereitstellung), several of which are thin (the `/informationen/hilfe` page's substantive prose is a single ~150-200 word overview paragraph followed mostly by links and structural elements). The FAQ page (`/faq`) has ~35-40 Q&A entries but they live as anchors on one single page, not 20-30 distinct narrative documents, and much of the FAQ content itself is about *dataset* licensing (not a coherent non-license topic).
- **Verdict:** disqualified on content depth (Step 2 fails) — confirmed the brief's prediction that GovData's narrative content is too thin.

### 3. `bund.de` / `service.bund.de` citizen portal — not pursued further

`https://www.bund.de/DE/Startseite/startseite_node.html` redirects to `verwaltung.bund.de`, a Bundesverwaltungsamt-run federal administration portal. Given the pattern found across every other German federal site checked (KBA, GovData, Destatis, gesund.bund.de, infektionsschutz.de — see below), and that the brief itself flagged this candidate as "many German public sites default to all-rights-reserved copyright with no reuse license," this was deprioritized in favor of directly searching for a better-fitting source once the pattern became clear.

## Additional public-sector candidates checked (own research, all rejected)

Because none of the three brief candidates passed both checks, the following were also verified live before giving up on the "government/public-sector" category (which the design spec calls "preferred," not mandatory — `docs/superpowers/specs/2026-07-17-relevance-evidence-expansion-design.md` line 59-60):

- **Statistisches Bundesamt / Destatis** (`www.destatis.de`): Impressum states a general copyright notice covering *"Standard-Veröffentlichungen ... sowie ... die Inhalte auf unserer Website www.destatis.de"* permitting reproduction/distribution with source attribution (`mit Quellennachweis gestattet`) — but, like KBA, contains no explicit grant of a right to modify/adapt/reformat the text, only to reproduce and distribute it. Too ambiguous to rely on for a normalized/reformatted snapshot corpus. Rejected.
- **Umweltbundesamt** (`www.umweltbundesamt.de`): German legal-notice page (`/datenschutz-haftung-urheberrecht`) explicitly states self-created *"Texte"* (texts) are under **CC BY-NC-ND 4.0** (`Creative Commons Namensnennung – Nicht kommerziell – keine Bearbeitungen 4.0`). This is the clearest license-to-text statement of any German government site found, but the **ND (no derivatives)** clause forbids exactly the kind of extraction/reformatting this project's normalization pipeline does, and **NC** conflicts with this repository's own MIT-licensed, potentially-commercial reuse. Rejected — not "open/reusable" in the sense required.
- **gesund.bund.de** (National Health Portal, BMG): Impressum permits quotation only if reproduced *"unverändert und vollständig"* (unchanged and complete) with source attribution, and states *"Im Übrigen bleiben alle Rechte vorbehalten"* (all other rights reserved). Explicitly forbids modification. Rejected.
- **infektionsschutz.de** (BZgA / Bundesinstitut für Risikobewertung public-health hygiene site): its Verwendungshinweise page grants CC BY-SA 4.0 only to specifically marked media-library graphics/downloads; the page explicitly states *"Alle Texte, Fotos und Filme der Website ... sind ... von den CC-Regeln ausdrücklich ausgenommen"* (all texts are explicitly excluded from the CC rules). Rejected despite excellent topical depth (~40 pathogen profile pages plus hygiene/vaccination sections).
- **BERUFENET / Bundesagentur für Arbeit**: Nutzungsbedingungen state the agency holds exclusive rights, reuse is restricted to unmodified career-guidance use, and resale/editing is explicitly prohibited. Rejected outright.

Common pattern found across essentially every German federal site checked: `Datenlizenz Deutschland` and CC-style statements are almost always scoped to **open datasets/statistics**, while ordinary narrative/help/FAQ page text remains under standard rights-reserved copyright, or (at best, Umweltbundesamt) under a No-Derivatives license that forbids the reformatting a snapshot corpus requires.

## Chosen source: German Wikipedia, "Fahrerlaubnisrecht (Deutschland)" category

Given the above, and per the task's explicit fallback instruction ("if none of the three work, search for a better one — the requirement is a real public German-language site with an explicit, verifiable open/reusable content license and enough narrative page depth"), the chosen source is the German-language Wikipedia (`de.wikipedia.org`), specifically its authoritative category of articles on German driving-license law, `Kategorie:Fahrerlaubnisrecht (Deutschland)`. This preserves the thematic parallel to the existing `govuk-learn-to-drive` suite (driving-licence domain) that made KBA attractive in the first place, while using a source whose license is unambiguous and indisputably permits the modification/reformatting this project's normalization step performs. German Wikipedia is also already a precedented content source in this repository (see `packages/relevance/fixtures/de.json` and `packages/relevance/fixtures/NOTICE.md`), so its license-handling pattern is already established and low-risk; this task applies that same pattern to a new, larger, topically-coherent domain corpus rather than the existing small per-language quiz fixture.

### License verification

- **License name and version:** Creative Commons Attribution-ShareAlike 4.0 International ("Creative-Commons-Lizenz Namensnennung – Weitergabe unter gleichen Bedingungen 4.0", CC BY-SA 4.0).
- **Fetched:** `https://de.wikipedia.org/wiki/Wikipedia:Lizenzbestimmungen` — confirms this is the license under which article text is made available, that commercial use is permitted, and that derivative works are permitted provided they are shared under the same license terms ("Weitergabe unter gleichen Bedingungen").
- **Scope:** applies to the narrative text content of articles themselves (this is the standard license under which all German Wikipedia article prose is published, not a dataset-only license). Confirmed article narrative depth directly by fetching three sample pages (see below).
- **License URL:** `https://creativecommons.org/licenses/by-sa/4.0/` (German deed: `https://creativecommons.org/licenses/by-sa/4.0/deed.de`).
- **Attribution:** Following this repository's existing convention for Wikipedia content (`packages/relevance/fixtures/de.json` `provenance.attribution`, and `packages/relevance/fixtures/NOTICE.md`), the attribution string is:
  `"Wikipedia-Autoren; die Versionsgeschichte ist über die jeweilige Quellseite verfügbar."` (Wikipedia contributors; the edit history is available via each source page.)
- **Retrieval date:** 2026-07-17.

### Content depth verification

- Fetched `https://de.wikipedia.org/wiki/Kategorie:Fahrerlaubnisrecht_(Deutschland)` directly: this is Wikipedia's own authoritative category listing of German driving-license-law articles, containing 41 article titles.
- Spot-checked narrative depth on three representative pages by fetching them directly:
  - `https://de.wikipedia.org/wiki/F%C3%BChrerschein` — multi-section article (history, per-country rules, minimum age, driving without a license, license withdrawal, international license) with substantial prose in every section.
  - `https://de.wikipedia.org/wiki/F%C3%BChrerschein_und_Fahrerlaubnis_(Deutschland)` — 10 sections (national license classes, special national rules, historical license classes, transition rules, central register, test-pass statistics, photo requirements, international license) with extensive explanatory paragraphs, not stubs.
  - `https://de.wikipedia.org/wiki/Medizinisch-Psychologische_Untersuchung` — 9 sections covering the concept, purpose, procedure, criticism, reform, and public reception of Germany's medical-psychological fitness-to-drive exam ("MPU"/"Idiotentest"), with extensive cited prose.
- Based on this sampling and Wikipedia's general article-quality norms for a well-maintained legal-topic category, the corpus is expected to have real narrative/explanatory content throughout, not just infoboxes or tables. (Task 3 will do a final per-page check while normalizing; if 1-2 of the 28 selected titles below turn out to be thin stubs, they can be swapped for another title from the same category without affecting this decision.)

### Rationale (why this is a good, distinct German-language domain)

This corpus is German-language (distinct from the existing English `searchable-docs` and `govuk-learn-to-drive` suites), sourced from a completely different site/genre (a crowd-authored reference encyclopedia rather than either this project's own docs or an official government content-management journey), and covers a legally/procedurally dense domain — German driving-license law and procedure — that gives natural task-oriented query material (license classes, the MPU/"Idiotentest" fitness exam, probationary periods, fines and points, driving without a license, cannabis and alcohol limits, international license recognition) distinct in shape from both the existing English docs corpus (developer/product documentation) and the GOV.UK corpus (an official step-by-step government journey with CTAs and cost figures). It also retains a loose thematic echo of the original KBA idea (driving-license domain) for future cross-suite comparison, without relying on a site whose license turned out not to actually cover narrative text.

## Full page list (28 pages)

All URLs use the `https://de.wikipedia.org/wiki/<Title>` pattern (MediaWiki canonical article path, spaces replaced with underscores). Document `id` in the eventual fixture should be the `/wiki/<Title>` path.

| # | Article title | Path (document `id`) |
|---|---|---|
| 1 | Führerschein | `/wiki/Führerschein` |
| 2 | Führerschein und Fahrerlaubnis (Deutschland) | `/wiki/Führerschein_und_Fahrerlaubnis_(Deutschland)` |
| 3 | Fahrerlaubnis-Verordnung | `/wiki/Fahrerlaubnis-Verordnung` |
| 4 | Fahrerlaubnisbehörde | `/wiki/Fahrerlaubnisbehörde` |
| 5 | Fahreignungsregister | `/wiki/Fahreignungsregister` |
| 6 | Fahreignungsseminar | `/wiki/Fahreignungsseminar` |
| 7 | Fahren ohne Fahrerlaubnis | `/wiki/Fahren_ohne_Fahrerlaubnis` |
| 8 | Fahren ohne Führerschein | `/wiki/Fahren_ohne_Führerschein` |
| 9 | Fahrverbot (Deutschland) | `/wiki/Fahrverbot_(Deutschland)` |
| 10 | Regelfahrverbot | `/wiki/Regelfahrverbot` |
| 11 | Sperrfrist (Fahrerlaubnis) | `/wiki/Sperrfrist_(Fahrerlaubnis)` |
| 12 | Medizinisch-Psychologische Untersuchung | `/wiki/Medizinisch-Psychologische_Untersuchung` |
| 13 | MPU-Vorbereitung | `/wiki/MPU-Vorbereitung` |
| 14 | Fahrtauglichkeitsuntersuchung | `/wiki/Fahrtauglichkeitsuntersuchung` |
| 15 | Beurteilungskriterien in der Fahreignungsbegutachtung | `/wiki/Beurteilungskriterien_in_der_Fahreignungsbegutachtung` |
| 16 | Begutachtungsstelle für Fahreignung | `/wiki/Begutachtungsstelle_für_Fahreignung` |
| 17 | Begleitetes Fahren | `/wiki/Begleitetes_Fahren` |
| 18 | Führerschein ab 17 | `/wiki/Führerschein_ab_17` |
| 19 | Führerschein ab 16 | `/wiki/Führerschein_ab_16` |
| 20 | Aufbauseminar für Fahranfänger | `/wiki/Aufbauseminar_für_Fahranfänger` |
| 21 | Aufbauseminar für punkteauffällige Kraftfahrer | `/wiki/Aufbauseminar_für_punkteauffällige_Kraftfahrer` |
| 22 | Fortbildungsseminar für Fahranfänger | `/wiki/Fortbildungsseminar_für_Fahranfänger` |
| 23 | Besondere Ausbildungsfahrt | `/wiki/Besondere_Ausbildungsfahrt` |
| 24 | Cannabisgesetz | `/wiki/Cannabisgesetz` |
| 25 | Fragenkatalog der theoretischen Fahrerlaubnisprüfung | `/wiki/Fragenkatalog_der_theoretischen_Fahrerlaubnisprüfung` |
| 26 | Mofa-Prüfbescheinigung | `/wiki/Mofa-Prüfbescheinigung` |
| 27 | Zentrales Fahrerlaubnisregister | `/wiki/Zentrales_Fahrerlaubnisregister` |
| 28 | §-70-Kurs | `/wiki/§-70-Kurs` |

Articles 1-2 were fetched and confirmed directly. Articles 3-28 (except 12, also fetched directly) come from Wikipedia's own `Kategorie:Fahrerlaubnisrecht (Deutschland)` listing (fetched `https://de.wikipedia.org/wiki/Kategorie:Fahrerlaubnisrecht_(Deutschland)`, which returned 41 titles; the 4 shortest-looking pure-amendment-ordinance stubs — "Zweite/Dritte/Vierte Verordnung über Ausnahmen von den Vorschriften der Fahrerlaubnis-Verordnung" — and a couple of narrow/ambiguous titles were excluded in favor of the more clearly narrative entries above) — so their existence as real article titles is authoritative, though their individual narrative depth should get a final human/normalization-time check in Task 3, per the note above.

## Open items / concerns for later tasks

- **Task 3 spot-check:** while 3 of the 28 titles were directly fetched and confirmed to have substantial narrative prose, the remaining 25 were selected from Wikipedia's own category listing but not all individually fetched for length in this task. If normalization in Task 3 finds any of them to be short stubs, swap in a replacement from the same `Kategorie:Fahrerlaubnisrecht (Deutschland)` list (13 unused titles remain as a buffer) rather than lowering the 20-page minimum.
- **Suite id suggestion (Task 2's decision, not binding):** something like `de-fahrerlaubnisrecht` or `de-wikipedia-fahrerlaubnis` would be a reasonable short kebab-case id.
- **Topic list suggestion (Task 2's decision, not binding):** candidate topics for `DOMAIN_QUERY_TOPICS` derived from the page list: license classes and eligibility (`fuehrerscheinklassen`), the MPU/fitness-to-drive process (`mpu-fahreignung`), fines/points/license withdrawal (`fahrverbot-punkte`), learner/probationary rules (`fahranfaenger-probezeit`), and special permits/courses (`sonderregelungen-kurse`).
