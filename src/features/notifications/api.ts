import { connection,fail } from '../sessions/api'
import type { Database } from '../../types/database'
export type Notification=Database['public']['Tables']['notifications']['Row']
export async function listNotifications() {
  const {data,error,status}=await connection().from('notifications').select('*').order('created_at',{ascending:false}).limit(100)
  if(error||!data)fail(error,status)
  return data
}
export async function markRead(id:string) {
  const {error,status}=await connection().rpc('mark_notification_read',{notification_id_input:id})
  if(error)fail(error,status)
}
