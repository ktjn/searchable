import datetime

from csf_analysis import analyze, get_language_profile
from csf_indexer.extract import extract_document
from csf_indexer.types import BuiltIndex, SourceDocument

_DEFAULT_FIELD_BOOSTS = {"title": 3.0, "body": 1.0}
_EXCERPT_LENGTH = 200


def _validate_source_ids(sources: list[SourceDocument]) -> None:
    seen: set[int] = set()
    for source in sources:
        if not isinstance(source.id, int) or isinstance(source.id, bool) or source.id < 0:
            raise ValueError(
                f"build_index: invalid document id {source.id!r} for "
                f'"{source.url}" -- ids must be non-negative integers'
            )
        if source.id in seen:
            raise ValueError(
                f"build_index: duplicate document id {source.id} "
                f'(seen again at "{source.url}") -- every source document '
                "must have a unique id"
            )
        seen.add(source.id)


def _derive_excerpt(body: str) -> str:
    if len(body) <= _EXCERPT_LENGTH:
        return body
    return body[:_EXCERPT_LENGTH].rstrip() + "…"


def _add_postings(shard, posting_index, field_name, doc_id, doc_boost, tokens) -> None:
    field_length = len(tokens)
    positions_by_term: dict[str, list[int]] = {}
    for token in tokens:
        positions_by_term.setdefault(token.term, []).append(token.position)

    for term, positions in positions_by_term.items():
        entry = shard.setdefault(term, {"df": 0, "postings": []})
        doc_index = posting_index.setdefault(term, {})
        posting = doc_index.get(doc_id)
        if posting is None:
            posting = {"doc": doc_id, "fields": {}}
            if doc_boost != 1.0:
                posting["boost"] = doc_boost
            entry["postings"].append(posting)
            entry["df"] += 1
            doc_index[doc_id] = posting
        posting["fields"][field_name] = {
            "tf": len(positions),
            "pos": positions,
            "len": field_length,
        }


def build_index(
    sources: list[SourceDocument],
    default_language: str = "en",
    field_boosts: dict[str, float] | None = None,
    allowed_url_origins: list[str] | None = None,
    canonical_base_url: str | None = None,
) -> BuiltIndex:
    _validate_source_ids(sources)
    boosts = {**_DEFAULT_FIELD_BOOSTS, **(field_boosts or {})}

    term_shards: dict[str, dict] = {}
    posting_index_by_language: dict[str, dict] = {}
    doc_store: dict = {}
    stats_by_language: dict[str, dict] = {}
    indexed_count = 0
    min_id: int | None = None
    max_id: int | None = None

    for source in sources:
        extracted = extract_document(
            source.html,
            source.url,
            default_language,
            allowed_url_origins=allowed_url_origins,
            canonical_base_url=canonical_base_url,
        )
        if extracted.noindex:
            continue

        language = extracted.language
        profile = get_language_profile(language)

        title_tokens = analyze(extracted.title, profile)
        body_tokens = analyze(extracted.body, profile)

        stats = stats_by_language.setdefault(
            language, {"title": 0, "body": 0, "count": 0}
        )
        stats["title"] += len(title_tokens)
        stats["body"] += len(body_tokens)
        stats["count"] += 1

        term_shard = term_shards.setdefault(language, {})
        posting_index = posting_index_by_language.setdefault(language, {})
        _add_postings(
            term_shard, posting_index, "title", source.id, extracted.boost, title_tokens
        )
        _add_postings(
            term_shard, posting_index, "body", source.id, extracted.boost, body_tokens
        )

        entry: dict = {
            "url": extracted.url,
            "fields": {
                "title": extracted.title,
                "excerpt": extracted.excerpt or _derive_excerpt(extracted.body),
            },
        }
        if extracted.boost != 1.0:
            entry["boost"] = extracted.boost
        doc_store[str(source.id)] = entry

        indexed_count += 1
        min_id = source.id if min_id is None else min(min_id, source.id)
        max_id = source.id if max_id is None else max(max_id, source.id)

    for term_shard in term_shards.values():
        for entry in term_shard.values():
            entry["postings"].sort(key=lambda p: p["doc"])

    languages = sorted(stats_by_language.keys()) if stats_by_language else [default_language]

    doc_count: dict[str, int] = {}
    avg_field_length: dict[str, dict[str, float]] = {}
    for language in languages:
        stats = stats_by_language.get(language)
        count = stats["count"] if stats else 0
        doc_count[language] = count
        avg_field_length[language] = {
            "title": (stats["title"] / count) if stats and count else 0.0,
            "body": (stats["body"] / count) if stats and count else 0.0,
        }

    manifest = {
        "version": 1,
        "buildId": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "format": "json",
        "languages": languages,
        "defaultLanguage": default_language,
        "fields": {
            "title": {"boost": boosts["title"], "stored": True},
            "body": {"boost": boosts["body"], "stored": False},
        },
        "docCount": doc_count,
        "avgFieldLength": avg_field_length,
        "shards": {"terms": [], "docs": []},
    }

    id_range = (min_id, max_id) if indexed_count else (0, 0)

    return BuiltIndex(
        manifest=manifest,
        term_shards=term_shards,
        doc_store=doc_store,
        id_range=id_range,
    )
