use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// "<dir>/<stem>.assets" for a document path (e.g. /x/notes.md -> /x/notes.assets).
fn assets_dir_for(doc_path: &str) -> PathBuf {
    let p = Path::new(doc_path);
    let dir = p.parent().unwrap_or_else(|| Path::new("."));
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("untitled");
    dir.join(format!("{stem}.assets"))
}

/// A non-colliding path in `dir` for `name`, appending -1, -2, ... before the
/// extension until free. Never returns an existing path (never overwrites).
fn dedup_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let np = Path::new(name);
    let stem = np.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = np.extension().and_then(|s| s.to_str());
    let mut n = 1;
    loop {
        let cand = match ext {
            Some(e) => dir.join(format!("{stem}-{n}.{e}")),
            None => dir.join(format!("{stem}-{n}")),
        };
        if !cand.exists() {
            return cand;
        }
        n += 1;
    }
}

/// Atomic write: temp file in the same dir + rename (matches fs.rs discipline).
fn atomic_write(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = dest.parent().ok_or("destination has no parent dir")?;
    let base = dest.file_name().and_then(|s| s.to_str()).unwrap_or("asset");
    let tmp = dir.join(format!(".{base}.tmp"));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Ensure <doc>.assets/, write `bytes` under a de-duped name derived from
/// `desired_name`, and return the doc-folder-relative path "<stem>.assets/<name>".
fn store_asset(doc_path: &str, desired_name: &str, bytes: &[u8]) -> Result<String, String> {
    let dir = assets_dir_for(doc_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dedup_path(&dir, desired_name);
    atomic_write(&dest, bytes)?;
    let folder = dir.file_name().and_then(|s| s.to_str()).ok_or("bad assets dir")?;
    let fname = dest.file_name().and_then(|s| s.to_str()).ok_or("bad file name")?;
    Ok(format!("{folder}/{fname}"))
}

/// Copy an existing file into <doc>.assets/. For the file picker + drag-drop.
#[tauri::command]
pub fn copy_image_into_assets(doc_path: String, source_path: String) -> Result<String, String> {
    let bytes = fs::read(&source_path).map_err(|e| e.to_string())?;
    let name = Path::new(&source_path)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("source path has no file name")?;
    store_asset(&doc_path, name, &bytes)
}

/// Write raw image bytes into <doc>.assets/ as "pasted.<ext>" (de-duped). For paste.
#[tauri::command]
pub fn write_image_into_assets(doc_path: String, bytes: Vec<u8>, ext: String) -> Result<String, String> {
    let ext = ext.trim_start_matches('.').to_lowercase();
    let name = if ext.is_empty() { "pasted.png".to_string() } else { format!("pasted.{ext}") };
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
}
