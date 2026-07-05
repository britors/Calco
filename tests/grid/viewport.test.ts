import { describe, expect, it } from 'vitest'
import { AxisSizer, computeVisibleRange, type GridMetrics } from '../../src/renderer/grid/viewport'

describe('AxisSizer', () => {
  it('behaves like uniform sizing when nothing is overridden', () => {
    const sizer = new AxisSizer(20, () => 20)
    sizer.rebuild(0)
    expect(sizer.offsetOf(0)).toBe(0)
    expect(sizer.offsetOf(5)).toBe(100)
    expect(sizer.sizeOf(3)).toBe(20)
    expect(sizer.indexAt(45)).toBe(2)
    expect(sizer.totalSize(10)).toBe(200)
  })

  it('accounts for overrides within the rebuilt bound', () => {
    const overrides = new Map([[2, 50]])
    const sizer = new AxisSizer(20, (i) => overrides.get(i) ?? 20)
    sizer.rebuild(5) // covers indices 0..4 exactly

    // 0:20 1:20 2:50 3:20 4:20 -> offsets 0,20,40,90,110,130
    expect(sizer.offsetOf(0)).toBe(0)
    expect(sizer.offsetOf(2)).toBe(40)
    expect(sizer.offsetOf(3)).toBe(90)
    expect(sizer.offsetOf(5)).toBe(130)
  })

  it('extrapolates arithmetically past the rebuilt bound using the default size', () => {
    const overrides = new Map([[2, 50]])
    const sizer = new AxisSizer(20, (i) => overrides.get(i) ?? 20)
    sizer.rebuild(5) // bound offset (index 5) = 130

    expect(sizer.offsetOf(5)).toBe(130)
    expect(sizer.offsetOf(6)).toBe(150) // 130 + 1*20, not consulting getSize(5) at all
    expect(sizer.offsetOf(105)).toBe(130 + 100 * 20)
  })

  it('indexAt is the exact inverse of offsetOf across the override boundary', () => {
    const overrides = new Map([[2, 50]])
    const sizer = new AxisSizer(20, (i) => overrides.get(i) ?? 20)
    sizer.rebuild(5)

    for (let i = 0; i < 20; i++) {
      const offset = sizer.offsetOf(i)
      expect(sizer.indexAt(offset)).toBe(i)
      // A position just before the next index's start still resolves to `i`.
      const nextOffset = sizer.offsetOf(i + 1)
      expect(sizer.indexAt(nextOffset - 1)).toBe(i)
    }
  })

  it('clamps indexAt to 0 for a negative or zero position', () => {
    const sizer = new AxisSizer(20, () => 20)
    sizer.rebuild(0)
    expect(sizer.indexAt(-5)).toBe(0)
    expect(sizer.indexAt(0)).toBe(0)
  })

  it('rebuild(0) still lets offsetOf/indexAt work purely by extrapolation', () => {
    const sizer = new AxisSizer(24, () => 24)
    sizer.rebuild(0)
    expect(sizer.offsetOf(10)).toBe(240)
    expect(sizer.indexAt(240)).toBe(10)
  })
})

describe('computeVisibleRange with variable sizing', () => {
  it('widens the visible column range around an oversized column', () => {
    const overrides = new Map([[1, 400]]) // column 1 is very wide
    const colSizer = new AxisSizer(80, (i) => overrides.get(i) ?? 80)
    colSizer.rebuild(3)
    const rowSizer = new AxisSizer(24, () => 24)
    rowSizer.rebuild(0)
    const metrics: GridMetrics = { headerWidth: 48, headerHeight: 24, rowSizer, colSizer }

    const range = computeVisibleRange(
      metrics,
      { scrollTop: 0, scrollLeft: 0, viewportWidth: 48 + 80 + 400 + 40, viewportHeight: 400 },
      999,
      999
    )
    // Columns 0, 1 (wide), 2 should all be reachable within that viewport width.
    expect(range.startCol).toBe(0)
    expect(range.endCol).toBeGreaterThanOrEqual(2)
  })
})
