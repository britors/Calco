use crate::{model::CellContent, workbook::Sheet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CsvEncoding {
    Utf8,
    Windows1252,
}

pub fn decode(bytes: &[u8], encoding: CsvEncoding) -> String {
    match encoding {
        CsvEncoding::Utf8 => String::from_utf8_lossy(bytes).into_owned(),
        CsvEncoding::Windows1252 => {
            let (text, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
            text.into_owned()
        }
    }
}

pub fn parse_delimited(text: &str, delimiter: char) -> Vec<Vec<String>> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = normalized.chars().peekable();
    let mut quoted = false;
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(ch);
            }
        } else if ch == '"' {
            quoted = true;
        } else if ch == delimiter {
            row.push(std::mem::take(&mut field));
        } else if ch == '\n' {
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
        } else {
            field.push(ch);
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

pub fn detect_delimiter(text: &str) -> char {
    let first_record = text.lines().next().unwrap_or_default();
    [';', ',', '\t']
        .into_iter()
        .max_by_key(|delimiter| first_record.matches(*delimiter).count())
        .filter(|delimiter| first_record.contains(*delimiter))
        .unwrap_or(';')
}

pub fn import_sheet(text: &str, delimiter: char, name: impl Into<String>) -> Sheet {
    let mut sheet = Sheet {
        name: name.into(),
        ..Default::default()
    };
    for (row, fields) in parse_delimited(text, delimiter).into_iter().enumerate() {
        for (col, raw) in fields.into_iter().enumerate() {
            if raw.trim().is_empty() {
                continue;
            }
            let content = coerce(&raw, delimiter);
            sheet.cells.insert((row as u32, col as u32), content);
        }
    }
    sheet
}

pub fn export_sheet(sheet: &Sheet, delimiter: char) -> String {
    let Some(max_row) = sheet.cells.keys().map(|(row, _)| *row).max() else {
        return String::new();
    };
    let max_col = sheet.cells.keys().map(|(_, col)| *col).max().unwrap_or(0);
    let calculation = sheet.calculation();
    (0..=max_row)
        .map(|row| {
            (0..=max_col)
                .map(|col| quote_field(&calculation.display(row, col), delimiter))
                .collect::<Vec<_>>()
                .join(&delimiter.to_string())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn coerce(raw: &str, delimiter: char) -> CellContent {
    let trimmed = raw.trim();
    if trimmed.eq_ignore_ascii_case("true") || trimmed.eq_ignore_ascii_case("verdadeiro") {
        return CellContent::Boolean(true);
    }
    if trimmed.eq_ignore_ascii_case("false") || trimmed.eq_ignore_ascii_case("falso") {
        return CellContent::Boolean(false);
    }
    let candidate = if delimiter == ';' {
        trimmed.replace(',', ".")
    } else {
        trimmed.to_owned()
    };
    candidate
        .parse::<f64>()
        .map(CellContent::Number)
        .unwrap_or_else(|_| CellContent::Text(raw.to_owned()))
}

fn quote_field(value: &str, delimiter: char) -> String {
    if value.contains(delimiter) || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}
