# Python Index-Creation Support (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add facets (terms/hierarchy/range), synonyms, fuzzy matching, and term pinning to the Python `searchable-indexer` package, matching `@ktjn/searchable-indexer`'s `buildIndex()`/`writeIndex()` behavior for these four features.

**Architecture:** Four new, focused modules (`facets.py`, `synonyms.py`, `fuzzy.py`, `pins.py`) under `searchable_indexer/`, each a direct port of the corresponding TS logic in `packages/indexer/src/build-index.ts`; `build_index.py` and `write_index.py` are extended (not rewritten) to wire them in, following the same pattern as Phase 1+2.

**Tech Stack:** Python 3.10+, `uv` + `pytest` (already set up), no new dependencies.

## Global Constraints

- Minimum Python version: 3.10 (unchanged from Phase 1+2).
- No vector shard building, no binary storage tier in this plan — facet/pins/synonyms/fuzzy shards are always written as JSON.
- New `build_index()` keyword arguments use the existing plain-kwarg style (`hierarchical_facets`, `range_facet_buckets`, `synonyms`, `fuzzy`, `fuzzy_max_edits`), not a bundled options object — matching Phase 2's `field_boosts`/`allowed_url_origins`/`canonical_base_url` convention.
- `BuiltIndex`'s four new fields (`facet_shards`, `pins_shards`, `synonym_shards`, `fuzzy_shards`) must default to empty dicts so every existing call site (Phase 1+2 tests, `cli.py`) keeps working unmodified.
- Every new module is a faithful, deliberate port of its TS counterpart in `packages/indexer/src/build-index.ts` — cite the specific TS function being ported in each module's docstring/comment, the same convention Phase 1+2 established.
- Every emitted shard must validate against its frozen schema: `spec/schema/facet-shard.schema.json`, `pins-shard.schema.json`, `synonym-shard.schema.json`, `fuzzy-shard.schema.json`.

---

## Task 1: `types.py` extension + `facets.py`

**Files:**
- Modify: `python/searchable-indexer/src/searchable_indexer/types.py`
- Create: `python/searchable-indexer/src/searchable_indexer/facets.py`
- Test: `python/searchable-indexer/tests/test_facets.py`

**Interfaces:**
- Produces: `BuiltIndex` gains `facet_shards: dict[str, dict] = field(default_factory=dict)`, `pins_shards: dict[str, dict] = field(default_factory=dict)`, `synonym_shards: dict[str, dict] = field(default_factory=dict)`, `fuzzy_shards: dict[str, dict] = field(default_factory=dict)`.
- Produces: `expand_hierarchy_paths(full_path: str, separator: str) -> list[str]`; `add_facet_values(facet_shards: dict[str, dict], facets: dict[str, list[str]], doc_id: int, hierarchical_facets: dict[str, dict]) -> None`; `add_range_facet_values(facet_shards: dict[str, dict], range_facets: dict[str, float], doc_id: int) -> None`; `compute_range_facet_buckets_equal_width(shard: dict, bucket_count: int) -> None`; `compute_range_facet_buckets_explicit(shard: dict, boundaries: list[float]) -> None`; `RANGE_FACET_BUCKET_COUNT = 5` — all used by `build_index.py` in Task 5.

- [ ] **Step 1: Modify `types.py`**

Add these four fields to the end of the existing `BuiltIndex` dataclass (after `id_range: tuple[int, int]`):

```python
    facet_shards: dict[str, dict] = field(default_factory=dict)
    pins_shards: dict[str, dict] = field(default_factory=dict)
    synonym_shards: dict[str, dict] = field(default_factory=dict)
    fuzzy_shards: dict[str, dict] = field(default_factory=dict)
```

The full `BuiltIndex` class becomes:

```python
@dataclass
class BuiltIndex:
    manifest: dict
    term_shards: dict[str, dict]
    doc_store: dict
    id_range: tuple[int, int]
    facet_shards: dict[str, dict] = field(default_factory=dict)
    pins_shards: dict[str, dict] = field(default_factory=dict)
    synonym_shards: dict[str, dict] = field(default_factory=dict)
    fuzzy_shards: dict[str, dict] = field(default_factory=dict)
```

- [ ] **Step 2: Write the failing tests for `types.py`'s new fields**

Append to `python/searchable-indexer/tests/test_types.py`:

```python
def test_built_index_new_fields_default_to_empty_dicts():
    built = BuiltIndex(manifest={}, term_shards={}, doc_store={}, id_range=(0, 0))
    assert built.facet_shards == {}
    assert built.pins_shards == {}
    assert built.synonym_shards == {}
    assert built.fuzzy_shards == {}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd python/searchable-indexer
uv run pytest tests/test_types.py -v
```
Expected: FAIL — `TypeError: BuiltIndex.__init__() got an unexpected keyword argument` is NOT what happens here (the test doesn't pass those kwargs); instead it fails with `AttributeError: 'BuiltIndex' object has no attribute 'facet_shards'`.

- [ ] **Step 4: Apply the `types.py` change from Step 1, then run test to verify it passes**

```bash
uv run pytest tests/test_types.py -v
```
Expected: PASS (5 passed — 4 pre-existing + 1 new).

- [ ] **Step 5: Write the failing tests for `facets.py`**

```python
from searchable_indexer.facets import (
    RANGE_FACET_BUCKET_COUNT,
    add_facet_values,
    add_range_facet_values,
    compute_range_facet_buckets_equal_width,
    compute_range_facet_buckets_explicit,
    expand_hierarchy_paths,
)


def test_expand_hierarchy_paths_returns_every_ancestor_plus_self():
    assert expand_hierarchy_paths("a>b>c", ">") == ["a", "a>b", "a>b>c"]


def test_expand_hierarchy_paths_with_no_separator_returns_just_itself():
    assert expand_hierarchy_paths("standalone", ">") == ["standalone"]


def test_add_facet_values_terms_facet_counts_and_collects_doc_ids():
    shards: dict[str, dict] = {}
    add_facet_values(shards, {"color": ["red", "blue"]}, 1, {})
    add_facet_values(shards, {"color": ["red"]}, 2, {})
    assert shards["color"]["type"] == "terms"
    assert shards["color"]["values"]["red"] == {"count": 2, "docs": [1, 2]}
    assert shards["color"]["values"]["blue"] == {"count": 1, "docs": [1]}


def test_add_facet_values_hierarchy_facet_dedupes_shared_ancestor():
    shards: dict[str, dict] = {}
    add_facet_values(
        shards,
        {"category": ["a>b", "a>c"]},
        1,
        {"category": {}},
    )
    # "a" is a shared ancestor of both "a>b" and "a>c" -- must only be
    # counted once for this one document, not twice.
    assert shards["category"]["values"]["a"]["count"] == 1
    assert shards["category"]["values"]["a>b"]["count"] == 1
    assert shards["category"]["values"]["a>c"]["count"] == 1


def test_add_facet_values_hierarchy_facet_respects_custom_separator():
    shards: dict[str, dict] = {}
    add_facet_values(
        shards,
        {"category": ["a/b"]},
        1,
        {"category": {"separator": "/"}},
    )
    assert shards["category"]["separator"] == "/"
    assert "a/b" in shards["category"]["values"]
    assert "a" in shards["category"]["values"]


def test_add_facet_values_first_declaration_wins_over_range_facet_conflict():
    shards: dict[str, dict] = {"price": {"type": "range", "values": {}, "sorted": []}}
    add_facet_values(shards, {"price": ["cheap"]}, 1, {})
    # Already declared as a range facet -- terms declaration is ignored.
    assert shards["price"]["type"] == "range"
    assert "cheap" not in shards["price"]["values"]


def test_add_range_facet_values_appends_to_sorted():
    shards: dict[str, dict] = {}
    add_range_facet_values(shards, {"price": 19.99}, 1)
    add_range_facet_values(shards, {"price": 5.0}, 2)
    assert shards["price"]["type"] == "range"
    assert shards["price"]["sorted"] == [
        {"value": 19.99, "doc": 1},
        {"value": 5.0, "doc": 2},
    ]


def test_compute_range_facet_buckets_equal_width_single_distinct_value():
    shard = {
        "type": "range",
        "values": {},
        "sorted": [{"value": 10.0, "doc": 1}, {"value": 10.0, "doc": 2}],
    }
    compute_range_facet_buckets_equal_width(shard, RANGE_FACET_BUCKET_COUNT)
    assert shard["values"] == {"10": {"count": 2, "docs": [1, 2]}}


def test_compute_range_facet_buckets_equal_width_spreads_across_buckets():
    shard = {
        "type": "range",
        "values": {},
        "sorted": [
            {"value": 0.0, "doc": 1},
            {"value": 50.0, "doc": 2},
            {"value": 100.0, "doc": 3},
        ],
    }
    compute_range_facet_buckets_equal_width(shard, 2)
    # width = 50; bucket 0 = [0,50), bucket 1 (last, open-ended) = [50,100]
    assert shard["values"]["0-50"]["docs"] == [1]
    assert shard["values"]["50+"]["docs"] == [2, 3]


def test_compute_range_facet_buckets_explicit_uses_author_boundaries():
    shard = {
        "type": "range",
        "values": {},
        "sorted": [
            {"value": 10.0, "doc": 1},
            {"value": 30.0, "doc": 2},
            {"value": 60.0, "doc": 3},
        ],
    }
    compute_range_facet_buckets_explicit(shard, [25, 50])
    assert shard["values"]["<25"]["docs"] == [1]
    assert shard["values"]["25-50"]["docs"] == [2]
    assert shard["values"]["50+"]["docs"] == [3]


def test_compute_range_facet_buckets_does_nothing_for_empty_sorted():
    shard = {"type": "range", "values": {}, "sorted": []}
    compute_range_facet_buckets_equal_width(shard, RANGE_FACET_BUCKET_COUNT)
    assert shard["values"] == {}
```

- [ ] **Step 6: Run test to verify it fails**

```bash
uv run pytest tests/test_facets.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'searchable_indexer.facets'`.

- [ ] **Step 7: Implement `facets.py`**

```python
import math

# Direct port of packages/indexer/src/build-index.ts's addFacetValues /
# addRangeFacetValues / expandHierarchyPaths /
# computeRangeFacetBuckets{EqualWidth,Explicit} / addToBucket /
# formatBucketBound.

DEFAULT_HIERARCHY_SEPARATOR = ">"
RANGE_FACET_BUCKET_COUNT = 5


def expand_hierarchy_paths(full_path: str, separator: str) -> list[str]:
    segments = [s.strip() for s in full_path.split(separator) if s.strip()]
    if not segments:
        return [full_path]
    return [separator.join(segments[: i + 1]) for i in range(len(segments))]


def add_facet_values(
    facet_shards: dict[str, dict],
    facets: dict[str, list[str]],
    doc_id: int,
    hierarchical_facets: dict[str, dict],
) -> None:
    for field_name, values in facets.items():
        hierarchy_config = hierarchical_facets.get(field_name)
        shard = facet_shards.get(field_name)
        if shard is None:
            if hierarchy_config is not None:
                shard = {
                    "type": "hierarchy",
                    "separator": hierarchy_config.get(
                        "separator", DEFAULT_HIERARCHY_SEPARATOR
                    ),
                    "values": {},
                }
            else:
                shard = {"type": "terms", "values": {}}
            facet_shards[field_name] = shard
        elif shard["type"] not in ("terms", "hierarchy"):
            # Same field also declared as a range facet elsewhere --
            # first declaration wins.
            continue

        # A doc's own distinct values can still overlap at an ancestor
        # level once expanded -- union into a set first so a shared
        # ancestor is only counted once for this document.
        paths: set[str] = set()
        for value in values:
            if shard["type"] == "hierarchy":
                separator = shard.get("separator", DEFAULT_HIERARCHY_SEPARATOR)
                paths.update(expand_hierarchy_paths(value, separator))
            else:
                paths.add(value)

        for path in paths:
            entry = shard["values"].setdefault(path, {"count": 0, "docs": []})
            entry["docs"].append(doc_id)
            entry["count"] += 1


def add_range_facet_values(
    facet_shards: dict[str, dict],
    range_facets: dict[str, float],
    doc_id: int,
) -> None:
    for field_name, value in range_facets.items():
        shard = facet_shards.get(field_name)
        if shard is None:
            shard = {"type": "range", "values": {}, "sorted": []}
            facet_shards[field_name] = shard
        elif shard["type"] != "range":
            # Same field also declared as a terms facet elsewhere --
            # first declaration wins.
            continue
        shard["sorted"].append({"value": value, "doc": doc_id})


def _format_bucket_bound(n: float) -> str:
    rounded = round(n, 2)
    if rounded == int(rounded):
        return str(int(rounded))
    return str(rounded)


def _add_to_bucket(shard: dict, label: str, doc: int) -> None:
    entry = shard["values"].get(label)
    if entry is None:
        entry = {"count": 0, "docs": []}
        shard["values"][label] = entry
    entry["docs"].append(doc)
    entry["count"] += 1


def compute_range_facet_buckets_equal_width(shard: dict, bucket_count: int) -> None:
    sorted_entries = shard.get("sorted", [])
    if not sorted_entries:
        return
    min_value = sorted_entries[0]["value"]
    max_value = sorted_entries[-1]["value"]

    if min_value == max_value:
        shard["values"][_format_bucket_bound(min_value)] = {
            "count": len(sorted_entries),
            "docs": [e["doc"] for e in sorted_entries],
        }
        return

    width = (max_value - min_value) / bucket_count
    labels = []
    for i in range(bucket_count):
        lo = min_value + i * width
        hi = min_value + (i + 1) * width
        if i == bucket_count - 1:
            labels.append(f"{_format_bucket_bound(lo)}+")
        else:
            labels.append(f"{_format_bucket_bound(lo)}-{_format_bucket_bound(hi)}")

    for entry in sorted_entries:
        index = min(
            bucket_count - 1, math.floor((entry["value"] - min_value) / width)
        )
        _add_to_bucket(shard, labels[index], entry["doc"])


def compute_range_facet_buckets_explicit(shard: dict, boundaries: list[float]) -> None:
    sorted_entries = shard.get("sorted", [])
    if not sorted_entries:
        return

    labels = []
    for i, b in enumerate(boundaries):
        if i == 0:
            labels.append(f"<{_format_bucket_bound(b)}")
        else:
            labels.append(
                f"{_format_bucket_bound(boundaries[i - 1])}-{_format_bucket_bound(b)}"
            )
    labels.append(f"{_format_bucket_bound(boundaries[-1])}+")

    for entry in sorted_entries:
        index = next(
            (i for i, b in enumerate(boundaries) if entry["value"] < b),
            len(boundaries),
        )
        _add_to_bucket(shard, labels[index], entry["doc"])
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
uv run pytest tests/test_facets.py tests/test_types.py -v
```
Expected: PASS (11 + 5 = 16 passed).

- [ ] **Step 9: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/types.py python/searchable-indexer/src/searchable_indexer/facets.py python/searchable-indexer/tests/test_facets.py python/searchable-indexer/tests/test_types.py
git commit -m "feat(searchable-indexer): add facets.py (terms/hierarchy/range facets), extend BuiltIndex"
```

---

## Task 2: `synonyms.py`

**Files:**
- Create: `python/searchable-indexer/src/searchable_indexer/synonyms.py`
- Test: `python/searchable-indexer/tests/test_synonyms.py`

**Interfaces:**
- Consumes: `get_language_profile`, `normalize_phrase` from `searchable_analysis` (already available — `searchable-indexer` depends on `searchable-analysis`).
- Produces: `build_synonym_shards(raw_synonyms: dict[str, dict] | None) -> dict[str, dict]`, used by `build_index.py` in Task 5.

- [ ] **Step 1: Write the failing tests**

```python
from searchable_indexer.synonyms import build_synonym_shards


def test_returns_empty_dict_for_none_input():
    assert build_synonym_shards(None) == {}


def test_normalizes_equivalences_through_the_language_pipeline():
    shards = build_synonym_shards(
        {"en": {"equivalences": [["Couch", "Sofa"]]}}
    )
    assert shards["en"]["equivalences"] == [["couch", "sofa"]]


def test_drops_single_member_equivalence_groups():
    # "widget" normalizes the same as itself and "widgets" also stems
    # to "widget" -- after dedup this collapses to one member, which
    # is dropped as nothing-left-to-expand-to.
    shards = build_synonym_shards(
        {"en": {"equivalences": [["widget", "widgets"]]}}
    )
    assert shards["en"].get("equivalences", []) == []


def test_normalizes_directional_keys_and_targets():
    shards = build_synonym_shards(
        {"en": {"directional": {"TV": ["Television", "Telly"]}}}
    )
    assert shards["en"]["directional"] == {"tv": ["television", "telli"]}


def test_drops_directional_entry_with_empty_normalized_targets():
    shards = build_synonym_shards({"en": {"directional": {"a": [""]}}})
    assert shards["en"].get("directional", {}) == {}


def test_normalizes_multi_word_phrases_as_a_unit():
    shards = build_synonym_shards(
        {"en": {"multiWord": [["New York", "NYC", "Big Apple"]]}}
    )
    normalized = shards["en"]["multiWord"][0]
    assert "new york" in normalized
    assert "nyc" in normalized
    assert "big apple" in normalized


def test_multiple_languages_each_normalized_with_their_own_profile():
    shards = build_synonym_shards(
        {
            "en": {"equivalences": [["Couch", "Sofa"]]},
            "de": {"equivalences": [["Sofa", "Couch"]]},
        }
    )
    assert "en" in shards
    assert "de" in shards


def test_empty_source_produces_a_shard_with_no_keys():
    shards = build_synonym_shards({"en": {}})
    assert shards["en"] == {}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_synonyms.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'searchable_indexer.synonyms'`.

- [ ] **Step 3: Implement `synonyms.py`**

```python
from searchable_analysis import get_language_profile, normalize_phrase

# Direct port of packages/indexer/src/build-index.ts's buildSynonymShards.


def _normalize_dedup(terms: list[str], normalize) -> list[str]:
    return list(dict.fromkeys(filter(None, (normalize(t) for t in terms))))


def build_synonym_shards(raw_synonyms: dict[str, dict] | None) -> dict[str, dict]:
    synonym_shards: dict[str, dict] = {}
    if not raw_synonyms:
        return synonym_shards

    for language, source in raw_synonyms.items():
        profile = get_language_profile(language)

        def normalize(term: str, _profile=profile) -> str:
            return normalize_phrase(term, _profile)

        equivalences = []
        for group in source.get("equivalences", []):
            normalized_group = _normalize_dedup(group, normalize)
            if len(normalized_group) >= 2:
                equivalences.append(normalized_group)

        directional: dict[str, list[str]] = {}
        for key, targets in source.get("directional", {}).items():
            normalized_key = normalize(key)
            if not normalized_key:
                continue
            normalized_targets = _normalize_dedup(targets, normalize)
            if not normalized_targets:
                continue
            directional[normalized_key] = normalized_targets

        multi_word = []
        for group in source.get("multiWord", []):
            normalized_group = _normalize_dedup(group, normalize)
            if len(normalized_group) >= 2:
                multi_word.append(normalized_group)

        shard: dict = {}
        if equivalences:
            shard["equivalences"] = equivalences
        if directional:
            shard["directional"] = directional
        if multi_word:
            shard["multiWord"] = multi_word
        synonym_shards[language] = shard

    return synonym_shards
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_synonyms.py -v
```
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/synonyms.py python/searchable-indexer/tests/test_synonyms.py
git commit -m "feat(searchable-indexer): add synonyms.py (equivalences/directional/multiWord normalization)"
```

---

## Task 3: `fuzzy.py`

**Files:**
- Create: `python/searchable-indexer/src/searchable_indexer/fuzzy.py`
- Test: `python/searchable-indexer/tests/test_fuzzy.py`

**Interfaces:**
- Produces: `build_fuzzy_shard(term_shard: dict, max_edits: int) -> dict`, used by `build_index.py` in Task 5.

- [ ] **Step 1: Write the failing tests**

```python
from searchable_indexer.fuzzy import build_fuzzy_shard


def test_max_edits_1_generates_single_deletion_variants():
    term_shard = {"cat": {"df": 1, "postings": []}}
    shard = build_fuzzy_shard(term_shard, 1)
    assert shard["maxEdits"] == 1
    # "cat" itself (0 deletions) plus every single-character deletion:
    # "at", "ct", "ca".
    assert shard["deletions"]["cat"] == ["cat"]
    assert shard["deletions"]["at"] == ["cat"]
    assert shard["deletions"]["ct"] == ["cat"]
    assert shard["deletions"]["ca"] == ["cat"]


def test_max_edits_2_generates_deletion_of_deletion_variants():
    term_shard = {"cats": {"df": 1, "postings": []}}
    shard = build_fuzzy_shard(term_shard, 2)
    assert shard["maxEdits"] == 2
    # Deleting 2 characters from "cats" reaches "as" (delete c, t) --
    # this is a distance-2 variant only reachable via the second
    # deletion pass, not a distance-1 deletion of "cats" itself.
    assert "as" in shard["deletions"]
    assert "cats" in shard["deletions"]["as"]


def test_multiple_terms_colliding_on_the_same_deletion_variant_both_listed():
    term_shard = {
        "cat": {"df": 1, "postings": []},
        "car": {"df": 1, "postings": []},
    }
    shard = build_fuzzy_shard(term_shard, 1)
    # Both "cat" and "car" delete to "ca".
    assert shard["deletions"]["ca"] == ["car", "cat"]  # sorted


def test_empty_term_shard_produces_empty_deletions():
    shard = build_fuzzy_shard({}, 1)
    assert shard == {"maxEdits": 1, "deletions": {}}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_fuzzy.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'searchable_indexer.fuzzy'`.

- [ ] **Step 3: Implement `fuzzy.py`**

```python
# Direct port of packages/indexer/src/build-index.ts's
# buildFuzzyShard / generateDeletes -- a SymSpell-style deletion
# dictionary: every string reachable by deleting up to max_edits
# Unicode code points from a term (plus the term itself, 0 deletions).


def _generate_deletes(term: str, max_edits: int) -> set[str]:
    frontier = {term}
    all_variants = set(frontier)
    for _ in range(max_edits):
        next_frontier: set[str] = set()
        for variant in frontier:
            chars = list(variant)
            for i in range(len(chars)):
                next_frontier.add("".join(chars[:i] + chars[i + 1 :]))
        all_variants |= next_frontier
        frontier = next_frontier
    return all_variants


def build_fuzzy_shard(term_shard: dict, max_edits: int) -> dict:
    deletion_sets: dict[str, set[str]] = {}
    for term in term_shard:
        for variant in _generate_deletes(term, max_edits):
            deletion_sets.setdefault(variant, set()).add(term)

    deletions = {variant: sorted(terms) for variant, terms in deletion_sets.items()}
    return {"maxEdits": max_edits, "deletions": deletions}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_fuzzy.py -v
```
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/fuzzy.py python/searchable-indexer/tests/test_fuzzy.py
git commit -m "feat(searchable-indexer): add fuzzy.py (SymSpell deletion dictionary)"
```

---

## Task 4: `pins.py`

**Files:**
- Create: `python/searchable-indexer/src/searchable_indexer/pins.py`
- Test: `python/searchable-indexer/tests/test_pins.py`

**Interfaces:**
- Produces: `resolve_pins(pins_acc_by_language: dict[str, dict[str, dict]]) -> tuple[dict[str, dict], list[str]]`, used by `build_index.py` in Task 5. Input shape: language → normalized phrase → `{"mode": str, "docs": [{"id": int, "priority": float, "exclusive": bool, "boost": float}, ...]}`.

- [ ] **Step 1: Write the failing tests**

```python
from searchable_indexer.pins import resolve_pins


def test_single_pin_no_conflict_produces_no_warning():
    acc = {"en": {"widgets": {"mode": "exact", "docs": [
        {"id": 1, "priority": 0.0, "exclusive": False, "boost": 1.0},
    ]}}}
    shards, warnings = resolve_pins(acc)
    assert warnings == []
    assert shards["en"]["widgets"]["mode"] == "exact"
    assert shards["en"]["widgets"]["docs"] == [
        {"id": 1, "priority": 0.0, "exclusive": False}
    ]


def test_sorts_by_priority_descending_first():
    acc = {"en": {"widgets": {"mode": "exact", "docs": [
        {"id": 1, "priority": 1.0, "exclusive": False, "boost": 1.0},
        {"id": 2, "priority": 5.0, "exclusive": False, "boost": 1.0},
    ]}}}
    shards, _ = resolve_pins(acc)
    assert [d["id"] for d in shards["en"]["widgets"]["docs"]] == [2, 1]


def test_ties_on_priority_broken_by_boost_descending():
    acc = {"en": {"widgets": {"mode": "exact", "docs": [
        {"id": 1, "priority": 1.0, "exclusive": False, "boost": 1.0},
        {"id": 2, "priority": 1.0, "exclusive": False, "boost": 3.0},
    ]}}}
    shards, _ = resolve_pins(acc)
    assert [d["id"] for d in shards["en"]["widgets"]["docs"]] == [2, 1]


def test_ties_on_priority_and_boost_preserve_insertion_order():
    acc = {"en": {"widgets": {"mode": "exact", "docs": [
        {"id": 5, "priority": 1.0, "exclusive": False, "boost": 1.0},
        {"id": 3, "priority": 1.0, "exclusive": False, "boost": 1.0},
    ]}}}
    shards, _ = resolve_pins(acc)
    assert [d["id"] for d in shards["en"]["widgets"]["docs"]] == [5, 3]


def test_multiple_distinct_docs_pinning_same_phrase_produces_one_warning():
    acc = {"en": {"widgets": {"mode": "exact", "docs": [
        {"id": 1, "priority": 5.0, "exclusive": False, "boost": 1.0},
        {"id": 2, "priority": 1.0, "exclusive": False, "boost": 1.0},
    ]}}}
    _, warnings = resolve_pins(acc)
    assert len(warnings) == 1
    assert "widgets" in warnings[0]
    assert "en" in warnings[0]


def test_same_doc_pinning_same_phrase_twice_produces_no_warning():
    # Distinct *pages* pinning the same phrase is a conflict; the same
    # page appearing twice in the accumulator (shouldn't normally
    # happen, but is not itself a conflict) is not.
    acc = {"en": {"widgets": {"mode": "exact", "docs": [
        {"id": 1, "priority": 5.0, "exclusive": False, "boost": 1.0},
        {"id": 1, "priority": 5.0, "exclusive": False, "boost": 1.0},
    ]}}}
    _, warnings = resolve_pins(acc)
    assert warnings == []


def test_empty_accumulator_produces_no_shards_or_warnings():
    shards, warnings = resolve_pins({})
    assert shards == {}
    assert warnings == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_pins.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'searchable_indexer.pins'`.

- [ ] **Step 3: Implement `pins.py`**

```python
# Direct port of packages/indexer/src/build-index.ts's resolvePins:
# applies the priority -> doc-boost -> insertion-order tie-break from
# docs/16-term-to-page-pinning.md#conflicting-pins.


def resolve_pins(
    pins_acc_by_language: dict[str, dict[str, dict]],
) -> tuple[dict[str, dict], list[str]]:
    pins_shards: dict[str, dict] = {}
    warnings: list[str] = []

    for language, pins_acc in pins_acc_by_language.items():
        pins_shard: dict = {}
        for phrase, acc in pins_acc.items():
            # Python's sorted() is stable (Timsort), matching the TS
            # original's reliance on Array#sort's ES2019-guaranteed
            # stability for the insertion-order tie-break.
            sorted_docs = sorted(
                acc["docs"], key=lambda d: (-d["priority"], -d["boost"])
            )
            # dict.fromkeys preserves first-occurrence order (matching
            # JS Set iteration order), not numeric order -- the warning
            # message lists doc ids in priority/boost/build order, same
            # as the TS original.
            distinct_doc_ids = list(dict.fromkeys(d["id"] for d in sorted_docs))
            if len(distinct_doc_ids) > 1:
                ids_str = ", ".join(str(i) for i in distinct_doc_ids)
                warnings.append(
                    f'pin conflict: "{phrase}" ({language}) is pinned by '
                    f"{len(distinct_doc_ids)} pages (doc ids {ids_str}) -- "
                    "resolved by priority/boost/build order; see "
                    "docs/16-term-to-page-pinning.md#conflicting-pins"
                )
            pins_shard[phrase] = {
                "mode": acc["mode"],
                "docs": [
                    {
                        "id": d["id"],
                        "priority": d["priority"],
                        "exclusive": d["exclusive"],
                    }
                    for d in sorted_docs
                ],
            }
        pins_shards[language] = pins_shard

    return pins_shards, warnings
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_pins.py -v
```
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/pins.py python/searchable-indexer/tests/test_pins.py
git commit -m "feat(searchable-indexer): add pins.py (pin conflict resolution and tie-break)"
```

---

## Task 5: `build_index.py` integration

**Files:**
- Modify: `python/searchable-indexer/src/searchable_indexer/build_index.py`
- Test: `python/searchable-indexer/tests/test_build_index.py` (append)

**Interfaces:**
- Consumes: `add_facet_values`, `add_range_facet_values`, `compute_range_facet_buckets_equal_width`, `compute_range_facet_buckets_explicit`, `RANGE_FACET_BUCKET_COUNT` (Task 1); `build_synonym_shards` (Task 2); `build_fuzzy_shard` (Task 3); `resolve_pins` (Task 4); `normalize_phrase` (from `searchable_analysis`, already a dependency).
- Produces: `build_index()` gains keyword arguments `hierarchical_facets`, `range_facet_buckets`, `synonyms`, `fuzzy`, `fuzzy_max_edits`; returns a `BuiltIndex` with `facet_shards`/`pins_shards`/`synonym_shards`/`fuzzy_shards` populated. Used by `write_index.py` in Task 6.

- [ ] **Step 1: Write the failing tests (append to `test_build_index.py`)**

```python
import pytest

from searchable_indexer.build_index import build_index
from searchable_indexer.types import SourceDocument


def _doc_with_meta(doc_id: int, url: str, title: str, body: str, extra_head: str = "") -> SourceDocument:
    html = (
        f'<html lang="en"><head><title>{title}</title>{extra_head}</head>'
        f"<body><main>{body}</main></body></html>"
    )
    return SourceDocument(id=doc_id, url=url, html=html)


def test_terms_facets_are_indexed_from_searchable_facet_meta_tags():
    doc = _doc_with_meta(
        1, "/a", "Widgets", "widgets",
        extra_head='<meta name="searchable-facet-color" content="red">',
    )
    built = build_index([doc])
    assert built.facet_shards["color"]["type"] == "terms"
    assert built.facet_shards["color"]["values"]["red"]["docs"] == [1]


def test_hierarchical_facets_option_produces_hierarchy_shard():
    doc = _doc_with_meta(
        1, "/a", "Widgets", "widgets",
        extra_head='<meta name="searchable-facet-category" content="a>b">',
    )
    built = build_index([doc], hierarchical_facets={"category": {}})
    assert built.facet_shards["category"]["type"] == "hierarchy"
    assert "a" in built.facet_shards["category"]["values"]
    assert "a>b" in built.facet_shards["category"]["values"]


def test_range_facets_get_default_5_equal_width_buckets():
    docs = [
        _doc_with_meta(
            i, f"/d{i}", "T", "b",
            extra_head=f'<meta name="searchable-facet-range-price" content="{price}">',
        )
        for i, price in enumerate([10, 50, 90], start=1)
    ]
    built = build_index(docs)
    assert built.facet_shards["price"]["type"] == "range"
    assert len(built.facet_shards["price"]["values"]) <= 5


def test_range_facet_buckets_option_overrides_default_count():
    docs = [
        _doc_with_meta(
            i, f"/d{i}", "T", "b",
            extra_head=f'<meta name="searchable-facet-range-price" content="{price}">',
        )
        for i, price in enumerate([10, 50, 90], start=1)
    ]
    built = build_index(docs, range_facet_buckets={"price": 2})
    assert len(built.facet_shards["price"]["values"]) == 2


def test_invalid_range_facet_buckets_count_raises_value_error():
    doc = _doc_with_meta(1, "/a", "T", "b")
    with pytest.raises(ValueError, match="invalid range_facet_buckets count"):
        build_index([doc], range_facet_buckets={"price": 0})


def test_invalid_range_facet_buckets_boundaries_raises_value_error():
    doc = _doc_with_meta(1, "/a", "T", "b")
    with pytest.raises(ValueError, match="must be strictly ascending"):
        build_index([doc], range_facet_buckets={"price": [50, 25]})


def test_manifest_facet_fields_present_only_when_facets_exist():
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc])
    assert "facetFields" not in built.manifest

    doc2 = _doc_with_meta(
        1, "/a", "T", "b",
        extra_head='<meta name="searchable-facet-color" content="red">',
    )
    built2 = build_index([doc2])
    assert built2.manifest["facetFields"] == ["color"]


def test_pins_are_accumulated_and_resolved():
    doc = _doc_with_meta(
        1, "/a", "Widgets", "widgets are great",
        extra_head='<meta name="searchable-pin" content="widgets">',
    )
    built = build_index([doc])
    assert "widget" in built.pins_shards["en"]
    assert built.pins_shards["en"]["widget"]["docs"][0]["id"] == 1


def test_pin_conflict_prints_a_warning_to_stderr(capsys):
    doc1 = _doc_with_meta(
        1, "/a", "T", "b", extra_head='<meta name="searchable-pin" content="widgets">'
    )
    doc2 = _doc_with_meta(
        2, "/b", "T", "b", extra_head='<meta name="searchable-pin" content="widgets">'
    )
    build_index([doc1, doc2])
    captured = capsys.readouterr()
    assert "pin conflict" in captured.err


def test_synonyms_option_populates_synonym_shards():
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc], synonyms={"en": {"equivalences": [["Couch", "Sofa"]]}})
    assert built.synonym_shards["en"]["equivalences"] == [["couch", "sofa"]]


def test_fuzzy_false_by_default_produces_no_fuzzy_shards():
    doc = _doc_with_meta(1, "/a", "Widgets", "widgets")
    built = build_index([doc])
    assert built.fuzzy_shards == {}


def test_fuzzy_true_produces_a_deletion_dictionary_per_language():
    doc = _doc_with_meta(1, "/a", "Widgets", "widgets")
    built = build_index([doc], fuzzy=True)
    assert built.fuzzy_shards["en"]["maxEdits"] == 1
    assert "widget" in built.fuzzy_shards["en"]["deletions"]


def test_invalid_fuzzy_max_edits_raises_value_error():
    doc = _doc_with_meta(1, "/a", "T", "b")
    with pytest.raises(ValueError, match="invalid fuzzy_max_edits"):
        build_index([doc], fuzzy=True, fuzzy_max_edits=3)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_build_index.py -v -k "facet or pin or synonym or fuzzy"
```
Expected: FAIL — `TypeError: build_index() got an unexpected keyword argument 'hierarchical_facets'` (and similar) for most, since `build_index()` doesn't accept these kwargs yet.

- [ ] **Step 3: Modify `build_index.py`**

Add imports at the top of the file:

```python
import math
import sys

from searchable_analysis import analyze, get_language_profile, normalize_phrase
from searchable_indexer.extract import extract_document
from searchable_indexer.facets import (
    RANGE_FACET_BUCKET_COUNT,
    add_facet_values,
    add_range_facet_values,
    compute_range_facet_buckets_equal_width,
    compute_range_facet_buckets_explicit,
)
from searchable_indexer.fuzzy import build_fuzzy_shard
from searchable_indexer.pins import resolve_pins
from searchable_indexer.synonyms import build_synonym_shards
from searchable_indexer.types import BuiltIndex, SourceDocument
```

(This replaces the existing narrower import block at the top of the file — `datetime` stays as its own `import datetime` line, unchanged.)

Add this new validation helper, placed after `_derive_excerpt` and before `_add_postings`:

```python
def _validate_range_facet_buckets(range_facet_buckets: dict[str, int | list[float]]) -> None:
    for field_name, config in range_facet_buckets.items():
        if isinstance(config, list):
            if len(config) < 1 or not all(math.isfinite(n) for n in config):
                raise ValueError(
                    f"build_index: invalid range_facet_buckets boundaries {config!r} "
                    f'for field "{field_name}" -- must be a non-empty list of finite numbers'
                )
            for i in range(1, len(config)):
                if config[i] <= config[i - 1]:
                    raise ValueError(
                        f"build_index: invalid range_facet_buckets boundaries {config!r} "
                        f'for field "{field_name}" -- must be strictly ascending'
                    )
        else:
            if not isinstance(config, int) or isinstance(config, bool) or config < 1:
                raise ValueError(
                    f"build_index: invalid range_facet_buckets count {config!r} "
                    f'for field "{field_name}" -- must be a positive integer'
                )
```

Replace the entire `build_index()` function with:

```python
def build_index(
    sources: list[SourceDocument],
    default_language: str = "en",
    field_boosts: dict[str, float] | None = None,
    allowed_url_origins: list[str] | None = None,
    canonical_base_url: str | None = None,
    hierarchical_facets: dict[str, dict] | None = None,
    range_facet_buckets: dict[str, int | list[float]] | None = None,
    synonyms: dict[str, dict] | None = None,
    fuzzy: bool = False,
    fuzzy_max_edits: int = 1,
) -> BuiltIndex:
    _validate_source_ids(sources)
    boosts = {**_DEFAULT_FIELD_BOOSTS, **(field_boosts or {})}
    hierarchical_facets = hierarchical_facets or {}
    range_facet_buckets = range_facet_buckets or {}
    _validate_range_facet_buckets(range_facet_buckets)
    if fuzzy_max_edits not in (1, 2):
        raise ValueError(
            f"build_index: invalid fuzzy_max_edits {fuzzy_max_edits!r} -- must be 1 or 2"
        )

    term_shards: dict[str, dict] = {}
    posting_index_by_language: dict[str, dict] = {}
    doc_store: dict = {}
    facet_shards: dict[str, dict] = {}
    pins_acc_by_language: dict[str, dict] = {}
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

        add_facet_values(facet_shards, extracted.facets, source.id, hierarchical_facets)
        add_range_facet_values(facet_shards, extracted.range_facets, source.id)

        if extracted.pins:
            pins_acc = pins_acc_by_language.setdefault(language, {})
            for pin in extracted.pins:
                normalized = normalize_phrase(pin.phrase, profile)
                if not normalized:
                    continue
                acc = pins_acc.setdefault(normalized, {"mode": pin.mode, "docs": []})
                acc["docs"].append(
                    {
                        "id": source.id,
                        "priority": pin.priority,
                        "exclusive": pin.exclusive,
                        "boost": extracted.boost,
                    }
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

    pins_shards, pin_warnings = resolve_pins(pins_acc_by_language)
    for warning in pin_warnings:
        print(f"[searchable-indexer] {warning}", file=sys.stderr)

    for term_shard in term_shards.values():
        for entry in term_shard.values():
            entry["postings"].sort(key=lambda p: p["doc"])

    for field_name, shard in facet_shards.items():
        if shard.get("sorted") is not None:
            shard["sorted"].sort(key=lambda e: (e["value"], e["doc"]))
        if shard["type"] == "range":
            config = range_facet_buckets.get(field_name, RANGE_FACET_BUCKET_COUNT)
            if isinstance(config, list):
                compute_range_facet_buckets_explicit(shard, config)
            else:
                compute_range_facet_buckets_equal_width(shard, config)
    for shard in facet_shards.values():
        for entry in shard["values"].values():
            entry["docs"].sort()

    facet_fields = sorted(facet_shards.keys())
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

    fuzzy_shards: dict[str, dict] = {}
    if fuzzy:
        for language, term_shard in term_shards.items():
            fuzzy_shards[language] = build_fuzzy_shard(term_shard, fuzzy_max_edits)

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
        **({"facetFields": facet_fields} if facet_fields else {}),
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
        facet_shards=facet_shards,
        pins_shards=pins_shards,
        synonym_shards=build_synonym_shards(synonyms),
        fuzzy_shards=fuzzy_shards,
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_build_index.py -v
```
Expected: PASS (11 pre-existing + 13 new = 24 passed).

- [ ] **Step 5: Run the full package test suite to confirm no regressions**

```bash
uv run pytest -v
```
Expected: PASS (all tests, including every prior task's, pass with no regressions).

- [ ] **Step 6: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/build_index.py python/searchable-indexer/tests/test_build_index.py
git commit -m "feat(searchable-indexer): wire facets/synonyms/fuzzy/pins into build_index"
```

---

## Task 6: `write_index.py` integration

**Files:**
- Modify: `python/searchable-indexer/src/searchable_indexer/write_index.py`
- Test: `python/searchable-indexer/tests/test_write_index.py` (append)

**Interfaces:**
- Consumes: `built.facet_shards`, `built.pins_shards`, `built.synonym_shards`, `built.fuzzy_shards` (Task 1/5).
- Produces: `write_index()` now also writes `facets/<field>.json`, `pins/<lang>.json`, `synonyms/<lang>.json`, `fuzzy/<lang>.json`, and the corresponding manifest sections.

- [ ] **Step 1: Write the failing tests (append to `test_write_index.py`)**

```python
import json

from searchable_indexer.build_index import build_index
from searchable_indexer.types import SourceDocument
from searchable_indexer.write_index import write_index


def _doc_with_meta(doc_id, url, title, body, extra_head=""):
    html = (
        f'<html lang="en"><head><title>{title}</title>{extra_head}</head>'
        f"<body><main>{body}</main></body></html>"
    )
    return SourceDocument(id=doc_id, url=url, html=html)


def test_facet_shard_is_written_and_referenced_in_manifest(tmp_path):
    doc = _doc_with_meta(
        1, "/a", "T", "b", extra_head='<meta name="searchable-facet-color" content="red">'
    )
    built = build_index([doc])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["facetFields"] == ["color"]
    facets_entry = manifest["shards"]["facets"][0]
    assert facets_entry["field"] == "color"
    facet_shard = json.loads((tmp_path / facets_entry["file"]).read_text())
    assert facet_shard["values"]["red"]["docs"] == [1]


def test_no_facets_section_when_no_facets_present(tmp_path):
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "facets" not in manifest["shards"]
    assert "facetFields" not in manifest


def test_pins_shard_is_written_and_referenced_in_manifest(tmp_path):
    doc = _doc_with_meta(
        1, "/a", "Widgets", "widgets", extra_head='<meta name="searchable-pin" content="widgets">'
    )
    built = build_index([doc])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    pins_file = manifest["pins"]["en"]
    pins_shard = json.loads((tmp_path / pins_file).read_text())
    assert "widget" in pins_shard


def test_synonym_shard_is_written_and_referenced_in_manifest(tmp_path):
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc], synonyms={"en": {"equivalences": [["Couch", "Sofa"]]}})
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    synonyms_file = manifest["synonyms"]["en"]
    synonym_shard = json.loads((tmp_path / synonyms_file).read_text())
    assert synonym_shard["equivalences"] == [["couch", "sofa"]]


def test_fuzzy_shard_is_written_and_referenced_in_manifest(tmp_path):
    doc = _doc_with_meta(1, "/a", "Widgets", "widgets")
    built = build_index([doc], fuzzy=True)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    fuzzy_entry = manifest["fuzzy"]["en"]
    fuzzy_shard = json.loads((tmp_path / fuzzy_entry["file"]).read_text())
    assert fuzzy_shard["maxEdits"] == 1


def test_no_pins_synonyms_fuzzy_sections_when_none_configured(tmp_path):
    doc = _doc_with_meta(1, "/a", "T", "b")
    built = build_index([doc])
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "pins" not in manifest
    assert "synonyms" not in manifest
    assert "fuzzy" not in manifest
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_write_index.py -v -k "facet or pin or synonym or fuzzy"
```
Expected: FAIL — `KeyError` or `AssertionError` (the manifest currently never contains these sections since `write_index()` doesn't emit them yet).

- [ ] **Step 3: Modify `write_index.py`**

Replace the `write_index()` function's body from the `manifest = {**built.manifest, ...}` line onward (everything from that line to the end of the function) with:

```python
    facet_fields = sorted(built.facet_shards.keys())
    facets = None
    if facet_fields:
        facets = []
        for field_name in facet_fields:
            file = _write_json(
                out_dir, f"facets/{field_name}.json", built.facet_shards[field_name]
            )
            facets.append({"field": field_name, "file": file})

    pin_languages = sorted(
        language for language, shard in built.pins_shards.items() if shard
    )
    pins = None
    if pin_languages:
        pins = {}
        for language in pin_languages:
            pins[language] = _write_json(
                out_dir, f"pins/{language}.json", built.pins_shards[language]
            )

    def _synonym_shard_nonempty(shard: dict) -> bool:
        return bool(
            shard.get("equivalences") or shard.get("directional") or shard.get("multiWord")
        )

    synonym_languages = sorted(
        language
        for language, shard in built.synonym_shards.items()
        if _synonym_shard_nonempty(shard)
    )
    synonyms = None
    if synonym_languages:
        synonyms = {}
        for language in synonym_languages:
            synonyms[language] = _write_json(
                out_dir, f"synonyms/{language}.json", built.synonym_shards[language]
            )

    fuzzy_languages = sorted(
        language
        for language, shard in built.fuzzy_shards.items()
        if shard.get("deletions")
    )
    fuzzy = None
    if fuzzy_languages:
        fuzzy = {}
        for language in fuzzy_languages:
            file = _write_json(
                out_dir, f"fuzzy/{language}.json", built.fuzzy_shards[language]
            )
            fuzzy[language] = {"file": file}

    manifest = {
        **built.manifest,
        "shards": {
            "terms": terms,
            "docs": docs,
            **({"facets": facets} if facets else {}),
        },
        **({"pins": pins} if pins else {}),
        **({"synonyms": synonyms} if synonyms else {}),
        **({"fuzzy": fuzzy} if fuzzy else {}),
    }

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    (out_path / "manifest.json").write_text(_to_json(manifest), encoding="utf-8")
```

(The `terms`/`docs` list-building code above this point, and the function signature, are unchanged from Phase 2.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest tests/test_write_index.py -v
```
Expected: PASS (6 pre-existing + 6 new = 12 passed).

- [ ] **Step 5: Run the full package test suite to confirm no regressions**

```bash
uv run pytest -v
```
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add python/searchable-indexer/src/searchable_indexer/write_index.py python/searchable-indexer/tests/test_write_index.py
git commit -m "feat(searchable-indexer): write facets/pins/synonyms/fuzzy shards and manifest sections"
```

---

## Task 7: Schema conformance test extension

**Files:**
- Modify: `python/searchable-indexer/tests/test_schema_conformance.py` (append)

**Interfaces:**
- Consumes: `build_index`, `write_index` (with the new kwargs from Tasks 5-6); `spec/schema/facet-shard.schema.json`, `pins-shard.schema.json`, `synonym-shard.schema.json`, `fuzzy-shard.schema.json`.

- [ ] **Step 1: Write the failing tests**

```python
def test_facet_shard_validates_against_facet_shard_schema(tmp_path):
    docs = [
        SourceDocument(
            id=1, url="/a",
            html='<html lang="en"><head><title>T</title>'
                 '<meta name="searchable-facet-category" content="a>b">'
                 '<meta name="searchable-facet-range-price" content="19.99">'
                 '</head><body><main>widgets are great</main></body></html>',
        ),
    ]
    built = build_index(docs, hierarchical_facets={"category": {}})
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("facet-shard.schema.json")
    for facets_entry in manifest["shards"]["facets"]:
        facet_shard = json.loads((tmp_path / facets_entry["file"]).read_text())
        jsonschema.validate(instance=facet_shard, schema=schema)


def test_pins_shard_validates_against_pins_shard_schema(tmp_path):
    docs = [
        SourceDocument(
            id=1, url="/a",
            html='<html lang="en"><head><title>T</title>'
                 '<meta name="searchable-pin" content="widgets"></head>'
                 "<body><main>widgets are great</main></body></html>",
        ),
    ]
    built = build_index(docs)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("pins-shard.schema.json")
    for language, file in manifest.get("pins", {}).items():
        pins_shard = json.loads((tmp_path / file).read_text())
        jsonschema.validate(instance=pins_shard, schema=schema)


def test_synonym_shard_validates_against_synonym_shard_schema(tmp_path):
    docs = [_doc(1, "/a", "Widgets", "widgets are great")]
    built = build_index(docs, synonyms={"en": {"equivalences": [["Couch", "Sofa"]]}})
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("synonym-shard.schema.json")
    for language, file in manifest.get("synonyms", {}).items():
        synonym_shard = json.loads((tmp_path / file).read_text())
        jsonschema.validate(instance=synonym_shard, schema=schema)


def test_fuzzy_shard_validates_against_fuzzy_shard_schema(tmp_path):
    docs = [_doc(1, "/a", "Widgets", "widgets are great")]
    built = build_index(docs, fuzzy=True)
    write_index(built, str(tmp_path))
    manifest = json.loads((tmp_path / "manifest.json").read_text())

    schema = _load_schema("fuzzy-shard.schema.json")
    for language, entry in manifest.get("fuzzy", {}).items():
        fuzzy_shard = json.loads((tmp_path / entry["file"]).read_text())
        jsonschema.validate(instance=fuzzy_shard, schema=schema)
```

Note: `_doc` and `_load_schema` are the existing helper functions already defined earlier in `test_schema_conformance.py` from Phase 2 — reuse them, don't redefine. The `SourceDocument`/`build_index`/`write_index`/`json`/`jsonschema` imports at the top of the file are already present from Phase 2 too.

- [ ] **Step 2: Run tests to verify they fail or pass**

```bash
uv run pytest tests/test_schema_conformance.py -v
```
Expected: PASS if Tasks 1-6 are faithful ports (this test validates existing behavior against frozen schemas, doesn't require new implementation code) — if any assertion fails, fix the relevant module's output shape, don't weaken the schema check.

- [ ] **Step 3: Confirm pass**

```bash
uv run pytest tests/test_schema_conformance.py -v
```
Expected: PASS (3 pre-existing + 4 new = 7 passed).

- [ ] **Step 4: Commit**

```bash
git add python/searchable-indexer/tests/test_schema_conformance.py
git commit -m "test(searchable-indexer): validate facet/pins/synonym/fuzzy shards against spec/schema"
```

---

## Task 8: Cross-implementation conformance test extension (TypeScript side)

**Files:**
- Modify: `packages/client/test/cross-implementation-conformance-python-indexer.test.ts`

**Interfaces:**
- Consumes: the installed `searchable-indexer` Python CLI (already used by the existing tests in this file, from Phase 2); `SearchClient` from `@ktjn/searchable-client`.

Note: the Python `searchable-indexer` CLI (`cli.py`) currently calls `build_index(sources)` and `write_index(built, out_dir)` with no extra options — it does not yet expose a way to pass `hierarchical_facets`/`range_facet_buckets`/`synonyms`/`fuzzy`/`fuzzy_max_edits` from the command line. This task tests facets/pins (which are driven entirely by `searchable-facet-*`/`searchable-pin*` HTML meta tags, needing no CLI flag) and does NOT attempt to test synonyms/fuzzy cross-implementation conformance via the CLI, since neither the Python nor the TS `searchable-indexer` CLI exposes those as CLI flags today — both require the programmatic `buildIndex()`/`build_index()` API. Cross-implementation conformance for synonyms/fuzzy is deferred to whenever CLI flag support for both sides is added (out of scope for this plan).

- [ ] **Step 1: Read the existing file to match its structure**

```bash
cat packages/client/test/cross-implementation-conformance-python-indexer.test.ts
```

- [ ] **Step 2: Add a new fixture document and a new `it` block**

Add one more document to the `FIXTURE_SOURCES`-equivalent array/fixture set already defined in this file (check its exact current variable name and shape by reading the file per Step 1), with a `searchable-facet-category` and a `searchable-pin` meta tag, e.g.:

```html
<html lang="en"><head><title>Gizmos</title><meta name="searchable-facet-category" content="electronics"><meta name="searchable-pin" content="gizmos"></head><body><main>Gizmos and gadgets for the modern home.</main></body></html>
```

Then add a new `it` block to the existing `describe` in this file:

```typescript
  it("returns the same facet counts and pin-boosted top hit for a query against both implementations", async () => {
    const tsClient = new SearchClient({ indexUrl: `${tsBaseUrl}manifest.json` });
    const pyClient = new SearchClient({ indexUrl: `${pyBaseUrl}manifest.json` });

    const tsFacets = await tsClient.facetValues("category");
    const pyFacets = await pyClient.facetValues("category");
    expect(pyFacets).toEqual(tsFacets);

    const tsResult = await tsClient.search("gizmos");
    const pyResult = await pyClient.search("gizmos");
    expect(pyResult.hits[0]?.id).toEqual(tsResult.hits[0]?.id);
  });
```

Adapt the exact variable names (`tsBaseUrl`/`pyBaseUrl` or whatever this file's existing `beforeAll` actually calls them — check Step 1's output) and `SearchClient`/`facetValues` API shape to match what's real in this codebase (check `packages/client/src/client.ts` for the exact `facetValues()` signature/return shape if unsure) rather than assuming the sketch above is exact — same latitude Phase 2's Task 19 was given to correct first-draft assumptions against the real APIs.

- [ ] **Step 3: Run the test**

```bash
npx vitest run packages/client/test/cross-implementation-conformance-python-indexer.test.ts
```
Expected: PASS (3 passed — 2 pre-existing + 1 new). If it fails, diagnose whether it's a real bug in the Python `facets.py`/`pins.py` port (fix the Python code) or a tokenization/tie-break difference — do not weaken the assertion to force a pass.

- [ ] **Step 4: Commit**

```bash
git add packages/client/test/cross-implementation-conformance-python-indexer.test.ts
git commit -m "test: extend cross-implementation conformance to facets and pins"
```

---

## Self-Review Notes

- **Spec coverage**: every section of `docs/superpowers/specs/2026-07-12-python-indexer-phase3-design.md` maps to a task — module layout (Tasks 1-4), `build_index.py` changes (Task 5), `write_index.py` changes (Task 6), testing (Tasks 1-8 each carry their own tests, plus Tasks 7-8 for schema/cross-implementation conformance specifically).
- **Type consistency**: `facet_shards`/`pins_shards`/`synonym_shards`/`fuzzy_shards` (Task 1's `BuiltIndex` fields) are populated with identical names/shapes in `build_index.py` (Task 5) and consumed identically in `write_index.py` (Task 6). `resolve_pins()`'s input shape (Task 4) matches exactly what `build_index.py`'s per-document loop constructs (Task 5). `build_synonym_shards()`'s output shape (Task 2) matches what `write_index.py`'s `_synonym_shard_nonempty()` checks (Task 6).
- **No placeholders**: every step above contains complete, runnable code — no `TBD`, no "similar to Task N" shortcuts, no undefined references. Task 8 is the one task with genuine runtime-dependent adaptation latitude (matching real variable names in an existing file), explicitly flagged as such, consistent with how Phase 1+2's Task 19 handled the same situation.
