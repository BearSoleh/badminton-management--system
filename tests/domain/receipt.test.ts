import { describe,expect,it } from 'vitest'
import { validateReceiptBytes } from '../../supabase/functions/_shared/receipt'

const pdf=new TextEncoder().encode('%PDF-1.4\nSynthetic receipt\n%%EOF')
describe('receipt byte validation',()=>{
  it('accepts PDF, PNG and JPEG with matching extension and complete signatures',()=>{
    expect(validateReceiptBytes(pdf,'receipt.pdf','application/pdf')).toBe('application/pdf')
    const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68,174,66,96,130])
    expect(validateReceiptBytes(png,'receipt.png','image/png')).toBe('image/png')
    expect(validateReceiptBytes(new Uint8Array([255,216,255,224,255,217]),'receipt.jpg','image/jpeg')).toBe('image/jpeg')
  })
  it('accepts exactly 5 MiB, rejects the next byte and empty or incomplete uploads',()=>{
    const b=new Uint8Array(5242880).fill(32);b.set(pdf);b.set(new TextEncoder().encode('%%EOF'),b.length-5)
    expect(validateReceiptBytes(b,'receipt.pdf','application/pdf')).toBe('application/pdf')
    expect(()=>validateReceiptBytes(new Uint8Array(5242881),'receipt.pdf','application/pdf')).toThrow('INVALID_RECEIPT')
    for(const data of [new Uint8Array(),new TextEncoder().encode('%PDF-1.4\nIncomplete')])expect(()=>validateReceiptBytes(data,'receipt.pdf','application/pdf')).toThrow('INVALID_RECEIPT')
  })
  it.each(['<svg xmlns="http://www.w3.org/2000/svg"></svg>','<!doctype html><script>alert(1)</script>','%PDF-1.4\n/JavaScript (bad)\n%%EOF','%PDF-1.4\n<svg onload="bad"/>\n%%EOF'])('rejects unsafe rendered content disguised as a receipt',value=>{
    expect(()=>validateReceiptBytes(new TextEncoder().encode(value),'receipt.pdf','application/pdf')).toThrow('INVALID_RECEIPT')
  })
  it('rejects mismatched metadata, filenames, MIME and signatures',()=>{
    for(const [name,type] of [['receipt.png','image/png'],['receipt.pdf','image/png'],['receipt.svg','application/pdf'],['receipt.html','text/html']])expect(()=>validateReceiptBytes(pdf,name,type)).toThrow('INVALID_RECEIPT')
  })
})
