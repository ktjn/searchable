/**
 * Real, hand-written prose paragraphs (not lorem-ipsum, not templated
 * word-substitution) banked per topic/language, so the generated
 * corpus (generate.ts) has genuinely searchable, grammatically real
 * content instead of noise that happens to have the right byte count.
 * Documents are built by combining a deterministic subset of these
 * paragraphs (see generate.ts) rather than each paragraph mapping 1:1
 * to one document, which is what lets a small hand-written bank
 * produce a much larger, still-non-repetitive corpus.
 */

export interface Topic {
  category: string;
  tags: string[];
  en: string[];
  de: string[];
}

export const TOPICS: Topic[] = [
  {
    category: "Engineering",
    tags: ["architecture", "performance", "testing"],
    en: [
      "Our search index is built offline and shipped as static JSON files, which means there is no database to provision and no query server to keep warm. The tradeoff is that every ranking decision has to be made ahead of time, baked into the shard a browser will later fetch.",
      "We spent a full sprint profiling shard fetch sizes against corpus size before committing to prefix-based sharding. Below a few thousand documents, a single unsharded term file is simpler and just as fast, so we only split shards once the fetch size actually justifies it.",
      "Regression tests catch more than unit tests ever will, because a scoring bug rarely breaks a single assertion — it quietly reorders results across dozens of queries at once. A snapshot of known queries against known result sets turns that into a reviewable diff instead of a support ticket.",
      "Every field boost, every stemming rule, every synonym mapping is a decision that changes ranking for someone. We try to make each of those decisions overridable per query rather than baked permanently into the build, so a team can experiment without reindexing.",
      "Tokenization has to run identically at index time and at query time, or matching silently breaks with no error thrown anywhere. We test this by running the exact same analysis pipeline against golden fixtures from both the indexer and the runtime client.",
      "A Web Worker keeps search execution off the main thread, so scrolling and typing stay smooth even while a large result set is being scored. The tradeoff is a small amount of message-passing overhead, which turns out to be negligible next to the responsiveness it buys back.",
      "Content-hashed shard filenames mean a browser can cache every shard forever and only refetch the ones that actually changed since the last publish. A one-line manifest points at the current set of hashes, so cache invalidation becomes a single small file to refetch, not a cache-busting query string on everything.",
      "We benchmark against synthetic corpora at several sizes, not just the small fixture we use for correctness tests, because a query that feels instant at a thousand documents can behave very differently at a hundred thousand.",
    ],
    de: [
      "Unser Suchindex wird offline erstellt und als statische JSON-Dateien ausgeliefert, sodass keine Datenbank bereitgestellt und kein Abfrageserver dauerhaft betrieben werden muss. Der Kompromiss besteht darin, dass jede Rangfolge-Entscheidung im Voraus getroffen werden muss.",
      "Wir haben einen ganzen Sprint damit verbracht, die Shard-Größen im Verhältnis zur Korpusgröße zu untersuchen, bevor wir uns für Präfix-basiertes Sharding entschieden haben. Unterhalb weniger tausend Dokumente ist eine einzelne, nicht aufgeteilte Termdatei einfacher und ebenso schnell.",
      "Regressionstests entdecken mehr als Unit-Tests jemals könnten, denn ein Fehler in der Bewertung bricht selten nur eine einzelne Prüfung — er ordnet still und leise die Ergebnisse vieler Abfragen gleichzeitig neu.",
      "Jede Feldgewichtung, jede Stammform-Regel, jede Synonymzuordnung ist eine Entscheidung, die für jemanden die Rangfolge verändert. Wir versuchen, jede dieser Entscheidungen pro Abfrage überschreibbar zu machen, statt sie dauerhaft in den Build einzubacken.",
      "Die Tokenisierung muss beim Indizieren und bei der Abfrage identisch ablaufen, sonst bricht das Matching lautlos, ohne dass irgendwo ein Fehler geworfen wird. Wir testen dies, indem wir dieselbe Analyse-Pipeline gegen goldene Referenzdaten laufen lassen.",
      "Ein Web Worker hält die Suchausführung vom Hauptthread fern, sodass Scrollen und Tippen auch bei einer großen Ergebnismenge flüssig bleiben. Der Kompromiss ist ein kleiner Mehraufwand durch Nachrichtenübermittlung, der sich als vernachlässigbar erweist.",
      "Inhaltsbasierte Shard-Dateinamen bedeuten, dass ein Browser jeden Shard für immer zwischenspeichern kann und nur die Shards erneut abruft, die sich seit der letzten Veröffentlichung tatsächlich geändert haben.",
      "Wir vergleichen die Leistung anhand synthetischer Korpora in mehreren Größenordnungen, nicht nur anhand der kleinen Fixtur, die wir für Korrektheitstests verwenden, denn eine Abfrage, die sich bei tausend Dokumenten sofort anfühlt, kann sich bei hunderttausend ganz anders verhalten.",
    ],
  },
  {
    category: "Product",
    tags: ["facets", "boosts", "pinning"],
    en: [
      "Faceted filtering lets a visitor narrow results by category, price range, or tag without typing a more specific query. Counts next to each facet value update contextually, so it is always clear how many results a given combination of filters would actually return.",
      "Field boosts let a title match count for more than a body match, since a page whose title literally contains the query term is usually a better answer than one that only mentions it in passing. The default weighting works well out of the box but is always overridable per query.",
      'Term-to-page pinning guarantees that a high-intent query like "pricing" or "contact" always surfaces the right page, regardless of how normal relevance ranking would have ordered things. An editor sets this once, in the page itself, with no separate configuration file to maintain.',
      "A document boost is a flat multiplier applied after ranking, useful for promoting a featured product or a recently published article without having to touch the underlying scoring formula at all.",
      "Typo tolerance means a visitor who mistypes a single letter still finds what they were looking for, with the literal match still outranking the typo-corrected one so the mechanism never surprises anyone by hiding the exact result they typed.",
      'When a query returns nothing at all, a "did you mean" suggestion reuses the same typo-tolerance dictionary already built for matching, so there is no separate suggestion index to maintain and keep in sync.',
      "Synonym expansion lets a search for one word also find pages that only use a different, equivalent word — useful when customers and the content team simply use different vocabulary for the same thing.",
      "Every one of these features is optional and can be turned on per query, so a simple search box can stay simple while a full commerce catalog can enable the whole feature set without forking the underlying engine.",
    ],
    de: [
      "Facettierte Filterung ermöglicht es Besuchern, Ergebnisse nach Kategorie, Preisspanne oder Schlagwort einzugrenzen, ohne eine spezifischere Anfrage einzugeben. Die Anzahl neben jedem Facettenwert wird kontextbezogen aktualisiert.",
      "Feldgewichtungen lassen einen Titeltreffer stärker zählen als einen Volltexttreffer, denn eine Seite, deren Titel den Suchbegriff enthält, ist meist eine bessere Antwort als eine, die ihn nur beiläufig erwähnt.",
      'Die Verknüpfung von Suchbegriffen mit bestimmten Seiten stellt sicher, dass eine Anfrage wie "Preise" oder "Kontakt" immer die richtige Seite anzeigt, unabhängig davon, wie die normale Relevanzbewertung sie eingeordnet hätte.',
      "Eine Dokumentengewichtung ist ein fester Multiplikator, der nach der Bewertung angewendet wird, nützlich um ein hervorgehobenes Produkt oder einen kürzlich veröffentlichten Artikel zu bewerben.",
      "Tippfehlertoleranz bedeutet, dass ein Besucher, der einen einzelnen Buchstaben falsch eingibt, trotzdem findet, wonach er gesucht hat, wobei der exakte Treffer immer Vorrang vor dem korrigierten Treffer behält.",
      'Wenn eine Anfrage überhaupt keine Ergebnisse liefert, nutzt ein Vorschlag "meinten Sie" dasselbe Wörterbuch, das bereits für die Tippfehlertoleranz aufgebaut wurde, sodass kein separater Vorschlagsindex gepflegt werden muss.',
      "Synonymerweiterung ermöglicht es, dass eine Suche nach einem Wort auch Seiten findet, die nur ein anderes, gleichbedeutendes Wort verwenden — nützlich, wenn Kunden und Redaktion einfach unterschiedliches Vokabular verwenden.",
      "Jede dieser Funktionen ist optional und lässt sich pro Abfrage aktivieren, sodass eine einfache Suchbox einfach bleiben kann, während ein vollständiger Produktkatalog den gesamten Funktionsumfang nutzen kann.",
    ],
  },
  {
    category: "Company",
    tags: ["culture", "remote", "hiring"],
    en: [
      "We are a fully remote team spread across several time zones, which means most decisions get written down instead of settled in a hallway conversation. It slows a few things down and speeds many others up, since anyone can catch up on a decision after the fact.",
      "Hiring is deliberately slow. We would rather leave a role open for another month than bring on someone who is a poor fit for how the team actually works, since undoing a bad hire costs far more than the extra weeks of searching ever would.",
      "Every new team member ships a small, real change in their first week, on purpose. Reading documentation only gets you so far — the fastest way to actually understand a codebase is to make a change to it and watch what breaks.",
      "We publish engineering postmortems publicly, including the ones that are embarrassing, because hiding a mistake only guarantees someone else on the team repeats it later without the benefit of what was already learned.",
      "Meetings default to thirty minutes and default to not existing at all unless someone can articulate what decision the meeting is actually for. Most updates travel better as a written note than as a synchronous conversation anyway.",
      "We try to hire for judgment over credentials, since the tools and frameworks a team uses today will mostly be replaced within a few years, but the ability to reason clearly about a tradeoff does not go out of date.",
      "Career growth here is not a fixed ladder with a title at each rung. It is closer to picking up responsibility as it makes sense for the team and for what someone actually wants to be doing more of.",
      "We keep the company small on purpose. A smaller team means fewer layers between a decision and the person who has to live with its consequences, and that feedback loop is worth protecting.",
    ],
    de: [
      "Wir sind ein vollständig verteiltes Team über mehrere Zeitzonen hinweg, was bedeutet, dass die meisten Entscheidungen schriftlich festgehalten werden, statt in einem Flurgespräch geklärt zu werden.",
      "Die Einstellung neuer Mitarbeiter erfolgt bewusst langsam. Wir lassen eine Stelle lieber einen weiteren Monat offen, als jemanden einzustellen, der nicht zur Arbeitsweise des Teams passt.",
      "Jedes neue Teammitglied liefert in der ersten Woche bewusst eine kleine, echte Änderung ab. Dokumentation zu lesen bringt einen nur bis zu einem gewissen Punkt weiter — der schnellste Weg, eine Codebasis wirklich zu verstehen, ist, etwas daran zu ändern.",
      "Wir veröffentlichen technische Nachbesprechungen öffentlich, auch die unangenehmen, denn einen Fehler zu verbergen garantiert nur, dass ihn später jemand anderes im Team wiederholt.",
      "Besprechungen dauern standardmäßig dreißig Minuten und finden standardmäßig gar nicht statt, sofern niemand benennen kann, welche Entscheidung tatsächlich ansteht.",
      "Wir versuchen, eher nach Urteilsvermögen als nach Abschlüssen einzustellen, denn die Werkzeuge und Frameworks, die ein Team heute nutzt, werden in wenigen Jahren größtenteils ersetzt sein.",
      "Die Karriereentwicklung hier ist keine feste Leiter mit einem Titel auf jeder Sprosse. Es ist eher so, dass man Verantwortung übernimmt, wo es für das Team und die eigenen Interessen sinnvoll ist.",
      "Wir halten das Unternehmen bewusst klein. Ein kleineres Team bedeutet weniger Ebenen zwischen einer Entscheidung und der Person, die mit ihren Konsequenzen leben muss.",
    ],
  },
  {
    category: "Guides",
    tags: ["onboarding", "tutorial", "getting-started"],
    en: [
      "Start by rendering your content as plain HTML, the same output your site already serves to visitors. The indexer reads a page's title, its main content region, and a handful of optional meta tags — there is no separate content-modeling step to do first.",
      "If the default extraction picks up the wrong region of a page, wrap the actual content in a single marked element and the indexer will use that instead of guessing from the page structure.",
      "Facets, boosts, and pins are all opt-in through plain meta tags on the page itself, so an author can add a search behavior to one page without touching any build configuration or asking an engineer to change anything.",
      "Run the indexer as the last step of your normal site build, right after the static pages are rendered, so the search index it produces always matches exactly what got published, never a stale snapshot from an earlier deploy.",
      "The generated shards are just static JSON files. Upload them anywhere a browser can fetch them over plain HTTP — there is no special hosting requirement and nothing else to deploy alongside your site.",
      "Test your search locally before publishing by serving the built shard directory with any static file server and pointing the client at it. If it behaves correctly over a local HTTP server, it will behave the same way once deployed.",
      "Start with the defaults for everything — field boosts, facets, synonyms are all optional and off unless a page or a query explicitly asks for them. Turn features on one at a time as you actually need them, not all at once up front.",
      "When something does not match the way you expect, check the analyzed token stream first. Most surprises come from a mismatch between how a term is stored at index time and how the same term is analyzed at query time.",
    ],
    de: [
      "Beginnen Sie damit, Ihre Inhalte als einfaches HTML zu rendern, dieselbe Ausgabe, die Ihre Website Besuchern bereits bereitstellt. Der Indexer liest den Titel einer Seite, ihren Hauptinhaltsbereich und einige optionale Meta-Tags.",
      "Wenn die Standardauswahl den falschen Bereich einer Seite erfasst, umschließen Sie den eigentlichen Inhalt mit einem einzelnen markierten Element, und der Indexer verwendet dieses anstelle einer Vermutung.",
      "Facetten, Gewichtungen und Verknüpfungen sind alle über einfache Meta-Tags auf der Seite selbst aktivierbar, sodass ein Autor ein Suchverhalten zu einer Seite hinzufügen kann, ohne die Build-Konfiguration anzufassen.",
      "Führen Sie den Indexer als letzten Schritt Ihres normalen Website-Builds aus, direkt nachdem die statischen Seiten gerendert wurden, damit der erzeugte Suchindex immer genau dem entspricht, was veröffentlicht wurde.",
      "Die erzeugten Shards sind einfach statische JSON-Dateien. Laden Sie sie überall hoch, wo ein Browser sie per einfachem HTTP abrufen kann — es gibt keine besondere Hosting-Anforderung.",
      "Testen Sie Ihre Suche lokal vor der Veröffentlichung, indem Sie das erzeugte Shard-Verzeichnis mit einem beliebigen statischen Dateiserver bereitstellen und den Client darauf verweisen.",
      "Beginnen Sie mit den Standardeinstellungen für alles — Feldgewichtungen, Facetten und Synonyme sind optional und standardmäßig deaktiviert, sofern eine Seite oder Abfrage sie nicht ausdrücklich anfordert.",
      "Wenn etwas nicht wie erwartet übereinstimmt, prüfen Sie zuerst den analysierten Token-Strom. Die meisten Überraschungen entstehen durch eine Abweichung zwischen Indizierung und Abfrage.",
    ],
  },
];

export interface MarketingPage {
  slug: string;
  en: { title: string; body: string; pin?: string };
  de: { title: string; body: string; pin?: string };
}

/** Fixed, non-generated pages with authored pins — the kind of high-intent page docs/14 calls out ("pricing," "contact"). */
export const MARKETING_PAGES: MarketingPage[] = [
  {
    slug: "pricing",
    en: {
      title: "Pricing",
      body: "Simple, transparent pricing with no hidden fees. Every plan includes the full feature set — facets, boosts, pinning, synonyms, and fuzzy matching are never gated behind a higher tier. Contact us if you need a custom plan for a very large catalog.",
      pin: "pricing",
    },
    de: {
      title: "Preise",
      body: "Einfache, transparente Preise ohne versteckte Gebühren. Jeder Plan enthält den vollen Funktionsumfang — Facetten, Gewichtungen, Verknüpfungen, Synonyme und Tippfehlertoleranz sind nie einer höheren Stufe vorbehalten.",
      pin: "preise",
    },
  },
  {
    slug: "contact",
    en: {
      title: "Contact Us",
      body: "Reach out any time and a real person will get back to you within one business day. For technical support, include the URL of the page where you are seeing unexpected search behavior so we can reproduce it quickly.",
      pin: "contact",
    },
    de: {
      title: "Kontakt",
      body: "Melden Sie sich jederzeit, und eine echte Person wird sich innerhalb eines Werktages bei Ihnen melden. Für technischen Support geben Sie bitte die URL der Seite an, auf der das unerwartete Suchverhalten auftritt.",
      pin: "kontakt",
    },
  },
  {
    slug: "about",
    en: {
      title: "About Us",
      body: "We build search infrastructure that runs entirely in the browser, with no server to operate and no per-query cost. Our small team is fully remote and has been shipping this engine together for several years.",
    },
    de: {
      title: "Über uns",
      body: "Wir bauen Suchinfrastruktur, die vollständig im Browser läuft, ohne Server zu betreiben und ohne Kosten pro Abfrage. Unser kleines Team arbeitet vollständig verteilt und entwickelt diese Engine seit mehreren Jahren gemeinsam.",
    },
  },
];
