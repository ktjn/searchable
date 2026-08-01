# Structured binary document-store benchmark

This is a small storage/encoder datapoint for the structured v2 codec, not a
product performance budget. It uses 1,000 synthetic RAG-shaped documents on the
developer workstation, with all optional structured fields populated. The
numbers are useful for checking the codec's direction; they do not justify
changing JSON's default or define supported corpus sizes.

| Measurement | JSON | Structured binary v2 |
|---|---:|---:|
| Raw bytes | 381,451 | 302,620 |
| gzip level 9 bytes | 17,426 | 19,650 |
| Python encode / parse mean | 1.39 ms parse | 7.10 ms encode |

The JSON parse and binary encode timings are intentionally not presented as a
direct query-latency comparison: they are different operations. A follow-up
benchmark should measure cold and warm browser loading, first-hit latency, and
memory-relevant decoded bytes across representative corpora and worker modes.

Reproduction uses `uv run --project python/searchable-indexer python -` with the
synthetic corpus and `encode_structured_doc_store_binary`; gzip sizes use level
9. The raw values above were collected on 2026-07-31.
