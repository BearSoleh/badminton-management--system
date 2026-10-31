import { describe,expect,it } from 'vitest'
import { parseSen,formatMoney } from '../../src/lib/money'
describe('manual MYR entry',()=>{
  it.each([['20.01',2001],['0',0],['0.02',2],[' 20.1 ',2010],['21474836.47',2147483647]])('converts %s to integer sen', (value,want)=>expect(parseSen(value)).toBe(want))
  it.each(['','-1','20.001','1e3','20,01','Infinity','21474836.48'])('rejects invalid or overflowing entry %s',value=>expect(parseSen(value)).toBeNull())
  it('distinguishes intentional zero from an unset fee',()=>{expect(formatMoney(0)).toBe('RM 0.00');expect(formatMoney(1501)).toBe('RM 15.01')})
})
