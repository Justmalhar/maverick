// UTF-8 boundary carry. PTY reads land on arbitrary byte boundaries, so a single
// multibyte codepoint (CJK ideographs, box-drawing glyphs in claude/aider TUIs)
// can be split across two reads. `String::from_utf8_lossy` on such a fragment
// emits U+FFFD and permanently corrupts the glyph. This decoder holds back any
// incomplete trailing sequence and prepends it to the next chunk, so only
// complete codepoints are ever decoded. Genuinely invalid bytes still degrade
// to U+FFFD (lossy), matching the previous behaviour for actual garbage.

/// Maximum bytes a single UTF-8 codepoint can occupy.
const MAX_UTF8_LEN: usize = 4;

/// Stateful incremental UTF-8 decoder. Carries an incomplete trailing sequence
/// (at most 3 bytes) between `push` calls.
#[derive(Default)]
pub struct Utf8Carry {
    // Held bytes that form the start of an incomplete codepoint. Length is
    // always < MAX_UTF8_LEN.
    carry: Vec<u8>,
}

impl Utf8Carry {
    pub fn new() -> Self {
        Self {
            carry: Vec::with_capacity(MAX_UTF8_LEN),
        }
    }

    /// Decode `input` (prepended with any carried bytes), returning a String of
    /// the complete codepoints. Any trailing incomplete sequence is retained for
    /// the next call. Invalid bytes (not part of a valid prefix) decode lossily.
    pub fn push(&mut self, input: &[u8]) -> String {
        let mut combined: Vec<u8> = Vec::with_capacity(self.carry.len() + input.len());
        combined.extend_from_slice(&self.carry);
        combined.extend_from_slice(input);
        self.carry.clear();

        // Find the longest valid-UTF-8 prefix. The first error tells us where an
        // incomplete-but-valid trailing sequence begins (vs. a hard error).
        let valid_up_to = match std::str::from_utf8(&combined) {
            Ok(s) => return s.to_string(),
            Err(e) => e.valid_up_to(),
        };

        let (good, rest) = combined.split_at(valid_up_to);
        // SAFETY: `good` is the validated prefix returned by from_utf8.
        let mut decoded = unsafe { std::str::from_utf8_unchecked(good) }.to_string();

        // `rest` starts at the first byte that broke validation. If it is a
        // valid *incomplete* lead (could still be completed by more bytes) and
        // it's short enough, carry it. Otherwise it's a hard error — decode it
        // lossily now so we never stall on garbage.
        if is_incomplete_trailing(rest) {
            self.carry.extend_from_slice(rest);
        } else {
            decoded.push_str(&String::from_utf8_lossy(rest));
        }
        decoded
    }
}

/// True if `bytes` is a non-empty, short prefix of a valid multibyte codepoint
/// that could still be completed by appending more continuation bytes.
fn is_incomplete_trailing(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes.len() >= MAX_UTF8_LEN {
        return false;
    }
    let lead = bytes[0];
    let expected = match lead {
        0x00..=0x7f => 1,        // ASCII — complete on its own, never carried.
        0xc2..=0xdf => 2,        // 2-byte lead (0xc0/0xc1 are always invalid).
        0xe0..=0xef => 3,        // 3-byte lead.
        0xf0..=0xf4 => 4,        // 4-byte lead (>0xf4 is invalid).
        _ => return false,       // Continuation byte or invalid lead: hard error.
    };
    if bytes.len() >= expected {
        return false; // Enough bytes to be complete — from_utf8 would have
                      // accepted it, so a stop here means a hard error, not carry.
    }
    // Remaining bytes after the lead must all be continuation bytes (0x80..=0xbf)
    // for this to be a still-valid incomplete sequence.
    bytes[1..].iter().all(|&b| (0x80..=0xbf).contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_passes_through() {
        let mut d = Utf8Carry::new();
        assert_eq!(d.push(b"hello"), "hello");
        assert!(d.carry.is_empty());
    }

    #[test]
    fn complete_multibyte_decodes_whole() {
        let mut d = Utf8Carry::new();
        // U+4E16 (世) = E4 B8 96
        assert_eq!(d.push("世".as_bytes()), "世");
        assert!(d.carry.is_empty());
    }

    #[test]
    fn split_three_byte_sequence_across_two_reads() {
        let mut d = Utf8Carry::new();
        let bytes = "世".as_bytes(); // [0xE4, 0xB8, 0x96]
        // First read: only the lead + one continuation byte arrive.
        let first = d.push(&bytes[..2]);
        assert_eq!(first, "", "incomplete sequence must not emit U+FFFD");
        assert_eq!(d.carry, &bytes[..2]);
        // Second read: the final continuation byte completes the glyph.
        let second = d.push(&bytes[2..]);
        assert_eq!(second, "世");
        assert!(!second.contains('\u{FFFD}'));
        assert!(d.carry.is_empty());
    }

    #[test]
    fn split_two_byte_sequence_byte_by_byte() {
        let mut d = Utf8Carry::new();
        // U+00E9 (é) = C3 A9
        assert_eq!(d.push(&[0xc3]), "");
        assert_eq!(d.carry, &[0xc3]);
        assert_eq!(d.push(&[0xa9]), "é");
        assert!(d.carry.is_empty());
    }

    #[test]
    fn split_four_byte_emoji() {
        let mut d = Utf8Carry::new();
        // U+1F680 (🚀) = F0 9F 9A 80
        let bytes = "🚀".as_bytes();
        assert_eq!(d.push(&bytes[..1]), "");
        assert_eq!(d.push(&bytes[1..3]), "");
        assert_eq!(d.push(&bytes[3..]), "🚀");
        assert!(d.carry.is_empty());
    }

    #[test]
    fn box_drawing_split_no_replacement_char() {
        let mut d = Utf8Carry::new();
        // U+2500 (─) = E2 94 80 — common in TUI frames.
        let bytes = "─".as_bytes();
        let a = d.push(&bytes[..1]);
        let b = d.push(&bytes[1..]);
        assert_eq!(a, "");
        assert_eq!(b, "─");
        assert!(!format!("{a}{b}").contains('\u{FFFD}'));
    }

    #[test]
    fn text_then_partial_carries_only_partial() {
        let mut d = Utf8Carry::new();
        let glyph = "好".as_bytes(); // E5 A5 BD
        let mut chunk = b"abc".to_vec();
        chunk.extend_from_slice(&glyph[..1]); // abc + lead byte
        assert_eq!(d.push(&chunk), "abc");
        assert_eq!(d.carry, &glyph[..1]);
        assert_eq!(d.push(&glyph[1..]), "好");
    }

    #[test]
    fn genuinely_invalid_bytes_decode_lossily() {
        let mut d = Utf8Carry::new();
        // 0xFF is never a valid UTF-8 byte — must not be carried forever.
        let out = d.push(&[0xff]);
        assert!(out.contains('\u{FFFD}'));
        assert!(d.carry.is_empty(), "invalid byte must not stall in carry");
    }

    #[test]
    fn lone_continuation_byte_is_lossy() {
        let mut d = Utf8Carry::new();
        // 0x80 with no lead is a hard error, not an incomplete prefix.
        let out = d.push(&[0x80]);
        assert!(out.contains('\u{FFFD}'));
        assert!(d.carry.is_empty());
    }

    #[test]
    fn overlong_two_byte_lead_is_lossy() {
        let mut d = Utf8Carry::new();
        // 0xC0 is an always-invalid lead (overlong); must not be carried.
        let out = d.push(&[0xc0]);
        assert!(out.contains('\u{FFFD}'));
        assert!(d.carry.is_empty());
    }

    #[test]
    fn carried_partial_then_invalid_continuation() {
        let mut d = Utf8Carry::new();
        // Lead of a 3-byte glyph, then a byte that is NOT a continuation.
        assert_eq!(d.push(&[0xe4]), "");
        assert_eq!(d.carry, &[0xe4]);
        // 'A' (0x41) breaks the sequence: lead decodes lossily, 'A' survives.
        let out = d.push(&[0x41]);
        assert!(out.contains('\u{FFFD}'));
        assert!(out.contains('A'));
        assert!(d.carry.is_empty());
    }

    #[test]
    fn default_is_empty_decoder() {
        let mut d = Utf8Carry::default();
        assert_eq!(d.push(b"x"), "x");
    }

    #[test]
    fn helper_rejects_complete_and_empty() {
        assert!(!is_incomplete_trailing(b""));
        assert!(!is_incomplete_trailing("世".as_bytes())); // complete 3-byte
        assert!(!is_incomplete_trailing(b"a")); // ASCII complete
        assert!(is_incomplete_trailing(&[0xe4])); // 3-byte lead alone
        assert!(is_incomplete_trailing(&[0xe4, 0xb8])); // 3-byte lead + 1 cont
    }
}
