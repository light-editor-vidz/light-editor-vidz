mod commands;
mod export;
#[cfg(target_os = "linux")]
mod menu_style;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    menu_style::unhinted_text();
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "linux")]
            menu_style::style_menu_bar();
            Ok(())
        })
        .manage(commands::export::ExportControl::default())
        .manage(commands::registry::OpenProjects::default())
        .register_uri_scheme_protocol("lvmedia", |ctx, request| {
            use tauri::Manager;
            let projects = ctx.app_handle().state::<commands::registry::OpenProjects>();
            let range = request.headers().get("range").and_then(|v| v.to_str().ok());
            let served = commands::media_protocol::serve(&projects, request.uri().path(), range);
            let mut response = tauri::http::Response::builder().status(served.status);
            for (name, value) in served.headers {
                response = response.header(name, value);
            }
            response.body(served.body).unwrap_or_default()
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::project::new_project,
            commands::project::load_project,
            commands::project::save_project,
            commands::project::list_recent_projects,
            commands::project::pick_text_file,
            commands::project::remove_recent_project,
            commands::assets::import_asset,
            commands::assets::list_assets,
            commands::assets::delete_asset,
            commands::assets::read_media_file,
            commands::stock::search_stock_assets,
            commands::stock::import_stock_asset,
            commands::stock::restrict_settings_permissions,
            commands::secrets::load_api_keys,
            commands::secrets::save_api_keys,
            commands::export::export_project,
            commands::export::cancel_export,
            commands::release_notes::release_notes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
