use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;

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
// Tauri commands — thin wrappers over decode/encode with on-disk atomic write.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_text_file(path: String) -> Result<LoadedFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read file: {e}"))?;
    decode(&bytes).map_err(|e| match e {
        DecodeError::LooksBinary => {
            "This looks like a binary file — Edtr edits text files only.".to_string()
        }
        DecodeError::NotUtf8 => "Edtr supports UTF-8 text files only.".to_string(),
    })
}

#[tauri::command]
pub fn write_text_file_atomic(path: String, text: String, meta: FileMeta) -> Result<(), String> {
    let bytes = encode(&text, meta);
    let target = PathBuf::from(&path);
    let dir = target
        .parent()
        .ok_or_else(|| "Invalid file path (no parent directory)".to_string())?;

    // Write to a temp file in the SAME directory, flush to disk, then rename
    // over the original — an atomic replace that can't leave a half-written file.
    let mut tmp = tempfile::NamedTempFile::new_in(dir)
        .map_err(|e| format!("Could not create temp file: {e}"))?;
    tmp.write_all(&bytes)
        .map_err(|e| format!("Could not write file: {e}"))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| format!("Could not flush file: {e}"))?;
    tmp.persist(&target)
        .map_err(|e| format!("Could not save file: {e}"))?;
    Ok(())
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

    // -------------------------------------------------------------------------
    // Task 3: Integration tests — on-disk round-trip via the real Tauri commands
    // -------------------------------------------------------------------------

    #[test]
    fn write_atomic_then_disk_bytes_match_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.md");
        let original: &[u8] = b"x\r\ny\r\n";
        std::fs::write(&path, original).unwrap();

        let path_str = path.to_string_lossy().to_string();
        let loaded = read_text_file(path_str.clone()).expect("read");
        write_text_file_atomic(path_str, loaded.text, loaded.meta).expect("write");

        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn write_atomic_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        std::fs::write(&path, b"hello\n").unwrap();
        let path_str = path.to_string_lossy().to_string();
        let loaded = read_text_file(path_str.clone()).unwrap();
        write_text_file_atomic(path_str, loaded.text, loaded.meta).unwrap();

        let mut entries: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect();
        entries.sort();
        assert_eq!(entries, vec![std::ffi::OsString::from("note.md")]);
    }

    #[test]
    fn read_text_file_refuses_binary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blob.bin");
        std::fs::write(&path, b"a\0b").unwrap();
        let err = read_text_file(path.to_string_lossy().to_string()).unwrap_err();
        assert!(err.contains("binary"));
    }
}
