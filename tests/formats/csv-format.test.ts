import { describe, expect, it } from 'vitest'
import {
  csvTextToSheet,
  decodeCsvBytes,
  parseDelimited,
  stringifyDelimited
} from '../../src/renderer/formats/csv-format'

describe('csv-format', () => {
  describe('parseDelimited', () => {
    it('splits plain rows on the given delimiter', () => {
      expect(parseDelimited('a;b;c\n1;2;3', ';')).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3']
      ])
    })

    it('supports comma and tab delimiters too', () => {
      expect(parseDelimited('a,b\n1,2', ',')).toEqual([
        ['a', 'b'],
        ['1', '2']
      ])
      expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
        ['a', 'b'],
        ['1', '2']
      ])
    })

    it('keeps a quoted field with an embedded delimiter intact', () => {
      expect(parseDelimited('"Smith, John";42', ';')).toEqual([['Smith, John', '42']])
    })

    it('keeps a quoted field with an embedded newline intact', () => {
      expect(parseDelimited('"linha 1\nlinha 2";x', ';')).toEqual([['linha 1\nlinha 2', 'x']])
    })

    it('unescapes a doubled quote inside a quoted field', () => {
      expect(parseDelimited('"ele disse ""oi""";x', ';')).toEqual([['ele disse "oi"', 'x']])
    })

    it('normalizes CRLF and bare CR line endings', () => {
      expect(parseDelimited('a;b\r\n1;2', ';')).toEqual([
        ['a', 'b'],
        ['1', '2']
      ])
    })

    it('handles a file with no trailing newline', () => {
      expect(parseDelimited('a;b', ';')).toEqual([['a', 'b']])
    })
  })

  describe('stringifyDelimited', () => {
    it('joins rows with the delimiter and newlines', () => {
      expect(
        stringifyDelimited(
          [
            ['a', 'b'],
            [1, 2]
          ],
          ';'
        )
      ).toBe('a;b\n1;2')
    })

    it('quotes a field containing the delimiter, a quote, or a newline', () => {
      expect(stringifyDelimited([['a;b']], ';')).toBe('"a;b"')
      expect(stringifyDelimited([['say "hi"']], ';')).toBe('"say ""hi"""')
      expect(stringifyDelimited([['line1\nline2']], ';')).toBe('"line1\nline2"')
    })

    it('round-trips through parseDelimited', () => {
      const original = [
        ['Smith, John', '1,5'],
        ['plain', '"quoted"']
      ]
      const text = stringifyDelimited(original, ';')
      expect(parseDelimited(text, ';')).toEqual(original.map((row) => row.map(String)))
    })
  })

  describe('csvTextToSheet', () => {
    it('coerces numbers and booleans, treating empty cells as absent', () => {
      const sheet = csvTextToSheet('nome;idade;ativo\nAna;30;true\n;;', ';', 'Sheet1')
      expect(sheet.name).toBe('Sheet1')
      expect(sheet.cells).toEqual(
        expect.arrayContaining([
          { row: 0, col: 0, content: 'nome' },
          { row: 0, col: 1, content: 'idade' },
          { row: 0, col: 2, content: 'ativo' },
          { row: 1, col: 0, content: 'Ana' },
          { row: 1, col: 1, content: 30 },
          { row: 1, col: 2, content: true }
        ])
      )
      // The fully-empty row contributes no cells at all.
      expect(sheet.cells).toHaveLength(6)
    })

    it('treats `,` as a decimal separator when the delimiter is `;` (pt-BR convention)', () => {
      const sheet = csvTextToSheet('preço\n1,5', ';', 'Sheet1')
      expect(sheet.cells).toEqual(expect.arrayContaining([{ row: 1, col: 0, content: 1.5 }]))
    })

    it('treats `.` as the decimal separator when the delimiter is `,`', () => {
      const sheet = csvTextToSheet('price\n1.5', ',', 'Sheet1')
      expect(sheet.cells).toEqual(expect.arrayContaining([{ row: 1, col: 0, content: 1.5 }]))
    })

    it('does not corrupt a non-numeric string containing a comma', () => {
      const sheet = csvTextToSheet('"Smith, John"', ';', 'Sheet1')
      expect(sheet.cells).toEqual([{ row: 0, col: 0, content: 'Smith, John' }])
    })

    it('recognizes pt-BR verdadeiro/falso alongside true/false', () => {
      const sheet = csvTextToSheet('verdadeiro;falso', ';', 'Sheet1')
      expect(sheet.cells).toEqual(
        expect.arrayContaining([
          { row: 0, col: 0, content: true },
          { row: 0, col: 1, content: false }
        ])
      )
    })
  })

  describe('decodeCsvBytes', () => {
    it('decodes UTF-8 bytes', () => {
      const bytes = new TextEncoder().encode('café')
      expect(decodeCsvBytes(bytes, 'utf-8')).toBe('café')
    })

    it('decodes windows-1252 bytes (e.g. "é" as single byte 0xE9)', () => {
      const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]) // "caf" + é (0xE9 in cp1252/latin1)
      expect(decodeCsvBytes(bytes, 'windows-1252')).toBe('café')
    })
  })
})
