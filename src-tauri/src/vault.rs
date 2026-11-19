//! Compatibility codec for the existing Python Fernet vault. Not exposed to the webview.
use fernet::Fernet;
use std::{fmt, fs::File, io::Read, path::Path};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum VaultError {
    Unavailable,
    InvalidKey,
    InvalidCredential,
}
impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unavailable => "The existing vault key could not be read.",
            Self::InvalidKey => "The existing vault key is invalid.",
            Self::InvalidCredential => "The stored credential could not be decrypted.",
        })
    }
}
impl std::error::Error for VaultError {}

pub struct Vault(Fernet);
impl Vault {
    pub fn open(workspace: &Path) -> Result<Self, VaultError> {
        let file = File::open(workspace.join("vault.key")).map_err(|_| VaultError::Unavailable)?;
        let mut key = String::with_capacity(45);
        file.take(45)
            .read_to_string(&mut key)
            .map_err(|_| VaultError::InvalidKey)?;
        if key.len() != 44 {
            return Err(VaultError::InvalidKey);
        }
        Fernet::new(&key).map(Self).ok_or(VaultError::InvalidKey)
    }
    pub fn unseal(&self, token: &str) -> Result<String, VaultError> {
        self.0
            .decrypt(token)
            .ok()
            .and_then(|clear| String::from_utf8(clear).ok())
            .ok_or(VaultError::InvalidCredential)
    }
    pub fn seal(&self, clear: &str) -> String {
        self.0.encrypt(clear.as_bytes())
    }
}
