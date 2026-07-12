from csf_indexer.binary_term_shard import encode_term_shard_binary


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
