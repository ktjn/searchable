/**
 * Little-endian byte buffer reader shared by every binary shard decoder
 * (`binary-term-shard.ts`, `binary-fuzzy-shard.ts`, `binary-doc-store.ts`),
 * mirroring `@ktjn/searchable-indexer`'s `ByteWriter`. Extracted once three decoders
 * needed the exact same varint/string/float64 reader rather than
 * duplicated per file.
 */
export class ByteReader {
  #view: Uint8Array;
  #pos: number;
  constructor(bytes: Uint8Array, startPos = 0) {
    this.#view = bytes;
    this.#pos = startPos;
  }

  get position(): number {
    return this.#pos;
  }

  readVarint(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.#view[this.#pos++];
      if (byte === undefined) {
        throw new Error("unexpected end of binary shard while reading varint");
      }
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return result;
      shift *= 128;
    }
  }

  readBytes(length: number): Uint8Array {
    if (length < 0 || this.#pos + length > this.#view.length) {
      throw new Error("unexpected end of binary shard while reading bytes");
    }
    const out = this.#view.subarray(this.#pos, this.#pos + length);
    this.#pos += length;
    return out;
  }

  readString(): string {
    const length = this.readVarint();
    return new TextDecoder("utf-8", { fatal: true }).decode(this.readBytes(length));
  }

  readFloat64(): number {
    const bytes = this.readBytes(8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
  }
}
