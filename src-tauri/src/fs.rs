use serde::{Deserialize, Serialize};

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FileMeta {
    pub eol: Eol,
    #[serde(rename = "hadBom")]
    pub had_bom: bool,
}

/// A file loaded into the editor.
///
/// `text` is always `\n`-normalized (CRLF files have their `\r\n` collapsed).
/// `meta` captures the byte conventions needed to reproduce the original.
///
/// `bare_lf_offsets` is an internal-only field (not serialized) that records
/// the byte offsets (in `text`) of `\n` characters that were originally bare
/// LF (not part of a CRLF pair) in a file whose dominant EOL is CRLF.  This
/// is needed so that `encode` can re-expand only the `\r\n`-origin newlines
/// and leave the lone ones alone — achieving exact byte-level round-trip
/// fidelity even for mixed-EOL files.
#[derive(Debug, PartialEq, Serialize)]
pub struct LoadedFile {
    pub text: String,
    pub meta: FileMeta,
    /// Offsets of bare-LF `\n` characters inside `text` that must stay as
    /// `\n` (not become `\r\n`) during CRLF-mode encode.
    /// Always empty when `meta.eol == Eol::Lf`.
    #[serde(skip)]
    pub bare_lf_offsets: Vec<usize>,
}

#[derive(Debug, PartialEq)]
pub enum DecodeError {
    NotUtf8,
    LooksBinary,
}

/// Decode raw file bytes into an editor-ready `\n`-normalized string + the
/// metadata needed to reproduce the original bytes on save.
pub fn decode(bytes: &[u8]) -> Result<LoadedFile, DecodeError> {
    // A NUL byte is the cheap, reliable "this is binary" signal.
    if bytes.contains(&0) {
        return Err(DecodeError::LooksBinary);
    }
    let (had_bom, rest) = if bytes.starts_with(&UTF8_BOM) {
        (true, &bytes[UTF8_BOM.len()..])
    } else {
        (false, bytes)
    };
    let raw = std::str::from_utf8(rest).map_err(|_| DecodeError::NotUtf8)?;
    // EOL style is decided by the first CRLF we see; lone CRs are left as
    // content (not treated as line breaks) so they survive the round trip.
    let eol = if raw.contains("\r\n") { Eol::Crlf } else { Eol::Lf };

    if eol == Eol::Lf {
        // Pure LF file — no CRLF pairs, no bare-LF tracking needed.
        return Ok(LoadedFile {
            text: raw.to_string(),
            meta: FileMeta { eol, had_bom },
            bare_lf_offsets: Vec::new(),
        });
    }

    // CRLF file: collapse \r\n → \n char-by-char, recording which output \n
    // positions came from bare LF (not from \r\n pairs).
    let mut text = String::with_capacity(raw.len());
    let mut bare_lf_offsets: Vec<usize> = Vec::new();
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\r' {
            if chars.peek() == Some(&'\n') {
                // CRLF pair: consume the \n and emit a single \n.
                chars.next();
                text.push('\n');
                // This \n is a CRLF-origin newline — NOT recorded in bare_lf_offsets.
            } else {
                // Lone CR: emit as content.
                text.push('\r');
            }
        } else if ch == '\n' {
            // Bare LF in a CRLF file: record its position and emit it.
            bare_lf_offsets.push(text.len());
            text.push('\n');
        } else {
            text.push(ch);
        }
    }

    Ok(LoadedFile {
        text,
        meta: FileMeta { eol, had_bom },
        bare_lf_offsets,
    })
}

/// Re-serialize editor text (always `\n`-separated) back to the original
/// byte conventions: re-apply CRLF if that's what the file used, re-prepend
/// the BOM if it had one.
pub fn encode(text: &str, meta: FileMeta) -> Vec<u8> {
    encode_with_bare_lfs(text, meta, &[])
}

/// Internal encode used by `LoadedFile`'s own round-trip path (carries
/// bare-LF position info from decode).
pub fn encode_loaded(loaded: &LoadedFile) -> Vec<u8> {
    encode_with_bare_lfs(&loaded.text, loaded.meta, &loaded.bare_lf_offsets)
}

fn encode_with_bare_lfs(text: &str, meta: FileMeta, bare_lf_offsets: &[usize]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + UTF8_BOM.len());
    if meta.had_bom {
        out.extend_from_slice(&UTF8_BOM);
    }
    match meta.eol {
        Eol::Lf => {
            out.extend_from_slice(text.as_bytes());
        }
        Eol::Crlf => {
            // Walk char-by-char; expand \n → \r\n unless it's a bare-LF.
            let mut byte_pos: usize = 0;
            for ch in text.chars() {
                if ch == '\n' {
                    if bare_lf_offsets.contains(&byte_pos) {
                        // Bare LF — emit as-is.
                        out.push(b'\n');
                    } else {
                        // CRLF-origin newline — restore the \r.
                        out.push(b'\r');
                        out.push(b'\n');
                    }
                } else {
                    let mut buf = [0u8; 4];
                    let s = ch.encode_utf8(&mut buf);
                    out.extend_from_slice(s.as_bytes());
                }
                byte_pos += ch.len_utf8();
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Placeholder command stubs — kept so lib.rs compiles while Task 3 is pending.
// Task 3 will replace these with real #[tauri::command] wrappers over decode/encode.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_text_file(_path: String) -> Result<(), String> {
    Err("not implemented — Task 3 pending".into())
}

#[tauri::command]
pub fn write_text_file_atomic(_path: String, _text: String) -> Result<(), String> {
    Err("not implemented — Task 3 pending".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// decode → encode must reproduce the original bytes exactly.
    fn roundtrip(original: &[u8]) -> Vec<u8> {
        let loaded = decode(original).expect("should decode");
        encode_loaded(&loaded)
    }

    #[test]
    fn lf_with_trailing_newline_roundtrips() {
        let original = b"# Title\n\nBody line\n";
        assert_eq!(roundtrip(original), original);
    }

    #[test]
    fn lf_without_trailing_newline_roundtrips() {
        let original = b"no trailing newline";
        assert_eq!(roundtrip(original), original);
    }

    #[test]
    fn crlf_with_trailing_roundtrips() {
        let original = b"line one\r\nline two\r\n";
        assert_eq!(roundtrip(original), original);
    }

    #[test]
    fn crlf_without_trailing_roundtrips() {
        let original = b"a\r\nb";
        assert_eq!(roundtrip(original), original);
    }

    #[test]
    fn bom_is_preserved() {
        let original = b"\xEF\xBB\xBF# Title\n";
        assert_eq!(roundtrip(original), original);
    }

    #[test]
    fn lone_cr_is_preserved_as_content() {
        let original = b"a\rb\r\nc\n";
        assert_eq!(roundtrip(original), original);
    }

    #[test]
    fn decode_detects_crlf_and_normalizes() {
        let loaded = decode(b"a\r\nb\r\n").unwrap();
        assert_eq!(loaded.meta.eol, Eol::Crlf);
        assert_eq!(loaded.text, "a\nb\n");
    }

    #[test]
    fn decode_strips_and_flags_bom() {
        let loaded = decode(b"\xEF\xBB\xBFhi").unwrap();
        assert!(loaded.meta.had_bom);
        assert_eq!(loaded.text, "hi");
    }

    #[test]
    fn decode_rejects_binary_null_byte() {
        assert_eq!(decode(b"a\0b"), Err(DecodeError::LooksBinary));
    }

    #[test]
    fn decode_rejects_invalid_utf8() {
        assert_eq!(decode(&[0xFF, 0xFE]), Err(DecodeError::NotUtf8));
    }
}
