// Device Attributes (DA) responder. Heterogeneous CLIs (claude/codex/aider TUIs)
// probe the terminal with DA1 (`ESC [ c` / `ESC [ 0 c`), DA2 (`ESC [ > c`) and
// DA3 (`ESC [ = c`) queries and block waiting for a reply. xterm.js answers
// these in a browser context, but the bytes only reach the webview AFTER the
// coalesce window — too late, so the CLI hangs or corrupts its screen. We
// intercept the query in the PTY output stream, write the standard answer back
// to the master, and strip the query bytes before they reach the emit buffer.

const ESC: u8 = 0x1b;
const LBRACKET: u8 = 0x5b;
const FINAL_C: u8 = 0x63;
const PREFIX_GT: u8 = 0x3e;
const PREFIX_EQ: u8 = 0x3d;

// DA1 reply: VT100 with Advanced Video Option — matches what xterm.js reports.
const DA1_REPLY: &[u8] = b"\x1b[?1;2c";
// DA2 reply: terminal id 0, firmware 276, no ROM cartridge — xterm-compatible.
const DA2_REPLY: &[u8] = b"\x1b[>0;276;0c";

// A held CSI never legitimately grows this large; flush it as passthrough so a
// runaway/garbage sequence can't pin the held buffer forever.
const HOLD_MAX: usize = 256;

#[derive(Clone, Copy)]
enum State {
    Idle,
    AfterEsc,
    InsideCsi,
}

/// Streaming DA-query interceptor. Carries partial CSI state across reads so a
/// query split over two PTY reads is still recognised.
pub struct DaFilter {
    state: State,
    hold: Vec<u8>,
}

impl Default for DaFilter {
    fn default() -> Self {
        Self::new()
    }
}

impl DaFilter {
    pub fn new() -> Self {
        DaFilter {
            state: State::Idle,
            hold: Vec::with_capacity(16),
        }
    }

    /// Append the non-DA bytes of `input` to `out`, invoking `respond` with the
    /// reply payload for any DA query found. DA queries are removed from `out`.
    pub fn process<F: FnMut(&[u8])>(&mut self, input: &[u8], out: &mut Vec<u8>, mut respond: F) {
        // Fast path: no in-flight CSI and no ESC at all — pass the chunk verbatim.
        if matches!(self.state, State::Idle) && !input.contains(&ESC) {
            out.extend_from_slice(input);
            return;
        }

        for &b in input {
            match self.state {
                State::Idle => {
                    if b == ESC {
                        self.state = State::AfterEsc;
                        self.hold.clear();
                        self.hold.push(b);
                    } else {
                        out.push(b);
                    }
                }
                State::AfterEsc => {
                    if b == LBRACKET {
                        self.state = State::InsideCsi;
                        self.hold.push(b);
                    } else if b == ESC {
                        // A second ESC restarts the sequence; the lone ESC was
                        // not a CSI introducer, so emit it.
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.hold.push(b);
                    } else {
                        // ESC followed by a non-`[` byte: not a CSI (e.g. ESC M).
                        out.extend_from_slice(&self.hold);
                        out.push(b);
                        self.hold.clear();
                        self.state = State::Idle;
                    }
                }
                State::InsideCsi => {
                    self.hold.push(b);
                    if (0x40..=0x7e).contains(&b) {
                        if b == FINAL_C {
                            let middle = &self.hold[2..self.hold.len() - 1];
                            // A DA *response* from terminal→host always opens its
                            // parameter string with `?` (e.g. `ESC[?1;2c`,
                            // `ESC[?64;…c`). A leading `;` or numeric param is a
                            // host *query* (incl. multi-param DA2 like `ESC[>0;1c`),
                            // so we must still answer those. Only suppress on a
                            // leading `?` so we never reply to our own reply and loop.
                            let is_response = middle.first() == Some(&b'?');
                            let prefix = middle.first().copied().unwrap_or(0);
                            if is_response {
                                out.extend_from_slice(&self.hold);
                            } else {
                                match prefix {
                                    PREFIX_GT => respond(DA2_REPLY),
                                    PREFIX_EQ => {} // DA3: consumed silently, no reply.
                                    0 | b'0'..=b'9' => respond(DA1_REPLY),
                                    _ => out.extend_from_slice(&self.hold),
                                }
                            }
                        } else {
                            // Any other CSI final byte: not a DA query, pass through.
                            out.extend_from_slice(&self.hold);
                        }
                        self.hold.clear();
                        self.state = State::Idle;
                    } else if self.hold.len() >= HOLD_MAX {
                        out.extend_from_slice(&self.hold);
                        self.hold.clear();
                        self.state = State::Idle;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(filter: &mut DaFilter, input: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
        let mut out = Vec::new();
        let mut replies = Vec::new();
        filter.process(input, &mut out, |r| replies.push(r.to_vec()));
        (out, replies)
    }

    #[test]
    fn da1_bare() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da1_with_zero_param() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[0c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da1_with_numeric_param() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[5c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da2_secondary() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[>c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA2_REPLY.to_vec()]);
    }

    #[test]
    fn da2_parameterized() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[>0c");
        // `>0c` has a `;`-less single param after the prefix; the `>` makes it DA2.
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA2_REPLY.to_vec()]);
    }

    #[test]
    fn da2_multi_param_query_gets_reply() {
        // `ESC[>0;1c` is a multi-param secondary DA *query* — the `;` must not be
        // mistaken for a response. The leading `>` (no `?`) means we answer it.
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[>0;1c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA2_REPLY.to_vec()]);
    }

    #[test]
    fn da1_multi_param_response_passes_through() {
        // `ESC[?1;2c` is a primary DA *response* (leading `?`) — pass it through
        // untouched and never reply, even though it carries a `;`.
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?1;2c");
        assert_eq!(out, b"\x1b[?1;2c");
        assert!(replies.is_empty());
    }

    #[test]
    fn da1_extended_response_passes_through() {
        // Real xterm DA1 responses like `ESC[?64;1;2c` must pass through.
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?64;1;2;6;9;15;18;21;22c");
        assert_eq!(out, b"\x1b[?64;1;2;6;9;15;18;21;22c");
        assert!(replies.is_empty());
    }

    #[test]
    fn da3_consumed_silently() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[=c");
        assert!(out.is_empty());
        assert!(replies.is_empty());
    }

    #[test]
    fn da3_parameterized_consumed_silently() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[=0c");
        assert!(out.is_empty());
        assert!(replies.is_empty());
    }

    #[test]
    fn plain_text_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"hello world\n");
        assert_eq!(out, b"hello world\n");
        assert!(replies.is_empty());
    }

    #[test]
    fn embedded_da_preserves_surrounding() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"pre\x1b[0cpost");
        assert_eq!(out, b"prepost");
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn non_da_csi_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?2004h");
        assert_eq!(out, b"\x1b[?2004h");
        assert!(replies.is_empty());
    }

    #[test]
    fn split_across_chunks() {
        let mut f = DaFilter::new();
        let (out1, r1) = run(&mut f, b"\x1b");
        let (out2, r2) = run(&mut f, b"[");
        let (out3, r3) = run(&mut f, b"c");
        assert!(out1.is_empty() && out2.is_empty() && out3.is_empty());
        assert!(r1.is_empty() && r2.is_empty());
        assert_eq!(r3, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn escape_then_non_csi() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1bM");
        assert_eq!(out, b"\x1bM");
        assert!(replies.is_empty());
    }

    #[test]
    fn double_esc() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b\x1b[c");
        assert_eq!(out, b"\x1b");
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }

    #[test]
    fn da1_response_passes_through_no_loop() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?1;2c");
        assert_eq!(out, b"\x1b[?1;2c");
        assert!(replies.is_empty());
    }

    #[test]
    fn da2_query_does_not_loop() {
        // A `>`-prefixed DA sequence in the PTY *output* stream can only be a DA2
        // query from the child CLI (a real DA2 response never originates from the
        // child), so we answer it. Our reply is written to the master input side,
        // not back into the output stream, so it never re-enters the filter — no
        // loop. The reply form is `ESC[>...c`, identical in shape to the query,
        // confirming there is nothing to distinguish on the output side.
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[>0;276;0c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA2_REPLY.to_vec()]);
    }

    #[test]
    fn da_with_question_prefix_is_response() {
        let mut f = DaFilter::new();
        let (out, replies) = run(&mut f, b"\x1b[?6c");
        assert_eq!(out, b"\x1b[?6c");
        assert!(replies.is_empty());
    }

    #[test]
    fn runaway_csi_flushes_at_hold_max() {
        let mut f = DaFilter::new();
        let mut input = Vec::from(b"\x1b[".as_slice());
        input.extend(std::iter::repeat_n(b'0', HOLD_MAX));
        let (out, replies) = run(&mut f, &input);
        assert_eq!(out.len(), HOLD_MAX + 2);
        assert!(replies.is_empty());
    }

    #[test]
    fn default_matches_new() {
        let mut f = DaFilter::default();
        let (out, replies) = run(&mut f, b"\x1b[c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA1_REPLY.to_vec()]);
    }
}
