import struct


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
        out = self._data[self._pos : self._pos + length]
        self._pos += length
        return out

    def read_string(self) -> str:
        length = self.read_varint()
        return self.read_bytes(length).decode("utf-8")

    def read_float64(self) -> float:
        value: float = struct.unpack_from("<d", self._data, self._pos)[0]
        self._pos += 8
        return value
