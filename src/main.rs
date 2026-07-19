mod ui;

use gtk::{Application, gio, prelude::*};

fn main() {
    let app = Application::new(
        Some("br.com.w3ti.Calco"),
        gio::ApplicationFlags::HANDLES_OPEN,
    );
    app.connect_activate(ui::build);
    app.connect_open(|app, files, _| {
        ui::build_with_path(app, files.first().and_then(gio::File::path));
    });
    app.run();
}
