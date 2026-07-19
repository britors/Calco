use crate::{
    model::{CellBorders, CellContent, CellStyle, HorizontalAlign, SerializedMerge, VerticalAlign},
    workbook::{Sheet, Workbook},
};
use calamine::{Data, Reader, Xlsx, open_workbook};
use quick_xml::{Reader as XmlReader, events::Event};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Formula};
use std::{collections::HashSet, error::Error, fs::File, io::Read, path::Path};
use zip::ZipArchive;

pub fn import(path: &Path) -> Result<Workbook, Box<dyn Error>> {
    let mut source: Xlsx<_> = open_workbook(path)?;
    let names = source.sheet_names().to_vec();
    let mut sheets = Vec::new();
    for name in names {
        let values = source.worksheet_range(&name)?;
        let formulas = source.worksheet_formula(&name)?;
        let mut sheet = Sheet {
            name: name.clone(),
            ..Default::default()
        };
        let value_origin = values.start().unwrap_or((0, 0));
        for (row, col, value) in values.cells() {
            let content = match value {
                Data::Int(value) => Some(CellContent::Number(*value as f64)),
                Data::Float(value) => Some(CellContent::Number(*value)),
                Data::String(value) => Some(CellContent::Text(value.clone())),
                Data::Bool(value) => Some(CellContent::Boolean(*value)),
                Data::DateTime(value) => Some(CellContent::Text(value.to_string())),
                Data::DateTimeIso(value) | Data::DurationIso(value) => {
                    Some(CellContent::Text(value.clone()))
                }
                Data::Error(value) => Some(CellContent::Text(value.to_string())),
                Data::Empty => None,
            };
            if let Some(content) = content {
                sheet.cells.insert(
                    (value_origin.0 + row as u32, value_origin.1 + col as u32),
                    content,
                );
            }
        }
        let formula_origin = formulas.start().unwrap_or((0, 0));
        for (row, col, formula) in formulas.cells() {
            if !formula.is_empty() {
                sheet.cells.insert(
                    (formula_origin.0 + row as u32, formula_origin.1 + col as u32),
                    CellContent::Text(format!("={}", formula.trim_start_matches('='))),
                );
            }
        }
        sheet.merges = source
            .merge_cells_by_sheet_name(&name)?
            .into_iter()
            .map(|range| SerializedMerge {
                min_row: range.start.0,
                min_col: range.start.1,
                max_row: range.end.0,
                max_col: range.end.1,
            })
            .collect();
        sheets.push(sheet);
    }
    import_dimensions(path, &mut sheets)?;
    if sheets.is_empty() {
        Ok(Workbook::default())
    } else {
        let mut workbook = Workbook::from_sheet(sheets.remove(0));
        workbook.sheets.extend(sheets);
        Ok(workbook)
    }
}

fn import_dimensions(path: &Path, sheets: &mut [Sheet]) -> Result<(), Box<dyn Error>> {
    let mut archive = ZipArchive::new(File::open(path)?)?;
    let styles = read_styles(&mut archive)?;
    for (index, sheet) in sheets.iter_mut().enumerate() {
        let entry = format!("xl/worksheets/sheet{}.xml", index + 1);
        let Ok(mut file) = archive.by_name(&entry) else {
            continue;
        };
        let mut xml = String::new();
        file.read_to_string(&mut xml)?;
        let mut reader = XmlReader::from_str(&xml);
        loop {
            match reader.read_event()? {
                Event::Start(element) | Event::Empty(element) => {
                    match element.local_name().as_ref() {
                        b"row" => {
                            let mut row: Option<u32> = None;
                            let mut height = None;
                            for attribute in element.attributes().flatten() {
                                match attribute.key.local_name().as_ref() {
                                    b"r" => row = parse_attribute(&attribute.value),
                                    b"ht" => height = parse_attribute::<f64>(&attribute.value),
                                    _ => {}
                                }
                            }
                            if let (Some(row), Some(height)) = (row, height) {
                                sheet
                                    .row_heights
                                    .insert(row.saturating_sub(1), height * 96.0 / 72.0);
                            }
                        }
                        b"col" => {
                            let mut min: Option<u32> = None;
                            let mut max: Option<u32> = None;
                            let mut width = None;
                            for attribute in element.attributes().flatten() {
                                match attribute.key.local_name().as_ref() {
                                    b"min" => min = parse_attribute(&attribute.value),
                                    b"max" => max = parse_attribute(&attribute.value),
                                    b"width" => width = parse_attribute::<f64>(&attribute.value),
                                    _ => {}
                                }
                            }
                            if let (Some(min), Some(max), Some(width)) = (min, max, width) {
                                let pixels = (width * 7.0).round();
                                for col in min.saturating_sub(1)..max {
                                    sheet.col_widths.insert(col, pixels);
                                }
                            }
                        }
                        b"c" => {
                            let mut address = None;
                            let mut style = None;
                            for attribute in element.attributes().flatten() {
                                match attribute.key.local_name().as_ref() {
                                    b"r" => {
                                        address = std::str::from_utf8(&attribute.value)
                                            .ok()
                                            .map(str::to_owned)
                                    }
                                    b"s" => style = parse_attribute::<usize>(&attribute.value),
                                    _ => {}
                                }
                            }
                            if let (Some(address), Some(style)) = (address, style)
                                && let Some(position) = crate::formula::parse_a1(&address)
                                && let Some(style) = styles.get(style)
                                && *style != CellStyle::default()
                            {
                                sheet.styles.insert(position, style.clone());
                            }
                        }
                        _ => {}
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
    }
    Ok(())
}

fn read_styles(archive: &mut ZipArchive<File>) -> Result<Vec<CellStyle>, Box<dyn Error>> {
    let Ok(mut file) = archive.by_name("xl/styles.xml") else {
        return Ok(Vec::new());
    };
    let mut xml = String::new();
    file.read_to_string(&mut xml)?;
    drop(file);
    let mut reader = XmlReader::from_str(&xml);
    let mut section = "";
    let mut fonts: Vec<CellStyle> = Vec::new();
    let mut fills: Vec<Option<String>> = Vec::new();
    let mut borders: Vec<bool> = Vec::new();
    let mut styles = Vec::new();
    let mut font = CellStyle::default();
    let mut fill = None;
    let mut border = false;
    loop {
        match reader.read_event()? {
            Event::Start(element) | Event::Empty(element) => {
                let name = element.local_name();
                match name.as_ref() {
                    b"fonts" => section = "fonts",
                    b"fills" => section = "fills",
                    b"borders" => section = "borders",
                    b"cellXfs" => section = "xfs",
                    b"font" if section == "fonts" => font = CellStyle::default(),
                    b"b" if section == "fonts" => font.bold = true,
                    b"i" if section == "fonts" => font.italic = true,
                    b"color" if section == "fonts" => font.text_color = color_attribute(&element),
                    b"fill" if section == "fills" => fill = None,
                    b"fgColor" if section == "fills" => fill = color_attribute(&element),
                    b"border" if section == "borders" => border = false,
                    b"left" | b"right" | b"top" | b"bottom" if section == "borders" => {
                        border |= element.attributes().flatten().any(|attribute| {
                            attribute.key.local_name().as_ref() == b"style"
                                && !attribute.value.is_empty()
                        });
                    }
                    b"xf" if section == "xfs" => {
                        let mut style = CellStyle::default();
                        for attribute in element.attributes().flatten() {
                            let value = parse_attribute::<usize>(&attribute.value);
                            match attribute.key.local_name().as_ref() {
                                b"fontId" => {
                                    if let Some(source) = value.and_then(|id| fonts.get(id)) {
                                        style.bold = source.bold;
                                        style.italic = source.italic;
                                        style.text_color = source.text_color.clone();
                                    }
                                }
                                b"fillId" => {
                                    style.background_color =
                                        value.and_then(|id| fills.get(id)).cloned().flatten()
                                }
                                b"borderId"
                                    if value.and_then(|id| borders.get(id)).copied()
                                        == Some(true) =>
                                {
                                    style.borders = Some(CellBorders::all("#000000"));
                                }
                                _ => {}
                            }
                        }
                        styles.push(style);
                    }
                    b"alignment" if section == "xfs" => {
                        if let Some(style) = styles.last_mut() {
                            for attribute in element.attributes().flatten() {
                                let Ok(value) = std::str::from_utf8(&attribute.value) else {
                                    continue;
                                };
                                match attribute.key.local_name().as_ref() {
                                    b"horizontal" => {
                                        style.h_align = match value {
                                            "left" => Some(HorizontalAlign::Left),
                                            "center" => Some(HorizontalAlign::Center),
                                            "right" => Some(HorizontalAlign::Right),
                                            _ => None,
                                        }
                                    }
                                    b"vertical" => {
                                        style.v_align = match value {
                                            "top" => Some(VerticalAlign::Top),
                                            "center" => Some(VerticalAlign::Middle),
                                            "bottom" => Some(VerticalAlign::Bottom),
                                            _ => None,
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Event::End(element) => match element.local_name().as_ref() {
                b"font" if section == "fonts" => fonts.push(font.clone()),
                b"fill" if section == "fills" => fills.push(fill.clone()),
                b"border" if section == "borders" => borders.push(border),
                b"fonts" | b"fills" | b"borders" | b"cellXfs" => section = "",
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(styles)
}

fn color_attribute(element: &quick_xml::events::BytesStart<'_>) -> Option<String> {
    let attribute = element
        .attributes()
        .flatten()
        .find(|attribute| attribute.key.local_name().as_ref() == b"rgb")?;
    let value = std::str::from_utf8(&attribute.value).ok()?;
    let rgb = value.get(value.len().saturating_sub(6)..)?;
    Some(format!("#{rgb}"))
}

fn parse_attribute<T: std::str::FromStr>(value: &[u8]) -> Option<T> {
    std::str::from_utf8(value).ok()?.parse().ok()
}

pub fn export(path: &Path, source: &Workbook) -> Result<(), Box<dyn Error>> {
    let mut target = rust_xlsxwriter::Workbook::new();
    for (sheet_index, sheet) in source.sheets.iter().enumerate() {
        let worksheet = target.add_worksheet();
        worksheet.set_name(&sheet.name)?;
        if sheet_index == source.active {
            worksheet.set_active(true);
        }
        for (&row, &height) in &sheet.row_heights {
            worksheet.set_row_height_pixels(row, height.max(8.0) as u32)?;
        }
        for (&col, &width) in &sheet.col_widths {
            worksheet.set_column_width_pixels(col as u16, width.max(16.0) as u32)?;
        }
        for merge in &sheet.merges {
            worksheet.merge_range(
                merge.min_row,
                merge.min_col as u16,
                merge.max_row,
                merge.max_col as u16,
                "",
                &Format::new(),
            )?;
        }
        let positions = sheet
            .cells
            .keys()
            .chain(sheet.styles.keys())
            .copied()
            .collect::<HashSet<_>>();
        for (row, col) in positions {
            let style = sheet.styles.get(&(row, col)).cloned().unwrap_or_default();
            let format = excel_format(&style);
            match sheet.cells.get(&(row, col)) {
                Some(CellContent::Number(value)) => {
                    worksheet.write_number_with_format(row, col as u16, *value, &format)?;
                }
                Some(CellContent::Boolean(value)) => {
                    worksheet.write_boolean_with_format(row, col as u16, *value, &format)?;
                }
                Some(CellContent::Text(value)) if value.starts_with('=') => {
                    worksheet.write_formula_with_format(
                        row,
                        col as u16,
                        Formula::new(value.trim_start_matches('=')),
                        &format,
                    )?;
                }
                Some(CellContent::Text(value)) => {
                    worksheet.write_string_with_format(row, col as u16, value, &format)?;
                }
                None => {
                    worksheet.write_blank(row, col as u16, &format)?;
                }
            }
        }
    }
    target.save(path)?;
    Ok(())
}

fn excel_format(style: &CellStyle) -> Format {
    let mut format = Format::new();
    if style.bold {
        format = format.set_bold();
    }
    if style.italic {
        format = format.set_italic();
    }
    if let Some(color) = style.text_color.as_deref().and_then(excel_color) {
        format = format.set_font_color(color);
    }
    if let Some(color) = style.background_color.as_deref().and_then(excel_color) {
        format = format.set_background_color(color);
    }
    if let Some(align) = style.h_align {
        format = format.set_align(match align {
            HorizontalAlign::Left => FormatAlign::Left,
            HorizontalAlign::Center => FormatAlign::Center,
            HorizontalAlign::Right => FormatAlign::Right,
        });
    }
    if let Some(align) = style.v_align {
        format = format.set_align(match align {
            VerticalAlign::Top => FormatAlign::Top,
            VerticalAlign::Middle => FormatAlign::VerticalCenter,
            VerticalAlign::Bottom => FormatAlign::Bottom,
        });
    }
    if style
        .borders
        .as_ref()
        .is_some_and(|borders| borders.is_full())
    {
        format = format.set_border(FormatBorder::Thin);
    }
    format
}

fn excel_color(value: &str) -> Option<Color> {
    let hex = value.strip_prefix('#')?;
    (hex.len() == 6)
        .then(|| u32::from_str_radix(hex, 16).ok().map(Color::RGB))
        .flatten()
}
