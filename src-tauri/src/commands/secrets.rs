//! Clés API des moteurs d'assets libres, rangées dans le trousseau du système (Secret Service
//! sous Linux, Keychain sous macOS, Credential Manager sous Windows). Si le trousseau est
//! indisponible (pas de démon Secret Service), repli sur le store `settings.json` en 0600.
//! Les anciennes clés du store sont migrées vers le trousseau à la première lecture.

use super::error::CmdResult;
use std::collections::BTreeMap;
use tauri_plugin_store::StoreExt;

const SERVICE: &str = "light-editor-vidz";
const SETTINGS_STORE: &str = "settings.json";
const API_KEYS_KEY: &str = "apiKeys";
pub const PROVIDERS: [&str; 3] = ["pexels", "pixabay", "freesound"];

fn entry(provider: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, provider)
}

fn keyring_get(provider: &str) -> Option<String> {
    entry(provider)
        .ok()?
        .get_password()
        .ok()
        .filter(|k| !k.is_empty())
}

fn store_keys(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    app.store(SETTINGS_STORE)
        .ok()
        .and_then(|s| s.get(API_KEYS_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn write_store(app: &tauri::AppHandle, keys: &BTreeMap<String, String>) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Settings store unavailable: {e}"))?;
    if keys.is_empty() {
        store.delete(API_KEYS_KEY);
    } else {
        store.set(API_KEYS_KEY, serde_json::json!(keys));
    }
    store
        .save()
        .map_err(|e| format!("Failed to save settings: {e}"))?;
    let _ = super::stock::restrict_settings_permissions(app.clone());
    Ok(())
}

/// Clé d'un moteur : trousseau d'abord, puis store (repli ou clé pas encore migrée).
pub fn api_key(app: &tauri::AppHandle, provider: &str) -> Option<String> {
    keyring_get(provider).or_else(|| {
        store_keys(app)
            .get(provider)
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
    })
}

#[tauri::command]
pub async fn load_api_keys(app: tauri::AppHandle) -> CmdResult<BTreeMap<String, String>> {
    super::blocking(move || {
        let mut keys = BTreeMap::new();
        for provider in PROVIDERS {
            if let Some(key) = api_key(&app, provider) {
                keys.insert(provider.to_string(), key);
            }
        }
        // Migration : les clés encore dans le store passent dans le trousseau, puis en sont retirées.
        let legacy = store_keys(&app);
        if !legacy.is_empty() {
            let mut remaining = legacy.clone();
            for (provider, key) in &legacy {
                if entry(provider).and_then(|e| e.set_password(key)).is_ok() {
                    remaining.remove(provider);
                }
            }
            if remaining.len() != legacy.len() {
                let _ = write_store(&app, &remaining);
            }
        }
        Ok(keys)
    })
    .await
}

#[tauri::command]
pub async fn save_api_keys(app: tauri::AppHandle, keys: BTreeMap<String, String>) -> CmdResult<()> {
    super::blocking(move || {
        let mut fallback = store_keys(&app);
        for provider in PROVIDERS {
            let key = keys.get(provider).map(|k| k.trim()).unwrap_or("");
            let stored = if key.is_empty() {
                // Suppression : « pas d'entrée » n'est pas une erreur.
                matches!(
                    entry(provider).map(|e| e.delete_credential()),
                    Ok(Ok(())) | Ok(Err(keyring::Error::NoEntry))
                )
            } else {
                entry(provider).and_then(|e| e.set_password(key)).is_ok()
            };
            if stored {
                fallback.remove(provider);
            } else if !key.is_empty() {
                // Trousseau indisponible : la clé reste dans le store (0600).
                fallback.insert(provider.to_string(), key.to_string());
            } else {
                fallback.remove(provider);
            }
        }
        write_store(&app, &fallback)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn providers_are_the_ones_the_settings_screen_offers() {
        assert_eq!(PROVIDERS, ["pexels", "pixabay", "freesound"]);
    }

    /// Aller-retour réel dans le trousseau ; sans démon Secret Service (CI, conteneur), le test
    /// constate l'indisponibilité au lieu d'échouer : c'est le cas qui déclenche le repli.
    #[test]
    fn keyring_roundtrip_when_a_keyring_is_available() {
        let name = format!("test-provider-{}", std::process::id());
        let Ok(e) = entry(&name) else { return };
        if e.set_password("secret-value").is_err() {
            eprintln!("keyring unavailable here: fallback path applies");
            return;
        }
        assert_eq!(keyring_get(&name).as_deref(), Some("secret-value"));
        e.delete_credential().unwrap();
        assert!(keyring_get(&name).is_none());
    }
}
