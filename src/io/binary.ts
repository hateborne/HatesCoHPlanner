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

/** Run bytes through a CompressionStream / DecompressionStream format. */
export async function streamBytes(data: Uint8Array, format: 'deflate' | 'deflate-raw', compress: boolean): Promise<Uint8Array> {
  const stream = compress ? new CompressionStream(format) : new DecompressionStream(format);
  const out = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
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
