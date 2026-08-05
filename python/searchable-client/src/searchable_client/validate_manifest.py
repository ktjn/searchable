from typing import cast
from urllib.parse import urljoin, urlparse

from searchable_client.errors import SearchClientError
from searchable_client.types import Manifest, manifest_from_dict


class InvalidManifestError(SearchClientError):
    pass


def _fail(message: str) -> None:
    raise InvalidManifestError(f"invalid manifest: {message}")


def _check_shard_file(
    file: object, manifest_url: str, allow_cross_origin: bool, context: str
) -> None:
    if not isinstance(file, str) or not file:
        _fail(f"{context}.file must be a non-empty string")
        return  # unreachable, but makes mypy happy
    if allow_cross_origin:
        return
    resolved = urlparse(urljoin(manifest_url, file))
    manifest_origin = urlparse(manifest_url)
    if (resolved.scheme, resolved.netloc) != (manifest_origin.scheme, manifest_origin.netloc):
        _fail(
            f'{context}.file "{file}" resolves to a different origin '
            f"({resolved.scheme}://{resolved.netloc}) than the manifest "
            f"({manifest_origin.scheme}://{manifest_origin.netloc}) — pass "
            "allow_cross_origin_shards=True to opt in"
        )


def _check_shard_file_array(
    entries: object, manifest_url: str, allow_cross_origin: bool, context: str
) -> None:
    if not isinstance(entries, list):
        _fail(f"{context} must be an array")
        return
    for i, entry in enumerate(entries):
        file = entry.get("file") if isinstance(entry, dict) else None
        _check_shard_file(file, manifest_url, allow_cross_origin, f"{context}[{i}]")


def _check_term_shards_strict(terms: object, languages: list[str]) -> None:
    if not isinstance(terms, list):
        return
    seen: set[tuple[str, str]] = set()
    for i, entry in enumerate(terms):
        context = f"shards.terms[{i}]"
        lang = entry.get("lang")
        prefix = entry.get("prefix")
        if not isinstance(lang, str) or lang not in languages:
            _fail(f"{context}.lang {lang!r} is not in languages")
        if not isinstance(prefix, str) or not prefix:
            _fail(f"{context}.prefix must be a non-empty string")
        key = (lang, prefix)
        if key in seen:
            _fail(f"{context}: duplicate (lang, prefix) pair ({lang}, {prefix!r})")
        seen.add(key)
        fmt = entry.get("format")
        if fmt is not None and fmt not in ("json", "binary"):
            _fail(f'{context}.format must be absent, "json", or "binary"')


def _check_id_range(id_range: object, context: str) -> None:
    is_valid = (
        isinstance(id_range, list)
        and len(id_range) == 2
        and all(isinstance(n, (int, float)) for n in id_range)
    )
    if not is_valid:
        _fail(f"{context}.idRange must be a two-number tuple")
        return
    if isinstance(id_range, list) and id_range[0] > id_range[1]:
        _fail(f"{context}.idRange {id_range} must be ordered (min <= max)")


def _check_docs_shards_strict(docs: object) -> None:
    if not isinstance(docs, list):
        return
    for i, entry in enumerate(docs):
        id_range = entry.get("idRange") if isinstance(entry, dict) else None
        _check_id_range(id_range, f"shards.docs[{i}]")


def _check_per_language_coverage_strict(
    value: object, languages: list[str], field_name: str
) -> None:
    for lang in languages:
        if not isinstance(value, dict) or lang not in value:
            _fail(f'{field_name} is missing an entry for language "{lang}"')


def validate_manifest(
    data: dict[str, object],
    manifest_url: str,
    *,
    allow_cross_origin_shards: bool = False,
    strict: bool = False,
) -> Manifest:
    if not isinstance(data, dict):
        _fail("must be a JSON object")
    if data.get("version") != 1:
        _fail(f"unsupported version {data.get('version')!r} (expected 1)")
    if data.get("format") not in ("json", "binary"):
        _fail(f'format must be "json" or "binary", got {data.get("format")!r}')
    languages = data.get("languages")
    if not (
        isinstance(languages, list)
        and languages
        and all(isinstance(lang_, str) for lang_ in languages)
    ):
        _fail("languages must be a non-empty array of strings")
        languages = []  # unreachable, but makes mypy happy
    default_language = data.get("defaultLanguage")
    if not isinstance(default_language, str) or default_language not in languages:
        _fail(f"defaultLanguage {default_language!r} must be a string present in languages")
    if not isinstance(data.get("fields"), dict):
        _fail("fields must be an object")
    if not isinstance(data.get("docCount"), dict):
        _fail("docCount must be an object keyed by language")
    if not isinstance(data.get("avgFieldLength"), dict):
        _fail("avgFieldLength must be an object keyed by language")
    shards = data.get("shards")
    if not isinstance(shards, dict):
        _fail("shards must be an object")
        return manifest_from_dict(data)  # unreachable, _fail always raises; keeps mypy happy

    _check_shard_file_array(
        shards.get("terms"), manifest_url, allow_cross_origin_shards, "shards.terms"
    )
    _check_shard_file_array(
        shards.get("docs"), manifest_url, allow_cross_origin_shards, "shards.docs"
    )

    if strict:
        _check_term_shards_strict(shards.get("terms"), cast(list[str], languages))
        _check_docs_shards_strict(shards.get("docs"))
        _check_per_language_coverage_strict(
            data.get("docCount"), cast(list[str], languages), "docCount"
        )
        _check_per_language_coverage_strict(
            data.get("avgFieldLength"), cast(list[str], languages), "avgFieldLength"
        )

    if shards.get("facets") is not None:
        _check_shard_file_array(
            shards.get("facets"), manifest_url, allow_cross_origin_shards, "shards.facets"
        )

    pins = data.get("pins")
    if pins is not None:
        if not isinstance(pins, dict):
            _fail("pins must be an object keyed by language")
        else:
            for lang, file in pins.items():
                _check_shard_file(file, manifest_url, allow_cross_origin_shards, f"pins.{lang}")

    synonyms = data.get("synonyms")
    if synonyms is not None:
        if not isinstance(synonyms, dict):
            _fail("synonyms must be an object keyed by language")
        else:
            for lang, file in synonyms.items():
                _check_shard_file(file, manifest_url, allow_cross_origin_shards, f"synonyms.{lang}")

    fuzzy = data.get("fuzzy")
    if fuzzy is not None:
        if not isinstance(fuzzy, dict):
            _fail("fuzzy must be an object keyed by language")
        else:
            for lang, descriptor in fuzzy.items():
                if not isinstance(descriptor, dict):
                    _fail(f"fuzzy.{lang} must be an object")
                    continue
                _check_shard_file(
                    descriptor.get("file"), manifest_url, allow_cross_origin_shards, f"fuzzy.{lang}"
                )

    return manifest_from_dict(data)
