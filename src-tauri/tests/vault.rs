use inkwell_tauri::vault::{Vault, VaultError};
use std::fs;

const KEY: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
// Generated with the archived Python dependency's Fernet.encrypt_at_time and a synthetic key.
const TOKEN: &str = "gAAAAABp9rxxKOTS5LgEawiJp-zc0QmPFyIG19AVWxSaJANXfkZAOF8nQnlrKFKoH1aJiZqRqn5MzVN27Yi-GI9npCWW5M7PM3uhsCQYBP2lHNjPNE5brFc=";

#[test]
fn reads_python_tokens_and_rejects_bad_keys_or_ciphertext() {
    let dir = tempfile::tempdir().unwrap();
    let key = dir.path().join("vault.key");
    assert!(matches!(
        Vault::open(dir.path()),
        Err(VaultError::Unavailable)
    ));
    assert!(!key.exists());
    fs::write(&key, KEY).unwrap();
    let vault = Vault::open(dir.path()).unwrap();
    assert_eq!(
        vault.unseal(TOKEN).unwrap(),
        "fixture: outlook refresh token"
    );
    let sealed = vault.seal("synthetic OAuth refresh token");
    assert_eq!(
        vault.unseal(&sealed).unwrap(),
        "synthetic OAuth refresh token"
    );
    let corrupt = TOKEN.replacen("KOTS", "JOTS", 1);
    assert_eq!(vault.unseal(&corrupt), Err(VaultError::InvalidCredential));
    assert_eq!(fs::read_to_string(&key).unwrap(), KEY);
    fs::write(&key, format!("{KEY}\n")).unwrap();
    assert!(matches!(
        Vault::open(dir.path()),
        Err(VaultError::InvalidKey)
    ));
}
