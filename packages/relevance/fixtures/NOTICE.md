# Relevance fixture notices

The six small relevance suites redistribute selected text from the matching language edition of Wikipedia. The selected source page, retrieval date, and attribution are recorded inside each JSON suite.

Wikipedia text is available under the [Creative Commons Attribution-ShareAlike 4.0 International license](https://creativecommons.org/licenses/by-sa/4.0/). The fixture excerpts and mechanical adaptations in this directory are distributed under that same license. Repository source code outside this fixture directory remains under the repository's MIT license.

Changes made to the source material are limited to removing link and presentation markup, shortening some answers, and assigning stable document/query identifiers. Consult each suite's `sourceUrl` and the source page's revision history for authorship.

## GOV.UK driving journey snapshot

The `govuk-learn-to-drive` domain fixture contains public sector information from [Learn to drive a car: step by step](https://www.gov.uk/learn-to-drive-a-car) and its 21 internal GOV.UK destinations, retrieved on 13 July 2026.

Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

The snapshot converts allowlisted GOV.UK Content API fields to plain text, preserves stable public routes, and records hashes of the normalized title, description, and body. It excludes downloadable attachments, logos, photographs, video and other media, the external theory-test application, and neighboring pages outside the approved journey.

The OGL applies to the GOV.UK fixture content. Repository source code remains licensed under the MIT license.
