//! The list of recently opened audio files.
//!
//! Kept by Rust, like the approved paths: the WebView can only ask for the list
//! and for entries to be dropped, never name a path to add. A path enters the
//! list when a file the user picked or dropped has been loaded, and comes back
//! approved for opening when the list is read.

use serde::Serialize;
use std::fs;
use std::path::Path;

pub const MAX_RECENT: usize = 10;
pub const FILE_NAME: &str = "recent.json";

#[derive(Serialize, Debug, PartialEq)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub dir: String,
}

impl RecentFile {
    pub fn new(path: &str) -> Self {
        let p = Path::new(path);
        RecentFile {
            path: path.to_string(),
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            dir: p
                .parent()
                .map(|d| d.to_string_lossy().into_owned())
                .unwrap_or_default(),
        }
    }
}

/// `path` at the top of `list`, moved there if already present, list bounded.
pub fn pushed(list: Vec<String>, path: &str) -> Vec<String> {
    let mut out = vec![path.to_string()];
    out.extend(list.into_iter().filter(|p| p != path));
    out.truncate(MAX_RECENT);
    out
}

pub fn read(file: &Path) -> Vec<String> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write(file: &Path, list: &[String]) {
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(list) {
        let _ = fs::write(file, json);
    }
}

/// Records `path` (just loaded) in the list stored in `file`.
pub fn record(file: &Path, path: &str) {
    write(file, &pushed(read(file), path));
}

/// The entries of the list in `file` whose file still exists, in order. A file that is gone is
/// dropped from the stored list too.
pub fn existing(file: &Path) -> Vec<RecentFile> {
    let list = read(file);
    let kept: Vec<String> = list
        .iter()
        .filter(|p| Path::new(p).is_file())
        .cloned()
        .collect();
    if kept.len() != list.len() {
        write(file, &kept);
    }
    kept.iter().map(|p| RecentFile::new(p)).collect()
}

/// Drops one entry, or all of them when `path` is `None`.
pub fn forget(file: &Path, path: Option<&str>) {
    let list = match path {
        Some(p) => read(file).into_iter().filter(|q| q != p).collect(),
        None => Vec::new(),
    };
    write(file, &list);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_new_file_goes_first() {
        assert_eq!(pushed(v(&["/a", "/b"]), "/c"), v(&["/c", "/a", "/b"]));
    }

    #[test]
    fn an_already_listed_file_moves_to_the_top_without_a_duplicate() {
        assert_eq!(pushed(v(&["/a", "/b", "/c"]), "/c"), v(&["/c", "/a", "/b"]));
    }

    #[test]
    fn the_list_is_bounded() {
        let many: Vec<String> = (0..MAX_RECENT).map(|i| format!("/f{i}")).collect();
        let out = pushed(many, "/new");
        assert_eq!(out.len(), MAX_RECENT);
        assert_eq!(out[0], "/new");
    }

    #[test]
    fn a_missing_or_corrupt_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        assert!(read(&file).is_empty());
        fs::write(&file, "not json").unwrap();
        assert!(read(&file).is_empty());
    }

    #[test]
    fn the_list_round_trips_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sub").join(FILE_NAME);
        write(&file, &v(&["/a", "/b"]));
        assert_eq!(read(&file), v(&["/a", "/b"]));
    }

    #[test]
    fn an_entry_is_split_into_name_and_folder() {
        let f = RecentFile::new("/home/me/music/song.wav");
        assert_eq!(f.name, "song.wav");
        assert_eq!(f.dir, "/home/me/music");
    }
}
