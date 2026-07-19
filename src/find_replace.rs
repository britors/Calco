use crate::workbook::Sheet;

pub fn find_matches(sheet: &Sheet, query: &str) -> Vec<(u32, u32)> {
    if query.is_empty() {
        return vec![];
    }
    let needle = query.to_lowercase();
    let mut matches = sheet
        .cells
        .iter()
        .filter_map(|(&(row, col), content)| {
            content
                .raw()
                .to_lowercase()
                .contains(&needle)
                .then_some((row, col))
        })
        .collect::<Vec<_>>();
    matches.sort_unstable();
    matches
}

pub fn replace_in_cell(
    sheet: &mut Sheet,
    row: u32,
    col: u32,
    query: &str,
    replacement: &str,
) -> bool {
    if query.is_empty() {
        return false;
    }
    let raw = sheet.raw(row, col);
    let replaced = replace_case_insensitive(&raw, query, replacement);
    if replaced == raw {
        return false;
    }
    sheet.set_raw(row, col, &replaced);
    true
}

pub fn replace_all(sheet: &mut Sheet, query: &str, replacement: &str) -> usize {
    let matches = find_matches(sheet, query);
    for &(row, col) in &matches {
        replace_in_cell(sheet, row, col, query, replacement);
    }
    matches.len()
}

fn replace_case_insensitive(text: &str, query: &str, replacement: &str) -> String {
    let needle = query.to_lowercase();
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    while cursor < text.len() {
        let mut found = None;
        for start in text[cursor..]
            .char_indices()
            .map(|(offset, _)| cursor + offset)
        {
            for end in text[start..]
                .char_indices()
                .skip(1)
                .map(|(offset, _)| start + offset)
                .chain(std::iter::once(text.len()))
            {
                if text[start..end].to_lowercase() == needle {
                    found = Some((start, end));
                    break;
                }
            }
            if found.is_some() {
                break;
            }
        }
        let Some((start, end)) = found else {
            output.push_str(&text[cursor..]);
            break;
        };
        output.push_str(&text[cursor..start]);
        output.push_str(replacement);
        cursor = end;
    }
    output
}
