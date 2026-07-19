use crate::model::{CellContent, format_number};

pub trait CellLookup {
    fn number_at(&self, row: u32, col: u32) -> Option<f64>;
    fn text_at(&self, row: u32, col: u32) -> Option<String> {
        self.number_at(row, col).map(format_number)
    }
    fn number_at_sheet(&self, _sheet: &str, _row: u32, _col: u32) -> Option<f64> {
        None
    }
    fn text_at_sheet(&self, sheet: &str, row: u32, col: u32) -> Option<String> {
        self.number_at_sheet(sheet, row, col).map(format_number)
    }
    fn take_error(&self) -> Option<&'static str> {
        None
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReferenceAxis {
    Row,
    Col,
}

/// Rewrites A1 references after a structural sheet edit. Absolute markers
/// affect copy/paste, but structural edits move absolute references too.
pub fn rewrite_references(
    formula: &str,
    axis: ReferenceAxis,
    at: u32,
    count: u32,
    insert: bool,
) -> String {
    if !formula.starts_with('=') || count == 0 {
        return formula.to_owned();
    }
    let bytes = formula.as_bytes();
    let mut output = String::with_capacity(formula.len());
    let mut cursor = 0;
    while cursor < bytes.len() {
        if !bytes[cursor].is_ascii() {
            let ch = formula[cursor..].chars().next().expect("valid UTF-8");
            output.push(ch);
            cursor += ch.len_utf8();
            continue;
        }
        let start = cursor;
        let mut pos = cursor;
        let col_absolute = bytes.get(pos) == Some(&b'$');
        if col_absolute {
            pos += 1;
        }
        let letters_start = pos;
        while bytes.get(pos).is_some_and(u8::is_ascii_alphabetic) {
            pos += 1;
        }
        if pos == letters_start {
            output.push(bytes[cursor] as char);
            cursor += 1;
            continue;
        }
        let row_absolute = bytes.get(pos) == Some(&b'$');
        if row_absolute {
            pos += 1;
        }
        let digits_start = pos;
        while bytes.get(pos).is_some_and(u8::is_ascii_digit) {
            pos += 1;
        }
        let previous_is_identifier = start > 0 && bytes[start - 1].is_ascii_alphanumeric();
        let next_is_identifier = bytes
            .get(pos)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_');
        if pos == digits_start || previous_is_identifier || next_is_identifier {
            output.push(bytes[cursor] as char);
            cursor += 1;
            continue;
        }
        let address = format!(
            "{}{}",
            &formula[letters_start..if row_absolute {
                digits_start - 1
            } else {
                digits_start
            }],
            &formula[digits_start..pos]
        );
        let Some((mut row, mut col)) = parse_a1(&address) else {
            output.push_str(&formula[start..pos]);
            cursor = pos;
            continue;
        };
        let target = match axis {
            ReferenceAxis::Row => &mut row,
            ReferenceAxis::Col => &mut col,
        };
        let shifted = if insert {
            if *target >= at {
                target.checked_add(count)
            } else {
                Some(*target)
            }
        } else {
            let end = at.saturating_add(count);
            if *target < at {
                Some(*target)
            } else if *target < end {
                None
            } else {
                Some(*target - count)
            }
        };
        if let Some(shifted) = shifted {
            *target = shifted;
            output.push_str(if col_absolute { "$" } else { "" });
            output.push_str(&column_label(col));
            output.push_str(if row_absolute { "$" } else { "" });
            output.push_str(&(row + 1).to_string());
        } else {
            output.push_str("#REF!");
        }
        cursor = pos;
    }
    output
}

/// Moves relative A1 references when a copied formula is pasted elsewhere.
pub fn translate_references(formula: &str, row_delta: i64, col_delta: i64) -> String {
    if !formula.starts_with('=') || (row_delta == 0 && col_delta == 0) {
        return formula.to_owned();
    }
    let bytes = formula.as_bytes();
    let mut output = String::with_capacity(formula.len());
    let mut cursor = 0;
    let mut quoted = false;
    while cursor < bytes.len() {
        if bytes[cursor] == b'"' {
            quoted = !quoted;
            output.push('"');
            cursor += 1;
            continue;
        }
        if quoted || (!bytes[cursor].is_ascii_alphabetic() && bytes[cursor] != b'$') {
            let ch = formula[cursor..].chars().next().expect("valid UTF-8");
            output.push(ch);
            cursor += ch.len_utf8();
            continue;
        }
        let start = cursor;
        let col_absolute = bytes[cursor] == b'$';
        cursor += usize::from(col_absolute);
        let letters_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_alphabetic) {
            cursor += 1;
        }
        let letters_end = cursor;
        let row_absolute = bytes.get(cursor) == Some(&b'$');
        cursor += usize::from(row_absolute);
        let digits_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        let valid_boundary = (start == 0 || !bytes[start - 1].is_ascii_alphanumeric())
            && !bytes
                .get(cursor)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_');
        if letters_start == letters_end || digits_start == cursor || !valid_boundary {
            output.push_str(&formula[start..cursor.max(start + 1)]);
            continue;
        }
        let address = format!(
            "{}{}",
            &formula[letters_start..letters_end],
            &formula[digits_start..cursor]
        );
        let Some((row, col)) = parse_a1(&address) else {
            output.push_str(&formula[start..cursor]);
            continue;
        };
        let shifted_row = if row_absolute {
            Some(row as i64)
        } else {
            (row as i64)
                .checked_add(row_delta)
                .filter(|value| *value >= 0)
        };
        let shifted_col = if col_absolute {
            Some(col as i64)
        } else {
            (col as i64)
                .checked_add(col_delta)
                .filter(|value| *value >= 0)
        };
        if let (Some(row), Some(col)) = (shifted_row, shifted_col) {
            output.push_str(if col_absolute { "$" } else { "" });
            output.push_str(&column_label(col as u32));
            output.push_str(if row_absolute { "$" } else { "" });
            output.push_str(&(row + 1).to_string());
        } else {
            output.push_str("#REF!");
        }
    }
    output
}

pub fn column_label(mut col: u32) -> String {
    let mut label = String::new();
    loop {
        label.insert(0, (b'A' + (col % 26) as u8) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    label
}

pub fn parse_a1(text: &str) -> Option<(u32, u32)> {
    let split = text.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = text.split_at(split);
    if letters.is_empty() || digits.is_empty() || !letters.chars().all(|c| c.is_ascii_alphabetic())
    {
        return None;
    }
    let mut col = 0_u32;
    for c in letters.bytes() {
        col = col
            .checked_mul(26)?
            .checked_add((c.to_ascii_uppercase() - b'A' + 1) as u32)?;
    }
    let row = digits.parse::<u32>().ok()?;
    if row == 0 {
        None
    } else {
        Some((row - 1, col - 1))
    }
}

pub fn display_value(content: &CellContent, lookup: &impl CellLookup) -> String {
    let CellContent::Text(text) = content else {
        return content.raw();
    };
    if !text.starts_with('=') {
        return text.clone();
    }
    match evaluate_textual(&text[1..], lookup) {
        Some(Ok(value)) => value,
        Some(Err(error)) => error.into(),
        None => match evaluate(&text[1..], lookup) {
            Ok(value) => format_number(value),
            Err(error) => error.into(),
        },
    }
}

fn evaluate_textual(expr: &str, lookup: &impl CellLookup) -> Option<Result<String, &'static str>> {
    let expr = expr.trim();
    if let Some(text) = string_literal(expr) {
        return Some(Ok(text));
    }
    if let Some(parts) = split_top_level(expr, '&') {
        let mut output = String::new();
        for part in parts {
            match evaluate_textual(part, lookup) {
                Some(Ok(value)) => output.push_str(&value),
                Some(Err(error)) => return Some(Err(error)),
                None => match evaluate(part, lookup) {
                    Ok(value) => output.push_str(&format_number(value)),
                    Err(error) => return Some(Err(error)),
                },
            }
        }
        return Some(Ok(output));
    }
    let canonical = normalize_function_names(&canonicalize_expression(expr));
    if let Some(arguments) = function_arguments(&canonical, "IF") {
        let arguments = split_arguments(arguments)?;
        if arguments.len() != 3 {
            return Some(Err("#ERRO!"));
        }
        let condition = evaluate_condition(arguments[0], lookup);
        return Some(match condition {
            Ok(true) => evaluate_branch(arguments[1], lookup),
            Ok(false) => evaluate_branch(arguments[2], lookup),
            Err(error) => Err(error),
        });
    }
    if let Some(arguments) = function_arguments(&canonical, "DATE") {
        let values = split_arguments(arguments)?;
        if values.len() == 3 {
            let year = evaluate(values[0], lookup).ok()? as i32;
            let month = evaluate(values[1], lookup).ok()? as u32;
            let day = evaluate(values[2], lookup).ok()? as u32;
            return Some(if (1..=12).contains(&month) && (1..=31).contains(&day) {
                Ok(format!("{year:04}-{month:02}-{day:02}"))
            } else {
                Err("#VALOR!")
            });
        }
    }
    if let Some(arguments) = function_arguments(&canonical, "VLOOKUP") {
        let arguments = split_arguments(arguments)?;
        if arguments.len() >= 3 {
            let needle = scalar_text(arguments[0], lookup).ok()?;
            let (start, end) = arguments[1].split_once(':')?;
            let (start_row, start_col) = parse_a1(&start.replace('$', ""))?;
            let (end_row, end_col) = parse_a1(&end.replace('$', ""))?;
            let result_col = evaluate(arguments[2], lookup).ok()? as u32;
            if result_col == 0 || start_col + result_col - 1 > end_col {
                return Some(Err("#REF!"));
            }
            for row in start_row.min(end_row)..=start_row.max(end_row) {
                if lookup.text_at(row, start_col).as_deref() == Some(&needle) {
                    return Some(
                        lookup
                            .text_at(row, start_col + result_col - 1)
                            .ok_or("#N/D"),
                    );
                }
            }
            return Some(Err("#N/D"));
        }
    }
    for (name, index) in [("YEAR", 0), ("MONTH", 1), ("DAY", 2)] {
        if let Some(argument) = function_arguments(&canonical, name) {
            let value = scalar_text(argument, lookup).ok()?;
            let parts = value.split('-').collect::<Vec<_>>();
            return Some(if parts.len() == 3 {
                parts[index]
                    .parse::<u32>()
                    .map(|value| value.to_string())
                    .map_err(|_| "#VALOR!")
            } else {
                Err("#VALOR!")
            });
        }
    }
    for name in ["UPPER", "LOWER", "TRIM", "LEN", "LEFT", "RIGHT"] {
        if let Some(arguments) = function_arguments(&canonical, name) {
            let arguments = split_arguments(arguments)?;
            let value = scalar_text(arguments[0], lookup).ok()?;
            let count = arguments
                .get(1)
                .and_then(|argument| evaluate(argument, lookup).ok())
                .map(|value| value.max(0.0) as usize)
                .unwrap_or(1);
            let result = match name {
                "UPPER" => value.to_uppercase(),
                "LOWER" => value.to_lowercase(),
                "TRIM" => value.split_whitespace().collect::<Vec<_>>().join(" "),
                "LEN" => value.chars().count().to_string(),
                "LEFT" => value.chars().take(count).collect(),
                "RIGHT" => value
                    .chars()
                    .rev()
                    .take(count)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect(),
                _ => unreachable!(),
            };
            return Some(Ok(result));
        }
    }
    if let Some(value) = reference_text(expr, lookup) {
        return Some(Ok(value));
    }
    None
}

fn evaluate_branch(expr: &str, lookup: &impl CellLookup) -> Result<String, &'static str> {
    evaluate_textual(expr, lookup).unwrap_or_else(|| evaluate(expr, lookup).map(format_number))
}

fn evaluate_condition(expr: &str, lookup: &impl CellLookup) -> Result<bool, &'static str> {
    for operator in ["<=", ">=", "<>", "=", "<", ">"] {
        if let Some((left, right)) = split_operator(expr, operator) {
            let left = scalar_text(left, lookup)?;
            let right = scalar_text(right, lookup)?;
            return Ok(match operator {
                "=" => left == right,
                "<>" => left != right,
                "<" => left < right,
                ">" => left > right,
                "<=" => left <= right,
                ">=" => left >= right,
                _ => false,
            });
        }
    }
    evaluate(expr, lookup).map(|value| value != 0.0)
}

fn scalar_text(expr: &str, lookup: &impl CellLookup) -> Result<String, &'static str> {
    if let Some(text) = string_literal(expr.trim()) {
        Ok(text)
    } else if let Some(text) = reference_text(expr.trim(), lookup) {
        Ok(text)
    } else if let Some(value) = evaluate_textual(expr, lookup) {
        value
    } else {
        evaluate(expr, lookup).map(format_number)
    }
}

fn reference_text(expr: &str, lookup: &impl CellLookup) -> Option<String> {
    let (sheet, address) = expr
        .rsplit_once('!')
        .map_or((None, expr), |(sheet, address)| {
            (Some(sheet.trim_matches('\'').replace("''", "'")), address)
        });
    let (row, col) = parse_a1(&address.replace('$', ""))?;
    match sheet {
        Some(sheet) => lookup.text_at_sheet(&sheet, row, col),
        None => lookup.text_at(row, col),
    }
}

fn string_literal(expr: &str) -> Option<String> {
    let inner = expr.strip_prefix('"')?.strip_suffix('"')?;
    Some(inner.replace("\"\"", "\""))
}

fn function_arguments<'a>(expr: &'a str, name: &str) -> Option<&'a str> {
    expr.strip_prefix(name)?
        .strip_prefix('(')?
        .strip_suffix(')')
}

fn split_arguments(expr: &str) -> Option<Vec<&str>> {
    split_top_level(expr, ',').or_else(|| Some(vec![expr]))
}

fn split_top_level(expr: &str, separator: char) -> Option<Vec<&str>> {
    let mut quoted = false;
    let mut depth = 0_u32;
    let mut start = 0;
    let mut parts = Vec::new();
    for (index, ch) in expr.char_indices() {
        match ch {
            '"' => quoted = !quoted,
            '(' if !quoted => depth += 1,
            ')' if !quoted => depth = depth.saturating_sub(1),
            _ if !quoted && depth == 0 && ch == separator => {
                parts.push(expr[start..index].trim());
                start = index + ch.len_utf8();
            }
            _ => {}
        }
    }
    if parts.is_empty() {
        None
    } else {
        parts.push(expr[start..].trim());
        Some(parts)
    }
}

fn split_operator<'a>(expr: &'a str, operator: &str) -> Option<(&'a str, &'a str)> {
    let mut quoted = false;
    let mut depth = 0_u32;
    for (index, ch) in expr.char_indices() {
        match ch {
            '"' => quoted = !quoted,
            '(' if !quoted => depth += 1,
            ')' if !quoted => depth = depth.saturating_sub(1),
            _ => {}
        }
        if !quoted && depth == 0 && expr[index..].starts_with(operator) {
            return Some((expr[..index].trim(), expr[index + operator.len()..].trim()));
        }
    }
    None
}

fn evaluate(expr: &str, lookup: &impl CellLookup) -> Result<f64, &'static str> {
    if expr.contains("#REF!") {
        return Err("#REF!");
    }
    let canonical = normalize_function_names(&canonicalize_expression(expr.trim()));
    let mut parser = Parser {
        chars: canonical.as_bytes(),
        pos: 0,
        lookup,
    };
    let value = parser.comparison()?;
    parser.skip_spaces();
    if parser.pos == parser.chars.len() {
        Ok(value)
    } else {
        Err("#ERRO!")
    }
}

pub fn canonicalize_formula(formula: &str) -> String {
    formula
        .strip_prefix('=')
        .map(|expr| format!("={}", canonicalize_expression(expr)))
        .unwrap_or_else(|| formula.to_owned())
}

fn canonicalize_expression(expr: &str) -> String {
    let decimal_comma = expr.contains(';') || !expr.contains('(');
    let chars = expr.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(expr.len());
    let mut quoted = false;
    for (index, ch) in chars.iter().copied().enumerate() {
        if ch == '"' {
            quoted = !quoted;
            output.push(ch);
        } else if !quoted && ch == ';' {
            output.push(',');
        } else if !quoted
            && decimal_comma
            && ch == ','
            && index > 0
            && chars[index - 1].is_ascii_digit()
            && chars.get(index + 1).is_some_and(char::is_ascii_digit)
        {
            output.push('.');
        } else {
            output.push(ch);
        }
    }
    output
}

fn normalize_function_names(expr: &str) -> String {
    let mut output = String::with_capacity(expr.len());
    let mut identifier = String::new();
    let mut quoted = false;
    let flush = |identifier: &mut String, output: &mut String| {
        if identifier.is_empty() {
            return;
        }
        let upper = identifier.to_uppercase();
        output.push_str(match upper.as_str() {
            "SOMA" => "SUM",
            "MÉDIA" | "MEDIA" => "AVERAGE",
            "CONTAGEM" => "COUNT",
            "SE" => "IF",
            "ARRED" => "ROUND",
            "RAIZ" => "SQRT",
            "DATA" => "DATE",
            "ANO" => "YEAR",
            "MÊS" | "MES" => "MONTH",
            "DIA" => "DAY",
            "MAIÚSCULA" | "MAIUSCULA" => "UPPER",
            "MINÚSCULA" | "MINUSCULA" => "LOWER",
            "ARRUMAR" => "TRIM",
            "NÚM.CARACT" | "NUM.CARACT" => "LEN",
            "ESQUERDA" => "LEFT",
            "DIREITA" => "RIGHT",
            "PROCV" => "VLOOKUP",
            _ => identifier,
        });
        identifier.clear();
    };
    for ch in expr.chars() {
        if ch == '"' {
            flush(&mut identifier, &mut output);
            quoted = !quoted;
            output.push(ch);
        } else if !quoted && (ch.is_alphabetic() || ch == '_') {
            identifier.push(ch);
        } else {
            flush(&mut identifier, &mut output);
            output.push(ch);
        }
    }
    flush(&mut identifier, &mut output);
    output
}

struct Parser<'a, T> {
    chars: &'a [u8],
    pos: usize,
    lookup: &'a T,
}
impl<T: CellLookup> Parser<'_, T> {
    fn skip_spaces(&mut self) {
        while self.chars.get(self.pos) == Some(&b' ') {
            self.pos += 1;
        }
    }
    fn comparison(&mut self) -> Result<f64, &'static str> {
        let left = self.expression()?;
        self.skip_spaces();
        let operator = ["<=", ">=", "<>", "=", "<", ">"]
            .into_iter()
            .find(|operator| self.chars[self.pos..].starts_with(operator.as_bytes()));
        let Some(operator) = operator else {
            return Ok(left);
        };
        self.pos += operator.len();
        let right = self.expression()?;
        Ok(f64::from(match operator {
            "=" => left == right,
            "<>" => left != right,
            "<" => left < right,
            ">" => left > right,
            "<=" => left <= right,
            ">=" => left >= right,
            _ => false,
        }))
    }
    fn expression(&mut self) -> Result<f64, &'static str> {
        let mut v = self.term()?;
        loop {
            self.skip_spaces();
            match self.chars.get(self.pos) {
                Some(b'+') => {
                    self.pos += 1;
                    v += self.term()?
                }
                Some(b'-') => {
                    self.pos += 1;
                    v -= self.term()?
                }
                _ => return Ok(v),
            }
        }
    }
    fn term(&mut self) -> Result<f64, &'static str> {
        let mut v = self.factor()?;
        loop {
            self.skip_spaces();
            match self.chars.get(self.pos) {
                Some(b'*') => {
                    self.pos += 1;
                    v *= self.factor()?
                }
                Some(b'/') => {
                    self.pos += 1;
                    let d = self.factor()?;
                    if d == 0.0 {
                        return Err("#DIV/0!");
                    }
                    v /= d
                }
                _ => return Ok(v),
            }
        }
    }
    fn factor(&mut self) -> Result<f64, &'static str> {
        self.skip_spaces();
        if self.chars.get(self.pos) == Some(&b'+') {
            self.pos += 1;
            return self.factor();
        }
        if self.chars.get(self.pos) == Some(&b'-') {
            self.pos += 1;
            return Ok(-self.factor()?);
        }
        if self.chars.get(self.pos) == Some(&b'(') {
            self.pos += 1;
            let v = self.comparison()?;
            self.skip_spaces();
            if self.chars.get(self.pos) != Some(&b')') {
                return Err("#ERRO!");
            }
            self.pos += 1;
            return Ok(v);
        }
        let start = self.pos;
        if let Some((sheet, row, col)) = self.qualified_cell_reference() {
            let value = match sheet {
                Some(sheet) => self.lookup.number_at_sheet(&sheet, row, col),
                None => self.lookup.number_at(row, col),
            };
            if let Some(error) = self.lookup.take_error() {
                return Err(error);
            }
            return Ok(value.unwrap_or(0.0));
        }
        self.pos = start;
        if self.chars.get(self.pos) == Some(&b'$') {
            self.pos += 1;
        }
        while self
            .chars
            .get(self.pos)
            .is_some_and(|c| c.is_ascii_alphabetic())
        {
            self.pos += 1;
        }
        let identifier_end = self.pos;
        if self.chars.get(self.pos) == Some(&b'$') {
            self.pos += 1;
        }
        while self.chars.get(self.pos).is_some_and(u8::is_ascii_digit) {
            self.pos += 1;
        }
        let token = std::str::from_utf8(&self.chars[start..self.pos]).map_err(|_| "#ERRO!")?;
        self.skip_spaces();
        if self.chars.get(self.pos) == Some(&b'(') && identifier_end > start {
            let name = std::str::from_utf8(&self.chars[start..identifier_end])
                .map_err(|_| "#ERRO!")?
                .to_uppercase();
            return self.function(&name);
        }
        let address = token.replace('$', "");
        if let Some((r, c)) = parse_a1(&address) {
            let value = self.lookup.number_at(r, c);
            if let Some(error) = self.lookup.take_error() {
                return Err(error);
            }
            return Ok(value.unwrap_or(0.0));
        }
        self.pos = start;
        while self
            .chars
            .get(self.pos)
            .is_some_and(|c| c.is_ascii_digit() || *c == b'.')
        {
            self.pos += 1;
        }
        let number = std::str::from_utf8(&self.chars[start..self.pos]).map_err(|_| "#ERRO!")?;
        number.parse().map_err(|_| "#VALOR!")
    }

    fn function(&mut self, name: &str) -> Result<f64, &'static str> {
        self.pos += 1;
        let mut values = Vec::new();
        loop {
            self.skip_spaces();
            if self.chars.get(self.pos) == Some(&b')') {
                self.pos += 1;
                break;
            }
            let saved = self.pos;
            if let Some(first) = self.qualified_cell_reference() {
                self.skip_spaces();
                if self.chars.get(self.pos) == Some(&b':') {
                    self.pos += 1;
                    let second = self.qualified_cell_reference().ok_or("#REF!")?;
                    let sheet = second.0.as_ref().or(first.0.as_ref());
                    if first.0.is_some() && second.0.is_some() && first.0 != second.0 {
                        return Err("#REF!");
                    }
                    for row in first.1.min(second.1)..=first.1.max(second.1) {
                        for col in first.2.min(second.2)..=first.2.max(second.2) {
                            let value = sheet
                                .map(|name| self.lookup.number_at_sheet(name, row, col))
                                .unwrap_or_else(|| self.lookup.number_at(row, col));
                            if let Some(error) = self.lookup.take_error() {
                                return Err(error);
                            }
                            if let Some(value) = value {
                                values.push(value);
                            }
                        }
                    }
                } else {
                    self.pos = saved;
                    values.push(self.comparison()?);
                }
            } else {
                self.pos = saved;
                values.push(self.comparison()?);
            }
            self.skip_spaces();
            match self.chars.get(self.pos) {
                Some(b',') => self.pos += 1,
                Some(b')') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("#ERRO!"),
            }
        }
        match name {
            "SUM" => Ok(values.iter().sum()),
            "AVERAGE" => (!values.is_empty())
                .then(|| values.iter().sum::<f64>() / values.len() as f64)
                .ok_or("#DIV/0!"),
            "MIN" => values.into_iter().reduce(f64::min).ok_or("#VALOR!"),
            "MAX" => values.into_iter().reduce(f64::max).ok_or("#VALOR!"),
            "COUNT" => Ok(values.len() as f64),
            "ABS" if values.len() == 1 => Ok(values[0].abs()),
            "SQRT" if values.len() == 1 && values[0] >= 0.0 => Ok(values[0].sqrt()),
            "POWER" if values.len() == 2 => Ok(values[0].powf(values[1])),
            "ROUND" if values.len() == 2 => {
                let factor = 10_f64.powf(values[1]);
                Ok((values[0] * factor).round() / factor)
            }
            "IF" if values.len() == 3 => Ok(if values[0] != 0.0 {
                values[1]
            } else {
                values[2]
            }),
            _ => Err("#NOME?"),
        }
    }

    fn cell_reference(&mut self) -> Option<(u32, u32)> {
        self.skip_spaces();
        let start = self.pos;
        if self.chars.get(self.pos) == Some(&b'$') {
            self.pos += 1;
        }
        let letters = self.pos;
        while self
            .chars
            .get(self.pos)
            .is_some_and(u8::is_ascii_alphabetic)
        {
            self.pos += 1;
        }
        if self.pos == letters {
            self.pos = start;
            return None;
        }
        if self.chars.get(self.pos) == Some(&b'$') {
            self.pos += 1;
        }
        let digits = self.pos;
        while self.chars.get(self.pos).is_some_and(u8::is_ascii_digit) {
            self.pos += 1;
        }
        if self.pos == digits {
            self.pos = start;
            return None;
        }
        let token = std::str::from_utf8(&self.chars[start..self.pos]).ok()?;
        parse_a1(&token.replace('$', ""))
    }

    fn qualified_cell_reference(&mut self) -> Option<(Option<String>, u32, u32)> {
        self.skip_spaces();
        let start = self.pos;
        let sheet =
            if self.chars.get(self.pos) == Some(&b'\'') {
                self.pos += 1;
                let mut name = Vec::new();
                loop {
                    let byte = *self.chars.get(self.pos)?;
                    if byte == b'\'' {
                        if self.chars.get(self.pos + 1) == Some(&b'\'') {
                            name.push(b'\'');
                            self.pos += 2;
                        } else {
                            self.pos += 1;
                            break;
                        }
                    } else {
                        name.push(byte);
                        self.pos += 1;
                    }
                }
                if self.chars.get(self.pos) != Some(&b'!') {
                    self.pos = start;
                    return None;
                }
                self.pos += 1;
                Some(String::from_utf8(name).ok()?)
            } else {
                let name_start = self.pos;
                while self.chars.get(self.pos).is_some_and(|byte| {
                    byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'.'
                }) {
                    self.pos += 1;
                }
                if self.pos > name_start && self.chars.get(self.pos) == Some(&b'!') {
                    let name = std::str::from_utf8(&self.chars[name_start..self.pos])
                        .ok()?
                        .to_owned();
                    self.pos += 1;
                    Some(name)
                } else {
                    self.pos = name_start;
                    None
                }
            };
        let Some((row, col)) = self.cell_reference() else {
            self.pos = start;
            return None;
        };
        Some((sheet, row, col))
    }
}
