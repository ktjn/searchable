import pytest

from searchable_client.validate_manifest import InvalidManifestError, validate_manifest

BASE = "http://example.com/idx/manifest.json"


def _valid_manifest(**overrides) -> dict:
    data = {
        "version": 1,
        "buildId": "x",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {},
        "docCount": {"en": 1},
        "avgFieldLength": {"en": {}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 1}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [0, 0]}],
        },
    }
    data.update(overrides)
    return data


def test_valid_manifest_passes():
    manifest = validate_manifest(_valid_manifest(), BASE)
    assert manifest.default_language == "en"


def test_rejects_wrong_version():
    with pytest.raises(InvalidManifestError, match="unsupported version"):
        validate_manifest(_valid_manifest(version=2), BASE)


def test_rejects_default_language_not_in_languages():
    with pytest.raises(InvalidManifestError, match="defaultLanguage"):
        validate_manifest(_valid_manifest(defaultLanguage="de"), BASE)


def test_rejects_cross_origin_shard_by_default():
    data = _valid_manifest()
    data["shards"]["terms"][0]["file"] = "http://evil.example.com/terms/all.json"
    with pytest.raises(InvalidManifestError, match="different origin"):
        validate_manifest(data, BASE)


def test_allows_cross_origin_shard_when_opted_in():
    data = _valid_manifest()
    data["shards"]["terms"][0]["file"] = "http://other.example.com/terms/all.json"
    manifest = validate_manifest(data, BASE, allow_cross_origin_shards=True)
    assert manifest.shards_terms[0].file == "http://other.example.com/terms/all.json"


def test_strict_rejects_duplicate_lang_prefix_pair():
    data = _valid_manifest()
    data["shards"]["terms"].append(
        {"lang": "en", "prefix": "all", "file": "terms/all2.json", "termCount": 1}
    )
    with pytest.raises(InvalidManifestError, match="duplicate"):
        validate_manifest(data, BASE, strict=True)


def test_strict_rejects_missing_doc_count_language_coverage():
    data = _valid_manifest(languages=["en", "de"], docCount={"en": 1})
    with pytest.raises(InvalidManifestError, match="docCount"):
        validate_manifest(data, BASE, strict=True)


def test_non_strict_allows_missing_doc_count_coverage():
    data = _valid_manifest(languages=["en", "de"], docCount={"en": 1})
    manifest = validate_manifest(data, BASE, strict=False)
    assert manifest.languages == ["en", "de"]
