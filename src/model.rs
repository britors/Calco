use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellStyle {
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h_align: Option<HorizontalAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v_align: Option<VerticalAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub borders: Option<CellBorders>,
}

const fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HorizontalAlign {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerticalAlign {
    Top,
    Middle,
    Bottom,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BorderStyle {
    pub color: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CellBorders {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderStyle>,
}

impl CellBorders {
    pub fn all(color: impl Into<String>) -> Self {
        let border = BorderStyle {
            color: color.into(),
        };
        Self {
            top: Some(border.clone()),
            right: Some(border.clone()),
            bottom: Some(border.clone()),
            left: Some(border),
        }
    }

    pub fn is_full(&self) -> bool {
        self.top.is_some() && self.right.is_some() && self.bottom.is_some() && self.left.is_some()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CellContent {
    Text(String),
    Number(f64),
    Boolean(bool),
}

impl CellContent {
    pub fn raw(&self) -> String {
        match self {
            Self::Text(value) => value.clone(),
            Self::Number(value) => format_number(*value),
            Self::Boolean(value) => if *value { "VERDADEIRO" } else { "FALSO" }.into(),
        }
    }
}

pub fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string().replace('.', ",")
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SerializedCell {
    pub row: u32,
    pub col: u32,
    pub content: CellContent,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SerializedStyledCell {
    pub row: u32,
    pub col: u32,
    pub style: CellStyle,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedMerge {
    pub min_row: u32,
    pub min_col: u32,
    pub max_row: u32,
    pub max_col: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SerializedRowHeight {
    pub row: u32,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SerializedColWidth {
    pub col: u32,
    pub width: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedSheet {
    pub name: String,
    #[serde(default)]
    pub cells: Vec<SerializedCell>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub styles: Vec<SerializedStyledCell>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merges: Vec<SerializedMerge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_heights: Vec<SerializedRowHeight>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub col_widths: Vec<SerializedColWidth>,
}

impl SerializedSheet {
    pub fn empty(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            cells: vec![],
            styles: vec![],
            merges: vec![],
            row_heights: vec![],
            col_widths: vec![],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedWorkbook {
    pub format_version: u8,
    pub sheets: Vec<SerializedSheet>,
    pub active_sheet_index: usize,
}

impl Default for SerializedWorkbook {
    fn default() -> Self {
        Self {
            format_version: 1,
            sheets: vec![SerializedSheet::empty("Planilha1")],
            active_sheet_index: 0,
        }
    }
}
