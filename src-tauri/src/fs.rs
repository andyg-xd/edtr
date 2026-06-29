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

#[derive(Debug, PartialEq, Serialize)]
pub struct LoadedFile {
    pub text: String,
    pub meta: FileMeta,
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
    let text = raw.replace("\r\n", "\n");
    Ok(LoadedFile {
        text,
        meta: FileMeta { eol, had_bom },
    })
}

/// Re-serialize editor text (always `\n`-separated) back to the original
/// byte conventions: re-apply CRLF if that's what the file used, re-prepend
/// the BOM if it had one.
///
/// Consistent files (all-LF or all-CRLF) round-trip byte-for-byte. A *mixed*
/// file (CRLF classification but containing a bare LF) normalizes to the
/// dominant ending — CodeMirror stores text as `\n` only, so per-line ending
/// variation cannot survive an edit. This is a documented limitation, not a
/// guarantee (see Task 10 carry-forward debt).
pub fn encode(text: &str, meta: FileMeta) -> Vec<u8> {
    let body = match meta.eol {
        Eol::Lf => text.to_string(),
        Eol::Crlf => text.replace('\n', "\r\n"),
    };
    let mut out = Vec::with_capacity(body.len() + UTF8_BOM.len());
    if meta.had_bom {
        out.extend_from_slice(&UTF8_BOM);
    }
    out.extend_from_slice(body.as_bytes());
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
        encode(&loaded.text, loaded.meta)
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
        // A consistent-CRLF file containing a lone CR (the `\r` after `a`).
        // The lone CR is never a line break, so it survives the round trip.
        // NOTE: a *mixed* file (CRLF + a bare LF, e.g. b"a\rb\r\nc\n") is
        // intentionally NOT round-tripped byte-for-byte — see the encode()
        // doc comment and the mixed-EOL carry-forward note in Task 10.
        let original = b"a\rb\r\nc\r\n";
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
