// macOS application menu. Tauri auto-creates a default menu whose Window ▸ Close
// (⌘W) is a native accelerator the webview cannot intercept — that is why ⌘W
// closed the whole window. We rebuild the menu here, keep the standard editing
// items (so ⌘C/⌘V/⌘Q still work), drop "Close Window", and add a "Close Tab"
// item bound to ⌘W that the webview handles via the `menu://close-tab` event.
//
// macOS only: on Windows/Linux Tauri shows no menu bar by default, so ⌘/Ctrl+W
// reaches the webview and the in-app keybinding handles it directly.
#![cfg(target_os = "macos")]

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Wry,
};

/// Menu id for the custom Close-Tab item; matched in `on_menu_event`.
pub const CLOSE_TAB_ID: &str = "close_tab";
/// Event emitted to the webview when Close Tab (⌘W) is invoked.
pub const CLOSE_TAB_EVENT: &str = "menu://close-tab";

/// Build the macOS menu: standard App/Edit/View items plus a Window submenu
/// whose ⌘W is "Close Tab" (no native "Close Window").
pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "Maverick",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let close_tab = MenuItem::with_id(app, CLOSE_TAB_ID, "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &close_tab,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}
