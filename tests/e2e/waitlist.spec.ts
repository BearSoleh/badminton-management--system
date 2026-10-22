import { expect,test } from '@playwright/test'
import { authFixture,login } from '../helpers/browser-auth'

const sid='40000000-0000-4000-8000-000000000001',pid='40000000-0000-4000-8000-000000000002',oid='40000000-0000-4000-8000-000000000003',nid='40000000-0000-4000-8000-000000000004'
const session={id:sid,title:'Fixture waiting-list game',venue:'Fixture Court',starts_at:'2099-10-23T14:00:00Z',ends_at:'2099-10-23T16:00:00Z',voting_closes_at:'2099-10-23T11:00:00Z',capacity:1,operational_status:'joining_open',billing_status:'not_published',waitlist_mode:'automatic'}
test('offer countdown, Continue retry, inbox read and current-state link',async({page})=>{
  await authFixture(page,'active')
  let accepted=false,read=false
  const requests:string[]=[]
  await page.route('**/rest/v1/notifications?**',r=>r.fulfill({json:[{id:nid,user_id:pid,event_key:`offer:${oid}`,type:'waitlist_offer',payload:{session_id:sid,session_title:session.title,offer_id:oid,expires_at:'2099-10-23T12:15:00Z'},created_at:'2099-10-23T12:00:00Z',read_at:read?'2099-10-23T12:01:00Z':null}]}))
  await page.route('**/rest/v1/rpc/mark_notification_read',r=>{expect(r.request().postDataJSON()).toEqual({notification_id_input:nid});read=true;return r.fulfill({json:{notification_id:nid,read_at:'2099-10-23T12:01:00Z'}})})
  await page.route('**/rest/v1/rpc/get_active_offers',r=>r.fulfill({json:{server_now:'2099-10-23T12:00:00Z',offers:[]}}))
  await page.route('**/rest/v1/rpc/get_session_snapshot',r=>r.fulfill({json:{session,server_now:'2099-10-23T12:00:00Z',participation:{id:pid,participation_status:accepted?'confirmed':'offered',liability_percent:0},offer:accepted?null:{id:oid,state:'pending',expires_at:'2099-10-23T12:15:00Z'},vote:'play',roster:[],counts:{confirmed:accepted?1:0,held:accepted?0:1,waiting:0},can_vote:false,can_join:true,can_withdraw:true,withdrawal_percent:0}}))
  await page.route('**/rest/v1/rpc/respond_to_offer',r=>{
    const args=r.request().postDataJSON();expect(Object.keys(args).sort()).toEqual(['accept_input','offer_id_input','request_id']);expect(args.offer_id_input).toBe(oid);expect(args.accept_input).toBe(true)
    requests.push(args.request_id)
    if(requests.length===1)return r.fulfill({status:503,json:{message:'private synthetic diagnostic'}})
    accepted=true;return r.fulfill({json:{offer_state:'accepted',participation_status:'confirmed'}})
  })
  await login(page)
  await page.getByRole('link',{name:'Notifications',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible()
  await expect(page.getByText('Unread',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Mark as read',exact:true}).click()
  await expect(page.getByText('Unread',{exact:true})).toHaveCount(0)
  await page.getByRole('link',{name:'View session',exact:true}).click()
  await expect(page.getByRole('heading',{name:'A place is available',exact:true})).toBeVisible()
  await expect(page.getByLabel('Time remaining')).toContainText('14:')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('We couldn’t complete that request.')
  await expect(page.getByText('private synthetic diagnostic')).toHaveCount(0)
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Confirmed')
  expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('countdown ending refreshes authoritative state and disables stale Continue',async({page})=>{
  await authFixture(page,'active')
  let loads=0
  let firstLoad=0
  await page.route('**/rest/v1/rpc/get_active_offers',r=>r.fulfill({json:{server_now:'2099-10-23T12:00:00Z',offers:[]}}))
  await page.route('**/rest/v1/rpc/get_session_snapshot',r=>{
    loads++;if(!firstLoad)firstLoad=Date.now();const expired=Date.now()-firstLoad>=1900
    return r.fulfill({json:{session,server_now:expired?'2099-10-23T12:15:01Z':'2099-10-23T12:14:58Z',participation:{id:pid,participation_status:expired?'offer_expired':'offered',liability_percent:0},offer:expired?null:{id:oid,state:'pending',expires_at:'2099-10-23T12:15:00Z'},vote:'play',roster:[],counts:{confirmed:0,held:expired?0:1,waiting:0},can_vote:false,can_join:true,can_withdraw:!expired,withdrawal_percent:0}})
  })
  await login(page);await expect(page.getByRole('heading',{name:'Welcome back, Bear.'})).toBeVisible()
  await page.goto(`/app/sessions/${sid}`)
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible()
  await expect(page.getByRole('region',{name:'Your participation'})).toContainText('Offer expired',{timeout:8000})
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0)
  expect(loads).toBeGreaterThan(1)
})
