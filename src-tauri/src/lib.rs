mod commands;
mod export;
mod imgz;
#[cfg(target_os = "linux")]
mod menu_style;
mod subz;

const STALE_AUDIO_AGE: std::time::Duration = std::time::Duration::from_secs(3600);
/// Le temps laissé à une génération de sous-titres pour s'arrêter proprement à la fermeture.
const QUIT_GRACE: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    menu_style::unhinted_text();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            commands::launch::on_second_launch(app, &args, &cwd);
        }))
        .setup(|app| {
            {
                use tauri::Manager;
                app.manage(commands::video_tool::VideoState::new(app.handle().clone()));
                commands::launch::on_first_launch(app.handle());
                // L'audio temporaire laissé par un plantage ou un arrêt forcé.
                if let Ok(cache) = app.path().app_cache_dir() {
                    subz::pipeline::audio_extract::remove_stale_temp_dirs(&cache, STALE_AUDIO_AGE);
                }
            }
            #[cfg(target_os = "linux")]
            menu_style::style_menu_bar();
            Ok(())
        })
        .manage(commands::launch::PendingOpen::default())
        .manage(commands::media_server::MediaServer::start())
        .manage(commands::export::ExportControl::default())
        .manage(audio_dsp::approval::Approved::default())
        .manage(audio_dsp::pipeline::DecodeCache::default())
        .manage(commands::audio_tool::AudioExportControl::default())
        // Un fichier déposé sur la fenêtre est un geste de l'utilisateur : le seul moyen, avec les
        // dialogues, de désigner un fichier que l'application peut ouvrir.
        .on_window_event(|window, event| {
            use tauri::Manager;
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let approved = window.state::<audio_dsp::approval::Approved>();
                for path in paths {
                    approved.allow_input(path);
                }
            }
        })
        .manage(commands::registry::OpenProjects::default())
        .manage(imgz::AppState(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        // Les images de la vue Image sont servies au WebView par ce protocole : le PNG ne
        // passe pas par l'IPC en base64.
        .register_asynchronous_uri_scheme_protocol("lcimg", |ctx, request, responder| {
            use tauri::Manager;
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || {
                let state = app.state::<imgz::AppState>();
                responder.respond(imgz::commands::image_protocol::serve(&state, &path));
            });
        })
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
            commands::export::export_project_audio,
            commands::export::cancel_export,
            commands::launch::take_pending_files,
            commands::media_server::video_stream_url,
            commands::media_server::project_stream_url,
            commands::audio_tool::pick_media_file,
            commands::audio_tool::media_kind,
            commands::audio_tool::audio_pick_file,
            commands::audio_tool::audio_pick_output,
            commands::audio_tool::audio_allow_asset,
            commands::audio_tool::audio_load,
            commands::audio_tool::audio_recent_list,
            commands::audio_tool::audio_recent_forget,
            commands::audio_tool::audio_process,
            commands::audio_tool::audio_cancel,
            commands::video_tool::video_pick_file,
            commands::video_tool::video_pick_subtitles,
            commands::video_tool::video_pick_output,
            commands::video_tool::video_preview,
            commands::video_tool::video_cancel_preview,
            commands::video_tool::video_filters,
            commands::video_tool::video_capabilities,
            commands::video_tool::video_queue_add,
            commands::video_tool::video_queue_list,
            commands::video_tool::video_queue_cancel,
            commands::video_tool::video_queue_clear_finished,
            commands::video_tool::video_recent_list,
            commands::video_tool::video_recent_forget,
            commands::subs_tool::subs_audio_tracks,
            commands::subs_tool::subs_media_tracks,
            commands::subs_tool::subs_generate_file,
            commands::subs_tool::subs_generate_media,
            commands::subs_tool::subs_generate_project,
            subz::commands::cancel_pipeline,
            subz::commands::translate_subtitles,
            subz::commands::list_languages,
            subz::commands::get_settings,
            subz::commands::set_settings,
            subz::commands::set_api_key,
            subz::commands::delete_api_key,
            subz::commands::has_api_key,
            subz::commands::save_subtitle_as,
            subz::commands::update_subtitles,
            imgz::commands::open::open_images,
            imgz::commands::open::open_images_by_paths,
            imgz::commands::exif::get_exif,
            imgz::commands::exif::strip_exif,
            imgz::commands::transform::canvas_resize_image,
            imgz::commands::transform::crop_image,
            imgz::commands::transform::flip_image,
            imgz::commands::transform::resize_image,
            imgz::commands::transform::rotate_image,
            imgz::commands::export::export_image,
            imgz::commands::history::undo_image,
            imgz::commands::history::redo_image,
            imgz::commands::history::reset_to_original,
            imgz::commands::history::reset_tool,
            imgz::commands::history::goto_history,
            imgz::commands::tabs::close_tab,
            imgz::commands::tabs::close_all_tabs,
            imgz::commands::tabs::close_other_tabs,
            imgz::commands::pipeline::apply_command,
            imgz::commands::pipeline::preview_command,
            imgz::commands::inpaint::inpaint_image,
            commands::release_notes::release_notes,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Quitter pendant une génération : on l'arrête et on attend qu'elle supprime son audio
            // temporaire et termine ffmpeg. Une seule fois, pour que la sortie finale passe.
            static QUITTING: std::sync::atomic::AtomicBool =
                std::sync::atomic::AtomicBool::new(false);
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if subz::cancel::is_busy()
                    && !QUITTING.swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_exit();
                    subz::cancel::request();
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        let deadline = std::time::Instant::now() + QUIT_GRACE;
                        while subz::cancel::is_busy() && std::time::Instant::now() < deadline {
                            std::thread::sleep(std::time::Duration::from_millis(50));
                        }
                        handle.exit(0);
                    });
                }
            }
            // Les exports en cours sont arrêtés et l'aperçu transcodé supprimé à la sortie.
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                app.state::<commands::video_tool::VideoState>().shutdown();
            }
        });
}
