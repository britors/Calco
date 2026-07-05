import { describe, expect, it } from 'vitest'
import { toCanonicalFormula, toDisplayFormula } from '../../src/renderer/engine/formula-locale'

describe('formula-locale', () => {
  describe('toCanonicalFormula (pt-BR -> canonical English, for persistence)', () => {
    it('translates function names and the argument separator', () => {
      expect(toCanonicalFormula('=SOMA(A1;B1)')).toBe('=SUM(A1,B1)')
      expect(toCanonicalFormula('=SE(A1>0;1;0)')).toBe('=IF(A1>0,1,0)')
      expect(toCanonicalFormula('=PROCV(A1;B1:C10;2;FALSO)')).toBe('=VLOOKUP(A1,B1:C10,2,FALSO)')
    })

    it('translates the decimal separator only between digits', () => {
      expect(toCanonicalFormula('=A1*1,5')).toBe('=A1*1.5')
      expect(toCanonicalFormula('=SOMA(A1;1,5)')).toBe('=SUM(A1,1.5)')
    })

    it('leaves string literals untouched', () => {
      expect(toCanonicalFormula('=SE(A1>1;"a;b,c";"não")')).toBe('=IF(A1>1,"a;b,c","não")')
    })

    it('handles nested function calls', () => {
      expect(toCanonicalFormula('=SOMA(SE(A1>0;1;0);B1)')).toBe('=SUM(IF(A1>0,1,0),B1)')
    })

    it('leaves non-formula content untouched', () => {
      expect(toCanonicalFormula('42')).toBe('42')
      expect(toCanonicalFormula('texto qualquer')).toBe('texto qualquer')
    })

    it('leaves already-canonical English formulas untouched', () => {
      expect(toCanonicalFormula('=SUM(A1,B1)')).toBe('=SUM(A1,B1)')
    })
  })

  describe('toDisplayFormula (canonical English -> pt-BR, for loading into the engine)', () => {
    it('is the inverse of toCanonicalFormula', () => {
      const cases = ['=SOMA(A1;B1)', '=SE(A1>0;1;0)', '=PROCV(A1;B1:C10;2;FALSO)', '=A1*1,5']
      for (const ptBr of cases) {
        expect(toDisplayFormula(toCanonicalFormula(ptBr))).toBe(ptBr)
      }
    })

    it('translates canonical English straight from a stored file', () => {
      expect(toDisplayFormula('=SUM(A1,B1)')).toBe('=SOMA(A1;B1)')
      expect(toDisplayFormula('=IF(A1>0,1,0)')).toBe('=SE(A1>0;1;0)')
    })
  })
})
