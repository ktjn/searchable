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
