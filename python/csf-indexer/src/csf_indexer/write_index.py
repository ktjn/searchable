import gzip
import json
import re
from pathlib import Path

from csf_indexer.hash import content_hash
from csf_indexer.types import BuiltIndex

DEFAULT_MAX_TERM_SHARD_GZIP_BYTES = 50 * 1024
_MAX_PREFIX_LENGTH = 8


def _canonicalize(value):
    if isinstance(value, list):
        return [_canonicalize(v) for v in value]
    if isinstance(value, tuple):
        return [_canonicalize(v) for v in value]
    if isinstance(value, dict):
        return {key: _canonicalize(value[key]) for key in sorted(value.keys())}
    return value


def _to_json(data) -> str:
    return json.dumps(_canonicalize(data), separators=(",", ":"), ensure_ascii=False)


def _write_json(out_dir: str, rel_path: str, data) -> str:
    content = _to_json(data)
    digest = content_hash(content)
    hashed_rel_path = re.sub(r"\.json$", f".{digest}.json", rel_path)
    abs_path = Path(out_dir) / hashed_rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(content, encoding="utf-8")
    return hashed_rel_path


def _gzip_byte_size(term_shard: dict) -> int:
    return len(gzip.compress(_to_json(term_shard).encode("utf-8")))


def _group_by_prefix_length(term_shard: dict, prefix_length: int) -> dict[str, dict]:
    groups: dict[str, dict] = {}
    for term, entry in term_shard.items():
        prefix = term[:prefix_length]
        groups.setdefault(prefix, {})[term] = entry
    return groups


def _split_oversized_bucket(
    prefix: str,
    group: dict,
    prefix_length: int,
    language: str,
    max_gzip_bytes: int,
    result: dict[str, dict],
) -> None:
    size = _gzip_byte_size(group)
    if size <= max_gzip_bytes:
        result[prefix] = group
        return
    term_count = len(group)
    if term_count <= 1 or prefix_length >= _MAX_PREFIX_LENGTH:
        result[prefix] = group
        return
    sub_buckets = _group_by_prefix_length(group, prefix_length + 1)
    if len(sub_buckets) <= 1:
        result[prefix] = group
        return
    for sub_prefix, sub_group in sub_buckets.items():
        _split_oversized_bucket(
            sub_prefix, sub_group, prefix_length + 1, language, max_gzip_bytes, result
        )


def _shard_terms_by_prefix(
    term_shard: dict, language: str, max_gzip_bytes: int
) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for prefix, group in _group_by_prefix_length(term_shard, 1).items():
        _split_oversized_bucket(prefix, group, 1, language, max_gzip_bytes, result)
    return result


def _chunk_doc_store_by_id_range(doc_store: dict, shard_size: float) -> list[dict]:
    sorted_ids = sorted(int(k) for k in doc_store.keys())
    chunks: list[dict] = []
    step = len(sorted_ids) if shard_size == float("inf") else int(shard_size)
    step = max(step, 1)
    i = 0
    while i < len(sorted_ids):
        ids_in_chunk = sorted_ids[i : i + step]
        shard = {str(doc_id): doc_store[str(doc_id)] for doc_id in ids_in_chunk}
        chunks.append({"idRange": (ids_in_chunk[0], ids_in_chunk[-1]), "shard": shard})
        i += step
    return chunks


def write_index(
    built: BuiltIndex,
    out_dir: str,
    max_shard_gzip_bytes: int = DEFAULT_MAX_TERM_SHARD_GZIP_BYTES,
    shard_by_prefix: bool = True,
    doc_store_shard_size: float = float("inf"),
) -> None:
    languages = sorted(built.term_shards.keys())
    terms: list[dict] = []
    for language in languages:
        term_shard = built.term_shards.get(language, {})
        if shard_by_prefix:
            buckets = sorted(
                _shard_terms_by_prefix(term_shard, language, max_shard_gzip_bytes).items()
            )
        else:
            buckets = [("all", term_shard)]
        for prefix, group in buckets:
            file = _write_json(out_dir, f"terms/{language}/{prefix}.json", group)
            terms.append(
                {"lang": language, "prefix": prefix, "file": file, "termCount": len(group)}
            )

    doc_store_chunks = _chunk_doc_store_by_id_range(built.doc_store, doc_store_shard_size)
    if not doc_store_chunks:
        doc_store_chunks = [{"idRange": built.id_range, "shard": {}}]
    docs: list[dict] = []
    for shard_index, chunk in enumerate(doc_store_chunks):
        file = _write_json(out_dir, f"docs/{shard_index}.json", chunk["shard"])
        docs.append(
            {"shard": shard_index, "file": file, "idRange": list(chunk["idRange"])}
        )

    manifest = {**built.manifest, "shards": {"terms": terms, "docs": docs}}

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    (out_path / "manifest.json").write_text(_to_json(manifest), encoding="utf-8")
