from searchable_client.score import score_term_for_doc
from searchable_client.types import FieldConfig, FieldPosting, Manifest, Posting


def _manifest() -> Manifest:
    return Manifest(
        version=1,
        build_id="x",
        format="json",
        languages=["en"],
        default_language="en",
        fields={"title": FieldConfig(boost=2.0, stored=True)},
        doc_count={"en": 10},
        avg_field_length={"en": {"title": 4.0}},
        shards_terms=[],
        shards_docs=[],
    )


def test_higher_term_frequency_scores_higher():
    manifest = _manifest()
    low_tf = Posting(doc=1, fields={"title": FieldPosting(tf=1, pos=[0], len=4)})
    high_tf = Posting(doc=2, fields={"title": FieldPosting(tf=3, pos=[0, 1, 2], len=4)})
    assert score_term_for_doc(high_tf, df=2, manifest=manifest, language="en") > score_term_for_doc(
        low_tf, df=2, manifest=manifest, language="en"
    )


def test_lower_document_frequency_scores_higher_idf():
    manifest = _manifest()
    posting = Posting(doc=1, fields={"title": FieldPosting(tf=1, pos=[0], len=4)})
    rare = score_term_for_doc(posting, df=1, manifest=manifest, language="en")
    common = score_term_for_doc(posting, df=9, manifest=manifest, language="en")
    assert rare > common


def test_field_boost_override_increases_score():
    manifest = _manifest()
    posting = Posting(doc=1, fields={"title": FieldPosting(tf=1, pos=[0], len=4)})
    base = score_term_for_doc(posting, df=2, manifest=manifest, language="en")
    boosted = score_term_for_doc(
        posting, df=2, manifest=manifest, language="en", field_boost_overrides={"title": 10.0}
    )
    assert boosted > base


def test_field_boost_override_zero_is_respected():
    """Test that a field_boost_overrides value of 0.0 (not None) is used.

    Matches TS ?? (nullish coalescing) semantics where 0 is a valid value.
    """
    manifest = _manifest()
    posting = Posting(doc=1, fields={"title": FieldPosting(tf=1, pos=[0], len=4)})
    base = score_term_for_doc(posting, df=2, manifest=manifest, language="en")
    # Zero override should zero out this field's contribution entirely
    zeroed = score_term_for_doc(
        posting, df=2, manifest=manifest, language="en", field_boost_overrides={"title": 0.0}
    )
    assert zeroed < base
    # Zero should be respected and not fall back to manifest's 2.0 boost
    assert zeroed != base


def test_avg_field_length_zero_is_respected():
    """Test that an avg_field_length value of 0.0 (not None) is used, matching TS ?? semantics."""
    # Manifest with title avg_field_length set to 0.0 explicitly
    manifest_with_zero_avg = Manifest(
        version=1,
        build_id="x",
        format="json",
        languages=["en"],
        default_language="en",
        fields={"title": FieldConfig(boost=2.0, stored=True)},
        doc_count={"en": 10},
        avg_field_length={"en": {"title": 0.0}},
        shards_terms=[],
        shards_docs=[],
    )
    # Manifest without title in avg_field_length (will fall back to field_posting.len)
    manifest_no_avg = Manifest(
        version=1,
        build_id="x",
        format="json",
        languages=["en"],
        default_language="en",
        fields={"title": FieldConfig(boost=2.0, stored=True)},
        doc_count={"en": 10},
        avg_field_length={"en": {}},
        shards_terms=[],
        shards_docs=[],
    )
    posting = Posting(doc=1, fields={"title": FieldPosting(tf=1, pos=[0], len=4)})

    # With avg_field_length=0.0, length_norm uses (0.0 or 1) = 1 for denominator
    score_with_zero_avg = score_term_for_doc(
        posting, df=2, manifest=manifest_with_zero_avg, language="en"
    )
    # Without avg_field_length, falls back to field_posting.len=4 for denominator
    score_without_avg = score_term_for_doc(posting, df=2, manifest=manifest_no_avg, language="en")

    # These should differ because 0.0 is treated differently from "not present"
    assert score_with_zero_avg != score_without_avg
