/**
 * Growable little-endian byte buffer writer shared by every binary shard
 * encoder (`binary-term-shard.ts`, `binary-fuzzy-shard.ts`,
 * `binary-doc-store.ts`), per docs/spec-binary-format.md's "little-endian"
 * / "variable-length integers" format principles. Extracted once three
 * encoders needed the exact same varint/string/float64 writer rather
 * than duplicated per file.
 */
export class ByteWriter {
  #chunks: Uint8Array[] = [];
  #buf = new Uint8Array(4096);
  #len = 0;

  #ensure(extra: number): void {
    if (this.#len + extra <= this.#buf.length) return;
    this.#chunks.push(this.#buf.subarray(0, this.#len));
    this.#buf = new Uint8Array(Math.max(4096, extra * 2));
    this.#len = 0;
  }

  writeVarint(value: number): void {
    this.#ensure(10);
    let v = value;
    while (v >= 0x80) {
      this.#buf[this.#len++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.#buf[this.#len++] = v;
  }

  writeBytes(bytes: Uint8Array): void {
    this.#ensure(bytes.length);
    this.#buf.set(bytes, this.#len);
    this.#len += bytes.length;
  }

  writeString(str: string): void {
    const bytes = new TextEncoder().encode(str);
    this.writeVarint(bytes.length);
    this.writeBytes(bytes);
  }

  writeFloat64(value: number): void {
    this.#ensure(8);
    new DataView(
      this.#buf.buffer,
      this.#buf.byteOffset + this.#len,
      8,
    ).setFloat64(0, value, true);
    this.#len += 8;
  }

  toUint8Array(): Uint8Array {
    this.#chunks.push(this.#buf.subarray(0, this.#len));
    const total = this.#chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.#chunks = [out];
    this.#buf = new Uint8Array(0);
    this.#len = 0;
    return out;
  }
}
