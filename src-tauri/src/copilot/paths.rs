/// Strip the \\?\ extended-length prefix that canonicalize() adds on Windows.
pub(crate) fn clean_path(p: std::path::PathBuf) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") {
        std::path::PathBuf::from(&s[4..])
    } else {
        p
    }
}

/// Resolve the path to copilot-bridge.mjs and the project root (where node_modules lives).
pub(crate) fn bridge_paths(app: &tauri::AppHandle) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    use tauri::Manager;

    // During dev the script lives at src-tauri/scripts/copilot-bridge.mjs
    // and node_modules is at the project root (one level above src-tauri).
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {}", e))?
        .join("scripts")
        .join("copilot-bridge.mjs");
    if resource.exists() {
        let resource = clean_path(resource);
        let project_root = resource
            .parent()
            .and_then(|p| p.parent())
            .ok_or_else(|| "Cannot resolve project root from resource path".to_string())?
            .to_path_buf();
        return Ok((resource, project_root));
    }

    // Fallback: dev mode – walk from the executable to the source tree
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
            return Ok((dev_path, project_root));
        }
    }

    Err("copilot-bridge.mjs not found".into())
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
}
