//! Shared parts of the native views laid over the main window's module area
//! (Jumper Exchange, and CoW Swap on Linux and macOS).

/// Area of the main window a view covers, in CSS (logical) pixels.
#[derive(serde::Deserialize, Clone, Copy)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// On Linux Tauri packs every webview of a window into one vertical GtkBox,
/// so a child view lands below the main webview (off screen) and
/// `set_position` / `set_size` do nothing. The first child view moves the main
/// webview and itself into a GtkOverlay — main webview underneath, the view on
/// top; later views join that overlay. Each is placed with margins and a size
/// request.
#[cfg(target_os = "linux")]
pub fn place_linux<R: tauri::Runtime>(webview: &tauri::Webview<R>, bounds: Bounds) {
    use gtk::prelude::*;

    let result = webview.with_webview(move |platform| {
        let view = platform.inner();
        let widget: &gtk::Widget = view.upcast_ref();

        if let Some(vbox) = widget.parent().and_then(|p| p.downcast::<gtk::Box>().ok()) {
            let children = vbox.children();
            let overlay = children
                .iter()
                .find_map(|c| c.clone().downcast::<gtk::Overlay>().ok());
            if let Some(overlay) = overlay {
                vbox.remove(widget);
                overlay.add_overlay(widget);
                widget.show_all();
            } else if let Some(main) = children
                .into_iter()
                .find(|c| c != widget && c.is::<webkit2gtk::WebView>())
            {
                let overlay = gtk::Overlay::new();
                vbox.remove(widget);
                vbox.remove(&main);
                overlay.add(&main);
                overlay.add_overlay(widget);
                vbox.pack_start(&overlay, true, true, 0);
                overlay.show_all();
                main.grab_focus();
            }
        }

        widget.set_halign(gtk::Align::Start);
        widget.set_valign(gtk::Align::Start);
        widget.set_margin_start(bounds.x.max(0.0).round() as i32);
        widget.set_margin_top(bounds.y.max(0.0).round() as i32);
        widget.set_size_request(
            bounds.width.max(1.0).round() as i32,
            bounds.height.max(1.0).round() as i32,
        );
    });
    if let Err(e) = result {
        log::warn!("[{}] cannot place the view: {e}", webview.label());
    }
}
