// Per-leaf byte ring that buffers PTY output while a leaf has no bound xterm
// renderer. Capped at 256KiB / 256 chunks; on overflow the oldest chunks are
// dropped and a reset+notice is prepended on drain so the user knows output was
// lost during hibernation. PTY data in Maverick arrives as strings, so chunks
// are strings and byte accounting uses the UTF-8 encoded length.

const DEFAULT_BYTE_CAP = 256 * 1024;
const DEFAULT_CHUNK_CAP = 256;

// \x1bc = full reset (RIS): the prior screen is unrecoverable once we dropped
// bytes, so reset before replaying the surviving tail to avoid corrupt frames.
const OVERFLOW_NOTICE =
  "\x1bc\x1b[2m[maverick: dropped output during hibernation]\x1b[0m\r\n";

const encoder = new TextEncoder();

function byteLen(s: string): number {
  return encoder.encode(s).length;
}

export class DormantRing {
  private chunks: (string | null)[] = [];
  private head = 0;
  private size = 0;
  private total = 0;
  private overflowed = false;

  constructor(
    private readonly byteCap = DEFAULT_BYTE_CAP,
    private readonly chunkCap = DEFAULT_CHUNK_CAP
  ) {}

  push(data: string): void {
    if (data.length === 0) return;
    const len = byteLen(data);
    // A single write larger than the whole ring: keep only its tail, drop the
    // rest, and mark overflow. We slice by char as a coarse upper bound on the
    // byte cap — exactness isn't required, only that we stay bounded.
    if (len >= this.byteCap) {
      const tail = data.slice(-this.byteCap);
      this.chunks = [OVERFLOW_NOTICE, tail];
      this.head = 0; // fresh backing array — the live range starts at index 0
      this.size = 2;
      this.total = byteLen(OVERFLOW_NOTICE) + byteLen(tail);
      this.overflowed = true;
      return;
    }
    this.chunks.push(data);
    this.size++;
    this.total += len;
    while (
      (this.total > this.byteCap || this.size > this.chunkCap) &&
      this.size > 1
    ) {
      const dropped = this.chunks[this.head]!;
      this.chunks[this.head] = null;
      this.head++;
      this.size--;
      this.total -= byteLen(dropped);
      this.overflowed = true;
    }
    // Compact the backing array once the dead prefix dominates, so a long-lived
    // dormant leaf doesn't grow an unbounded array of null holes.
    if (this.head > 1024 && this.head > this.chunks.length / 2) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  drain(write: (data: string) => void): void {
    if (this.overflowed) {
      const first = this.chunks[this.head];
      if (first !== OVERFLOW_NOTICE) write(OVERFLOW_NOTICE);
    }
    const end = this.head + this.size;
    // [head, head+size) is the live range; entries there are never null by
    // invariant (only the dropped prefix [0, head) is nulled). The non-null
    // assertion surfaces a ring-bookkeeping bug instead of silently skipping.
    for (let i = this.head; i < end; i++) {
      write(this.chunks[i]!);
    }
    this.chunks = [];
    this.head = 0;
    this.size = 0;
    this.total = 0;
    this.overflowed = false;
  }

  clear(): void {
    this.chunks = [];
    this.head = 0;
    this.size = 0;
    this.total = 0;
    this.overflowed = false;
  }

  byteLength(): number {
    return this.total;
  }

  get didOverflow(): boolean {
    return this.overflowed;
  }
}
