/// Strip the \\?\ extended-length prefix that canonicalize() adds on Windows.
pub(crate) fn clean_path(p: std::path::PathBuf) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") {
        std::path::PathBuf::from(&s[4..])
    } else {
        p
    }
}

/// All paths the bridge process needs to start.
pub(crate) struct BridgeConfig {
    /// Path to the bridge script (bundled or dev).
    pub script: std::path::PathBuf,
    /// Working directory for the Node.js process.
    pub work_dir: std::path::PathBuf,
    /// Path to a bundled Node.js binary (full installer only).
    pub node_bin: Option<std::path::PathBuf>,
}

/// Name of the bundled Node.js binary for the current platform.
#[cfg(windows)]
const NODE_BIN_NAME: &str = "node.exe";
#[cfg(not(windows))]
const NODE_BIN_NAME: &str = "node";

fn has_copilot_runtime(root: &std::path::Path) -> bool {
    let pkg = std::path::Path::new("@github")
        .join("copilot-sdk")
        .join("package.json");
    // Standard layout: node_modules/@github/copilot-sdk/package.json (dev mode)
    // Flat layout:     @github/copilot-sdk/package.json (bundled resource dir)
    root.join("node_modules").join(&pkg).exists() || root.join(&pkg).exists()
}

/// Resolve bridge paths.  Tries three strategies in order:
///
/// 1. **Packaged (bundled bridge)** — `<resource_dir>/scripts/copilot-bridge-bundled.mjs`
///    exists.  Self-contained single-file bundle, no node_modules needed.
///
/// 2. **Packaged (raw modules)** — `<resource_dir>/scripts/copilot-bridge.mjs` with the
///    SDK available in the resource dir (flat or node_modules layout).
///
/// 3. **Dev mode** — Walk from the executable to the source tree (`src-tauri/scripts/`).
pub(crate) fn bridge_paths(app: &tauri::AppHandle) -> Result<BridgeConfig, String> {
    use tauri::Manager;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {}", e))?;

    // --- Strategy 1: bundled bridge (packaged build) ---
    let bundled_script = resource_dir.join("scripts").join("copilot-bridge-bundled.mjs");
    if bundled_script.exists() {
        let bundled_script = clean_path(bundled_script);
        let work_dir = clean_path(resource_dir.clone());
        let node_bin_path = resource_dir.join("node-runtime").join(NODE_BIN_NAME);
        let node_bin = if node_bin_path.exists() {
            Some(clean_path(node_bin_path))
        } else {
            None
        };
        return Ok(BridgeConfig {
            script: bundled_script,
            work_dir,
            node_bin,
        });
    }

    // --- Strategy 2: unbundled bridge in resource dir (legacy packaged layout) ---
    let resource_script = resource_dir.join("scripts").join("copilot-bridge.mjs");
    if resource_script.exists() {
        let resource_script = clean_path(resource_script);
        let project_root = resource_script
            .parent()
            .and_then(|p| p.parent())
            .ok_or_else(|| "Cannot resolve project root from resource path".to_string())?
            .to_path_buf();
        if has_copilot_runtime(&project_root) {
            return Ok(BridgeConfig {
                script: resource_script,
                work_dir: project_root,
                node_bin: None,
            });
        }
    }

    // --- Strategy 3: dev mode — walk from executable to source tree ---
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(tauri_dir) = exe.parent() {
        // target/debug/ -> src-tauri/
        let dev_path = tauri_dir
            .join("..") // target/
            .join("..") // src-tauri/
            .join("scripts")
            .join("copilot-bridge.mjs");
        let dev_path = clean_path(dev_path.canonicalize().unwrap_or(dev_path));
        if dev_path.exists() {
            // Project root is src-tauri/../ (i.e. two levels up from scripts/)
            let project_root = dev_path
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .ok_or_else(|| "Cannot resolve project root from dev path".to_string())?
                .to_path_buf();
            if has_copilot_runtime(&project_root) {
                return Ok(BridgeConfig {
                    script: dev_path,
                    work_dir: project_root,
                    node_bin: None,
                });
            }
        }
    }

    Err("copilot-bridge.mjs or bundled Copilot runtime not found".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_path_strips_extended_prefix() {
        let p = std::path::PathBuf::from(r"\\?\C:\Users\test\file.txt");
        let cleaned = clean_path(p);
        assert_eq!(cleaned, std::path::PathBuf::from(r"C:\Users\test\file.txt"));
    }

    #[test]
    fn clean_path_leaves_normal_path_unchanged() {
        let p = std::path::PathBuf::from(r"C:\Users\test\file.txt");
        let cleaned = clean_path(p.clone());
        assert_eq!(cleaned, p);
    }

    #[test]
    fn clean_path_handles_unix_style_path() {
        let p = std::path::PathBuf::from("/home/user/file.txt");
        let cleaned = clean_path(p.clone());
        assert_eq!(cleaned, p);
    }

    #[test]
    fn has_copilot_runtime_rejects_missing_runtime() {
        let temp = std::env::temp_dir().join("copilot-runtime-missing-test");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        assert!(!has_copilot_runtime(&temp));
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn has_copilot_runtime_finds_standard_layout() {
        let temp = std::env::temp_dir().join("copilot-runtime-standard-test");
        let _ = std::fs::remove_dir_all(&temp);
        let pkg_dir = temp.join("node_modules").join("@github").join("copilot-sdk");
        std::fs::create_dir_all(&pkg_dir).unwrap();
        std::fs::write(pkg_dir.join("package.json"), "{}").unwrap();
        assert!(has_copilot_runtime(&temp));
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn has_copilot_runtime_finds_flat_layout() {
        let temp = std::env::temp_dir().join("copilot-runtime-flat-test");
        let _ = std::fs::remove_dir_all(&temp);
        let pkg_dir = temp.join("@github").join("copilot-sdk");
        std::fs::create_dir_all(&pkg_dir).unwrap();
        std::fs::write(pkg_dir.join("package.json"), "{}").unwrap();
        assert!(has_copilot_runtime(&temp));
        let _ = std::fs::remove_dir_all(&temp);
    }
}
