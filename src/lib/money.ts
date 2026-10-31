export function parseSen(value:string):number|null {
  const match=/^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value.trim())
  if(!match)return null
  const sen=Number(match[1])*100+Number((match[2]??'').padEnd(2,'0'))
  return Number.isSafeInteger(sen)&&sen<=2147483647?sen:null
}
export function formatMoney(sen:number):string { return `RM ${Math.floor(sen/100).toLocaleString('en-MY')}.${String(sen%100).padStart(2,'0')}` }
