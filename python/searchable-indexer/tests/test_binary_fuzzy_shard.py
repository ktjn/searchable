from searchable_indexer.binary_fuzzy_shard import encode_fuzzy_shard_binary


def test_encodes_a_single_variant_shard():
    shard = {"maxEdits": 1, "deletions": {"ca": ["cat"]}}
    encoded = encode_fuzzy_shard_binary(shard)
    # Header: maxEdits=1, variantCount=1, string("ca"), offset=0,
    # length=5 -> 0x01, 0x01, 0x02,0x63,0x61, 0x00, 0x05
    # Blob: termCount=1, string("cat") -> 0x01, 0x03,0x63,0x61,0x74
    expected = bytes(
        [
            0x01,
            0x01,
            0x02,
            0x63,
            0x61,
            0x00,
            0x05,
            0x01,
            0x03,
            0x63,
            0x61,
            0x74,
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
    blob_marker = bytes([0x02, 0x03, 0x63, 0x61, 0x72, 0x03, 0x63, 0x61, 0x74])
    assert blob_marker in encoded
