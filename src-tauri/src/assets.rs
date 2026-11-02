use std::fs;
use std::io::ErrorKind;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

/// "<dir>/<stem>.assets" for a document path (e.g. /x/notes.md -> /x/notes.assets).
fn assets_dir_for(doc_path: &str) -> PathBuf {
    let p = Path::new(doc_path);
    let dir = p.parent().unwrap_or_else(|| Path::new("."));
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("untitled");
    dir.join(format!("{stem}.assets"))
}

/// Sanitize an extension to a bare lowercase alphanumeric string (no separators,
/// no dots). Falls back to "png" if empty after sanitizing.
fn sanitize_ext(ext: &str) -> String {
    let cleaned: String = ext
        .trim_start_matches('.')
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if cleaned.is_empty() { "png".to_string() } else { cleaned }
}

/// Candidate file name #n: "name" for n==0, else "stem-n.ext" (or "stem-n").
fn candidate_name(name: &str, n: u32) -> String {
    if n == 0 {
        return name.to_string();
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    match p.extension().and_then(|s| s.to_str()) {
        Some(e) => format!("{stem}-{n}.{e}"),
        None => format!("{stem}-{n}"),
    }
}

/// Ensure <doc>.assets/, write `bytes` to a unique temp there, then atomically
/// persist it to a non-colliding destination (never overwriting — the race-free
/// `persist_noclobber` closes the check-then-act gap; the NamedTempFile is
/// auto-deleted on failure, matching fs.rs). Returns "<stem>.assets/<name>".
fn store_asset(doc_path: &str, desired_name: &str, bytes: &[u8]) -> Result<String, String> {
    let dir = assets_dir_for(doc_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let folder = dir
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("bad assets dir")?
        .to_string();

    let mut tmp = NamedTempFile::new_in(&dir).map_err(|e| e.to_string())?;
    tmp.write_all(bytes).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;

    let mut n = 0u32;
    loop {
        let cand = dir.join(candidate_name(desired_name, n));
        match tmp.persist_noclobber(&cand) {
            Ok(_) => {
                let fname = cand.file_name().and_then(|s| s.to_str()).ok_or("bad file name")?;
                return Ok(format!("{folder}/{fname}"));
            }
            Err(e) if e.error.kind() == ErrorKind::AlreadyExists => {
                tmp = e.file; // reclaim the temp file, try the next candidate name
                n += 1;
            }
            Err(e) => return Err(e.error.to_string()),
        }
    }
}

/// The picture types Edtr inserts. Mirrors `IMAGE_EXTS` in
/// `src/files/imageTypes.ts`; `imageTypes.contract.test.ts` holds the two equal.
pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTS.contains(&e.to_lowercase().as_str()))
}

/// Copy an existing picture into <doc>.assets/. For the file picker + drag-drop.
///
/// Pictures only, checked here as well as in the frontend's filters: this
/// command can read any file the app can, and copying a key or a script next
/// to a document would put it wherever that document is shared.
#[tauri::command]
pub fn copy_image_into_assets(doc_path: String, source_path: String) -> Result<String, String> {
    let source = Path::new(&source_path);
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("source path has no file name")?;
    if !is_image_file(source) {
        return Err(format!("{name} is not a picture, so it was not added."));
    }
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    store_asset(&doc_path, name, &bytes)
}

/// Write raw image bytes into <doc>.assets/ as "pasted.<ext>" (de-duped). For paste.
#[tauri::command]
pub fn write_image_into_assets(doc_path: String, bytes: Vec<u8>, ext: String) -> Result<String, String> {
    let ext = sanitize_ext(&ext);
    let name = format!("pasted.{ext}");
    store_asset(&doc_path, &name, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assets_dir_uses_doc_stem() {
        assert_eq!(assets_dir_for("/x/y/notes.md"), PathBuf::from("/x/y/notes.assets"));
    }

    #[test]
    fn copy_creates_dir_and_returns_relative_path_and_preserves_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("notes.md");
        fs::write(&doc, b"# hi\n").unwrap();
        let src = dir.path().join("pic.png");
        fs::write(&src, b"\x89PNGDATA").unwrap();
        let rel = copy_image_into_assets(
            doc.to_string_lossy().into_owned(),
            src.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(rel, "notes.assets/pic.png");
        assert_eq!(fs::read(dir.path().join("notes.assets/pic.png")).unwrap(), b"\x89PNGDATA");
    }

    fn copy_from(dir: &Path, name: &str) -> Result<String, String> {
        let doc = dir.join("notes.md");
        fs::write(&doc, b"# hi\n").unwrap();
        let src = dir.join(name);
        fs::write(&src, b"bytes").unwrap();
        copy_image_into_assets(doc.to_string_lossy().into_owned(), src.to_string_lossy().into_owned())
    }

    #[test]
    fn copy_accepts_every_picture_type_in_any_letter_case() {
        for name in ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg", "g.bmp", "h.avif"] {
            let dir = tempfile::tempdir().unwrap();
            assert!(copy_from(dir.path(), name).is_ok(), "{name} should be accepted");
        }
    }

    #[test]
    fn copy_refuses_anything_that_is_not_a_picture_and_writes_nothing() {
        for name in ["notes.txt", "id_rsa", "run.command", "setup.sh", "page.html", "photo.png.app", ".png"] {
            let dir = tempfile::tempdir().unwrap();
            assert!(copy_from(dir.path(), name).is_err(), "{name} should be refused");
            assert!(!dir.path().join("notes.assets").exists(), "{name}: nothing may be written");
        }
    }

    #[test]
    fn copy_dedups_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("notes.md");
        fs::write(&doc, b"x").unwrap();
        let src = dir.path().join("pic.png");
        fs::write(&src, b"A").unwrap();
        let doc_s = doc.to_string_lossy().into_owned();
        let src_s = src.to_string_lossy().into_owned();
        let r1 = copy_image_into_assets(doc_s.clone(), src_s.clone()).unwrap();
        let r2 = copy_image_into_assets(doc_s, src_s).unwrap();
        assert_eq!(r1, "notes.assets/pic.png");
        assert_eq!(r2, "notes.assets/pic-1.png");
    }

    #[test]
    fn write_bytes_names_pasted_and_dedups() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("notes.md");
        fs::write(&doc, b"x").unwrap();
        let doc_s = doc.to_string_lossy().into_owned();
        let r1 = write_image_into_assets(doc_s.clone(), b"A".to_vec(), "png".into()).unwrap();
        let r2 = write_image_into_assets(doc_s, b"B".to_vec(), "png".into()).unwrap();
        assert_eq!(r1, "notes.assets/pasted.png");
        assert_eq!(r2, "notes.assets/pasted-1.png");
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("notes.md");
        fs::write(&doc, b"x").unwrap();
        let src = dir.path().join("p.png");
        fs::write(&src, b"Z").unwrap();
        copy_image_into_assets(doc.to_string_lossy().into_owned(), src.to_string_lossy().into_owned()).unwrap();
        let names: Vec<_> = fs::read_dir(dir.path().join("notes.assets"))
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("p.png")]);
    }

    #[test]
    fn sanitize_ext_strips_separators_and_dots() {
        assert_eq!(sanitize_ext("png"), "png");
        assert_eq!(sanitize_ext(".JPEG"), "jpeg");
        assert_eq!(sanitize_ext("png/../../x"), "pngx");
        assert_eq!(sanitize_ext(""), "png");
    }

    #[test]
    fn write_bytes_with_hostile_ext_stays_in_assets_dir() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("notes.md");
        fs::write(&doc, b"x").unwrap();
        let rel = write_image_into_assets(doc.to_string_lossy().into_owned(), b"A".to_vec(), "png/../evil".into()).unwrap();
        // ext sanitized to "pngevil"; path stays inside notes.assets/ with a single separator.
        assert_eq!(rel, "notes.assets/pasted.pngevil");
        assert!(dir.path().join("notes.assets/pasted.pngevil").exists());
    }
}
