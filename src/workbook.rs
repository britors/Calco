use crate::{
    formula::{CellLookup, ReferenceAxis, display_value, rewrite_references},
    model::*,
};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
};

pub const MAX_ROWS: u32 = 100_000;
pub const MAX_COLS: u32 = 1_000;

#[derive(Clone, Default)]
pub struct Sheet {
    pub name: String,
    pub cells: HashMap<(u32, u32), CellContent>,
    pub styles: HashMap<(u32, u32), CellStyle>,
    pub row_heights: HashMap<u32, f64>,
    pub col_widths: HashMap<u32, f64>,
    pub merges: Vec<SerializedMerge>,
}

impl CellLookup for Sheet {
    fn number_at(&self, row: u32, col: u32) -> Option<f64> {
        match self.cells.get(&(row, col))? {
            CellContent::Number(v) => Some(*v),
            CellContent::Boolean(v) => Some(u8::from(*v) as f64),
            CellContent::Text(v) if v.starts_with('=') => {
                crate::formula::display_value(self.cells.get(&(row, col))?, self)
                    .replace(',', ".")
                    .parse()
                    .ok()
            }
            CellContent::Text(v) => v.replace(',', ".").parse().ok(),
        }
    }
}

impl Sheet {
    pub fn row_height(&self, row: u32) -> f64 {
        self.row_heights.get(&row).copied().unwrap_or(26.0).max(8.0)
    }

    pub fn col_width(&self, col: u32) -> f64 {
        self.col_widths
            .get(&col)
            .copied()
            .unwrap_or(100.0)
            .max(16.0)
    }

    pub fn row_position(&self, row: u32) -> f64 {
        row as f64 * 26.0
            + self
                .row_heights
                .iter()
                .filter(|(index, _)| **index < row)
                .map(|(_, height)| height.max(8.0) - 26.0)
                .sum::<f64>()
    }

    pub fn col_position(&self, col: u32) -> f64 {
        col as f64 * 100.0
            + self
                .col_widths
                .iter()
                .filter(|(index, _)| **index < col)
                .map(|(_, width)| width.max(16.0) - 100.0)
                .sum::<f64>()
    }

    pub fn row_at(&self, offset: f64) -> u32 {
        axis_at(offset, MAX_ROWS, |index| self.row_position(index))
    }

    pub fn col_at(&self, offset: f64) -> u32 {
        axis_at(offset, MAX_COLS, |index| self.col_position(index))
    }

    pub fn total_height(&self) -> f64 {
        self.row_position(MAX_ROWS)
    }

    pub fn total_width(&self) -> f64 {
        self.col_position(MAX_COLS)
    }

    pub fn used_region(&self) -> (u32, u32, u32, u32) {
        let mut positions = self
            .cells
            .keys()
            .chain(self.styles.keys())
            .copied()
            .collect::<Vec<_>>();
        for merge in &self.merges {
            positions.push((merge.min_row, merge.min_col));
            positions.push((merge.max_row, merge.max_col));
        }
        for &row in self.row_heights.keys() {
            positions.push((row, 0));
        }
        for &col in self.col_widths.keys() {
            positions.push((0, col));
        }
        if positions.is_empty() {
            return (0, 0, 0, 0);
        }
        positions.into_iter().fold(
            (u32::MAX, u32::MAX, 0, 0),
            |(min_row, min_col, max_row, max_col), (row, col)| {
                (
                    min_row.min(row),
                    min_col.min(col),
                    max_row.max(row),
                    max_col.max(col),
                )
            },
        )
    }

    pub fn merge_containing(&self, row: u32, col: u32) -> Option<&SerializedMerge> {
        self.merges.iter().find(|merge| {
            row >= merge.min_row
                && row <= merge.max_row
                && col >= merge.min_col
                && col <= merge.max_col
        })
    }

    pub fn merge_range(&mut self, range: SerializedMerge) -> bool {
        if (range.min_row == range.max_row && range.min_col == range.max_col)
            || range.max_row >= MAX_ROWS
            || range.max_col >= MAX_COLS
            || self
                .merges
                .iter()
                .any(|merge| ranges_overlap(merge, &range))
        {
            return false;
        }
        self.merges.push(range);
        true
    }

    pub fn unmerge_at(&mut self, row: u32, col: u32) -> bool {
        let before = self.merges.len();
        self.merges.retain(|merge| {
            row < merge.min_row || row > merge.max_row || col < merge.min_col || col > merge.max_col
        });
        self.merges.len() != before
    }

    pub fn raw(&self, row: u32, col: u32) -> String {
        self.cells
            .get(&(row, col))
            .map(CellContent::raw)
            .unwrap_or_default()
    }
    pub fn display(&self, row: u32, col: u32) -> String {
        self.calculation().display(row, col)
    }
    pub fn calculation(&self) -> CalculationContext<'_> {
        CalculationContext {
            sheets: std::slice::from_ref(self),
            active: 0,
            current: RefCell::new(0),
            visiting: RefCell::new(HashSet::new()),
            error: RefCell::new(None),
            cache: RefCell::new(HashMap::new()),
        }
    }
    pub fn set_raw(&mut self, row: u32, col: u32, raw: &str) {
        if raw.is_empty() {
            self.cells.remove(&(row, col));
            return;
        }
        let value = if raw.starts_with('=') {
            CellContent::Text(crate::formula::canonicalize_formula(raw))
        } else if let Ok(v) = raw.replace(',', ".").parse::<f64>() {
            CellContent::Number(v)
        } else if raw.eq_ignore_ascii_case("verdadeiro") {
            CellContent::Boolean(true)
        } else if raw.eq_ignore_ascii_case("falso") {
            CellContent::Boolean(false)
        } else {
            CellContent::Text(raw.into())
        };
        self.cells.insert((row, col), value);
    }

    pub fn insert_rows(&mut self, at: u32, count: u32) {
        shift_rows(&mut self.cells, at, count, true);
        shift_rows(&mut self.styles, at, count, true);
        self.row_heights = self
            .row_heights
            .drain()
            .filter_map(|(row, height)| {
                let row = if row >= at {
                    row.checked_add(count)?
                } else {
                    row
                };
                (row < MAX_ROWS).then_some((row, height))
            })
            .collect();
        for merge in &mut self.merges {
            if at <= merge.min_row {
                merge.min_row += count;
                merge.max_row += count;
            } else if at <= merge.max_row {
                merge.max_row += count;
            }
        }
        self.merges.retain(|merge| merge.max_row < MAX_ROWS);
        rewrite_sheet_references(self, ReferenceAxis::Row, at, count, true);
    }

    pub fn delete_rows(&mut self, at: u32, count: u32) {
        shift_rows(&mut self.cells, at, count, false);
        shift_rows(&mut self.styles, at, count, false);
        self.row_heights = self
            .row_heights
            .drain()
            .filter_map(|(row, height)| delete_index(row, at, count).map(|row| (row, height)))
            .collect();
        self.merges = self
            .merges
            .drain(..)
            .filter_map(|mut merge| {
                let (min, max) = delete_span(merge.min_row, merge.max_row, at, count)?;
                merge.min_row = min;
                merge.max_row = max;
                Some(merge)
            })
            .collect();
        rewrite_sheet_references(self, ReferenceAxis::Row, at, count, false);
    }

    pub fn insert_cols(&mut self, at: u32, count: u32) {
        shift_cols(&mut self.cells, at, count, true);
        shift_cols(&mut self.styles, at, count, true);
        self.col_widths = self
            .col_widths
            .drain()
            .filter_map(|(col, width)| {
                let col = if col >= at {
                    col.checked_add(count)?
                } else {
                    col
                };
                (col < MAX_COLS).then_some((col, width))
            })
            .collect();
        for merge in &mut self.merges {
            if at <= merge.min_col {
                merge.min_col += count;
                merge.max_col += count;
            } else if at <= merge.max_col {
                merge.max_col += count;
            }
        }
        self.merges.retain(|merge| merge.max_col < MAX_COLS);
        rewrite_sheet_references(self, ReferenceAxis::Col, at, count, true);
    }

    pub fn delete_cols(&mut self, at: u32, count: u32) {
        shift_cols(&mut self.cells, at, count, false);
        shift_cols(&mut self.styles, at, count, false);
        self.col_widths = self
            .col_widths
            .drain()
            .filter_map(|(col, width)| delete_index(col, at, count).map(|col| (col, width)))
            .collect();
        self.merges = self
            .merges
            .drain(..)
            .filter_map(|mut merge| {
                let (min, max) = delete_span(merge.min_col, merge.max_col, at, count)?;
                merge.min_col = min;
                merge.max_col = max;
                Some(merge)
            })
            .collect();
        rewrite_sheet_references(self, ReferenceAxis::Col, at, count, false);
    }
}

pub struct CalculationContext<'a> {
    sheets: &'a [Sheet],
    active: usize,
    current: RefCell<usize>,
    visiting: RefCell<HashSet<(usize, u32, u32)>>,
    error: RefCell<Option<&'static str>>,
    cache: RefCell<HashMap<(usize, u32, u32), String>>,
}

impl CalculationContext<'_> {
    pub fn display(&self, row: u32, col: u32) -> String {
        self.display_at(self.active, row, col)
    }

    fn display_at(&self, sheet: usize, row: u32, col: u32) -> String {
        if let Some(value) = self.cache.borrow().get(&(sheet, row, col)) {
            return value.clone();
        }
        if !self.visiting.borrow_mut().insert((sheet, row, col)) {
            return "#CICLO!".into();
        }
        let previous = self.current.replace(sheet);
        let value = self.sheets[sheet]
            .cells
            .get(&(row, col))
            .map(|content| display_value(content, self))
            .unwrap_or_default();
        self.current.replace(previous);
        self.visiting.borrow_mut().remove(&(sheet, row, col));
        self.cache
            .borrow_mut()
            .insert((sheet, row, col), value.clone());
        value
    }

    fn number_at_index(&self, sheet: usize, row: u32, col: u32) -> Option<f64> {
        match self.sheets[sheet].cells.get(&(row, col)) {
            Some(CellContent::Number(value)) => Some(*value),
            Some(CellContent::Boolean(value)) => Some(u8::from(*value) as f64),
            Some(_) => {
                let displayed = self.display_at(sheet, row, col);
                self.parse_displayed(&displayed)
            }
            None => None,
        }
    }

    fn parse_displayed(&self, displayed: &str) -> Option<f64> {
        if displayed.starts_with('#') {
            *self.error.borrow_mut() = Some(match displayed {
                "#DIV/0!" => "#DIV/0!",
                "#REF!" => "#REF!",
                "#CICLO!" => "#CICLO!",
                "#VALOR!" => "#VALOR!",
                "#NOME?" => "#NOME?",
                _ => "#ERRO!",
            });
            None
        } else {
            displayed.replace(',', ".").parse().ok()
        }
    }
}

impl CellLookup for CalculationContext<'_> {
    fn number_at(&self, row: u32, col: u32) -> Option<f64> {
        let current = *self.current.borrow();
        self.number_at_index(current, row, col)
    }

    fn number_at_sheet(&self, sheet: &str, row: u32, col: u32) -> Option<f64> {
        let Some(index) = self
            .sheets
            .iter()
            .position(|candidate| candidate.name.eq_ignore_ascii_case(sheet))
        else {
            *self.error.borrow_mut() = Some("#REF!");
            return None;
        };
        self.number_at_index(index, row, col)
    }

    fn text_at(&self, row: u32, col: u32) -> Option<String> {
        let current = *self.current.borrow();
        self.sheets[current]
            .cells
            .contains_key(&(row, col))
            .then(|| self.display_at(current, row, col))
    }

    fn text_at_sheet(&self, sheet: &str, row: u32, col: u32) -> Option<String> {
        let index = self
            .sheets
            .iter()
            .position(|candidate| candidate.name.eq_ignore_ascii_case(sheet))?;
        self.sheets[index]
            .cells
            .contains_key(&(row, col))
            .then(|| self.display_at(index, row, col))
    }

    fn take_error(&self) -> Option<&'static str> {
        self.error.borrow_mut().take()
    }
}

fn axis_at(offset: f64, count: u32, position: impl Fn(u32) -> f64) -> u32 {
    let target = offset.max(0.0);
    let mut low = 0;
    let mut high = count;
    while low < high {
        let middle = low + (high - low) / 2;
        if position(middle + 1) <= target {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    low.min(count - 1)
}

fn ranges_overlap(a: &SerializedMerge, b: &SerializedMerge) -> bool {
    a.min_row <= b.max_row
        && a.max_row >= b.min_row
        && a.min_col <= b.max_col
        && a.max_col >= b.min_col
}

fn rewrite_sheet_references(
    sheet: &mut Sheet,
    axis: ReferenceAxis,
    at: u32,
    count: u32,
    insert: bool,
) {
    for content in sheet.cells.values_mut() {
        if let CellContent::Text(raw) = content
            && raw.starts_with('=')
        {
            *raw = rewrite_references(raw, axis, at, count, insert);
        }
    }
}

fn shift_rows<T>(map: &mut HashMap<(u32, u32), T>, at: u32, count: u32, insert: bool) {
    *map = map
        .drain()
        .filter_map(|((row, col), value)| {
            let row = if insert {
                if row >= at {
                    row.checked_add(count)?
                } else {
                    row
                }
            } else {
                delete_index(row, at, count)?
            };
            (row < MAX_ROWS).then_some(((row, col), value))
        })
        .collect();
}

fn shift_cols<T>(map: &mut HashMap<(u32, u32), T>, at: u32, count: u32, insert: bool) {
    *map = map
        .drain()
        .filter_map(|((row, col), value)| {
            let col = if insert {
                if col >= at {
                    col.checked_add(count)?
                } else {
                    col
                }
            } else {
                delete_index(col, at, count)?
            };
            (col < MAX_COLS).then_some(((row, col), value))
        })
        .collect();
}

fn delete_index(index: u32, at: u32, count: u32) -> Option<u32> {
    let end = at.saturating_add(count);
    if index < at {
        Some(index)
    } else if index < end {
        None
    } else {
        Some(index - count)
    }
}

fn delete_span(min: u32, max: u32, at: u32, count: u32) -> Option<(u32, u32)> {
    let first = (min..=max).find_map(|index| delete_index(index, at, count))?;
    let last = (min..=max)
        .rev()
        .find_map(|index| delete_index(index, at, count))?;
    Some((first, last))
}

#[derive(Clone)]
pub struct Workbook {
    pub sheets: Vec<Sheet>,
    pub active: usize,
    undo: Vec<SerializedWorkbook>,
    redo: Vec<SerializedWorkbook>,
}

impl Default for Workbook {
    fn default() -> Self {
        Self::from_serialized(SerializedWorkbook::default())
    }
}

impl Workbook {
    pub fn from_sheet(sheet: Sheet) -> Self {
        Self {
            sheets: vec![sheet],
            active: 0,
            undo: vec![],
            redo: vec![],
        }
    }

    pub fn active(&self) -> &Sheet {
        &self.sheets[self.active]
    }
    pub fn active_mut(&mut self) -> &mut Sheet {
        &mut self.sheets[self.active]
    }
    pub fn calculation(&self) -> CalculationContext<'_> {
        CalculationContext {
            sheets: &self.sheets,
            active: self.active,
            current: RefCell::new(self.active),
            visiting: RefCell::new(HashSet::new()),
            error: RefCell::new(None),
            cache: RefCell::new(HashMap::new()),
        }
    }
    pub fn checkpoint(&mut self) {
        self.undo.push(self.serialize());
        self.redo.clear();
    }
    pub fn undo(&mut self) {
        if let Some(previous) = self.undo.pop() {
            self.redo.push(self.serialize());
            *self = Self::from_serialized_with_history(
                previous,
                std::mem::take(&mut self.undo),
                std::mem::take(&mut self.redo),
            );
        }
    }
    pub fn redo(&mut self) {
        if let Some(next) = self.redo.pop() {
            self.undo.push(self.serialize());
            *self = Self::from_serialized_with_history(
                next,
                std::mem::take(&mut self.undo),
                std::mem::take(&mut self.redo),
            );
        }
    }
    fn from_serialized_with_history(
        doc: SerializedWorkbook,
        undo: Vec<SerializedWorkbook>,
        redo: Vec<SerializedWorkbook>,
    ) -> Self {
        let mut wb = Self::from_serialized(doc);
        wb.undo = undo;
        wb.redo = redo;
        wb
    }
    pub fn add_sheet(&mut self) {
        self.checkpoint();
        let name = format!("Planilha{}", self.sheets.len() + 1);
        self.sheets.push(Sheet {
            name,
            ..Default::default()
        });
        self.active = self.sheets.len() - 1;
    }
    pub fn rename_sheet(&mut self, index: usize, name: &str) -> bool {
        let name = name.trim();
        if name.is_empty()
            || index >= self.sheets.len()
            || self
                .sheets
                .iter()
                .enumerate()
                .any(|(other, sheet)| other != index && sheet.name.eq_ignore_ascii_case(name))
            || self.sheets[index].name == name
        {
            return false;
        }
        self.checkpoint();
        self.sheets[index].name = name.to_owned();
        true
    }
    pub fn remove_sheet(&mut self, index: usize) -> bool {
        if self.sheets.len() <= 1 || index >= self.sheets.len() {
            return false;
        }
        self.checkpoint();
        self.sheets.remove(index);
        if self.active > index {
            self.active -= 1;
        } else if self.active >= self.sheets.len() {
            self.active = self.sheets.len() - 1;
        }
        true
    }
    pub fn insert_rows(&mut self, at: u32, count: u32) {
        if count == 0 || at >= MAX_ROWS {
            return;
        }
        self.checkpoint();
        self.active_mut().insert_rows(at, count);
    }
    pub fn delete_rows(&mut self, at: u32, count: u32) {
        if count == 0 || at >= MAX_ROWS {
            return;
        }
        self.checkpoint();
        self.active_mut().delete_rows(at, count.min(MAX_ROWS - at));
    }
    pub fn insert_cols(&mut self, at: u32, count: u32) {
        if count == 0 || at >= MAX_COLS {
            return;
        }
        self.checkpoint();
        self.active_mut().insert_cols(at, count);
    }
    pub fn delete_cols(&mut self, at: u32, count: u32) {
        if count == 0 || at >= MAX_COLS {
            return;
        }
        self.checkpoint();
        self.active_mut().delete_cols(at, count.min(MAX_COLS - at));
    }
    pub fn merge_range(&mut self, range: SerializedMerge) -> bool {
        if (range.min_row == range.max_row && range.min_col == range.max_col)
            || self
                .active()
                .merges
                .iter()
                .any(|merge| ranges_overlap(merge, &range))
        {
            return false;
        }
        self.checkpoint();
        self.active_mut().merge_range(range)
    }
    pub fn unmerge_at(&mut self, row: u32, col: u32) -> bool {
        if self.active().merge_containing(row, col).is_none() {
            return false;
        }
        self.checkpoint();
        self.active_mut().unmerge_at(row, col)
    }
    pub fn serialize(&self) -> SerializedWorkbook {
        SerializedWorkbook {
            format_version: 1,
            active_sheet_index: self.active,
            sheets: self
                .sheets
                .iter()
                .map(|s| SerializedSheet {
                    name: s.name.clone(),
                    cells: s
                        .cells
                        .iter()
                        .map(|(&(row, col), content)| SerializedCell {
                            row,
                            col,
                            content: content.clone(),
                        })
                        .collect(),
                    styles: s
                        .styles
                        .iter()
                        .map(|(&(row, col), style)| SerializedStyledCell {
                            row,
                            col,
                            style: style.clone(),
                        })
                        .collect(),
                    merges: s.merges.clone(),
                    row_heights: s
                        .row_heights
                        .iter()
                        .map(|(&row, &height)| SerializedRowHeight { row, height })
                        .collect(),
                    col_widths: s
                        .col_widths
                        .iter()
                        .map(|(&col, &width)| SerializedColWidth { col, width })
                        .collect(),
                })
                .collect(),
        }
    }
    pub fn from_serialized(doc: SerializedWorkbook) -> Self {
        let sheets = doc
            .sheets
            .into_iter()
            .map(|s| Sheet {
                name: s.name,
                cells: s
                    .cells
                    .into_iter()
                    .map(|c| ((c.row, c.col), c.content))
                    .collect(),
                styles: s
                    .styles
                    .into_iter()
                    .map(|c| ((c.row, c.col), c.style))
                    .collect(),
                row_heights: s
                    .row_heights
                    .into_iter()
                    .map(|v| (v.row, v.height))
                    .collect(),
                col_widths: s.col_widths.into_iter().map(|v| (v.col, v.width)).collect(),
                merges: s.merges,
            })
            .collect::<Vec<_>>();
        let active = doc.active_sheet_index.min(sheets.len().saturating_sub(1));
        Self {
            sheets: if sheets.is_empty() {
                vec![Sheet {
                    name: "Planilha1".into(),
                    ..Default::default()
                }]
            } else {
                sheets
            },
            active,
            undo: vec![],
            redo: vec![],
        }
    }
}
