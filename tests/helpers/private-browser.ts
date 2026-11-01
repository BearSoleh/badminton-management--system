import type { Locator,Page } from '@playwright/test'

// Playwright's normal timeout message can echo fill/goto arguments. Live
// capability/password journeys replace those messages before reporters persist them.
export async function fillPrivate(locator:Locator,value:string) {
  try{await locator.fill(value)}catch{throw new Error('Private form entry failed; sensitive action details suppressed.')}
}
export async function openPrivateLink(page:Page,url:string) {
  try{await page.goto(url)}catch{throw new Error('Private navigation failed; sensitive URL details suppressed.')}
}
