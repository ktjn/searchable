import json
from pathlib import Path

import pytest

from searchable_client.fetch import ShardCache, resolve_url


def test_resolve_url_joins_relative_path_against_file_base(tmp_path: Path):
    base = (tmp_path / "manifest.json").resolve().as_uri()
    resolved = resolve_url(base, "shards/terms/all.json")
    assert resolved.endswith("/shards/terms/all.json")
    assert resolved.startswith("file://")


def test_resolve_url_joins_relative_path_against_http_base():
    resolved = resolve_url("http://example.com/idx/manifest.json", "shards/0.json")
    assert resolved == "http://example.com/idx/shards/0.json"


def test_fetch_json_reads_local_file(tmp_path: Path):
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps({"hello": "world"}))
    cache = ShardCache()
    assert cache.fetch_json(p.as_uri()) == {"hello": "world"}


def test_fetch_json_is_memoized(tmp_path: Path):
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps({"n": 1}))
    cache = ShardCache()
    url = p.as_uri()
    first = cache.fetch_json(url)
    p.write_text(json.dumps({"n": 2}))
    second = cache.fetch_json(url)
    assert first is second


def test_fetch_json_raises_on_missing_file(tmp_path: Path):
    cache = ShardCache()
    with pytest.raises(FileNotFoundError):
        cache.fetch_json((tmp_path / "missing.json").as_uri())


def test_fetch_bytes_reads_local_file(tmp_path: Path):
    p = tmp_path / "shard.bin"
    p.write_bytes(b"\x01\x02\x03")
    cache = ShardCache()
    assert cache.fetch_bytes(p.as_uri()) == b"\x01\x02\x03"
