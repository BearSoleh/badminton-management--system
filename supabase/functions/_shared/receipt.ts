// Conservative signature/completion checks. Receipts are download-only.
export function validateReceiptBytes(bytes:Uint8Array,path:string,mime:string):string {
  const invalid=()=>{throw new Error('INVALID_RECEIPT')}
  if(bytes.length<1||bytes.length>5242880)invalid()
  const text=new TextDecoder('latin1').decode(bytes)
  if(/<\s*(?:!doctype\s+html|html|svg|script|iframe|\?xml)\b/i.test(text))invalid()
  const extension=path.split('.').pop()?.toLowerCase()
  if(mime==='application/pdf'&&extension==='pdf'&&text.startsWith('%PDF-')&&/%%EOF\s*$/.test(text)) {
    if(/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/i.test(text))invalid()
    return mime
  }
  if(mime==='image/jpeg'&&['jpg','jpeg'].includes(extension??'')&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return mime
  const pngHeader=[137,80,78,71,13,10,26,10],pngEnd=[0,0,0,0,73,69,78,68,174,66,96,130]
  if(mime==='image/png'&&extension==='png'&&pngHeader.every((v,i)=>bytes[i]===v)&&pngEnd.every((v,i)=>bytes[bytes.length-pngEnd.length+i]===v))return mime
  return invalid()
}
