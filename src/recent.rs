use crate::{format, model::SerializedWorkbook};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

fn data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .unwrap_or_else(std::env::temp_dir)
        .join("calco")
}

pub fn list() -> Vec<PathBuf> {
    let path = data_dir().join("recent.json");
    fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<PathBuf>>(&bytes).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|path| path.exists())
        .collect()
}

pub fn add(path: &Path) -> io::Result<()> {
    let directory = data_dir();
    fs::create_dir_all(&directory)?;
    let mut paths = list();
    paths.retain(|existing| existing != path);
    paths.insert(0, path.to_owned());
    paths.truncate(10);
    fs::write(directory.join("recent.json"), serde_json::to_vec(&paths)?)
}

pub fn autosave(document: &SerializedWorkbook) -> Result<(), format::FormatError> {
    let directory = data_dir();
    fs::create_dir_all(&directory)?;
    format::save(&directory.join("autosave.calco"), document)
}

pub fn autosave_path() -> PathBuf {
    data_dir().join("autosave.calco")
}

pub fn clear_autosave() {
    let _ = fs::remove_file(autosave_path());
}
