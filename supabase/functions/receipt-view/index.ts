import { receiptHandler } from '../_shared/receipt-handler.ts'
Deno.serve(receiptHandler('view'))
