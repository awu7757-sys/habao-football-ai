const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),a=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='test.invalid'){
     const name=u.pathname==='/'?'performance.html':u.pathname.slice(1),file=path.join(root,name);
     if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':'application/octet-stream'});
   }
   if(u.pathname.includes('/functions/v1/')){
     requests.push(u.pathname+u.search);
     const sport=u.pathname.includes('basketball')?'basketball':u.pathname.includes('baseball')?'baseball':'football';
     const rows=[2,20,40].map(days=>({game_id:days,fixture_id:days,kickoff_at:new Date(Date.now()-days*86400000).toISOString(),home:'HOME-'+sport+'-'+days,away:'AWAY',league:'NBA',final_score:'2-1',prediction:{},settlement:{moneyline:'win',over_under:'loss',btts:'win',handicap:'win'}}));
     // Deliberately over-broad API rows test the frontend's hard 30-day limit.
     return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,summary:{verified_matches:3},markets:{},recent_form:{},trend:[],leagues:[],matches:rows,rows:[]})});
   }
   return route.fulfill({status:200,body:'',contentType:'application/javascript'});
 });
 await page.goto('https://test.invalid/performance.html');
 for(const sport of ['football','basketball','baseball']){
   if(sport!=='football')await page.locator('[data-sport="'+sport+'"]').click();
   await page.waitForFunction(()=>document.querySelector('.period-btn.active')?.dataset.period==='30');
   const records=width>600?page.locator('#recordsBody'):page.locator('#mobileRecords');
   await records.getByText('HOME-'+sport+'-20',{exact:false}).first().waitFor({state:'visible'});
   a.ok(!(await records.innerText()).includes('HOME-'+sport+'-40'));
   await page.locator('.period-btn[data-period="7"]').click();
   await page.waitForFunction(()=>document.querySelector('.period-btn.active')?.dataset.period==='7');
   a.ok((await records.innerText()).includes('HOME-'+sport+'-20'),'7D chart keeps 30D verification');
   await page.locator('#moreBtn').click();
   a.ok(!(await records.innerText()).includes('HOME-'+sport+'-40'));
 }
 a.equal(errors.length,0,errors.join('\n'));
 a.ok(requests.filter(x=>x.includes('performance')).every(x=>/days=(7|30)/.test(x)));
 console.log('PASS',width,'px: all sports default 30D, chart 7D leaves records 30D, more capped, no JS errors');
 await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
