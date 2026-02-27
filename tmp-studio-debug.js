const { chromium } = require('playwright');
(async()=>{
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', msg => {
    if (['error','warning'].includes(msg.type())) {
      console.log('[console.'+msg.type()+']', msg.text());
    }
  });
  page.on('pageerror', err => console.log('[pageerror]', err && err.stack || err));
  await page.goto('http://127.0.0.1:5174/#/');
  await page.evaluate(() => localStorage.setItem('ai-storyboarder-visited', 'true'));
  await page.goto('http://127.0.0.1:5174/#/studio');
  await page.waitForTimeout(2500);
  console.log('URL:', page.url());
  const bodyText = await page.textContent('body');
  console.log('Body snippet:', (bodyText||'').replace(/\s+/g,' ').slice(0,300));
  await page.screenshot({path:'tmp-studio-debug.png', fullPage:true});
  await browser.close();
})();
