// Byte-oriented bounded ring with monotonic offsets — mirrors the Rust
// BoundedRingBuffer used for PTY/shell logs. Callers tail with `readFrom(since)`:
// every `push` advances `nextOffset` by the bytes appended even when older
// bytes are dropped to honour the cap, so an offset-paging viewer can detect
// overflow ("you missed `dropped` bytes") and never re-reads consumed output.
export interface LogPage {
  data: string;
  nextOffset: number;
  dropped: number;
}

export class LogRing {
  private chunks: Uint8Array;
  private len = 0;
  private readonly cap: number;
  private nextOffset = 0;
  private dropped = 0;

  constructor(cap = 256 * 1024) {
    // Guard against a zero/negative cap collapsing the math; a one-byte floor
    // keeps push/readFrom total.
    this.cap = cap > 0 ? cap : 1;
    this.chunks = new Uint8Array(this.cap);
  }

  push(text: string): void {
    const bytes = new TextEncoder().encode(text);
    this.nextOffset += bytes.length;
    if (bytes.length >= this.cap) {
      // Incoming chunk alone exceeds cap: keep only its tail.
      const keepFrom = bytes.length - this.cap;
      this.dropped += this.len + keepFrom;
      this.chunks.set(bytes.subarray(keepFrom));
      this.len = this.cap;
      return;
    }
    const overflow = Math.max(0, this.len + bytes.length - this.cap);
    if (overflow > 0) {
      this.chunks.copyWithin(0, overflow, this.len);
      this.len -= overflow;
      this.dropped += overflow;
    }
    this.chunks.set(bytes, this.len);
    this.len += bytes.length;
  }

  readFrom(since: number): LogPage {
    const oldest = this.nextOffset - this.len;
    const start = Math.max(since, oldest);
    const skip = start - oldest;
    const slice = skip < this.len ? this.chunks.subarray(skip, this.len) : new Uint8Array(0);
    return {
      data: new TextDecoder().decode(slice),
      nextOffset: this.nextOffset,
      dropped: this.dropped,
    };
  }
}
