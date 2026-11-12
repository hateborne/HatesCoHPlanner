/** Little-endian byte writer/reader with .NET BinaryWriter string and varint support. */

export class ByteWriter {
  private buf = new Uint8Array(1024);
  private n = 0;

  private grow(k: number): void {
    if (this.n + k <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    nb.set(this.buf);
    this.buf = nb;
  }
  u8(v: number): void {
    this.grow(1);
    this.buf[this.n++] = v & 0xff;
  }
  i8(v: number): void {
    this.u8(v < 0 ? v + 256 : v);
  }
  bool(v: boolean): void {
    this.u8(v ? 1 : 0);
  }
  i32(v: number): void {
    this.grow(4);
    new DataView(this.buf.buffer).setInt32(this.n, v, true);
    this.n += 4;
  }
  f32(v: number): void {
    this.grow(4);
    new DataView(this.buf.buffer).setFloat32(this.n, v, true);
    this.n += 4;
  }
  bytes(b: Uint8Array): void {
    this.grow(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }
  /** Unsigned LEB128 (also .NET's 7-bit encoded int). */
  varint(v: number): void {
    let x = v >>> 0;
    while (x >= 0x80) {
      this.u8((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    this.u8(x);
  }
  /** .NET BinaryWriter.Write(string): 7-bit length prefix + UTF-8 bytes. */
  netString(s: string): void {
    const b = new TextEncoder().encode(s);
    this.varint(b.length);
    this.bytes(b);
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

/** Reading ran past the end of the data: what was read was cut short or isn't what it claims to be. */
export class EndOfData extends Error {
  constructor() {
    super('unexpected end of data');
    this.name = 'EndOfData';
  }
}

export class ByteReader {
  private n = 0;
  private dv: DataView;
  constructor(private buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get pos(): number {
    return this.n;
  }
  get left(): number {
    return this.buf.length - this.n;
  }
  u8(): number {
    if (this.n >= this.buf.length) throw new EndOfData();
    return this.buf[this.n++]!;
  }
  i8(): number {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  /** @raise EndOfData when fewer than `k` bytes are left. */
  private need(k: number): void {
    if (k < 0 || this.n + k > this.buf.length) throw new EndOfData();
  }
  i32(): number {
    this.need(4);
    const v = this.dv.getInt32(this.n, true);
    this.n += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.dv.getFloat32(this.n, true);
    this.n += 4;
    return v;
  }
  bytes(k: number): Uint8Array {
    this.need(k);
    const b = this.buf.slice(this.n, this.n + k);
    this.n += k;
    return b;
  }
  varint(): number {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = this.u8();
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return v >>> 0;
      shift += 7;
    }
  }
  netString(): string {
    const len = this.varint();
    return new TextDecoder().decode(this.bytes(len));
  }
}

// The most a decompressed build may hold. A share link's or a Mids code's data is a few KB; a
// stream that inflates past this is damaged or built to exhaust the tab's memory.
export const MAX_INFLATED = 1 << 20;

/** Decompressed data larger than the caller's limit (see MAX_INFLATED). */
export class TooLarge extends Error {}

/**
 * Run bytes through a CompressionStream / DecompressionStream format.
 *
 * Decompression stops as soon as the output passes `limit`, so a small stream that would inflate
 * to gigabytes never gets the chance to.
 *
 * @param data The input bytes.
 * @param format The zlib format.
 * @param compress Compress (true) or decompress (false).
 * @param limit The most bytes the output may hold (default: MAX_INFLATED when decompressing).
 * @return The output bytes.
 * @raise TooLarge when the output passes `limit`.
 */
export async function streamBytes(data: Uint8Array, format: 'deflate' | 'deflate-raw', compress: boolean, limit = compress ? Infinity : MAX_INFLATED): Promise<Uint8Array> {
  const stream = compress ? new CompressionStream(format) : new DecompressionStream(format);
  const reader = new Blob([data]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      void reader.cancel().catch(() => undefined);
      throw new TooLarge(`decompressed data passed ${limit} bytes`);
    }
    chunks.push(value);
  }
  return concatBytes(chunks, total);
}

/** @return The chunks joined into one array of `total` bytes. */
export function concatBytes(chunks: Uint8Array[], total = chunks.reduce((n, c) => n + c.length, 0)): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64Url(b: Uint8Array): string {
  return toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(t + '='.repeat((4 - (t.length % 4)) % 4));
}
