from csf_indexer.hash import content_hash


def test_hash_is_8_hex_characters():
    h = content_hash("hello")
    assert len(h) == 8
    assert all(c in "0123456789abcdef" for c in h)


def test_hash_is_deterministic():
    assert content_hash("hello") == content_hash("hello")


def test_hash_differs_for_different_content():
    assert content_hash("hello") != content_hash("world")


def test_hash_accepts_bytes():
    assert content_hash(b"hello") == content_hash("hello")
