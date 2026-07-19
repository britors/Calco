use crate::model::SerializedWorkbook;
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
use thiserror::Error;
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

#[derive(Debug, Error)]
pub enum FormatError {
    #[error("erro de I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("arquivo ZIP inválido: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("JSON inválido: {0}")]
    Json(#[from] serde_json::Error),
    #[error("versão .calco não suportada: {0}")]
    Version(u8),
    #[error("entrada obrigatória ausente: {0}")]
    Missing(&'static str),
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format_version: u8,
    generated_by: String,
}

pub fn save(path: &Path, doc: &SerializedWorkbook) -> Result<(), FormatError> {
    let file = File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("manifest.json", options)?;
    zip.write_all(&serde_json::to_vec(&Manifest {
        format_version: 1,
        generated_by: format!("Calco {}", env!("CARGO_PKG_VERSION")),
    })?)?;
    zip.start_file("workbook.json", options)?;
    zip.write_all(&serde_json::to_vec(doc)?)?;
    zip.finish()?;
    Ok(())
}

pub fn open(path: &Path) -> Result<SerializedWorkbook, FormatError> {
    let mut zip = ZipArchive::new(File::open(path)?)?;
    let manifest: Manifest = {
        let mut entry = zip
            .by_name("manifest.json")
            .map_err(|_| FormatError::Missing("manifest.json"))?;
        let mut bytes = vec![];
        entry.read_to_end(&mut bytes)?;
        serde_json::from_slice(&bytes)?
    };
    if manifest.format_version != 1 {
        return Err(FormatError::Version(manifest.format_version));
    }
    let mut entry = zip
        .by_name("workbook.json")
        .map_err(|_| FormatError::Missing("workbook.json"))?;
    let mut bytes = vec![];
    entry.read_to_end(&mut bytes)?;
    Ok(serde_json::from_slice(&bytes)?)
}
