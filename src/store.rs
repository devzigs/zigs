//! Tiny file-based "bulletin board".
//!
//! Every message that a real deployment would send over the network (via a
//! relay such as ZF's `frostd`) is written as a JSON file under `public/`.
//! Every secret is written under `participants/<id>/` and must never leave
//! that participant's machine.
//!
//! WARNING: DKG round-2 packages are point-to-point *secret* messages. In this
//! prototype they are plain files. A real deployment must encrypt and
//! authenticate them (frost-client uses Noise channels for this).

use std::path::{Path, PathBuf};

use eyre::{eyre, Result, WrapErr};
use serde::{de::DeserializeOwned, Serialize};

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
        }
    }

    pub fn path(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    pub fn write_json<T: Serialize>(&self, rel: &str, value: &T) -> Result<()> {
        let p = self.path(rel);
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&p, serde_json::to_vec_pretty(value)?)
            .wrap_err_with(|| format!("writing {}", p.display()))
    }

    pub fn read_json<T: DeserializeOwned>(&self, rel: &str) -> Result<T> {
        let p = self.path(rel);
        let bytes =
            std::fs::read(&p).wrap_err_with(|| format!("reading {}", p.display()))?;
        serde_json::from_slice(&bytes).wrap_err_with(|| format!("parsing {}", p.display()))
    }

    pub fn write_bytes(&self, rel: &str, bytes: &[u8]) -> Result<()> {
        let p = self.path(rel);
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&p, bytes).wrap_err_with(|| format!("writing {}", p.display()))
    }

    pub fn read_bytes(&self, rel: &str) -> Result<Vec<u8>> {
        let p = self.path(rel);
        std::fs::read(&p).wrap_err_with(|| format!("reading {}", p.display()))
    }

    #[allow(dead_code)]
    pub fn exists(&self, rel: &str) -> bool {
        self.path(rel).exists()
    }

    pub fn remove(&self, rel: &str) -> Result<()> {
        let p = self.path(rel);
        if p.exists() {
            std::fs::remove_file(&p)?;
        }
        Ok(())
    }

    #[allow(dead_code)]
    /// List file stems (without `.json`) in a directory.
    pub fn list(&self, rel_dir: &str) -> Result<Vec<String>> {
        let p = self.path(rel_dir);
        if !p.exists() {
            return Ok(vec![]);
        }
        let mut out = vec![];
        for e in std::fs::read_dir(&p)? {
            let name = e?.file_name().to_string_lossy().to_string();
            if let Some(stem) = name.strip_suffix(".json") {
                out.push(stem.to_string());
            }
        }
        out.sort();
        Ok(out)
    }
}

pub fn parse_id(s: &str) -> Result<u16> {
    s.parse::<u16>().map_err(|_| eyre!("bad participant id {s}"))
}
