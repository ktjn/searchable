from csf_indexer.byte_writer import ByteWriter


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
