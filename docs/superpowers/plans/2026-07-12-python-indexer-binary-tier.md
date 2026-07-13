# Python Index-Creation Support (Binary Storage Tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the TS binary storage tier (term shards, doc store, fuzzy shards) to the Python `searchable-indexer` package, giving `write_index()` the same `term_shard_format`/`doc_store_format`/`fuzzy_shard_format` options the TS `writeIndex()` already has.

**Architecture:** Four new modules under `searchable_indexer/` (`byte_writer.py`, `binary_term_shard.py`, `binary_doc_store.py`, `binary_fuzzy_shard.py`), each a direct port of its TS counterpart in `packages/indexer/src/`; `write_index.py` is extended (not rewritten) to branch on the new format kwargs. `build_index.py` is untouched — this is purely a physical-encoding choice at write time.

**Tech Stack:** Python 3.10+ stdlib only (`struct` for float64, no new dependencies), `uv` + `pytest`.

## Global Constraints

- Minimum Python version: 3.10.
- Scope is exactly term shards, doc store, fuzzy shards — facets/synonyms/pins stay JSON-only permanently (per `docs/spec-binary-format.md`), no format option exists for them, don't add one.
- `build_index.py` is not modified in this plan at all.
- The term-shard prefix-sharding/gzip-budget-splitting logic (`_shard_terms_by_prefix` in `write_index.py`) must NOT change — it always sizes via gzipped JSON regardless of the final output format, matching the TS original's own accepted approximation. Only the final per-bucket encode+write step branches on format.
- `byte_writer.py`'s `ByteWriter` deliberately omits the TS original's manual chunked-buffer growth machinery (`#ensure`/`#chunks`) — Python's `bytearray` already handles amortized growth internally. This is a documented, deliberate simplification, not a missing feature.
- Varint encoding is unsigned LEB128 (7 bits per byte, high bit = continuation), little-endian throughout (float64 via `struct.pack("<d", ...)`).
- Boost is always encoded as float64 (never float32) — matching the TS original's explicit precision-loss avoidance (`1.8` doesn't round-trip through float32).

---

## Task 1: `byte_writer.py`

**Files:**
- Create: `python/searchable-indexer/src/searchable_indexer/byte_writer.py`
- Test: `python/searchable-indexer/tests/test_byte_writer.py`

**Interfaces:**
- Produces: `ByteWriter` class with `write_varint(value: int) -> None`, `write_bytes(data: bytes) -> None`, `write_string(s: str) -> None`, `write_float64(value: float) -> None`, `to_bytes() -> bytes`. Used by all three binary encoders in Tasks 2-4.

- [ ] **Step 1: Write the failing tests**

```python
from searchable_indexer.byte_writer import ByteWriter


def test_write_varint_single_byte_values():
    w = ByteWriter()
    w.write_varint(0)
    assert w.to_bytes() == bytes([0x00])

    w = ByteWriter()
    w.write_varint(1)
    assert w.to_bytes() == bytes([0x01])

    w = ByteWriter()
    w.write_varint(127)
    assert w.to_bytes() == bytes([0x7F])


def test_write_varint_multi_byte_values():
    w = ByteWriter()
    w.write_varint(128)
    assert w.to_bytes() == bytes([0x80, 0x01])

    w = ByteWriter()
    w.write_varint(300)
    assert w.to_bytes() == bytes([0xAC, 0x02])

    w = ByteWriter()
    w.write_varint(16384)
    assert w.to_bytes() == bytes([0x80, 0x80, 0x01])


def test_write_bytes_appends_raw_bytes():
    w = ByteWriter()
    w.write_bytes(b"xyz")
    assert w.to_bytes() == b"xyz"


def test_write_string_encodes_length_prefixed_utf8():
    w = ByteWriter()
    w.write_string("")
    assert w.to_bytes() == bytes([0x00])

    w = ByteWriter()
    w.write_string("A")
    assert w.to_bytes() == bytes([0x01, 0x41])

    w = ByteWriter()
    w.write_string("ab")
    assert w.to_bytes() == bytes([0x02, 0x61, 0x62])


def test_write_string_encodes_non_ascii_as_utf8_byte_length():
    # "é" is U+00E9, which UTF-8 encodes as 2 bytes (0xC3 0xA9) --
    # the length prefix must be the UTF-8 byte count, not the
    # character count.
    w = ByteWriter()
    w.write_string("é")
    assert w.to_bytes() == bytes([0x02, 0xC3, 0xA9])


def test_write_float64_matches_ieee754_little_endian_encoding():
    w = ByteWriter()
    w.write_float64(1.5)
    # 1.5 as IEEE-754 double, little-endian: 0x3FF8000000000000
    # byte-reversed.
    assert w.to_bytes() == bytes([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xF8, 0x3F])

    w = ByteWriter()
    w.write_float64(0.0)
    assert w.to_bytes() == bytes([0x00] * 8)


def test_multiple_writes_accumulate_in_order():
    w = ByteWriter()
    w.write_varint(1)
    w.write_string("a")
    assert w.to_bytes() == bytes([0x01, 0x01, 0x61])
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd python/searchable-indexer
uv run pytest tests/test_byte_writer.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'searchable_indexer.byte_writer'`.

- [ ] **Step 3: Implement `byte_writer.py`**

```python
import struct

# Direct port of packages/indexer/src/byte-writer.ts's ByteWriter,
# minus the manual chunked-buffer growth machinery (#ensure/#chunks) --
# Python's bytearray already handles amortized growth internally, so
# that complexity (needed in JS because Uint8Array isn't natively
# resizable) has no equivalent here.


class ByteWriter:
    def __init__(self) -> None:
        self._buf = bytearray()

    def write_varint(self, value: int) -> None:
        v = value
        while v >= 0x80:
            self._buf.append((v & 0x7F) | 0x80)
            v >>= 7
        self._buf.append(v)

    def write_bytes(self, data: bytes) -> None:
        self._buf.extend(data)

    def write_string(self, s: str) -> None:
        encoded = s.encode("utf-8")
        self.write_varint(len(encoded))
        self.write_bytes(encoded)

    def write_float64(self, value: float) -> None:
        self._buf.extend(struct.pack("<d", value))

    def to_bytes(self) -> bytes:
        return bytes(self._buf)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_byte_writer.py -v
```
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/byte_writer.py python/searchable-indexer/tests/test_byte_writer.py
git commit -m "feat(searchable-indexer): add ByteWriter (varint/string/float64 binary encoding)"
```

---

## Task 2: `binary_term_shard.py`

**Files:**
- Create: `python/searchable-indexer/src/searchable_indexer/binary_term_shard.py`
- Test: `python/searchable-indexer/tests/test_binary_term_shard.py`

**Interfaces:**
- Consumes: `ByteWriter` (Task 1).
- Produces: `encode_term_shard_binary(term_shard: dict) -> bytes`, used by `write_index.py` in Task 5.

- [ ] **Step 1: Write the failing test**

```python
from searchable_indexer.binary_term_shard import encode_term_shard_binary


def test_encodes_a_single_term_single_posting_single_field_shard():
    term_shard = {
        "a": {
            "df": 1,
            "postings": [
                {"doc": 0, "fields": {"t": {"tf": 1, "pos": [0], "len": 1}}}
            ],
        }
    }
    encoded = encode_term_shard_binary(term_shard)
    # Directory: termCount=1, string("a"), offset=0, length=11
    #   -> 0x01, 0x01,0x61, 0x00, 0x0B
    # Postings blob for "a": df=1, postingCount=1, docDelta=0,
    # hasBoost=0, fieldCount=1, string("t"), tf=1, len=1, posCount=1,
    # posDelta=0
    #   -> 0x01,0x01,0x00,0x00,0x01, 0x01,0x74, 0x01,0x01,0x01,0x00
    expected = bytes(
        [
            0x01, 0x01, 0x61, 0x00, 0x0B,
            0x01, 0x01, 0x00, 0x00, 0x01, 0x01, 0x74, 0x01, 0x01, 0x01, 0x00,
        ]
    )
    assert encoded == expected


def test_terms_are_encoded_in_sorted_order_regardless_of_dict_insertion_order():
    term_shard = {
        "z": {"df": 1, "postings": [{"doc": 0, "fields": {}}]},
        "a": {"df": 1, "postings": [{"doc": 0, "fields": {}}]},
    }
    encoded = encode_term_shard_binary(term_shard)
    # Directory starts with termCount=2, then the first term's string
    # bytes -- "a" (0x61) must appear before "z" (0x7A) despite dict
    # insertion order being z-then-a.
    assert encoded[1] == 0x01  # length-prefix of the first term string
    assert encoded[2] == 0x61  # 'a', not 'z' (0x7A)


def test_posting_with_boost_encodes_float64_boost():
    term_shard = {
        "a": {
            "df": 1,
            "postings": [{"doc": 0, "boost": 2.0, "fields": {}}],
        }
    }
    encoded = encode_term_shard_binary(term_shard)
    # Directory: 0x01,0x01,0x61,0x00,length. Postings blob: df=1,
    # postingCount=1, docDelta=0, hasBoost=1, then float64(2.0), then
    # fieldCount=0.
    # float64(2.0) little-endian = 0x0000000000000040
    boost_bytes = bytes([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40])
    assert boost_bytes in encoded


def test_postings_encode_delta_from_previous_doc_id():
    term_shard = {
        "a": {
            "df": 2,
            "postings": [
                {"doc": 5, "fields": {}},
                {"doc": 8, "fields": {}},
            ],
        }
    }
    encoded = encode_term_shard_binary(term_shard)
    # Postings blob: df=2(0x02), postingCount=2(0x02), first
    # docDelta=5(0x05), hasBoost=0, fieldCount=0, second
    # docDelta=8-5=3(0x03), hasBoost=0, fieldCount=0.
    postings_blob_marker = bytes([0x02, 0x02, 0x05, 0x00, 0x00, 0x03, 0x00, 0x00])
    assert postings_blob_marker in encoded
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_binary_term_shard.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'searchable_indexer.binary_term_shard'`.

- [ ] **Step 3: Implement `binary_term_shard.py`**

```python
from searchable_indexer.byte_writer import ByteWriter

# Direct port of packages/indexer/src/binary-term-shard.ts's
# encodeTermShardBinary/encodePostings.


def _encode_postings(entry: dict) -> bytes:
    w = ByteWriter()
    w.write_varint(entry["df"])
    w.write_varint(len(entry["postings"]))
    prev_doc = 0
    for posting in entry["postings"]:
        w.write_varint(posting["doc"] - prev_doc)
        prev_doc = posting["doc"]
        has_boost = "boost" in posting
        w.write_varint(1 if has_boost else 0)
        if has_boost:
            w.write_float64(posting["boost"])
        field_names = sorted(posting["fields"].keys())
        w.write_varint(len(field_names))
        for field_name in field_names:
            field = posting["fields"][field_name]
            w.write_string(field_name)
            w.write_varint(field["tf"])
            w.write_varint(field["len"])
            w.write_varint(len(field["pos"]))
            prev_pos = 0
            for pos in field["pos"]:
                w.write_varint(pos - prev_pos)
                prev_pos = pos
    return w.to_bytes()


def encode_term_shard_binary(term_shard: dict) -> bytes:
    terms = sorted(term_shard.keys())
    postings_blobs = [_encode_postings(term_shard[term]) for term in terms]

    directory = ByteWriter()
    directory.write_varint(len(terms))
    offset = 0
    for term, blob in zip(terms, postings_blobs):
        directory.write_string(term)
        directory.write_varint(offset)
        directory.write_varint(len(blob))
        offset += len(blob)

    postings_blob = ByteWriter()
    for blob in postings_blobs:
        postings_blob.write_bytes(blob)

    return directory.to_bytes() + postings_blob.to_bytes()
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_binary_term_shard.py -v
```
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/binary_term_shard.py python/searchable-indexer/tests/test_binary_term_shard.py
git commit -m "feat(searchable-indexer): add encode_term_shard_binary"
```

---

## Task 3: `binary_doc_store.py`

**Files:**
- Create: `python/searchable-indexer/src/searchable_indexer/binary_doc_store.py`
- Test: `python/searchable-indexer/tests/test_binary_doc_store.py`

**Interfaces:**
- Consumes: `ByteWriter` (Task 1).
- Produces: `encode_doc_store_binary(shard: dict) -> bytes`, used by `write_index.py` in Task 5.

- [ ] **Step 1: Write the failing test**

```python
from searchable_indexer.binary_doc_store import encode_doc_store_binary


def test_encodes_a_single_doc_shard():
    shard = {"0": {"url": "/a", "fields": {"t": "x"}}}
    encoded = encode_doc_store_binary(shard)
    # Directory: docCount=1, idDelta=0, offset=0, length=9
    #   -> 0x01, 0x00, 0x00, 0x09
    # Record blob: string("/a"), hasBoost=0, fieldCount=1,
    # string("t"), string("x")
    #   -> 0x02,0x2F,0x61, 0x00, 0x01, 0x01,0x74, 0x01,0x78
    expected = bytes(
        [
            0x01, 0x00, 0x00, 0x09,
            0x02, 0x2F, 0x61, 0x00, 0x01, 0x01, 0x74, 0x01, 0x78,
        ]
    )
    assert encoded == expected


def test_docs_are_encoded_in_ascending_numeric_id_order():
    shard = {
        "20": {"url": "/b", "fields": {}},
        "3": {"url": "/a", "fields": {}},
    }
    encoded = encode_doc_store_binary(shard)
    # Directory: docCount=2(0x02), then first entry's idDelta must be
    # 3 (doc id 3, string sort would have put "20" first, numeric sort
    # correctly puts 3 first).
    assert encoded[0] == 0x02
    assert encoded[1] == 0x03


def test_doc_with_boost_encodes_float64_boost():
    shard = {"0": {"url": "/a", "boost": 2.0, "fields": {}}}
    encoded = encode_doc_store_binary(shard)
    boost_bytes = bytes([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40])
    assert boost_bytes in encoded


def test_second_doc_id_delta_is_relative_to_previous_id():
    shard = {
        "5": {"url": "/a", "fields": {}},
        "8": {"url": "/b", "fields": {}},
    }
    encoded = encode_doc_store_binary(shard)
    # Directory: docCount=2, first idDelta=5, ..., second idDelta=8-5=3.
    assert encoded[0] == 0x02
    assert encoded[1] == 0x05
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_binary_doc_store.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'searchable_indexer.binary_doc_store'`.

- [ ] **Step 3: Implement `binary_doc_store.py`**

```python
from searchable_indexer.byte_writer import ByteWriter

# Direct port of packages/indexer/src/binary-doc-store.ts's
# encodeDocStoreBinary.


def encode_doc_store_binary(shard: dict) -> bytes:
    ids = sorted(int(key) for key in shard.keys())

    blobs = []
    for doc_id in ids:
        entry = shard[str(doc_id)]
        w = ByteWriter()
        w.write_string(entry["url"])
        has_boost = "boost" in entry
        w.write_varint(1 if has_boost else 0)
        if has_boost:
            w.write_float64(entry["boost"])
        field_names = sorted(entry["fields"].keys())
        w.write_varint(len(field_names))
        for field_name in field_names:
            w.write_string(field_name)
            w.write_string(entry["fields"].get(field_name) or "")
        blobs.append(w.to_bytes())

    directory = ByteWriter()
    directory.write_varint(len(ids))
    prev_id = 0
    offset = 0
    for doc_id, blob in zip(ids, blobs):
        directory.write_varint(doc_id - prev_id)
        prev_id = doc_id
        directory.write_varint(offset)
        directory.write_varint(len(blob))
        offset += len(blob)

    blob_writer = ByteWriter()
    for blob in blobs:
        blob_writer.write_bytes(blob)

    return directory.to_bytes() + blob_writer.to_bytes()
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_binary_doc_store.py -v
```
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/binary_doc_store.py python/searchable-indexer/tests/test_binary_doc_store.py
git commit -m "feat(searchable-indexer): add encode_doc_store_binary"
```

---

## Task 4: `binary_fuzzy_shard.py`

**Files:**
- Create: `python/searchable-indexer/src/searchable_indexer/binary_fuzzy_shard.py`
- Test: `python/searchable-indexer/tests/test_binary_fuzzy_shard.py`

**Interfaces:**
- Consumes: `ByteWriter` (Task 1).
- Produces: `encode_fuzzy_shard_binary(shard: dict) -> bytes`, used by `write_index.py` in Task 5.

- [ ] **Step 1: Write the failing test**

```python
from searchable_indexer.binary_fuzzy_shard import encode_fuzzy_shard_binary


def test_encodes_a_single_variant_shard():
    shard = {"maxEdits": 1, "deletions": {"ca": ["cat"]}}
    encoded = encode_fuzzy_shard_binary(shard)
    # Header: maxEdits=1, variantCount=1, string("ca"), offset=0,
    # length=5 -> 0x01, 0x01, 0x02,0x63,0x61, 0x00, 0x05
    # Blob: termCount=1, string("cat") -> 0x01, 0x03,0x63,0x61,0x74
    expected = bytes(
        [
            0x01, 0x01, 0x02, 0x63, 0x61, 0x00, 0x05,
            0x01, 0x03, 0x63, 0x61, 0x74,
        ]
    )
    assert encoded == expected


def test_max_edits_2_is_encoded_in_the_header():
    shard = {"maxEdits": 2, "deletions": {}}
    encoded = encode_fuzzy_shard_binary(shard)
    assert encoded[0] == 0x02


def test_variants_are_encoded_in_sorted_order():
    shard = {"maxEdits": 1, "deletions": {"z": ["zoo"], "a": ["apple"]}}
    encoded = encode_fuzzy_shard_binary(shard)
    # Header: maxEdits=1(0x01), variantCount=2(0x02), then first
    # variant's string length(1) and byte -- "a" (0x61) must come
    # before "z" (0x7A).
    assert encoded[2] == 0x01  # length-prefix of first variant string
    assert encoded[3] == 0x61  # 'a', not 'z'


def test_multiple_terms_for_one_variant_are_all_listed():
    shard = {"maxEdits": 1, "deletions": {"ca": ["car", "cat"]}}
    encoded = encode_fuzzy_shard_binary(shard)
    # The variant's blob: termCount=2(0x02), string("car"), string("cat").
    blob_marker = bytes(
        [0x02, 0x03, 0x63, 0x61, 0x72, 0x03, 0x63, 0x61, 0x74]
    )
    assert blob_marker in encoded
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_binary_fuzzy_shard.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'searchable_indexer.binary_fuzzy_shard'`.

- [ ] **Step 3: Implement `binary_fuzzy_shard.py`**

```python
from searchable_indexer.byte_writer import ByteWriter

# Direct port of packages/indexer/src/binary-fuzzy-shard.ts's
# encodeFuzzyShardBinary.


def encode_fuzzy_shard_binary(shard: dict) -> bytes:
    variants = sorted(shard["deletions"].keys())
    blobs = []
    for variant in variants:
        terms = shard["deletions"].get(variant, [])
        w = ByteWriter()
        w.write_varint(len(terms))
        for term in terms:
            w.write_string(term)
        blobs.append(w.to_bytes())

    header = ByteWriter()
    header.write_varint(shard["maxEdits"])
    header.write_varint(len(variants))
    offset = 0
    for variant, blob in zip(variants, blobs):
        header.write_string(variant)
        header.write_varint(offset)
        header.write_varint(len(blob))
        offset += len(blob)

    blob_writer = ByteWriter()
    for blob in blobs:
        blob_writer.write_bytes(blob)

    return header.to_bytes() + blob_writer.to_bytes()
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_binary_fuzzy_shard.py -v
```
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/binary_fuzzy_shard.py python/searchable-indexer/tests/test_binary_fuzzy_shard.py
git commit -m "feat(searchable-indexer): add encode_fuzzy_shard_binary"
```

---

## Task 5: `write_index.py` integration

**Files:**
- Modify: `python/searchable-indexer/src/searchable_indexer/write_index.py`
- Test: `python/searchable-indexer/tests/test_write_index.py` (append)

**Interfaces:**
- Consumes: `encode_term_shard_binary` (Task 2), `encode_doc_store_binary` (Task 3), `encode_fuzzy_shard_binary` (Task 4).
- Produces: `write_index()` gains `term_shard_format: str = "json"`, `doc_store_format: str = "json"`, `fuzzy_shard_format: str = "json"` keyword arguments.

- [ ] **Step 1: Write the failing tests (append to `test_write_index.py`)**

```python
import json

from searchable_indexer.build_index import build_index
from searchable_indexer.types import SourceDocument
from searchable_indexer.write_index import write_index


def _doc(doc_id: int, url: str, title: str, body: str) -> SourceDocument:
    html = f'<html lang="en"><head><title>{title}</title></head><body><main>{body}</main></body></html>'
    return SourceDocument(id=doc_id, url=url, html=html)


def test_term_shard_format_binary_writes_bin_files_and_marks_manifest(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path), term_shard_format="binary")
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    term_entry = manifest["shards"]["terms"][0]
    assert term_entry["format"] == "binary"
    assert term_entry["file"].endswith(".bin")
    term_file = tmp_path / term_entry["file"]
    assert term_file.exists()
    # Binary content must not parse as JSON.
    try:
        json.loads(term_file.read_bytes())
        parsed_as_json = True
    except (json.JSONDecodeError, UnicodeDecodeError):
        parsed_as_json = False
    assert not parsed_as_json


def test_doc_store_format_binary_writes_bin_files_and_marks_manifest(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path), doc_store_format="binary")
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    docs_entry = manifest["shards"]["docs"][0]
    assert docs_entry["format"] == "binary"
    assert docs_entry["file"].endswith(".bin")
    assert (tmp_path / docs_entry["file"]).exists()


def test_fuzzy_shard_format_binary_writes_bin_files_and_marks_manifest(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")], fuzzy=True)
    write_index(built, str(tmp_path), fuzzy_shard_format="binary")
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    fuzzy_entry = manifest["fuzzy"]["en"]
    assert fuzzy_entry["format"] == "binary"
    assert fuzzy_entry["file"].endswith(".bin")
    assert (tmp_path / fuzzy_entry["file"]).exists()


def test_default_format_is_still_json_for_all_three(tmp_path):
    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")], fuzzy=True)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "format" not in manifest["shards"]["terms"][0]
    assert "format" not in manifest["shards"]["docs"][0]
    assert "format" not in manifest["fuzzy"]["en"]


def test_binary_term_shard_content_hash_matches_file_bytes(tmp_path):
    from searchable_indexer.hash import content_hash

    built = build_index([_doc(1, "/a", "Widgets", "widgets are great")])
    write_index(built, str(tmp_path), term_shard_format="binary")
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    term_entry = manifest["shards"]["terms"][0]
    file_bytes = (tmp_path / term_entry["file"]).read_bytes()
    assert content_hash(file_bytes) in term_entry["file"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_write_index.py -v -k "binary or default_format"
```
Expected: FAIL — `TypeError: write_index() got an unexpected keyword argument 'term_shard_format'` (and similar).

- [ ] **Step 3: Modify `write_index.py`**

Add these three imports at the top of the file, alongside the existing `from searchable_indexer.hash import content_hash` / `from searchable_indexer.types import BuiltIndex` lines:

```python
from searchable_indexer.binary_doc_store import encode_doc_store_binary
from searchable_indexer.binary_fuzzy_shard import encode_fuzzy_shard_binary
from searchable_indexer.binary_term_shard import encode_term_shard_binary
```

Add this new helper function immediately after `_write_json`:

```python
def _write_binary(out_dir: str, rel_path: str, data: bytes) -> str:
    digest = content_hash(data)
    hashed_rel_path = re.sub(r"\.bin$", f".{digest}.bin", rel_path)
    abs_path = Path(out_dir) / hashed_rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(data)
    return hashed_rel_path
```

Change the `write_index()` signature to:

```python
def write_index(
    built: BuiltIndex,
    out_dir: str,
    max_shard_gzip_bytes: int = DEFAULT_MAX_TERM_SHARD_GZIP_BYTES,
    shard_by_prefix: bool = True,
    doc_store_shard_size: float = float("inf"),
    term_shard_format: str = "json",
    doc_store_format: str = "json",
    fuzzy_shard_format: str = "json",
) -> None:
```

Replace the terms-writing loop (the `for prefix, group in buckets:` block) with:

```python
        for prefix, group in buckets:
            if term_shard_format == "binary":
                file = _write_binary(
                    out_dir,
                    f"terms/{language}/{prefix}.bin",
                    encode_term_shard_binary(group),
                )
                terms.append(
                    {
                        "lang": language,
                        "prefix": prefix,
                        "file": file,
                        "termCount": len(group),
                        "format": "binary",
                    }
                )
            else:
                file = _write_json(out_dir, f"terms/{language}/{prefix}.json", group)
                terms.append(
                    {
                        "lang": language,
                        "prefix": prefix,
                        "file": file,
                        "termCount": len(group),
                    }
                )
```

Replace the docs-writing loop (the `for shard_index, chunk in enumerate(doc_store_chunks):` block) with:

```python
    docs: list[dict] = []
    for shard_index, chunk in enumerate(doc_store_chunks):
        if doc_store_format == "binary":
            file = _write_binary(
                out_dir,
                f"docs/{shard_index}.bin",
                encode_doc_store_binary(chunk["shard"]),
            )
            docs.append(
                {
                    "shard": shard_index,
                    "file": file,
                    "idRange": list(chunk["idRange"]),
                    "format": "binary",
                }
            )
        else:
            file = _write_json(out_dir, f"docs/{shard_index}.json", chunk["shard"])
            docs.append(
                {"shard": shard_index, "file": file, "idRange": list(chunk["idRange"])}
            )
```

Replace the fuzzy-writing block (`if fuzzy_languages: fuzzy = {}; for language in fuzzy_languages: ...`) with:

```python
    fuzzy = None
    if fuzzy_languages:
        fuzzy = {}
        for language in fuzzy_languages:
            if fuzzy_shard_format == "binary":
                file = _write_binary(
                    out_dir,
                    f"fuzzy/{language}.bin",
                    encode_fuzzy_shard_binary(built.fuzzy_shards[language]),
                )
                fuzzy[language] = {"file": file, "format": "binary"}
            else:
                file = _write_json(
                    out_dir, f"fuzzy/{language}.json", built.fuzzy_shards[language]
                )
                fuzzy[language] = {"file": file}
```

(Every other part of `write_index()` — the terms/docs list-building setup above these loops, the facets/pins/synonyms sections, and the final manifest assembly — is unchanged from Phase 3.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_write_index.py -v
```
Expected: PASS (12 pre-existing + 5 new = 17 passed).

- [ ] **Step 5: Run the full package test suite to confirm no regressions**

```bash
uv run pytest -v
```
Expected: PASS (all tests, including every prior phase's).

- [ ] **Step 6: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/write_index.py python/searchable-indexer/tests/test_write_index.py
git commit -m "feat(searchable-indexer): wire binary term/doc-store/fuzzy shard formats into write_index"
```

---

## Task 6: Byte-identical cross-implementation test + end-to-end query test (TypeScript side)

**Files:**
- Modify: `packages/client/test/cross-implementation-conformance-python-indexer.test.ts`

**Interfaces:**
- Consumes: the Python `build_index`/`write_index` API directly (not the CLI — the CLI has no format flags, and adding them is out of scope for this plan). Invoked via a small inline Python script run through `uv run python -c "..."` from `python/searchable-indexer/` as the working directory.
- Consumes: `buildIndex`/`writeIndex` from `@ktjn/searchable-indexer` with `termShardFormat`/`docStoreFormat`/`fuzzyShardFormat: "binary"`.

- [ ] **Step 1: Read the existing file to confirm its real structure**

```bash
cat packages/client/test/cross-implementation-conformance-python-indexer.test.ts
```

Confirm the existing fixture/helper shapes (`FixtureSource`, `toHtml()`, the `beforeAll`/`afterAll` setup, `serveStatic` usage, temp-directory conventions) before writing new code — reuse them, don't reinvent.

- [ ] **Step 2: Add a new `describe` block to the same file**

Add a second `describe` block (sibling to the existing one, in the same file) that:

1. Builds a small, fixed 2-document fixture (reuse the existing `FixtureSource`/`toHtml()` pattern from Step 1, or a smaller inline fixture — your judgment based on what's actually in the file) via the TS side: `buildIndex(sources, "en")` then `writeIndex(built, outDir, { termShardFormat: "binary", docStoreFormat: "binary" })`.
2. Builds the identical fixture via Python by writing a temporary `.py` script that imports and calls `build_index`/`write_index` directly with `term_shard_format="binary"`, `doc_store_format="binary"` — matching document ids/urls/html exactly, then running it via `execFileSync("uv", ["run", "python", scriptPath], { cwd: pythonIndexerDir })`. Example inline script content (adapt exact source list to match the TS side's fixture exactly):

```python
import sys
sys.path.insert(0, "src")
from searchable_indexer.build_index import build_index
from searchable_indexer.write_index import write_index
from searchable_indexer.types import SourceDocument

sources = [
    SourceDocument(id=1, url="/a", html='<html lang="en"><head><title>Widgets</title></head><body><main>Our widgets are wonderful.</main></body></html>'),
    SourceDocument(id=2, url="/b", html='<html lang="en"><head><title>Gadgets</title></head><body><main>Gadgets and gizmos.</main></body></html>'),
]
built = build_index(sources, "en")
write_index(built, sys.argv[1], term_shard_format="binary", doc_store_format="binary")
```

Write this to a temp file (`mkdtemp`), pass the Python-side output directory as `sys.argv[1]`.

3. Reads the manifest from both output directories, finds the corresponding term-shard and doc-store `.bin` file paths, and asserts the raw file bytes read via `readFileSync` are **byte-identical** (`Buffer.compare(tsBytes, pyBytes) === 0` or `expect(tsBytes.equals(pyBytes)).toBe(true)`) — for at least the term shard and the doc store shard.
4. Separately (defense-in-depth, not just byte comparison), serves the Python-built binary-format output over real HTTP via the existing `serveStatic` helper and confirms the real `SearchClient` can query it successfully (returns the expected doc for a known query word) — proving `@ktjn/searchable-client`'s actual binary decoder can read Python-produced binary shards, not just that the bytes happen to match TS's own output.

Use your judgment on the exact assertion/fixture code structure based on what's real in the file from Step 1 — this is the same kind of adaptation-from-a-sketch situation as the prior phase's equivalent tasks, and the same latitude applies: correct the sketch against the real APIs, keep the actual intent (byte-identical binary output + a real end-to-end query working).

- [ ] **Step 3: Run the test**

```bash
npx vitest run packages/client/test/cross-implementation-conformance-python-indexer.test.ts
```
Expected: PASS (previous tests + the new ones). If the byte-identical assertion fails, diagnose whether it's a genuine encoding bug in one of Tasks 1-4's Python modules (fix the Python code — this is a fully deterministic format, there is no legitimate "difference" to excuse here, unlike tokenization) rather than weakening the assertion.

- [ ] **Step 4: Commit**

```bash
git add packages/client/test/cross-implementation-conformance-python-indexer.test.ts
git commit -m "test: byte-identical cross-implementation conformance for the binary storage tier"
```

---

## Self-Review Notes

- **Spec coverage**: every section of `docs/superpowers/specs/2026-07-12-python-indexer-binary-tier-design.md` maps to a task — module layout (Tasks 1-4), `write_index.py` changes (Task 5), testing including the byte-identical cross-implementation guarantee (Task 6). Facets/synonyms/pins are correctly untouched by every task (no format option added for them anywhere).
- **Type consistency**: `ByteWriter` (Task 1) is used identically by all three encoders (Tasks 2-4). `encode_term_shard_binary`/`encode_doc_store_binary`/`encode_fuzzy_shard_binary`'s signatures (Tasks 2-4) match exactly how `write_index.py` (Task 5) calls them.
- **No placeholders**: every step contains complete, runnable code — no `TBD`, no "similar to Task N" shortcuts. Task 6's fixture-matching code has the same explicit, bounded adaptation latitude as prior phases' equivalent tasks (documented as such, not an open-ended gap).
