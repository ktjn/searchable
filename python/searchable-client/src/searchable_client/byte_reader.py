import struct
from collections.abc import Callable
from typing import TypeVar

K = TypeVar("K")


class ByteReader:
    def __init__(self, data: bytes, start_pos: int = 0) -> None:
        self._data = data
        self._pos = start_pos

    @property
    def position(self) -> int:
        return self._pos

    def read_varint(self) -> int:
        result = 0
        shift = 1
        while True:
            if self._pos >= len(self._data):
                raise ValueError("unexpected end of binary shard while reading varint")
            byte = self._data[self._pos]
            self._pos += 1
            result += (byte & 0x7F) * shift
            if (byte & 0x80) == 0:
                return result
            shift *= 128

    def read_bytes(self, length: int) -> bytes:
        if length < 0 or self._pos + length > len(self._data):
            raise ValueError("unexpected end of binary shard while reading bytes")
        out = self._data[self._pos : self._pos + length]
        self._pos += length
        return out

    def read_string(self) -> str:
        length = self.read_varint()
        return self.read_bytes(length).decode("utf-8")

    def read_float64(self) -> float:
        value: float = struct.unpack("<d", self.read_bytes(8))[0]
        return value


def read_directory(
    r: ByteReader, count: int, read_key: Callable[[ByteReader], K]
) -> tuple[list[K], dict[K, tuple[int, int]]]:
    """Reads `count` `{key, offset, length}` directory entries from `r`.
    Every directory-based binary shard (terminal, fuzzy, doc store) shares
    this layout; only the key stream differs (raw string vs delta-encoded
    id), supplied via `read_key`."""
    keys: list[K] = []
    index: dict[K, tuple[int, int]] = {}
    for _ in range(count):
        key = read_key(r)
        offset = r.read_varint()
        length = r.read_varint()
        keys.append(key)
        index[key] = (offset, length)
    return keys, index
