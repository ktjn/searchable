import struct

# Direct port of packages/indexer/src/byte-writer.ts's ByteWriter,
# minus the manual chunked-buffer growth machinery (#ensure/#chunks) --
# Python's bytearray already handles amortized growth internally, so
# that complexity (needed in JS because Uint8Array isn't natively
# resizable) has no equivalent here.


class ByteWriter:
    def __init__(self) -> None:
        self._buf = bytearray()

    def write_varint(self, value: int) -> None:
        v = value
        while v >= 0x80:
            self._buf.append((v & 0x7F) | 0x80)
            v >>= 7
        self._buf.append(v)

    def write_bytes(self, data: bytes) -> None:
        self._buf.extend(data)

    def write_string(self, s: str) -> None:
        encoded = s.encode("utf-8")
        self.write_varint(len(encoded))
        self.write_bytes(encoded)

    def write_float64(self, value: float) -> None:
        self._buf.extend(struct.pack("<d", value))

    def to_bytes(self) -> bytes:
        return bytes(self._buf)
