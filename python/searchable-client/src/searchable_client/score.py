import math

from searchable_client.types import Manifest, Posting

K1 = 1.2
B = 0.75


def _idf(doc_count: int, df: int) -> float:
    return math.log(1 + (doc_count - df + 0.5) / (df + 0.5))


def score_term_for_doc(
    posting: Posting,
    df: int,
    manifest: Manifest,
    language: str,
    field_boost_overrides: dict[str, float] | None = None,
) -> float:
    avg_field_length = manifest.avg_field_length.get(language, {})
    weighted_tf = 0.0
    for field_name, field_posting in posting.fields.items():
        # Use is not None to respect zero values like TS ?? (nullish coalescing)
        override = (field_boost_overrides or {}).get(field_name)
        if override is not None:
            boost = override
        elif field_name in manifest.fields:
            boost = manifest.fields[field_name].boost
        else:
            boost = 1.0

        avg_len_value = avg_field_length.get(field_name)
        avg_len = avg_len_value if avg_len_value is not None else field_posting.len
        length_norm = 1 - B + B * (field_posting.len / (avg_len or 1))
        weighted_tf += (boost * field_posting.tf) / (length_norm or 1)

    doc_count = manifest.doc_count.get(language, 0)
    return _idf(doc_count, df) * (weighted_tf / (weighted_tf + K1))
