from csf_indexer.pins import resolve_pins


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
