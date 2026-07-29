from searchable_client.score import score_term_for_doc
from searchable_client.types import FieldConfig, FieldPosting, Manifest, Posting


def _manifest() -> Manifest:
    return Manifest(
        version=1, build_id="x", format="json", languages=["en"], default_language="en",
        fields={"title": FieldConfig(boost=2.0, stored=True)},
        doc_count={"en": 10}, avg_field_length={"en": {"title": 4.0}},
        shards_terms=[], shards_docs=[],
    )


def test_higher_term_frequency_scores_higher():
    manifest = _manifest()
    low_tf = Posting(doc=1, fields={"title": FieldPosting(tf=1, pos=[0], len=4)})
    high_tf = Posting(doc=2, fields={"title": FieldPosting(tf=3, pos=[0, 1, 2], len=4)})
    assert score_term_for_doc(high_tf, df=2, manifest=manifest, language="en") > \
        score_term_for_doc(low_tf, df=2, manifest=manifest, language="en")


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
