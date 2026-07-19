use crate::workbook::{MAX_COLS, MAX_ROWS, Sheet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellRange {
    pub min_row: u32,
    pub max_row: u32,
    pub min_col: u32,
    pub max_col: u32,
}

impl CellRange {
    pub fn between(row_a: u32, col_a: u32, row_b: u32, col_b: u32) -> Self {
        Self {
            min_row: row_a.min(row_b),
            max_row: row_a.max(row_b),
            min_col: col_a.min(col_b),
            max_col: col_a.max(col_b),
        }
    }
}

/// Tab-separated raw cell contents, compatible with spreadsheet clipboards.
pub fn build_tsv(sheet: &Sheet, range: CellRange) -> String {
    (range.min_row..=range.max_row)
        .map(|row| {
            (range.min_col..=range.max_col)
                .map(|col| sheet.raw(row, col))
                .collect::<Vec<_>>()
                .join("\t")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn build_html(sheet: &Sheet, range: CellRange) -> String {
    let mut html = String::from("<table>");
    for row in range.min_row..=range.max_row {
        html.push_str("<tr>");
        for col in range.min_col..=range.max_col {
            let style = sheet.styles.get(&(row, col));
            let mut css = Vec::new();
            if let Some(style) = style {
                if style.bold {
                    css.push("font-weight:bold".to_owned());
                }
                if style.italic {
                    css.push("font-style:italic".to_owned());
                }
                if let Some(color) = &style.text_color {
                    css.push(format!("color:{color}"));
                }
                if let Some(color) = &style.background_color {
                    css.push(format!("background-color:{color}"));
                }
                if let Some(align) = style.h_align {
                    css.push(format!(
                        "text-align:{}",
                        match align {
                            crate::model::HorizontalAlign::Left => "left",
                            crate::model::HorizontalAlign::Center => "center",
                            crate::model::HorizontalAlign::Right => "right",
                        }
                    ));
                }
            }
            let style_attribute = if css.is_empty() {
                String::new()
            } else {
                format!(" style=\"{}\"", css.join(";"))
            };
            html.push_str(&format!(
                "<td{style_attribute}>{}</td>",
                escape_html(&sheet.raw(row, col))
            ));
        }
        html.push_str("</tr>");
    }
    html.push_str("</table>");
    html
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn parse_tsv(text: &str) -> Vec<Vec<String>> {
    let normalized = text.replace("\r\n", "\n");
    let mut lines = normalized.split('\n').collect::<Vec<_>>();
    if lines.len() > 1 && lines.last() == Some(&"") {
        lines.pop();
    }
    lines
        .into_iter()
        .map(|line| line.split('\t').map(str::to_owned).collect())
        .collect()
}

/// Pastes as much of a TSV block as fits inside the sheet.
pub fn paste_tsv(sheet: &mut Sheet, start_row: u32, start_col: u32, text: &str) {
    for (row_offset, row) in parse_tsv(text).into_iter().enumerate() {
        let Some(target_row) = start_row.checked_add(row_offset as u32) else {
            break;
        };
        if target_row >= MAX_ROWS {
            break;
        }
        for (col_offset, raw) in row.into_iter().enumerate() {
            let Some(target_col) = start_col.checked_add(col_offset as u32) else {
                break;
            };
            if target_col >= MAX_COLS {
                break;
            }
            sheet.set_raw(target_row, target_col, &raw);
        }
    }
}

pub fn clear_range(sheet: &mut Sheet, range: CellRange) {
    sheet.cells.retain(|&(row, col), _| {
        row < range.min_row || row > range.max_row || col < range.min_col || col > range.max_col
    });
}
