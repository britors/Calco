import { HyperFormula } from 'hyperformula'
import ptPT from 'hyperformula/i18n/languages/ptPT'

// pt-PT and pt-BR share the same spreadsheet function names (SOMA, SE, PROCV...);
// HyperFormula ships no dedicated pt-BR pack, so the pt-PT one is registered under
// the 'ptBR' code the rest of the app uses.
export const LOCALE_CODE = 'ptBR'

let registered = false
export function ensureLocaleRegistered(): void {
  if (registered) return
  if (!HyperFormula.getRegisteredLanguagesCodes().includes(LOCALE_CODE)) {
    HyperFormula.registerLanguage(LOCALE_CODE, ptPT)
  }
  registered = true
}

const PT_TO_EN = new Map<string, string>()
const EN_TO_PT = new Map<string, string>()
for (const [enId, ptName] of Object.entries(ptPT.functions)) {
  if (!ptName) continue
  EN_TO_PT.set(enId.toUpperCase(), ptName)
  PT_TO_EN.set(ptName.toUpperCase(), enId)
}

const IDENT_START = /[A-Za-zÀ-ÖØ-öø-ÿ_]/
const IDENT_PART = /[A-Za-zÀ-ÖØ-öø-ÿ0-9_.]/
const DIGIT = /[0-9]/

interface TranslateOptions {
  funcMap: Map<string, string>
  argSeparatorFrom: string
  argSeparatorTo: string
  decimalFrom: string
  decimalTo: string
}

/**
 * Single left-to-right scan that swaps function names, the argument
 * separator and the decimal separator in one pass, skipping the contents of
 * double-quoted string literals along the way. Only formula strings (leading
 * '=') carry pt-BR/canonical syntax differences -- everything else is
 * returned untouched.
 */
function translateFormula(formula: string, opts: TranslateOptions): string {
  if (!formula.startsWith('=')) return formula

  let result = ''
  let inString = false
  let i = 0
  while (i < formula.length) {
    const ch = formula[i]

    if (ch === '"') {
      inString = !inString
      result += ch
      i++
      continue
    }
    if (inString) {
      result += ch
      i++
      continue
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1
      while (j < formula.length && IDENT_PART.test(formula[j])) j++
      const ident = formula.slice(i, j)
      let k = j
      while (k < formula.length && formula[k] === ' ') k++
      const isFunctionCall = formula[k] === '('
      result += isFunctionCall ? (opts.funcMap.get(ident.toUpperCase()) ?? ident) : ident
      i = j
      continue
    }

    if (ch === opts.argSeparatorFrom) {
      result += opts.argSeparatorTo
      i++
      continue
    }
    if (ch === opts.decimalFrom && DIGIT.test(formula[i - 1] ?? '') && DIGIT.test(formula[i + 1] ?? '')) {
      result += opts.decimalTo
      i++
      continue
    }

    result += ch
    i++
  }
  return result
}

/** pt-BR display formula (as typed/shown in the UI) -> canonical English string for persistence. */
export function toCanonicalFormula(ptBrFormula: string): string {
  return translateFormula(ptBrFormula, {
    funcMap: PT_TO_EN,
    argSeparatorFrom: ';',
    argSeparatorTo: ',',
    decimalFrom: ',',
    decimalTo: '.'
  })
}

/** Canonical English persisted string -> pt-BR display formula, for feeding back into the engine on load. */
export function toDisplayFormula(canonicalFormula: string): string {
  return translateFormula(canonicalFormula, {
    funcMap: EN_TO_PT,
    argSeparatorFrom: ',',
    argSeparatorTo: ';',
    decimalFrom: '.',
    decimalTo: ','
  })
}
