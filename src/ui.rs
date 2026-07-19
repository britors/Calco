use calco::{
    clipboard::{CellRange, build_html, build_tsv, clear_range, paste_tsv},
    csv::{CsvEncoding, decode, detect_delimiter, export_sheet, import_sheet},
    find_replace::{find_matches, replace_all, replace_in_cell},
    format,
    formula::{column_label, translate_references},
    model::{CellBorders, CellContent, CellStyle, HorizontalAlign, SerializedMerge, VerticalAlign},
    recent,
    workbook::{MAX_COLS, MAX_ROWS, Workbook},
    xlsx,
};
use gtk::{
    Adjustment, Align, Application, ApplicationWindow, Box as GtkBox, Button, ColorDialog,
    ColorDialogButton, DrawingArea, Entry, EventControllerKey, EventControllerScroll,
    EventControllerScrollFlags, FileDialog, GestureClick, GestureDrag, Grid, HeaderBar, Label,
    MenuButton, Orientation, Overlay, Popover, Scrollbar, gdk, gio, glib, prelude::*,
};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::PathBuf,
    rc::Rc,
};

const ROW_HEIGHT: f64 = 26.0;
const COL_WIDTH: f64 = 100.0;
const ROW_HEADER: f64 = 54.0;
const COL_HEADER: f64 = 28.0;
type RefreshCallback = Rc<dyn Fn()>;
type RefreshHolder = Rc<RefCell<Option<RefreshCallback>>>;

#[derive(Clone, Copy)]
enum ResizeAxis {
    Row,
    Col,
}

#[derive(Clone, Copy)]
struct ResizeState {
    axis: ResizeAxis,
    index: u32,
    original: f64,
}

#[derive(Default)]
struct State {
    workbook: Workbook,
    row: u32,
    col: u32,
    anchor_row: u32,
    anchor_col: u32,
    path: Option<PathBuf>,
    dirty: bool,
    select_all_stage: bool,
    internal_clipboard: Option<InternalClipboard>,
}

#[derive(Clone)]
struct InternalClipboard {
    text: String,
    source: CellRange,
    cells: Vec<InternalCell>,
}

#[derive(Clone)]
struct InternalCell {
    row_offset: u32,
    col_offset: u32,
    content: Option<CellContent>,
    value: String,
    style: Option<CellStyle>,
}

impl State {
    fn selection(&self) -> CellRange {
        CellRange::between(self.anchor_row, self.anchor_col, self.row, self.col)
    }
}

fn apply_style(workbook: &mut Workbook, range: CellRange, change: impl Fn(&mut CellStyle)) {
    let sheet = workbook.active_mut();
    for row in range.min_row..=range.max_row {
        for col in range.min_col..=range.max_col {
            change(sheet.styles.entry((row, col)).or_default());
        }
    }
}

fn snapshot_clipboard(state: &State, text: String) -> InternalClipboard {
    let range = state.selection();
    let sheet = state.workbook.active();
    let calculation = state.workbook.calculation();
    let mut cells = Vec::new();
    for row in range.min_row..=range.max_row {
        for col in range.min_col..=range.max_col {
            cells.push(InternalCell {
                row_offset: row - range.min_row,
                col_offset: col - range.min_col,
                content: sheet.cells.get(&(row, col)).cloned(),
                value: calculation.display(row, col),
                style: sheet.styles.get(&(row, col)).cloned(),
            });
        }
    }
    InternalClipboard {
        text,
        source: range,
        cells,
    }
}

pub fn build(app: &Application) {
    build_with_path(app, None);
}

pub fn build_with_path(app: &Application, initial_path: Option<PathBuf>) {
    let offer_recovery = initial_path.is_none() && recent::autosave_path().exists();
    let state = Rc::new(RefCell::new(State::default()));
    let window = ApplicationWindow::builder()
        .application(app)
        .title("Calco")
        .default_width(1280)
        .default_height(800)
        .build();
    let root = GtkBox::new(Orientation::Vertical, 0);
    window.set_child(Some(&root));

    let header = HeaderBar::new();
    let title = Label::new(Some("Calco"));
    title.add_css_class("title");
    header.set_title_widget(Some(&title));
    let new_btn = header_button("document-new-symbolic", "Nova planilha");
    let open_btn = header_button("document-open-symbolic", "Abrir");
    let save_btn = header_button("document-save-symbolic", "Salvar");
    let save_as_btn = header_button("document-save-as-symbolic", "Salvar como");
    let about_btn = header_button("help-about-symbolic", "Sobre o Calco");
    let recent_btn = MenuButton::new();
    recent_btn.set_label("Recentes");
    let import_csv_btn = Button::with_label("Importar CSV");
    import_csv_btn.set_tooltip_text(Some("Importar arquivo CSV"));
    let export_csv_btn = Button::with_label("Exportar CSV");
    export_csv_btn.set_tooltip_text(Some("Exportar a planilha ativa como CSV"));
    let import_xlsx_btn = Button::with_label("Importar XLSX");
    import_xlsx_btn.set_tooltip_text(Some("Importar arquivo Excel"));
    let export_xlsx_btn = Button::with_label("Exportar XLSX");
    export_xlsx_btn.set_tooltip_text(Some("Exportar como arquivo Excel"));
    header.pack_start(&new_btn);
    header.pack_start(&open_btn);
    header.pack_start(&save_btn);
    header.pack_start(&save_as_btn);
    header.pack_end(&about_btn);
    header.pack_end(&recent_btn);
    header.pack_end(&export_csv_btn);
    header.pack_end(&import_csv_btn);
    header.pack_end(&export_xlsx_btn);
    header.pack_end(&import_xlsx_btn);
    window.set_titlebar(Some(&header));

    let toolbar = GtkBox::new(Orientation::Horizontal, 4);
    toolbar.set_margin_start(8);
    toolbar.set_margin_end(8);
    toolbar.set_margin_top(5);
    toolbar.set_margin_bottom(5);
    let bold = Button::with_label("N");
    bold.set_tooltip_text(Some("Negrito"));
    bold.add_css_class("flat");
    let italic = Button::with_label("I");
    italic.set_tooltip_text(Some("Itálico"));
    italic.add_css_class("flat");
    let text_color =
        ColorDialogButton::new(Some(ColorDialog::builder().title("Cor do texto").build()));
    text_color.set_tooltip_text(Some("Cor do texto"));
    text_color.set_rgba(&gdk::RGBA::BLACK);
    let background_color =
        ColorDialogButton::new(Some(ColorDialog::builder().title("Cor de fundo").build()));
    background_color.set_tooltip_text(Some("Cor de fundo"));
    background_color.set_rgba(&gdk::RGBA::WHITE);
    let align_left = Button::with_label("≡");
    align_left.set_tooltip_text(Some("Alinhar à esquerda"));
    let align_center = Button::with_label("≣");
    align_center.set_tooltip_text(Some("Centralizar horizontalmente"));
    let align_right = Button::with_label("≡");
    align_right.set_tooltip_text(Some("Alinhar à direita"));
    let align_top = Button::with_label("▲");
    align_top.set_tooltip_text(Some("Alinhar ao topo"));
    let align_middle = Button::with_label("■");
    align_middle.set_tooltip_text(Some("Centralizar verticalmente"));
    let align_bottom = Button::with_label("▼");
    align_bottom.set_tooltip_text(Some("Alinhar à base"));
    let borders = Button::with_label("▦");
    borders.set_tooltip_text(Some("Alternar bordas"));
    let merge_cells = Button::with_label("⊞");
    merge_cells.set_tooltip_text(Some("Mesclar ou desmesclar células"));
    let undo = header_button("edit-undo-symbolic", "Desfazer");
    let redo = header_button("edit-redo-symbolic", "Refazer");
    let insert_rows = Button::with_label("+ Linhas");
    insert_rows.set_tooltip_text(Some("Inserir linhas acima da seleção"));
    let delete_rows = Button::with_label("− Linhas");
    delete_rows.set_tooltip_text(Some("Excluir linhas selecionadas"));
    let insert_cols = Button::with_label("+ Colunas");
    insert_cols.set_tooltip_text(Some("Inserir colunas à esquerda da seleção"));
    let delete_cols = Button::with_label("− Colunas");
    delete_cols.set_tooltip_text(Some("Excluir colunas selecionadas"));
    toolbar.append(&undo);
    toolbar.append(&redo);
    toolbar.append(&gtk::Separator::new(Orientation::Vertical));
    toolbar.append(&bold);
    toolbar.append(&italic);
    toolbar.append(&text_color);
    toolbar.append(&background_color);
    toolbar.append(&borders);
    toolbar.append(&merge_cells);
    toolbar.append(&align_left);
    toolbar.append(&align_center);
    toolbar.append(&align_right);
    toolbar.append(&align_top);
    toolbar.append(&align_middle);
    toolbar.append(&align_bottom);
    toolbar.append(&gtk::Separator::new(Orientation::Vertical));
    toolbar.append(&insert_rows);
    toolbar.append(&delete_rows);
    toolbar.append(&insert_cols);
    toolbar.append(&delete_cols);
    root.append(&toolbar);

    for (action, button) in [
        ("new", new_btn.clone()),
        ("open", open_btn.clone()),
        ("save", save_btn.clone()),
        ("save_as", save_as_btn.clone()),
        ("import_csv", import_csv_btn.clone()),
        ("export_csv", export_csv_btn.clone()),
        ("import_xlsx", import_xlsx_btn.clone()),
        ("export_xlsx", export_xlsx_btn.clone()),
        ("undo", undo.clone()),
        ("redo", redo.clone()),
        ("about", about_btn.clone()),
    ] {
        bind_button_action(app, action, &button);
    }
    let menu = gtk::gio::Menu::new();
    let file_menu = gtk::gio::Menu::new();
    file_menu.append(Some("Novo"), Some("app.new"));
    file_menu.append(Some("Abrir…"), Some("app.open"));
    file_menu.append(Some("Salvar"), Some("app.save"));
    file_menu.append(Some("Salvar como…"), Some("app.save_as"));
    let import_menu = gtk::gio::Menu::new();
    import_menu.append(Some("Excel (.xlsx)…"), Some("app.import_xlsx"));
    import_menu.append(Some("CSV (.csv)…"), Some("app.import_csv"));
    file_menu.append_submenu(Some("Importar"), &import_menu);
    let export_menu = gtk::gio::Menu::new();
    export_menu.append(Some("Excel (.xlsx)…"), Some("app.export_xlsx"));
    export_menu.append(Some("CSV (.csv)…"), Some("app.export_csv"));
    file_menu.append_submenu(Some("Exportar"), &export_menu);
    menu.append_submenu(Some("Arquivo"), &file_menu);
    let edit_menu = gtk::gio::Menu::new();
    edit_menu.append(Some("Desfazer"), Some("app.undo"));
    edit_menu.append(Some("Refazer"), Some("app.redo"));
    menu.append_submenu(Some("Editar"), &edit_menu);
    let help_menu = gtk::gio::Menu::new();
    help_menu.append(Some("Sobre o Calco"), Some("app.about"));
    menu.append_submenu(Some("Ajuda"), &help_menu);
    let menu_bar = gtk::PopoverMenuBar::from_model(Some(&menu));
    root.prepend(&menu_bar);
    app.set_accels_for_action("app.new", &["<Primary>n"]);
    app.set_accels_for_action("app.open", &["<Primary>o"]);
    app.set_accels_for_action("app.save", &["<Primary>s"]);
    app.set_accels_for_action("app.save_as", &["<Primary><Shift>s"]);
    app.set_accels_for_action("app.undo", &["<Primary>z"]);
    app.set_accels_for_action("app.redo", &["<Primary>y"]);

    let formula = GtkBox::new(Orientation::Horizontal, 6);
    formula.set_margin_start(8);
    formula.set_margin_end(8);
    formula.set_margin_bottom(5);
    let name = Entry::builder().width_chars(8).text("A1").build();
    let fx = Label::new(Some("fx"));
    fx.add_css_class("dim-label");
    let formula_entry = Entry::new();
    formula_entry.set_hexpand(true);
    formula.append(&name);
    formula.append(&fx);
    formula.append(&formula_entry);
    root.append(&formula);

    let overlay = Overlay::new();
    overlay.set_hexpand(true);
    overlay.set_vexpand(true);
    let drawing = DrawingArea::new();
    drawing.set_focusable(true);
    drawing.set_hexpand(true);
    drawing.set_vexpand(true);
    let hadj = Adjustment::new(0.0, 0.0, COL_WIDTH * MAX_COLS as f64, 40.0, 400.0, 800.0);
    let vadj = Adjustment::new(0.0, 0.0, ROW_HEIGHT * MAX_ROWS as f64, 26.0, 260.0, 600.0);
    let grid = Grid::new();
    grid.attach(&drawing, 0, 0, 1, 1);
    grid.attach(
        &Scrollbar::new(Orientation::Vertical, Some(&vadj)),
        1,
        0,
        1,
        1,
    );
    grid.attach(
        &Scrollbar::new(Orientation::Horizontal, Some(&hadj)),
        0,
        1,
        1,
        1,
    );
    overlay.set_child(Some(&grid));
    let editor = Entry::new();
    editor.add_css_class("cell-editor");
    editor.set_visible(false);
    editor.set_halign(Align::Start);
    editor.set_valign(Align::Start);
    editor.set_width_request(COL_WIDTH as i32);
    editor.set_height_request(ROW_HEIGHT as i32);
    overlay.add_overlay(&editor);

    let find_panel = GtkBox::new(Orientation::Vertical, 6);
    find_panel.add_css_class("find-panel");
    find_panel.set_halign(Align::End);
    find_panel.set_valign(Align::Start);
    find_panel.set_margin_top(8);
    find_panel.set_margin_end(20);
    find_panel.set_visible(false);
    let find_row = GtkBox::new(Orientation::Horizontal, 4);
    let find_entry = Entry::builder()
        .placeholder_text("Localizar")
        .width_chars(18)
        .build();
    let find_prev = Button::with_label("◀");
    find_prev.set_tooltip_text(Some("Resultado anterior"));
    let find_next = Button::with_label("▶");
    find_next.set_tooltip_text(Some("Próximo resultado"));
    let find_status = Label::new(None);
    let toggle_replace = Button::with_label("⋯");
    toggle_replace.set_tooltip_text(Some("Substituir"));
    let close_find = Button::with_label("×");
    close_find.set_tooltip_text(Some("Fechar"));
    for widget in [
        find_entry.clone().upcast::<gtk::Widget>(),
        find_prev.clone().upcast(),
        find_next.clone().upcast(),
        find_status.clone().upcast(),
        toggle_replace.clone().upcast(),
        close_find.clone().upcast(),
    ] {
        find_row.append(&widget);
    }
    let replace_row = GtkBox::new(Orientation::Horizontal, 4);
    replace_row.set_visible(false);
    let replace_entry = Entry::builder()
        .placeholder_text("Substituir por")
        .width_chars(18)
        .build();
    let replace_one = Button::with_label("Substituir");
    let replace_every = Button::with_label("Substituir tudo");
    replace_row.append(&replace_entry);
    replace_row.append(&replace_one);
    replace_row.append(&replace_every);
    find_panel.append(&find_row);
    find_panel.append(&replace_row);
    overlay.add_overlay(&find_panel);
    root.append(&overlay);

    let tabs = GtkBox::new(Orientation::Horizontal, 3);
    tabs.set_margin_start(8);
    tabs.set_margin_end(8);
    tabs.set_margin_top(4);
    tabs.set_margin_bottom(4);
    let add_sheet = Button::with_label("+");
    add_sheet.set_tooltip_text(Some("Nova planilha"));
    tabs.append(&add_sheet);
    root.append(&tabs);
    let status = Label::new(Some("Pronto"));
    status.set_halign(Align::End);
    status.set_margin_end(10);
    status.set_margin_bottom(4);
    root.append(&status);

    install_css();
    connect_draw(&drawing, state.clone(), hadj.clone(), vadj.clone());
    connect_system_theme(&drawing);
    if let Some(settings) = gtk::Settings::default() {
        let drawing_for_dark = drawing.clone();
        settings.connect_gtk_application_prefer_dark_theme_notify(move |_| {
            drawing_for_dark.queue_draw();
        });
        let drawing_for_theme = drawing.clone();
        settings.connect_gtk_theme_name_notify(move |_| drawing_for_theme.queue_draw());
    }
    {
        let drawing = drawing.clone();
        let editor = editor.clone();
        let state = state.clone();
        let hadj_for_editor = hadj.clone();
        let vadj = vadj.clone();
        hadj.connect_value_changed(move |_| {
            drawing.queue_draw();
            position_editor(&editor, &state, &hadj_for_editor, &vadj);
        });
    }
    {
        let drawing = drawing.clone();
        let editor = editor.clone();
        let state = state.clone();
        let hadj = hadj.clone();
        let vadj_for_editor = vadj.clone();
        vadj.connect_value_changed(move |_| {
            drawing.queue_draw();
            position_editor(&editor, &state, &hadj, &vadj_for_editor);
        });
    }
    {
        let hadj = hadj.clone();
        let vadj = vadj.clone();
        drawing.connect_resize(move |_, w, h| {
            hadj.set_page_size((w as f64 - ROW_HEADER).max(COL_WIDTH));
            vadj.set_page_size((h as f64 - COL_HEADER).max(ROW_HEIGHT));
        });
    }
    let wheel = EventControllerScroll::new(EventControllerScrollFlags::BOTH_AXES);
    {
        let hadj = hadj.clone();
        let vadj = vadj.clone();
        wheel.connect_scroll(move |_, dx, dy| {
            hadj.set_value(
                (hadj.value() + dx * COL_WIDTH * 2.0).clamp(0.0, hadj.upper() - hadj.page_size()),
            );
            vadj.set_value(
                (vadj.value() + dy * ROW_HEIGHT * 3.0).clamp(0.0, vadj.upper() - vadj.page_size()),
            );
            glib::Propagation::Stop
        });
    }
    drawing.add_controller(wheel);
    let refresh_tabs_holder: RefreshHolder = Rc::new(RefCell::new(None));
    let refresh_tabs: RefreshCallback = {
        let tabs = tabs.clone();
        let add_sheet = add_sheet.clone();
        let drawing = drawing.clone();
        let state = state.clone();
        let refresh_tabs_holder = refresh_tabs_holder.clone();
        Rc::new(move || {
            while let Some(child) = tabs.first_child() {
                tabs.remove(&child);
            }
            let (sheets, active) = {
                let s = state.borrow();
                (
                    s.workbook
                        .sheets
                        .iter()
                        .map(|sheet| sheet.name.clone())
                        .collect::<Vec<_>>(),
                    s.workbook.active,
                )
            };
            let can_delete = sheets.len() > 1;
            for (index, sheet_name) in sheets.into_iter().enumerate() {
                let tab = GtkBox::new(Orientation::Horizontal, 0);
                tab.add_css_class("sheet-tab");
                if index == active {
                    tab.add_css_class("active");
                }
                let entry = Entry::builder()
                    .text(&sheet_name)
                    .width_chars(sheet_name.len().clamp(6, 18) as i32)
                    .build();
                entry.set_tooltip_text(Some(
                    "Clique para selecionar; edite o nome e pressione Enter",
                ));
                let remove = Button::with_label("×");
                remove.add_css_class("flat");
                remove.set_sensitive(can_delete);
                remove.set_tooltip_text(Some("Excluir planilha"));
                tab.append(&entry);
                tab.append(&remove);
                let state_for_focus = state.clone();
                let drawing = drawing.clone();
                let tabs_for_focus = tabs.clone();
                entry.connect_has_focus_notify(move |entry| {
                    if !entry.has_focus() {
                        return;
                    }
                    state_for_focus.borrow_mut().workbook.active = index;
                    let mut child = tabs_for_focus.first_child();
                    let mut position = 0;
                    while let Some(widget) = child {
                        child = widget.next_sibling();
                        widget.remove_css_class("active");
                        if position == index {
                            widget.add_css_class("active");
                        }
                        position += 1;
                    }
                    drawing.queue_draw();
                });
                let state_for_rename = state.clone();
                let holder = refresh_tabs_holder.clone();
                entry.connect_activate(move |entry| {
                    let mut s = state_for_rename.borrow_mut();
                    if s.workbook.rename_sheet(index, entry.text().as_str()) {
                        s.dirty = true;
                    }
                    drop(s);
                    if let Some(refresh) = holder.borrow().as_ref() {
                        refresh();
                    }
                });
                let state_for_remove = state.clone();
                let holder = refresh_tabs_holder.clone();
                remove.connect_clicked(move |_| {
                    let mut s = state_for_remove.borrow_mut();
                    if s.workbook.remove_sheet(index) {
                        s.dirty = true;
                    }
                    drop(s);
                    if let Some(refresh) = holder.borrow().as_ref() {
                        refresh();
                    }
                });
                tabs.append(&tab);
            }
            tabs.append(&add_sheet);
        })
    };
    *refresh_tabs_holder.borrow_mut() = Some(refresh_tabs.clone());
    refresh_tabs();

    let recent_popover = Popover::new();
    let recent_list = GtkBox::new(Orientation::Vertical, 2);
    recent_list.set_margin_top(6);
    recent_list.set_margin_bottom(6);
    recent_list.set_margin_start(6);
    recent_list.set_margin_end(6);
    let recent_paths = recent::list();
    if recent_paths.is_empty() {
        recent_list.append(&Label::new(Some("Nenhum arquivo recente")));
    }
    for path in recent_paths {
        let button = Button::with_label(&path.file_name().unwrap_or_default().to_string_lossy());
        button.set_tooltip_text(Some(&path.to_string_lossy()));
        let window = window.clone();
        let state = state.clone();
        let drawing = drawing.clone();
        let refresh_tabs = refresh_tabs.clone();
        let title = title.clone();
        button.connect_clicked(move |_| {
            let window = window.clone();
            let state = state.clone();
            let drawing = drawing.clone();
            let refresh_tabs = refresh_tabs.clone();
            let title = title.clone();
            let path = path.clone();
            glib::spawn_future_local(async move {
                if !confirm_discard(&window, &state).await {
                    return;
                }
                match format::open(&path) {
                    Ok(document) => {
                        let mut s = state.borrow_mut();
                        s.workbook = Workbook::from_serialized(document);
                        s.path = Some(path.clone());
                        s.dirty = false;
                        drop(s);
                        title.set_text(&format!(
                            "Calco — {}",
                            path.file_name().unwrap_or_default().to_string_lossy()
                        ));
                        refresh_tabs();
                        drawing.queue_draw();
                    }
                    Err(error) => show_error(&window, &error.to_string()),
                }
            });
        });
        recent_list.append(&button);
    }
    recent_popover.set_child(Some(&recent_list));
    recent_btn.set_popover(Some(&recent_popover));

    let update_selection: Rc<dyn Fn()> = {
        let state = state.clone();
        let name = name.clone();
        let formula_entry = formula_entry.clone();
        let drawing = drawing.clone();
        let hadj = hadj.clone();
        let vadj = vadj.clone();
        Rc::new(move || {
            let s = state.borrow();
            name.set_text(&format!("{}{}", column_label(s.col), s.row + 1));
            formula_entry.set_text(&s.workbook.active().raw(s.row, s.col));
            let sheet = s.workbook.active();
            hadj.set_upper(sheet.total_width());
            vadj.set_upper(sheet.total_height());
            let cell_x = sheet.col_position(s.col);
            let cell_y = sheet.row_position(s.row);
            let cell_width = sheet.col_width(s.col);
            let cell_height = sheet.row_height(s.row);
            if cell_x < hadj.value() {
                hadj.set_value(cell_x);
            } else if cell_x + cell_width > hadj.value() + hadj.page_size() {
                hadj.set_value(cell_x + cell_width - hadj.page_size());
            }
            if cell_y < vadj.value() {
                vadj.set_value(cell_y);
            } else if cell_y + cell_height > vadj.value() + vadj.page_size() {
                vadj.set_value(cell_y + cell_height - vadj.page_size());
            }
            drawing.queue_draw();
        })
    };
    #[derive(Default)]
    struct FindSession {
        matches: Vec<(u32, u32)>,
        current: usize,
    }
    let find_session = Rc::new(RefCell::new(FindSession::default()));
    let refresh_find: Rc<dyn Fn()> = {
        let state = state.clone();
        let session = find_session.clone();
        let find_entry = find_entry.clone();
        let find_status = find_status.clone();
        let update = update_selection.clone();
        Rc::new(move || {
            let matches =
                find_matches(state.borrow().workbook.active(), find_entry.text().as_str());
            let mut search = session.borrow_mut();
            search.matches = matches;
            search.current = 0;
            if let Some(&(row, col)) = search.matches.first() {
                let mut s = state.borrow_mut();
                s.row = row;
                s.col = col;
                s.anchor_row = row;
                s.anchor_col = col;
                find_status.set_text(&format!("1/{}", search.matches.len()));
            } else {
                find_status.set_text("0/0");
            }
            drop(search);
            update();
        })
    };
    {
        let refresh_find = refresh_find.clone();
        find_entry.connect_changed(move |_| refresh_find());
    }
    let move_match: Rc<dyn Fn(bool)> = {
        let state = state.clone();
        let session = find_session.clone();
        let status = find_status.clone();
        let update = update_selection.clone();
        Rc::new(move |forward| {
            let mut search = session.borrow_mut();
            if search.matches.is_empty() {
                return;
            }
            search.current = if forward {
                (search.current + 1) % search.matches.len()
            } else {
                (search.current + search.matches.len() - 1) % search.matches.len()
            };
            let (row, col) = search.matches[search.current];
            let mut s = state.borrow_mut();
            s.row = row;
            s.col = col;
            s.anchor_row = row;
            s.anchor_col = col;
            status.set_text(&format!("{}/{}", search.current + 1, search.matches.len()));
            drop(s);
            drop(search);
            update();
        })
    };
    {
        let move_match = move_match.clone();
        find_next.connect_clicked(move |_| move_match(true));
    }
    {
        let move_match = move_match.clone();
        find_prev.connect_clicked(move |_| move_match(false));
    }
    {
        let move_match = move_match.clone();
        find_entry.connect_activate(move |_| move_match(true));
    }
    {
        let replace_row = replace_row.clone();
        toggle_replace.connect_clicked(move |_| replace_row.set_visible(!replace_row.is_visible()));
    }
    {
        let panel = find_panel.clone();
        let drawing = drawing.clone();
        close_find.connect_clicked(move |_| {
            panel.set_visible(false);
            drawing.grab_focus();
        });
    }
    {
        let state = state.clone();
        let session = find_session.clone();
        let query = find_entry.clone();
        let replacement = replace_entry.clone();
        let refresh_find = refresh_find.clone();
        replace_one.connect_clicked(move |_| {
            let target = {
                let search = session.borrow();
                search.matches.get(search.current).copied()
            };
            if let Some((row, col)) = target {
                let mut s = state.borrow_mut();
                s.workbook.checkpoint();
                replace_in_cell(
                    s.workbook.active_mut(),
                    row,
                    col,
                    query.text().as_str(),
                    replacement.text().as_str(),
                );
                s.dirty = true;
                drop(s);
                refresh_find();
            }
        });
    }
    {
        let state = state.clone();
        let query = find_entry.clone();
        let replacement = replace_entry.clone();
        let refresh_find = refresh_find.clone();
        replace_every.connect_clicked(move |_| {
            if find_matches(state.borrow().workbook.active(), query.text().as_str()).is_empty() {
                return;
            }
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            replace_all(
                s.workbook.active_mut(),
                query.text().as_str(),
                replacement.text().as_str(),
            );
            s.dirty = true;
            drop(s);
            refresh_find();
        });
    }
    let find_keys = EventControllerKey::new();
    {
        let panel = find_panel.clone();
        let replace_row = replace_row.clone();
        let entry = find_entry.clone();
        let drawing = drawing.clone();
        let new_btn = new_btn.clone();
        let open_btn = open_btn.clone();
        let save_btn = save_btn.clone();
        let save_as_btn = save_as_btn.clone();
        find_keys.connect_key_pressed(move |_, key, _, mods| {
            if mods.contains(gdk::ModifierType::CONTROL_MASK) {
                if key == gdk::Key::n {
                    new_btn.emit_clicked();
                    return glib::Propagation::Stop;
                }
                if key == gdk::Key::o {
                    open_btn.emit_clicked();
                    return glib::Propagation::Stop;
                }
                if key == gdk::Key::s {
                    if mods.contains(gdk::ModifierType::SHIFT_MASK) {
                        save_as_btn.emit_clicked();
                    } else {
                        save_btn.emit_clicked();
                    }
                    return glib::Propagation::Stop;
                }
            }
            if mods.contains(gdk::ModifierType::CONTROL_MASK)
                && (key == gdk::Key::f || key == gdk::Key::h)
            {
                panel.set_visible(true);
                replace_row.set_visible(key == gdk::Key::h);
                entry.grab_focus();
                entry.select_region(0, -1);
                return glib::Propagation::Stop;
            }
            if key == gdk::Key::Escape && panel.is_visible() {
                panel.set_visible(false);
                drawing.grab_focus();
                return glib::Propagation::Stop;
            }
            glib::Propagation::Proceed
        });
    }
    window.add_controller(find_keys);
    connect_grid_input(
        &drawing,
        &editor,
        state.clone(),
        update_selection.clone(),
        hadj,
        vadj,
    );

    {
        let state = state.clone();
        let drawing = drawing.clone();
        formula_entry.connect_activate(move |entry| {
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            let (r, c) = (s.row, s.col);
            s.workbook.active_mut().set_raw(r, c, &entry.text());
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    {
        let state = state.clone();
        let update = update_selection.clone();
        merge_cells.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            let changed = if s.workbook.active().merge_containing(s.row, s.col).is_some() {
                let (row, col) = (s.row, s.col);
                s.workbook.unmerge_at(row, col)
            } else {
                let range = s.selection();
                s.workbook.merge_range(SerializedMerge {
                    min_row: range.min_row,
                    min_col: range.min_col,
                    max_row: range.max_row,
                    max_col: range.max_col,
                })
            };
            if changed {
                s.dirty = true;
                let merge = s.workbook.active().merge_containing(s.row, s.col).cloned();
                if let Some(merge) = merge {
                    s.row = merge.min_row;
                    s.col = merge.min_col;
                    s.anchor_row = merge.max_row;
                    s.anchor_col = merge.max_col;
                }
            }
            drop(s);
            update();
        });
    }
    {
        let state = state.clone();
        let drawing = drawing.clone();
        background_color.connect_rgba_notify(move |picker| {
            let color = picker.rgba();
            let hex = format!(
                "#{:02x}{:02x}{:02x}",
                (color.red() * 255.0).round() as u8,
                (color.green() * 255.0).round() as u8,
                (color.blue() * 255.0).round() as u8
            );
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            let range = s.selection();
            apply_style(&mut s.workbook, range, |style| {
                style.background_color = Some(hex.clone())
            });
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    {
        let state = state.clone();
        let drawing = drawing.clone();
        borders.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            let enabled = !s
                .workbook
                .active()
                .styles
                .get(&(s.row, s.col))
                .and_then(|style| style.borders.as_ref())
                .is_some_and(CellBorders::is_full);
            s.workbook.checkpoint();
            let range = s.selection();
            apply_style(&mut s.workbook, range, |style| {
                style.borders = enabled.then(|| CellBorders::all("#000000"));
            });
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    {
        let state = state.clone();
        let update = update_selection.clone();
        insert_rows.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            let range = s.selection();
            s.workbook
                .insert_rows(range.min_row, range.max_row - range.min_row + 1);
            s.row = range.min_row;
            s.anchor_row = s.row;
            s.dirty = true;
            drop(s);
            update();
        });
    }
    {
        let state = state.clone();
        let update = update_selection.clone();
        delete_rows.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            let range = s.selection();
            s.workbook
                .delete_rows(range.min_row, range.max_row - range.min_row + 1);
            s.row = range.min_row.min(MAX_ROWS - 1);
            s.anchor_row = s.row;
            s.dirty = true;
            drop(s);
            update();
        });
    }
    {
        let state = state.clone();
        let update = update_selection.clone();
        insert_cols.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            let range = s.selection();
            s.workbook
                .insert_cols(range.min_col, range.max_col - range.min_col + 1);
            s.col = range.min_col;
            s.anchor_col = s.col;
            s.dirty = true;
            drop(s);
            update();
        });
    }
    {
        let state = state.clone();
        let update = update_selection.clone();
        delete_cols.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            let range = s.selection();
            s.workbook
                .delete_cols(range.min_col, range.max_col - range.min_col + 1);
            s.col = range.min_col.min(MAX_COLS - 1);
            s.anchor_col = s.col;
            s.dirty = true;
            drop(s);
            update();
        });
    }
    {
        let state = state.clone();
        let drawing = drawing.clone();
        bold.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            let enabled = !s
                .workbook
                .active()
                .styles
                .get(&(s.row, s.col))
                .is_some_and(|style| style.bold);
            let range = s.selection();
            apply_style(&mut s.workbook, range, |style| style.bold = enabled);
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    {
        let state = state.clone();
        let drawing = drawing.clone();
        italic.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            let enabled = !s
                .workbook
                .active()
                .styles
                .get(&(s.row, s.col))
                .is_some_and(|style| style.italic);
            let range = s.selection();
            apply_style(&mut s.workbook, range, |style| style.italic = enabled);
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    {
        let state = state.clone();
        let drawing = drawing.clone();
        text_color.connect_rgba_notify(move |picker| {
            let color = picker.rgba();
            let hex = format!(
                "#{:02x}{:02x}{:02x}",
                (color.red() * 255.0).round() as u8,
                (color.green() * 255.0).round() as u8,
                (color.blue() * 255.0).round() as u8
            );
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            let range = s.selection();
            apply_style(&mut s.workbook, range, |style| {
                style.text_color = Some(hex.clone())
            });
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    for (button, alignment) in [
        (align_left, HorizontalAlign::Left),
        (align_center, HorizontalAlign::Center),
        (align_right, HorizontalAlign::Right),
    ] {
        let state = state.clone();
        let drawing = drawing.clone();
        button.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            let range = s.selection();
            apply_style(&mut s.workbook, range, |style| {
                style.h_align = Some(alignment)
            });
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    for (button, alignment) in [
        (align_top, VerticalAlign::Top),
        (align_middle, VerticalAlign::Middle),
        (align_bottom, VerticalAlign::Bottom),
    ] {
        let state = state.clone();
        let drawing = drawing.clone();
        button.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            let range = s.selection();
            apply_style(&mut s.workbook, range, |style| {
                style.v_align = Some(alignment)
            });
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    {
        let state = state.clone();
        let drawing = drawing.clone();
        undo.connect_clicked(move |_| {
            state.borrow_mut().workbook.undo();
            drawing.queue_draw();
        });
    }
    {
        let state = state.clone();
        let drawing = drawing.clone();
        redo.connect_clicked(move |_| {
            state.borrow_mut().workbook.redo();
            drawing.queue_draw();
        });
    }
    {
        let state = state.clone();
        let refresh_tabs = refresh_tabs.clone();
        add_sheet.connect_clicked(move |_| {
            let mut s = state.borrow_mut();
            s.workbook.add_sheet();
            s.dirty = true;
            drop(s);
            refresh_tabs();
        });
    }
    {
        let state = state.clone();
        let drawing = drawing.clone();
        let refresh_tabs = refresh_tabs.clone();
        let title = title.clone();
        let window = window.clone();
        new_btn.connect_clicked(move |_| {
            let state = state.clone();
            let drawing = drawing.clone();
            let refresh_tabs = refresh_tabs.clone();
            let title = title.clone();
            let window = window.clone();
            glib::spawn_future_local(async move {
                if confirm_discard(&window, &state).await {
                    *state.borrow_mut() = State::default();
                    title.set_text("Calco");
                    refresh_tabs();
                    drawing.queue_draw();
                }
            });
        });
    }
    connect_files(
        &window,
        [&open_btn, &save_btn, &save_as_btn],
        state.clone(),
        drawing.clone(),
        refresh_tabs.clone(),
        title.clone(),
    );
    {
        let window = window.clone();
        about_btn.connect_clicked(move |_| {
            let dialog = gtk::AboutDialog::builder()
                .transient_for(&window)
                .modal(true)
                .program_name("Calco")
                .version(env!("CARGO_PKG_VERSION"))
                .comments("Editor de planilhas nativo em Rust e GTK4")
                .license_type(gtk::License::Gpl30)
                .website("https://github.com/britors/Calco")
                .build();
            dialog.present();
        });
    }
    {
        let state = state.clone();
        window.connect_close_request(move |window| {
            if !state.borrow().dirty {
                return glib::Propagation::Proceed;
            }
            let window = window.clone();
            let state = state.clone();
            glib::spawn_future_local(async move {
                if confirm_discard(&window, &state).await {
                    state.borrow_mut().dirty = false;
                    window.close();
                }
            });
            glib::Propagation::Stop
        });
    }
    connect_csv_files(
        &window,
        &import_csv_btn,
        &export_csv_btn,
        state.clone(),
        drawing.clone(),
        refresh_tabs.clone(),
        title.clone(),
    );
    connect_xlsx_files(
        &window,
        &import_xlsx_btn,
        &export_xlsx_btn,
        state.clone(),
        drawing.clone(),
        refresh_tabs.clone(),
        title.clone(),
    );

    if let Some(path) = initial_path {
        match format::open(&path) {
            Ok(document) => {
                let mut s = state.borrow_mut();
                s.workbook = Workbook::from_serialized(document);
                s.path = Some(path.clone());
                s.dirty = false;
                let _ = recent::add(&path);
                drop(s);
                title.set_text(&format!(
                    "Calco — {}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                ));
                refresh_tabs();
                drawing.queue_draw();
            }
            Err(error) => show_error(&window, &error.to_string()),
        }
    }

    {
        let state = state.clone();
        glib::timeout_add_seconds_local(30, move || {
            let s = state.borrow();
            if s.dirty {
                let _ = recent::autosave(&s.workbook.serialize());
            }
            glib::ControlFlow::Continue
        });
    }

    window.present();
    drawing.grab_focus();
    if offer_recovery {
        let window = window.clone();
        let state = state.clone();
        let drawing = drawing.clone();
        let refresh_tabs = refresh_tabs.clone();
        glib::spawn_future_local(async move {
            let dialog = gtk::AlertDialog::builder()
                .modal(true)
                .message("Recuperar documento automático?")
                .detail("O Calco encontrou alterações salvas automaticamente.")
                .buttons(["Descartar", "Recuperar"])
                .cancel_button(0)
                .default_button(1)
                .build();
            if dialog.choose_future(Some(&window)).await == Ok(1) {
                if let Ok(document) = format::open(&recent::autosave_path()) {
                    let mut s = state.borrow_mut();
                    s.workbook = Workbook::from_serialized(document);
                    s.path = None;
                    s.dirty = true;
                    drop(s);
                    refresh_tabs();
                    drawing.queue_draw();
                }
            } else {
                recent::clear_autosave();
            }
        });
    }
}

fn header_button(icon: &str, tooltip: &str) -> Button {
    let button = Button::from_icon_name(icon);
    button.set_tooltip_text(Some(tooltip));
    button
}

fn bind_button_action(app: &Application, name: &str, button: &Button) {
    let action = gtk::gio::SimpleAction::new(name, None);
    let button = button.clone();
    action.connect_activate(move |_, _| button.emit_clicked());
    app.add_action(&action);
}

fn install_css() {
    let css = gtk::CssProvider::new();
    css.load_from_string(".title { font-weight: 700; } button.suggested-action { background: #78b83b; color: #102006; } entry { border-radius: 4px; } entry.cell-editor { background: #ffffff; color: #1a1f1a; caret-color: #1a1f1a; } .find-panel { background: @popover_bg_color; color: @popover_fg_color; border: 1px solid @borders; border-radius: 6px; padding: 8px; box-shadow: 0 4px 12px alpha(#000000, 0.25); } .sheet-tab { padding: 2px; border-bottom: 2px solid transparent; } .sheet-tab.active { background: alpha(@theme_selected_bg_color, 0.18); border-bottom-color: #78b83b; }");
    gtk::style_context_add_provider_for_display(
        &gdk::Display::default().expect("display"),
        &css,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
}

fn connect_draw(area: &DrawingArea, state: Rc<RefCell<State>>, hadj: Adjustment, vadj: Adjustment) {
    area.set_draw_func(move |area, cr, width, height| {
        let s = state.borrow();
        let sheet = s.workbook.active();
        let calculation = s.workbook.calculation();
        let sx = hadj.value();
        let sy = vadj.value();
        let dark = prefers_dark_theme();
        let foreground = area.color();
        let window_bg = if dark {
            (0.12, 0.13, 0.12)
        } else {
            (0.96, 0.97, 0.96)
        };
        let window_fg = (
            foreground.red() as f64,
            foreground.green() as f64,
            foreground.blue() as f64,
        );
        let view_bg = (1.0, 1.0, 1.0);
        let view_fg = (0.10, 0.12, 0.10);
        let grid_color = (0.86, 0.88, 0.86);
        cr.set_source_rgb(window_bg.0, window_bg.1, window_bg.2);
        let _ = cr.paint();
        cr.set_source_rgb(grid_color.0, grid_color.1, grid_color.2);
        cr.set_line_width(1.0);
        let first_col = sheet.col_at(sx);
        let last_col = sheet.col_at(sx + width as f64);
        let first_row = sheet.row_at(sy);
        let last_row = sheet.row_at(sy + height as f64);
        cr.rectangle(
            ROW_HEADER,
            COL_HEADER,
            width as f64 - ROW_HEADER,
            height as f64 - COL_HEADER,
        );
        cr.set_source_rgb(view_bg.0, view_bg.1, view_bg.2);
        let _ = cr.fill();
        cr.set_source_rgb(grid_color.0, grid_color.1, grid_color.2);
        for col in first_col..=last_col + 1 {
            let x = ROW_HEADER + sheet.col_position(col) - sx;
            cr.move_to(x, COL_HEADER);
            cr.line_to(x, height as f64);
        }
        for row in first_row..=last_row + 1 {
            let y = COL_HEADER + sheet.row_position(row) - sy;
            cr.move_to(ROW_HEADER, y);
            cr.line_to(width as f64, y);
        }
        let _ = cr.stroke();
        for merge in &sheet.merges {
            if merge.max_row < first_row
                || merge.min_row > last_row
                || merge.max_col < first_col
                || merge.min_col > last_col
            {
                continue;
            }
            let x = ROW_HEADER + sheet.col_position(merge.min_col) - sx;
            let y = COL_HEADER + sheet.row_position(merge.min_row) - sy;
            let width = sheet.col_position(merge.max_col + 1) - sheet.col_position(merge.min_col);
            let height = sheet.row_position(merge.max_row + 1) - sheet.row_position(merge.min_row);
            cr.set_source_rgb(view_bg.0, view_bg.1, view_bg.2);
            cr.rectangle(x + 0.5, y + 0.5, width - 1.0, height - 1.0);
            let _ = cr.fill_preserve();
            cr.set_source_rgb(grid_color.0, grid_color.1, grid_color.2);
            cr.set_line_width(1.0);
            let _ = cr.stroke();
        }
        for row in first_row..=last_row {
            for col in first_col..=last_col {
                let merge = sheet.merge_containing(row, col);
                if merge.is_some_and(|merge| row != merge.min_row || col != merge.min_col) {
                    continue;
                }
                let cell_width = merge
                    .map(|merge| {
                        sheet.col_position(merge.max_col + 1) - sheet.col_position(merge.min_col)
                    })
                    .unwrap_or_else(|| sheet.col_width(col));
                let cell_height = merge
                    .map(|merge| {
                        sheet.row_position(merge.max_row + 1) - sheet.row_position(merge.min_row)
                    })
                    .unwrap_or_else(|| sheet.row_height(row));
                let text = calculation.display(row, col);
                let style = sheet
                    .styles
                    .get(&(row, col))
                    .cloned()
                    .unwrap_or_else(CellStyle::default);
                if let Some(bg) = style.background_color.as_deref().and_then(rgb) {
                    cr.set_source_rgb(bg.0, bg.1, bg.2);
                    cr.rectangle(
                        ROW_HEADER + sheet.col_position(col) - sx + 1.0,
                        COL_HEADER + sheet.row_position(row) - sy + 1.0,
                        cell_width - 2.0,
                        cell_height - 2.0,
                    );
                    let _ = cr.fill();
                }
                let cell_x = ROW_HEADER + sheet.col_position(col) - sx;
                let cell_y = COL_HEADER + sheet.row_position(row) - sy;
                if !text.is_empty() {
                    if let Some(color) = style.text_color.as_deref().and_then(rgb) {
                        cr.set_source_rgb(color.0, color.1, color.2);
                    } else {
                        cr.set_source_rgb(view_fg.0, view_fg.1, view_fg.2);
                    }
                    cr.select_font_face(
                        "Sans",
                        if style.italic {
                            gtk::cairo::FontSlant::Italic
                        } else {
                            gtk::cairo::FontSlant::Normal
                        },
                        if style.bold {
                            gtk::cairo::FontWeight::Bold
                        } else {
                            gtk::cairo::FontWeight::Normal
                        },
                    );
                    cr.set_font_size(13.0);
                    if let Ok(extents) = cr.text_extents(&text) {
                        let text_x = match style.h_align.unwrap_or(HorizontalAlign::Left) {
                            HorizontalAlign::Left => cell_x + 6.0 - extents.x_bearing(),
                            HorizontalAlign::Center => {
                                cell_x + (cell_width - extents.width()) / 2.0 - extents.x_bearing()
                            }
                            HorizontalAlign::Right => {
                                cell_x + cell_width - 6.0 - extents.width() - extents.x_bearing()
                            }
                        };
                        let text_y = match style.v_align.unwrap_or(VerticalAlign::Middle) {
                            VerticalAlign::Top => cell_y + 4.0 - extents.y_bearing(),
                            VerticalAlign::Middle => {
                                cell_y + (cell_height - extents.height()) / 2.0
                                    - extents.y_bearing()
                            }
                            VerticalAlign::Bottom => {
                                cell_y + cell_height - 4.0 - extents.height() - extents.y_bearing()
                            }
                        };
                        cr.move_to(text_x, text_y);
                        let _ = cr.show_text(&text);
                    }
                }
                if let Some(borders) = &style.borders {
                    draw_borders(cr, borders, cell_x, cell_y, cell_width, cell_height);
                }
            }
        }
        let selection = s.selection();
        let x = ROW_HEADER + sheet.col_position(selection.min_col) - sx;
        let y = COL_HEADER + sheet.row_position(selection.min_row) - sy;
        let selection_width =
            sheet.col_position(selection.max_col + 1) - sheet.col_position(selection.min_col);
        let selection_height =
            sheet.row_position(selection.max_row + 1) - sheet.row_position(selection.min_row);
        cr.set_source_rgba(0.35, 0.65, 0.12, 0.10);
        cr.rectangle(
            x + 1.0,
            y + 1.0,
            selection_width - 2.0,
            selection_height - 2.0,
        );
        let _ = cr.fill();
        cr.set_source_rgb(0.35, 0.65, 0.12);
        cr.set_line_width(2.0);
        cr.rectangle(
            x + 1.0,
            y + 1.0,
            selection_width - 2.0,
            selection_height - 2.0,
        );
        let _ = cr.stroke();
        cr.set_source_rgb(window_fg.0, window_fg.1, window_fg.2);
        cr.set_font_size(12.0);
        for col in first_col..=last_col {
            cr.move_to(ROW_HEADER + sheet.col_position(col) - sx + 8.0, 19.0);
            let _ = cr.show_text(&column_label(col));
        }
        for row in first_row..=last_row {
            cr.move_to(8.0, COL_HEADER + sheet.row_position(row) - sy + 18.0);
            let _ = cr.show_text(&(row + 1).to_string());
        }
    });
}

fn prefers_dark_theme() -> bool {
    gtk::Settings::default().is_some_and(|settings| {
        settings.is_gtk_application_prefer_dark_theme()
            || settings
                .gtk_theme_name()
                .is_some_and(|name| name.to_ascii_lowercase().contains("dark"))
    })
}

fn connect_system_theme(drawing: &DrawingArea) {
    let Some(schema) = gio::SettingsSchemaSource::default()
        .and_then(|source| source.lookup("org.gnome.desktop.interface", true))
    else {
        return;
    };
    let system = gio::Settings::new_full(&schema, None::<&gio::SettingsBackend>, None);
    apply_system_theme(&system, drawing);
    let drawing = drawing.clone();
    system.connect_changed(Some("color-scheme"), move |settings, _| {
        apply_system_theme(settings, &drawing);
    });
}

fn apply_system_theme(system: &gio::Settings, drawing: &DrawingArea) {
    let dark = system.string("color-scheme").as_str() == "prefer-dark";
    if let Some(settings) = gtk::Settings::default() {
        settings.set_gtk_application_prefer_dark_theme(dark);
    }
    drawing.queue_draw();
}

fn set_rich_clipboard(text: &str, html: &str) {
    let plain = gdk::ContentProvider::for_bytes(
        "text/plain;charset=utf-8",
        &glib::Bytes::from_owned(text.as_bytes().to_vec()),
    );
    let rich = gdk::ContentProvider::for_bytes(
        "text/html",
        &glib::Bytes::from_owned(html.as_bytes().to_vec()),
    );
    let provider = gdk::ContentProvider::new_union(&[plain, rich]);
    let _ = gdk::Display::default()
        .expect("display")
        .clipboard()
        .set_content(Some(&provider));
}

fn draw_borders(
    cr: &gtk::cairo::Context,
    borders: &CellBorders,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) {
    cr.set_line_width(1.5);
    let stroke = |border: &calco::model::BorderStyle, x1, y1, x2, y2| {
        if let Some(color) = rgb(&border.color) {
            cr.set_source_rgb(color.0, color.1, color.2);
            cr.move_to(x1, y1);
            cr.line_to(x2, y2);
            let _ = cr.stroke();
        }
    };
    if let Some(border) = &borders.top {
        stroke(border, x, y, x + width, y);
    }
    if let Some(border) = &borders.right {
        stroke(border, x + width, y, x + width, y + height);
    }
    if let Some(border) = &borders.bottom {
        stroke(border, x, y + height, x + width, y + height);
    }
    if let Some(border) = &borders.left {
        stroke(border, x, y, x, y + height);
    }
}

fn connect_grid_input(
    area: &DrawingArea,
    editor: &Entry,
    state: Rc<RefCell<State>>,
    update: Rc<dyn Fn()>,
    hadj: Adjustment,
    vadj: Adjustment,
) {
    let click = GestureClick::new();
    {
        let state = state.clone();
        let update = update.clone();
        let editor = editor.clone();
        let hadj = hadj.clone();
        let vadj = vadj.clone();
        click.connect_pressed(move |gesture, n, x, y| {
            let mut s = state.borrow_mut();
            s.select_all_stage = false;
            let row = s
                .workbook
                .active()
                .row_at((y - COL_HEADER).max(0.0) + vadj.value());
            let col = s
                .workbook
                .active()
                .col_at((x - ROW_HEADER).max(0.0) + hadj.value());
            if x < ROW_HEADER && y < COL_HEADER {
                s.row = 0;
                s.col = 0;
                s.anchor_row = MAX_ROWS - 1;
                s.anchor_col = MAX_COLS - 1;
            } else if x < ROW_HEADER {
                s.row = row.min(MAX_ROWS - 1);
                s.col = 0;
                s.anchor_row = s.row;
                s.anchor_col = MAX_COLS - 1;
            } else if y < COL_HEADER {
                s.row = 0;
                s.col = col.min(MAX_COLS - 1);
                s.anchor_row = MAX_ROWS - 1;
                s.anchor_col = s.col;
            } else {
                s.col = col.min(MAX_COLS - 1);
                s.row = row.min(MAX_ROWS - 1);
                if !gesture
                    .current_event_state()
                    .contains(gdk::ModifierType::SHIFT_MASK)
                {
                    s.anchor_col = s.col;
                    s.anchor_row = s.row;
                    if let Some(merge) = s.workbook.active().merge_containing(s.row, s.col).cloned()
                    {
                        s.row = merge.min_row;
                        s.col = merge.min_col;
                        s.anchor_row = merge.max_row;
                        s.anchor_col = merge.max_col;
                    }
                }
            }
            drop(s);
            update();
            if n == 2 && x >= ROW_HEADER && y >= COL_HEADER {
                open_editor(&editor, &state, &hadj, &vadj);
            }
            gesture.set_state(gtk::EventSequenceState::Claimed);
        });
    }
    area.add_controller(click);
    let drag = GestureDrag::new();
    let drag_origin = Rc::new(Cell::new((0.0, 0.0)));
    {
        let origin = drag_origin.clone();
        drag.connect_drag_begin(move |_, x, y| origin.set((x, y)));
    }
    {
        let state = state.clone();
        let update = update.clone();
        let origin = drag_origin.clone();
        let hadj = hadj.clone();
        let vadj = vadj.clone();
        drag.connect_drag_update(move |_, offset_x, offset_y| {
            let (start_x, start_y) = origin.get();
            if start_x < ROW_HEADER || start_y < COL_HEADER {
                return;
            }
            let mut s = state.borrow_mut();
            s.row = s
                .workbook
                .active()
                .row_at((start_y + offset_y - COL_HEADER).max(0.0) + vadj.value());
            s.col = s
                .workbook
                .active()
                .col_at((start_x + offset_x - ROW_HEADER).max(0.0) + hadj.value());
            s.select_all_stage = false;
            drop(s);
            update();
        });
    }
    area.add_controller(drag);
    let resize = GestureDrag::new();
    let resize_state = Rc::new(Cell::new(None::<ResizeState>));
    {
        let state = state.clone();
        let resize_state = resize_state.clone();
        let hadj = hadj.clone();
        let vadj = vadj.clone();
        resize.connect_drag_begin(move |gesture, x, y| {
            let mut s = state.borrow_mut();
            let sheet = s.workbook.active();
            let candidate = if y < COL_HEADER && x >= ROW_HEADER {
                let col = sheet.col_at(x - ROW_HEADER + hadj.value());
                let boundary = ROW_HEADER + sheet.col_position(col + 1) - hadj.value();
                ((x - boundary).abs() <= 6.0).then_some(ResizeState {
                    axis: ResizeAxis::Col,
                    index: col,
                    original: sheet.col_width(col),
                })
            } else if x < ROW_HEADER && y >= COL_HEADER {
                let row = sheet.row_at(y - COL_HEADER + vadj.value());
                let boundary = COL_HEADER + sheet.row_position(row + 1) - vadj.value();
                ((y - boundary).abs() <= 6.0).then_some(ResizeState {
                    axis: ResizeAxis::Row,
                    index: row,
                    original: sheet.row_height(row),
                })
            } else {
                None
            };
            if candidate.is_some() {
                s.workbook.checkpoint();
                resize_state.set(candidate);
                gesture.set_state(gtk::EventSequenceState::Claimed);
            }
        });
    }
    {
        let state = state.clone();
        let resize_state = resize_state.clone();
        let drawing = area.clone();
        resize.connect_drag_update(move |_, offset_x, offset_y| {
            let Some(resize) = resize_state.get() else {
                return;
            };
            let mut s = state.borrow_mut();
            match resize.axis {
                ResizeAxis::Row => {
                    s.workbook
                        .active_mut()
                        .row_heights
                        .insert(resize.index, (resize.original + offset_y).max(8.0));
                }
                ResizeAxis::Col => {
                    s.workbook
                        .active_mut()
                        .col_widths
                        .insert(resize.index, (resize.original + offset_x).max(16.0));
                }
            }
            s.dirty = true;
            drawing.queue_draw();
        });
    }
    {
        let resize_state = resize_state.clone();
        resize.connect_drag_end(move |_, _, _| resize_state.set(None));
    }
    area.add_controller(resize);
    let keys = EventControllerKey::new();
    {
        let state = state.clone();
        let update = update.clone();
        let editor = editor.clone();
        let hadj = hadj.clone();
        let vadj = vadj.clone();
        keys.connect_key_pressed(move |_, key, _, mods| {
            let mut s = state.borrow_mut();
            if mods.contains(gdk::ModifierType::CONTROL_MASK) {
                if key == gdk::Key::a {
                    if s.select_all_stage {
                        s.row = 0;
                        s.col = 0;
                        s.anchor_row = MAX_ROWS - 1;
                        s.anchor_col = MAX_COLS - 1;
                    } else {
                        let (min_row, min_col, max_row, max_col) =
                            s.workbook.active().used_region();
                        s.row = min_row;
                        s.col = min_col;
                        s.anchor_row = max_row;
                        s.anchor_col = max_col;
                        s.select_all_stage = true;
                    }
                    drop(s);
                    update();
                    return glib::Propagation::Stop;
                }
                if key == gdk::Key::z {
                    s.workbook.undo();
                    drop(s);
                    update();
                    return glib::Propagation::Stop;
                }
                if key == gdk::Key::y {
                    s.workbook.redo();
                    drop(s);
                    update();
                    return glib::Propagation::Stop;
                }
                if key == gdk::Key::c || key == gdk::Key::x {
                    let text = build_tsv(s.workbook.active(), s.selection());
                    let html = build_html(s.workbook.active(), s.selection());
                    set_rich_clipboard(&text, &html);
                    s.internal_clipboard = Some(snapshot_clipboard(&s, text));
                    if key == gdk::Key::x {
                        s.workbook.checkpoint();
                        let range = s.selection();
                        clear_range(s.workbook.active_mut(), range);
                        s.dirty = true;
                        drop(s);
                        update();
                    }
                    return glib::Propagation::Stop;
                }
                if key == gdk::Key::v {
                    let clipboard = gdk::Display::default().expect("display").clipboard();
                    let state = state.clone();
                    let update = update.clone();
                    let values_only = mods.contains(gdk::ModifierType::SHIFT_MASK);
                    glib::spawn_future_local(async move {
                        if let Ok(Some(text)) = clipboard.read_text_future().await {
                            let mut s = state.borrow_mut();
                            s.workbook.checkpoint();
                            let (row, col) = (s.row, s.col);
                            let internal = s
                                .internal_clipboard
                                .clone()
                                .filter(|internal| internal.text == text);
                            if let Some(internal) = internal {
                                let row_delta = row as i64 - internal.source.min_row as i64;
                                let col_delta = col as i64 - internal.source.min_col as i64;
                                let sheet = s.workbook.active_mut();
                                for cell in internal.cells {
                                    let target_row = row + cell.row_offset;
                                    let target_col = col + cell.col_offset;
                                    if target_row >= MAX_ROWS || target_col >= MAX_COLS {
                                        continue;
                                    }
                                    if values_only {
                                        sheet.set_raw(target_row, target_col, &cell.value);
                                    } else {
                                        match cell.content {
                                            Some(CellContent::Text(formula))
                                                if formula.starts_with('=') =>
                                            {
                                                sheet.set_raw(
                                                    target_row,
                                                    target_col,
                                                    &translate_references(
                                                        &formula, row_delta, col_delta,
                                                    ),
                                                );
                                            }
                                            Some(content) => {
                                                sheet
                                                    .cells
                                                    .insert((target_row, target_col), content);
                                            }
                                            None => {
                                                sheet.cells.remove(&(target_row, target_col));
                                            }
                                        }
                                        match cell.style {
                                            Some(style) => {
                                                sheet
                                                    .styles
                                                    .insert((target_row, target_col), style);
                                            }
                                            None => {
                                                sheet.styles.remove(&(target_row, target_col));
                                            }
                                        }
                                    }
                                }
                            } else {
                                paste_tsv(s.workbook.active_mut(), row, col, &text);
                            }
                            s.dirty = true;
                            drop(s);
                            update();
                        }
                    });
                    return glib::Propagation::Stop;
                }
            }
            s.select_all_stage = false;
            let extend = mods.contains(gdk::ModifierType::SHIFT_MASK);
            match key {
                gdk::Key::Left => s.col = s.col.saturating_sub(1),
                gdk::Key::Right => s.col = (s.col + 1).min(MAX_COLS - 1),
                gdk::Key::Up => s.row = s.row.saturating_sub(1),
                gdk::Key::Down | gdk::Key::Return => s.row = (s.row + 1).min(MAX_ROWS - 1),
                gdk::Key::F2 => {
                    drop(s);
                    open_editor(&editor, &state, &hadj, &vadj);
                    return glib::Propagation::Stop;
                }
                gdk::Key::Delete => {
                    s.workbook.checkpoint();
                    let range = s.selection();
                    clear_range(s.workbook.active_mut(), range);
                    s.dirty = true
                }
                _ => {
                    let printable = (!mods.intersects(
                        gdk::ModifierType::CONTROL_MASK
                            | gdk::ModifierType::ALT_MASK
                            | gdk::ModifierType::SUPER_MASK,
                    ))
                    .then(|| key.to_unicode())
                    .flatten()
                    .filter(|ch| !ch.is_control());
                    drop(s);
                    if let Some(ch) = printable {
                        open_editor(&editor, &state, &hadj, &vadj);
                        editor.set_text(&ch.to_string());
                        editor.set_position(-1);
                        return glib::Propagation::Stop;
                    }
                    return glib::Propagation::Proceed;
                }
            };
            if !extend {
                s.anchor_row = s.row;
                s.anchor_col = s.col;
            }
            drop(s);
            update();
            glib::Propagation::Stop
        });
    }
    area.add_controller(keys);
    {
        let state = state.clone();
        let update = update.clone();
        let area = area.clone();
        editor.connect_activate(move |entry| {
            let mut s = state.borrow_mut();
            s.workbook.checkpoint();
            let (r, c) = (s.row, s.col);
            s.workbook.active_mut().set_raw(r, c, &entry.text());
            s.dirty = true;
            entry.set_visible(false);
            area.grab_focus();
            drop(s);
            update();
        });
    }
    let editor_keys = EventControllerKey::new();
    {
        let state = state.clone();
        let update = update.clone();
        let area = area.clone();
        editor_keys.connect_key_pressed(move |controller, key, _, mods| {
            let entry = controller
                .widget()
                .and_downcast::<Entry>()
                .expect("editor key controller");
            if key == gdk::Key::Escape {
                entry.set_visible(false);
                area.grab_focus();
                update();
                return glib::Propagation::Stop;
            }
            if key == gdk::Key::Tab || key == gdk::Key::ISO_Left_Tab {
                let mut s = state.borrow_mut();
                s.workbook.checkpoint();
                let (row, col) = (s.row, s.col);
                s.workbook.active_mut().set_raw(row, col, &entry.text());
                s.dirty = true;
                let backwards =
                    key == gdk::Key::ISO_Left_Tab || mods.contains(gdk::ModifierType::SHIFT_MASK);
                s.col = if backwards {
                    s.col.saturating_sub(1)
                } else {
                    (s.col + 1).min(MAX_COLS - 1)
                };
                s.anchor_col = s.col;
                entry.set_visible(false);
                area.grab_focus();
                drop(s);
                update();
                return glib::Propagation::Stop;
            }
            glib::Propagation::Proceed
        });
    }
    editor.add_controller(editor_keys);
}

fn open_editor(editor: &Entry, state: &Rc<RefCell<State>>, hadj: &Adjustment, vadj: &Adjustment) {
    let s = state.borrow();
    let sheet = s.workbook.active();
    editor.set_text(&sheet.raw(s.row, s.col));
    let merge = sheet.merge_containing(s.row, s.col);
    editor.set_width_request(
        merge
            .map(|merge| sheet.col_position(merge.max_col + 1) - sheet.col_position(merge.min_col))
            .unwrap_or_else(|| sheet.col_width(s.col)) as i32,
    );
    editor.set_height_request(
        merge
            .map(|merge| sheet.row_position(merge.max_row + 1) - sheet.row_position(merge.min_row))
            .unwrap_or_else(|| sheet.row_height(s.row)) as i32,
    );
    editor.set_margin_start((ROW_HEADER + sheet.col_position(s.col) - hadj.value()) as i32);
    editor.set_margin_top((COL_HEADER + sheet.row_position(s.row) - vadj.value()) as i32);
    editor.set_visible(true);
    editor.grab_focus();
    editor.select_region(0, -1);
}

fn position_editor(
    editor: &Entry,
    state: &Rc<RefCell<State>>,
    hadj: &Adjustment,
    vadj: &Adjustment,
) {
    if !gtk::prelude::WidgetExt::is_visible(editor) {
        return;
    }
    let s = state.borrow();
    let sheet = s.workbook.active();
    editor.set_margin_start((ROW_HEADER + sheet.col_position(s.col) - hadj.value()) as i32);
    editor.set_margin_top((COL_HEADER + sheet.row_position(s.row) - vadj.value()) as i32);
}

fn filtered_dialog(title: &str, filter_name: &str, pattern: &str) -> FileDialog {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some(filter_name));
    filter.add_pattern(pattern);
    let filters = gtk::gio::ListStore::new::<gtk::FileFilter>();
    filters.append(&filter);
    FileDialog::builder()
        .title(title)
        .filters(&filters)
        .default_filter(&filter)
        .build()
}

async fn confirm_discard(window: &ApplicationWindow, state: &Rc<RefCell<State>>) -> bool {
    if !state.borrow().dirty {
        return true;
    }
    let dialog = gtk::AlertDialog::builder()
        .modal(true)
        .message("Há alterações não salvas")
        .detail("Descartar as alterações feitas neste documento?")
        .buttons(["Cancelar", "Descartar"])
        .cancel_button(0)
        .default_button(0)
        .build();
    dialog.choose_future(Some(window)).await == Ok(1)
}

fn connect_files(
    window: &ApplicationWindow,
    buttons: [&Button; 3],
    state: Rc<RefCell<State>>,
    drawing: DrawingArea,
    refresh_tabs: Rc<dyn Fn()>,
    title: Label,
) {
    let [open_btn, save_btn, save_as_btn] = buttons;
    {
        let window = window.clone();
        let state = state.clone();
        let drawing = drawing.clone();
        let refresh_tabs = refresh_tabs.clone();
        let title = title.clone();
        open_btn.connect_clicked(move |_| {
            let dialog = filtered_dialog("Abrir planilha", "Calco", "*.calco");
            let window = window.clone();
            let state = state.clone();
            let drawing = drawing.clone();
            let refresh_tabs = refresh_tabs.clone();
            let title = title.clone();
            glib::spawn_future_local(async move {
                if !confirm_discard(&window, &state).await {
                    return;
                }
                if let Ok(file) = dialog.open_future(Some(&window)).await
                    && let Some(path) = file.path()
                {
                    match format::open(&path) {
                        Ok(doc) => {
                            state.borrow_mut().workbook = Workbook::from_serialized(doc);
                            state.borrow_mut().path = Some(path.clone());
                            state.borrow_mut().dirty = false;
                            let _ = recent::add(&path);
                            recent::clear_autosave();
                            title.set_text(&format!(
                                "Calco — {}",
                                path.file_name().unwrap_or_default().to_string_lossy()
                            ));
                            refresh_tabs();
                            drawing.queue_draw()
                        }
                        Err(e) => show_error(&window, &e.to_string()),
                    }
                }
            });
        });
    }
    {
        let window = window.clone();
        let state = state.clone();
        let title = title.clone();
        save_btn.connect_clicked(move |_| {
            if let Some(path) = state.borrow().path.clone() {
                save_to(&window, &state, &title, path);
                return;
            }
            let dialog = filtered_dialog("Salvar planilha", "Calco", "*.calco");
            dialog.set_initial_name(Some("planilha.calco"));
            let window = window.clone();
            let state = state.clone();
            let title = title.clone();
            glib::spawn_future_local(async move {
                if let Ok(file) = dialog.save_future(Some(&window)).await
                    && let Some(path) = file.path()
                {
                    save_to(&window, &state, &title, path)
                }
            });
        });
    }
    {
        let window = window.clone();
        let state = state.clone();
        let title = title.clone();
        save_as_btn.connect_clicked(move |_| {
            let dialog = filtered_dialog("Salvar planilha como", "Calco", "*.calco");
            dialog.set_initial_name(Some("planilha.calco"));
            let window = window.clone();
            let state = state.clone();
            let title = title.clone();
            glib::spawn_future_local(async move {
                if let Ok(file) = dialog.save_future(Some(&window)).await
                    && let Some(path) = file.path()
                {
                    save_to(&window, &state, &title, path)
                }
            });
        });
    }
}

fn connect_csv_files(
    window: &ApplicationWindow,
    import_btn: &Button,
    export_btn: &Button,
    state: Rc<RefCell<State>>,
    drawing: DrawingArea,
    refresh_tabs: Rc<dyn Fn()>,
    title: Label,
) {
    {
        let window = window.clone();
        let state = state.clone();
        let drawing = drawing.clone();
        let refresh_tabs = refresh_tabs.clone();
        let title = title.clone();
        import_btn.connect_clicked(move |_| {
            let dialog = filtered_dialog("Importar CSV", "CSV", "*.csv");
            let window = window.clone();
            let state = state.clone();
            let drawing = drawing.clone();
            let refresh_tabs = refresh_tabs.clone();
            let title = title.clone();
            glib::spawn_future_local(async move {
                if !confirm_discard(&window, &state).await {
                    return;
                }
                if let Ok(file) = dialog.open_future(Some(&window)).await
                    && let Some(path) = file.path()
                {
                    match fs::read(&path) {
                        Ok(bytes) => {
                            let Some((encoding, chosen_delimiter)) =
                                choose_csv_options(&window).await
                            else {
                                return;
                            };
                            let text = decode(&bytes, encoding);
                            let delimiter =
                                chosen_delimiter.unwrap_or_else(|| detect_delimiter(&text));
                            let name = path
                                .file_stem()
                                .and_then(|value| value.to_str())
                                .unwrap_or("Dados");
                            let sheet = import_sheet(&text, delimiter, name);
                            let mut s = state.borrow_mut();
                            s.workbook = Workbook::from_sheet(sheet);
                            s.path = None;
                            s.row = 0;
                            s.col = 0;
                            s.anchor_row = 0;
                            s.anchor_col = 0;
                            s.dirty = true;
                            drop(s);
                            title.set_text("Calco — CSV importado");
                            refresh_tabs();
                            drawing.queue_draw();
                        }
                        Err(error) => show_error(&window, &error.to_string()),
                    }
                }
            });
        });
    }
    {
        let window = window.clone();
        let state = state.clone();
        export_btn.connect_clicked(move |_| {
            let dialog = filtered_dialog("Exportar CSV", "CSV", "*.csv");
            dialog.set_initial_name(Some("planilha.csv"));
            let window = window.clone();
            let state = state.clone();
            glib::spawn_future_local(async move {
                if let Ok(file) = dialog.save_future(Some(&window)).await
                    && let Some(path) = file.path()
                {
                    let csv = export_sheet(state.borrow().workbook.active(), ';');
                    if let Err(error) = fs::write(path, csv) {
                        show_error(&window, &error.to_string());
                    }
                }
            });
        });
    }
}

fn connect_xlsx_files(
    window: &ApplicationWindow,
    import_btn: &Button,
    export_btn: &Button,
    state: Rc<RefCell<State>>,
    drawing: DrawingArea,
    refresh_tabs: RefreshCallback,
    title: Label,
) {
    {
        let window = window.clone();
        let state = state.clone();
        let drawing = drawing.clone();
        let refresh_tabs = refresh_tabs.clone();
        let title = title.clone();
        import_btn.connect_clicked(move |_| {
            let dialog = filtered_dialog("Importar Excel", "Excel", "*.xlsx");
            let window = window.clone();
            let state = state.clone();
            let drawing = drawing.clone();
            let refresh_tabs = refresh_tabs.clone();
            let title = title.clone();
            glib::spawn_future_local(async move {
                if !confirm_discard(&window, &state).await {
                    return;
                }
                if let Ok(file) = dialog.open_future(Some(&window)).await
                    && let Some(path) = file.path()
                {
                    match xlsx::import(&path) {
                        Ok(workbook) => {
                            let mut s = state.borrow_mut();
                            s.workbook = workbook;
                            s.path = None;
                            s.row = 0;
                            s.col = 0;
                            s.anchor_row = 0;
                            s.anchor_col = 0;
                            s.dirty = true;
                            drop(s);
                            title.set_text("Calco — XLSX importado");
                            refresh_tabs();
                            drawing.queue_draw();
                        }
                        Err(error) => show_error(&window, &error.to_string()),
                    }
                }
            });
        });
    }
    {
        let window = window.clone();
        let state = state.clone();
        export_btn.connect_clicked(move |_| {
            let dialog = filtered_dialog("Exportar Excel", "Excel", "*.xlsx");
            dialog.set_initial_name(Some("planilha.xlsx"));
            let window = window.clone();
            let state = state.clone();
            glib::spawn_future_local(async move {
                if let Ok(file) = dialog.save_future(Some(&window)).await
                    && let Some(path) = file.path()
                    && let Err(error) = xlsx::export(&path, &state.borrow().workbook)
                {
                    show_error(&window, &error.to_string());
                }
            });
        });
    }
}

async fn choose_csv_options(window: &ApplicationWindow) -> Option<(CsvEncoding, Option<char>)> {
    let encoding_dialog = gtk::AlertDialog::builder()
        .modal(true)
        .message("Codificação do CSV")
        .detail("Escolha como o arquivo deve ser decodificado.")
        .buttons(["Cancelar", "UTF-8", "Windows-1252"])
        .cancel_button(0)
        .default_button(1)
        .build();
    let encoding = match encoding_dialog.choose_future(Some(window)).await.ok()? {
        1 => CsvEncoding::Utf8,
        2 => CsvEncoding::Windows1252,
        _ => return None,
    };
    let delimiter_dialog = gtk::AlertDialog::builder()
        .modal(true)
        .message("Delimitador do CSV")
        .detail("A detecção automática funciona para ponto e vírgula, vírgula e tabulação.")
        .buttons(["Cancelar", "Automático", ";", ",", "Tab"])
        .cancel_button(0)
        .default_button(1)
        .build();
    let delimiter = match delimiter_dialog.choose_future(Some(window)).await.ok()? {
        1 => None,
        2 => Some(';'),
        3 => Some(','),
        4 => Some('\t'),
        _ => return None,
    };
    Some((encoding, delimiter))
}
fn save_to(window: &ApplicationWindow, state: &Rc<RefCell<State>>, title: &Label, path: PathBuf) {
    match format::save(&path, &state.borrow().workbook.serialize()) {
        Ok(()) => {
            state.borrow_mut().path = Some(path.clone());
            state.borrow_mut().dirty = false;
            let _ = recent::add(&path);
            recent::clear_autosave();
            title.set_text(&format!(
                "Calco — {}",
                path.file_name().unwrap_or_default().to_string_lossy()
            ))
        }
        Err(e) => show_error(window, &e.to_string()),
    }
}
fn show_error(window: &ApplicationWindow, message: &str) {
    let dialog = gtk::AlertDialog::builder()
        .modal(true)
        .message("Não foi possível concluir a operação")
        .detail(message)
        .build();
    dialog.show(Some(window));
}
fn rgb(hex: &str) -> Option<(f64, f64, f64)> {
    let h = hex.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    Some((
        u8::from_str_radix(&h[0..2], 16).ok()? as f64 / 255.0,
        u8::from_str_radix(&h[2..4], 16).ok()? as f64 / 255.0,
        u8::from_str_radix(&h[4..6], 16).ok()? as f64 / 255.0,
    ))
}
