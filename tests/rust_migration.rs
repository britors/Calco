use calco::{
    clipboard::{CellRange, build_html, build_tsv, clear_range, parse_tsv, paste_tsv},
    csv::{CsvEncoding, decode, detect_delimiter, export_sheet, import_sheet, parse_delimited},
    find_replace::{find_matches, replace_all, replace_in_cell},
    format,
    formula::{
        CellLookup, ReferenceAxis, column_label, display_value, parse_a1, rewrite_references,
        translate_references,
    },
    model::{
        CellBorders, CellContent, CellStyle, HorizontalAlign, SerializedMerge, SerializedWorkbook,
        VerticalAlign,
    },
    workbook::Workbook,
    xlsx,
};
use std::{collections::HashMap, fs};

#[derive(Default)]
struct Cells(HashMap<(u32, u32), f64>);
impl CellLookup for Cells {
    fn number_at(&self, row: u32, col: u32) -> Option<f64> {
        self.0.get(&(row, col)).copied()
    }
}

#[test]
fn csv_import_and_export_support_pt_br_data_and_quotes() {
    assert_eq!(decode(b"caf\xe9", CsvEncoding::Windows1252), "café");
    assert_eq!(
        parse_delimited("nome;nota\r\n\"Ana; Maria\";1,5", ';'),
        vec![vec!["nome", "nota"], vec!["Ana; Maria", "1,5"]]
    );
    assert_eq!(detect_delimiter("a,b,c\n1,2,3"), ',');

    let mut sheet = import_sheet(
        "nome;nota;ativo\n\"Ana; Maria\";1,5;verdadeiro",
        ';',
        "Dados",
    );
    assert_eq!(sheet.display(1, 0), "Ana; Maria");
    assert_eq!(sheet.display(1, 1), "1,5");
    assert_eq!(sheet.display(1, 2), "VERDADEIRO");
    sheet.set_raw(2, 0, "=1+1");
    assert_eq!(
        export_sheet(&sheet, ';'),
        "nome;nota;ativo\n\"Ana; Maria\";1,5;VERDADEIRO\n2;;"
    );
}

#[test]
fn find_and_replace_uses_raw_content_and_is_case_insensitive() {
    let mut workbook = Workbook::default();
    let sheet = workbook.active_mut();
    sheet.set_raw(0, 0, "Olá mundo");
    sheet.set_raw(0, 1, "=SUM(A1,10)");
    sheet.set_raw(2, 0, "olá novamente");

    assert_eq!(find_matches(sheet, "OLÁ"), vec![(0, 0), (2, 0)]);
    assert_eq!(find_matches(sheet, "SUM"), vec![(0, 1)]);
    assert!(replace_in_cell(sheet, 0, 0, "olá", "Oi"));
    assert_eq!(sheet.raw(0, 0), "Oi mundo");
    assert_eq!(replace_all(sheet, "10", "20"), 1);
    assert_eq!(sheet.raw(0, 1), "=SUM(A1,20)");
    assert_eq!(sheet.display(0, 1), "20");
}

#[test]
fn clipboard_round_trips_rectangular_tsv_blocks() {
    let mut workbook = Workbook::default();
    let sheet = workbook.active_mut();
    sheet.set_raw(0, 0, "10");
    sheet.set_raw(0, 1, "=A1*2");
    sheet.set_raw(1, 0, "olá");
    let range = CellRange::between(1, 1, 0, 0);
    assert_eq!(build_tsv(sheet, range), "10\t=A1*2\nolá\t");

    paste_tsv(sheet, 3, 2, "1\ttexto\r\n\t2\r\n");
    assert_eq!(sheet.raw(3, 2), "1");
    assert_eq!(sheet.raw(3, 3), "texto");
    assert_eq!(sheet.raw(4, 2), "");
    assert_eq!(sheet.raw(4, 3), "2");
    assert_eq!(parse_tsv("42"), vec![vec!["42"]]);

    clear_range(sheet, CellRange::between(3, 2, 4, 3));
    assert_eq!(sheet.raw(3, 2), "");
    assert_eq!(sheet.raw(4, 3), "");

    sheet.set_raw(6, 0, "<b>&</b>");
    sheet.styles.insert(
        (6, 0),
        CellStyle {
            bold: true,
            text_color: Some("#123456".into()),
            ..Default::default()
        },
    );
    assert_eq!(
        build_html(sheet, CellRange::between(6, 0, 6, 0)),
        "<table><tr><td style=\"font-weight:bold;color:#123456\">&lt;b&gt;&amp;&lt;/b&gt;</td></tr></table>"
    );
}

#[test]
fn a1_addresses_round_trip() {
    assert_eq!(column_label(0), "A");
    assert_eq!(column_label(25), "Z");
    assert_eq!(column_label(26), "AA");
    assert_eq!(parse_a1("AA42"), Some((41, 26)));
    assert_eq!(parse_a1("A0"), None);
}

#[test]
fn formulas_accept_portuguese_separator_and_ranges() {
    let mut cells = Cells::default();
    cells.0.insert((0, 0), 10.0);
    cells.0.insert((1, 0), 5.0);
    assert_eq!(
        display_value(&CellContent::Text("=SOMA(A1:A2;5)".into()), &cells),
        "20"
    );
    assert_eq!(
        display_value(&CellContent::Text("=A1/0".into()), &cells),
        "#DIV/0!"
    );
}

#[test]
fn sparse_workbook_and_calco_round_trip() {
    let mut workbook = Workbook::default();
    workbook.active_mut().set_raw(99_999, 999, "=SUM(A1,2)");
    let expected = workbook.serialize();
    let path = std::env::temp_dir().join(format!("calco-test-{}.calco", std::process::id()));
    format::save(&path, &expected).unwrap();
    let actual = format::open(&path).unwrap();
    let _ = fs::remove_file(path);
    assert_eq!(actual, expected);
    assert_eq!(actual, SerializedWorkbook { ..expected });
}

#[test]
fn undo_restores_cell_content() {
    let mut workbook = Workbook::default();
    workbook.checkpoint();
    workbook.active_mut().set_raw(0, 0, "42");
    assert_eq!(workbook.active().display(0, 0), "42");
    workbook.undo();
    assert_eq!(workbook.active().display(0, 0), "");
    workbook.redo();
    assert_eq!(workbook.active().display(0, 0), "42");
}

#[test]
fn structural_edits_shift_auxiliary_data_and_are_undoable() {
    let mut workbook = Workbook::default();
    {
        let sheet = workbook.active_mut();
        sheet.set_raw(0, 0, "cabeçalho");
        sheet.set_raw(2, 1, "movido");
        sheet.styles.insert(
            (2, 1),
            CellStyle {
                bold: true,
                ..Default::default()
            },
        );
        sheet.row_heights.insert(2, 40.0);
        sheet.col_widths.insert(1, 150.0);
        sheet.merges.push(SerializedMerge {
            min_row: 1,
            min_col: 0,
            max_row: 3,
            max_col: 1,
        });
    }

    workbook.insert_rows(1, 2);
    assert_eq!(workbook.active().raw(4, 1), "movido");
    assert!(workbook.active().styles[&(4, 1)].bold);
    assert_eq!(workbook.active().row_heights[&4], 40.0);
    assert_eq!(workbook.active().merges[0].min_row, 3);
    assert_eq!(workbook.active().merges[0].max_row, 5);

    workbook.delete_cols(0, 1);
    assert_eq!(workbook.active().raw(4, 0), "movido");
    assert_eq!(workbook.active().col_widths[&0], 150.0);
    assert_eq!(workbook.active().merges[0].min_col, 0);
    assert_eq!(workbook.active().merges[0].max_col, 0);

    workbook.undo();
    assert_eq!(workbook.active().raw(4, 1), "movido");
    workbook.undo();
    assert_eq!(workbook.active().raw(2, 1), "movido");
    workbook.redo();
    assert_eq!(workbook.active().raw(4, 1), "movido");
}

#[test]
fn structural_edits_rewrite_formula_references() {
    let mut workbook = Workbook::default();
    workbook.active_mut().set_raw(0, 0, "10");
    workbook.active_mut().set_raw(1, 0, "=A1*2");
    workbook.active_mut().set_raw(2, 0, "=MÉDIA(A1:A2)");

    workbook.insert_rows(0, 1);
    assert_eq!(workbook.active().raw(2, 0), "=A2*2");
    assert_eq!(workbook.active().display(2, 0), "20");
    assert_eq!(workbook.active().raw(3, 0), "=MÉDIA(A2:A3)");

    workbook.delete_rows(1, 1);
    assert_eq!(workbook.active().raw(1, 0), "=#REF!*2");
    assert_eq!(workbook.active().display(1, 0), "#REF!");
    workbook.undo();
    assert_eq!(workbook.active().raw(2, 0), "=A2*2");

    assert_eq!(
        rewrite_references("=$A1+B$2+$C$3", ReferenceAxis::Col, 1, 2, true),
        "=$A1+D$2+$E$3"
    );
}

#[test]
fn complete_cell_formatting_round_trips() {
    let mut workbook = Workbook::default();
    workbook.active_mut().styles.insert(
        (3, 4),
        CellStyle {
            bold: true,
            italic: true,
            text_color: Some("#123456".into()),
            background_color: Some("#abcdef".into()),
            h_align: Some(HorizontalAlign::Right),
            v_align: Some(VerticalAlign::Bottom),
            borders: Some(CellBorders::all("#000000")),
        },
    );
    let restored = Workbook::from_serialized(workbook.serialize());
    let style = &restored.active().styles[&(3, 4)];
    assert_eq!(style.text_color.as_deref(), Some("#123456"));
    assert_eq!(style.h_align, Some(HorizontalAlign::Right));
    assert!(style.borders.as_ref().is_some_and(CellBorders::is_full));
}

#[test]
fn merges_reject_overlaps_and_follow_history() {
    let mut workbook = Workbook::default();
    let first = SerializedMerge {
        min_row: 0,
        min_col: 0,
        max_row: 1,
        max_col: 2,
    };
    assert!(workbook.merge_range(first.clone()));
    assert_eq!(workbook.active().merge_containing(1, 2), Some(&first));
    assert!(!workbook.merge_range(SerializedMerge {
        min_row: 1,
        min_col: 2,
        max_row: 3,
        max_col: 3,
    }));
    assert_eq!(workbook.active().merges.len(), 1);
    assert!(workbook.unmerge_at(0, 1));
    assert!(workbook.active().merges.is_empty());
    workbook.undo();
    assert_eq!(workbook.active().merges, vec![first]);
    workbook.undo();
    assert!(workbook.active().merges.is_empty());
    workbook.redo();
    assert_eq!(workbook.active().merges.len(), 1);
}

#[test]
fn sheets_can_be_renamed_and_removed_without_losing_the_last_one() {
    let mut workbook = Workbook::default();
    workbook.add_sheet();
    workbook.add_sheet();
    assert!(workbook.rename_sheet(1, "Dados"));
    assert!(!workbook.rename_sheet(2, "dados"));
    assert!(!workbook.rename_sheet(1, "  "));
    workbook.active = 2;
    assert!(workbook.remove_sheet(1));
    assert_eq!(workbook.active, 1);
    assert_eq!(workbook.sheets.len(), 2);
    assert!(workbook.remove_sheet(1));
    assert_eq!(workbook.active, 0);
    assert!(!workbook.remove_sheet(0));
    workbook.undo();
    assert_eq!(workbook.sheets.len(), 2);
}

#[test]
fn used_region_includes_content_styles_merges_and_dimensions() {
    let mut workbook = Workbook::default();
    let sheet = workbook.active_mut();
    assert_eq!(sheet.used_region(), (0, 0, 0, 0));
    sheet.set_raw(4, 2, "x");
    sheet.styles.insert(
        (1, 7),
        CellStyle {
            bold: true,
            ..Default::default()
        },
    );
    sheet.row_heights.insert(9, 40.0);
    sheet.merges.push(SerializedMerge {
        min_row: 2,
        min_col: 3,
        max_row: 6,
        max_col: 8,
    });
    assert_eq!(sheet.used_region(), (1, 0, 9, 8));
}

#[test]
fn custom_dimensions_share_consistent_positions_and_hit_testing() {
    let mut workbook = Workbook::default();
    let sheet = workbook.active_mut();
    sheet.row_heights.insert(0, 40.0);
    sheet.row_heights.insert(2, 10.0);
    sheet.col_widths.insert(0, 150.0);
    sheet.col_widths.insert(1, 20.0);
    assert_eq!(sheet.row_position(0), 0.0);
    assert_eq!(sheet.row_position(1), 40.0);
    assert_eq!(sheet.row_position(3), 76.0);
    assert_eq!(sheet.row_at(39.0), 0);
    assert_eq!(sheet.row_at(40.0), 1);
    assert_eq!(sheet.row_at(70.0), 2);
    assert_eq!(sheet.col_position(1), 150.0);
    assert_eq!(sheet.col_position(2), 170.0);
    assert_eq!(sheet.col_at(149.0), 0);
    assert_eq!(sheet.col_at(150.0), 1);
    assert_eq!(sheet.col_at(170.0), 2);
}

#[test]
fn xlsx_round_trip_preserves_sheets_values_formulas_and_merges() {
    let mut workbook = Workbook::default();
    workbook.active_mut().set_raw(0, 0, "10");
    workbook.active_mut().set_raw(0, 1, "=A1*2");
    assert!(workbook.merge_range(SerializedMerge {
        min_row: 1,
        min_col: 0,
        max_row: 1,
        max_col: 2,
    }));
    workbook.add_sheet();
    workbook.active_mut().set_raw(2, 3, "segunda");
    let path = std::env::temp_dir().join(format!("calco-xlsx-{}.xlsx", std::process::id()));
    xlsx::export(&path, &workbook).unwrap();
    let imported = xlsx::import(&path).unwrap();
    let _ = fs::remove_file(path);
    assert_eq!(imported.sheets.len(), 2);
    assert_eq!(imported.sheets[0].raw(0, 0), "10");
    assert_eq!(imported.sheets[0].raw(0, 1), "=A1*2");
    assert_eq!(imported.sheets[0].merges.len(), 1);
    assert_eq!(imported.sheets[1].raw(2, 3), "segunda");
}

#[test]
fn xlsx_round_trip_preserves_custom_dimensions() {
    let path = std::env::temp_dir().join(format!("calco-dimensions-{}.xlsx", std::process::id()));
    let mut workbook = Workbook::default();
    workbook.active_mut().row_heights.insert(2, 40.0);
    workbook.active_mut().col_widths.insert(3, 180.0);
    calco::xlsx::export(&path, &workbook).expect("export xlsx dimensions");
    let imported = calco::xlsx::import(&path).expect("import xlsx dimensions");
    std::fs::remove_file(path).ok();

    assert!((imported.active().row_height(2) - 40.0).abs() < 2.0);
    assert!(
        (imported.active().col_width(3) - 180.0).abs() < 2.0,
        "imported width: {}",
        imported.active().col_width(3)
    );
}

#[test]
fn xlsx_round_trip_preserves_cell_styles() {
    let path = std::env::temp_dir().join(format!("calco-styles-{}.xlsx", std::process::id()));
    let mut workbook = Workbook::default();
    workbook.active_mut().set_raw(0, 0, "estilo");
    workbook.active_mut().styles.insert(
        (0, 0),
        CellStyle {
            bold: true,
            italic: true,
            text_color: Some("#112233".into()),
            background_color: Some("#AABBCC".into()),
            h_align: Some(HorizontalAlign::Center),
            v_align: Some(VerticalAlign::Middle),
            borders: Some(CellBorders::all("#000000")),
        },
    );
    xlsx::export(&path, &workbook).unwrap();
    let imported = xlsx::import(&path).unwrap();
    std::fs::remove_file(path).ok();
    assert_eq!(
        imported.active().styles[&(0, 0)],
        workbook.active().styles[&(0, 0)]
    );
}

#[test]
fn formula_cycles_and_dependency_errors_are_propagated() {
    let mut workbook = Workbook::default();
    workbook.active_mut().set_raw(0, 0, "=B1+1");
    workbook.active_mut().set_raw(0, 1, "=A1+1");
    assert_eq!(workbook.active().display(0, 0), "#CICLO!");
    workbook.active_mut().set_raw(0, 0, "=1/0");
    workbook.active_mut().set_raw(0, 1, "=A1+1");
    assert_eq!(workbook.active().display(0, 1), "#DIV/0!");
}

#[test]
fn formulas_support_nesting_comparisons_unary_and_absolute_references() {
    let mut workbook = Workbook::default();
    workbook.active_mut().set_raw(0, 0, "2");
    workbook.active_mut().set_raw(1, 0, "3");
    workbook
        .active_mut()
        .set_raw(0, 1, "=SOMA($A$1:A2;MAX(4;ABS(-5)))*2");
    assert_eq!(workbook.active().display(0, 1), "20");
    workbook
        .active_mut()
        .set_raw(1, 1, "=SE(B1>=20;ARRED(RAIZ(9);0);0)");
    assert_eq!(workbook.active().display(1, 1), "3");
    workbook.active_mut().set_raw(2, 1, "=POWER(2;3)<>8");
    assert_eq!(workbook.active().display(2, 1), "0");
}

#[test]
fn copied_formulas_move_only_relative_references() {
    assert_eq!(
        translate_references("=A1+$B1+C$2+$D$3", 2, 1),
        "=B3+$B3+D$2+$D$3"
    );
    assert_eq!(translate_references("=A1", -1, 0), "=#REF!");
    assert_eq!(
        translate_references("=IF(A1=\"A1\";A1;0)", 1, 1),
        "=IF(B2=\"A1\";B2;0)"
    );
}

#[test]
fn formulas_support_cross_sheet_references_ranges_and_cycles() {
    let mut workbook = Workbook::default();
    workbook.active_mut().name = "Dados 2026".into();
    workbook.active_mut().set_raw(0, 0, "10");
    workbook.active_mut().set_raw(1, 0, "20");
    workbook.add_sheet();
    workbook.active_mut().name = "Resumo".into();
    workbook
        .active_mut()
        .set_raw(0, 0, "=SUM('Dados 2026'!A1:A2)");
    workbook.active_mut().set_raw(1, 0, "='Dados 2026'!A1*2");

    let calculation = workbook.calculation();
    assert_eq!(calculation.display(0, 0), "30");
    assert_eq!(calculation.display(1, 0), "20");
    drop(calculation);

    workbook.sheets[0].set_raw(2, 0, "=Resumo!A3");
    workbook.sheets[1].set_raw(2, 0, "='Dados 2026'!A3");
    assert_eq!(workbook.calculation().display(2, 0), "#CICLO!");
}

#[test]
fn formulas_support_text_comparison_concatenation_and_dates() {
    let mut workbook = Workbook::default();
    workbook.active_mut().set_raw(0, 0, "Maria");
    workbook.active_mut().set_raw(0, 1, "=A1&\" Silva\"");
    workbook
        .active_mut()
        .set_raw(1, 1, "=SE(A1=\"Maria\";\"Olá\";\"Tchau\")");
    workbook.active_mut().set_raw(2, 1, "=DATA(2026;7;19)");
    workbook.active_mut().set_raw(3, 1, "=ANO(B3)");
    workbook.active_mut().set_raw(4, 1, "=MÊS(B3)");
    workbook.active_mut().set_raw(5, 1, "=DIA(B3)");
    workbook
        .active_mut()
        .set_raw(6, 1, "=MAIÚSCULA(ESQUERDA(A1;3))");
    workbook
        .active_mut()
        .set_raw(7, 1, "=SE(1>0;\"a;b,c\";\"não\")");
    workbook.active_mut().set_raw(8, 1, "=1,5+1");
    workbook.active_mut().set_raw(9, 0, "Código");
    workbook.active_mut().set_raw(9, 1, "Descrição");
    workbook.active_mut().set_raw(10, 0, "42");
    workbook.active_mut().set_raw(10, 1, "Produto");
    workbook
        .active_mut()
        .set_raw(11, 1, "=PROCV(42;A10:B11;2;FALSO)");
    assert_eq!(workbook.calculation().display(0, 1), "Maria Silva");
    assert_eq!(workbook.calculation().display(1, 1), "Olá");
    assert_eq!(workbook.calculation().display(2, 1), "2026-07-19");
    assert_eq!(workbook.calculation().display(3, 1), "2026");
    assert_eq!(workbook.calculation().display(4, 1), "7");
    assert_eq!(workbook.calculation().display(5, 1), "19");
    assert_eq!(workbook.calculation().display(6, 1), "MAR");
    assert_eq!(workbook.calculation().display(7, 1), "a;b,c");
    assert_eq!(workbook.calculation().display(8, 1), "2,5");
    assert_eq!(workbook.calculation().display(11, 1), "Produto");
}
