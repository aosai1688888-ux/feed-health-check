"use strict";
// Founder-authorized official Paddle SANDBOX test-card QA against the original site.
// No Live payments, no simulated provider receipts, no secrets in CI logs.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {chromium}=require("playwright");
const mode=process.env.FEEDHEALTH_QA_MODE||"overlay_probe";
assert.ok(["overlay_probe","official_test_card"].includes(mode));
const cfg=JSON.parse(fs.readFileSync(process.env.FEEDHEALTH_QA_CONFIG,"utf8"));
assert.equal(cfg.environment,"sandbox");
assert.equal(cfg.production_authorization,"DENIED");
assert.equal(cfg.fulfillment_status,"SANDBOX_QA_DELIVERY_UNPROVEN");
assert.equal(cfg.fulfillment?.status,"SANDBOX_QA_READY");
assert.match(cfg.paddle.client_side_token,/^test_/);
const origin="https://feed.qianwuai.com";

async function fields(page){
 const snapshot=[];
 for(const frame of page.frames()){
   let host="unknown";try{host=new URL(frame.url()).hostname}catch{}
   const items=await frame.locator("input,button,select").evaluateAll(xs=>xs.slice(0,35).map(x=>({
     tag:x.tagName.toLowerCase(),type:x.getAttribute("type")||"",
     name:(x.getAttribute("name")||"").slice(0,45),
     placeholder:(x.getAttribute("placeholder")||"").slice(0,45),
     aria:(x.getAttribute("aria-label")||"").slice(0,45),
     label:x.tagName==="BUTTON"?(x.textContent||"").trim().slice(0,45):""
   }))).catch(()=>[]);
   snapshot.push({host,items});
 }
 console.log("PADDLE_QA_FORM_SHAPE="+JSON.stringify(snapshot).slice(0,5000));
}
async function input(page,selectors,text,name,required){
 for(let attempt=0;attempt<5;attempt++){
   for(const frame of page.frames())for(const selector of selectors){
     try{
       const el=frame.locator(selector).first();
       if(await el.count()&&await el.isVisible()){
         await el.fill(text,{timeout:4000});
         console.log("PADDLE_SANDBOX_FORM_FILLED="+name);
         return true;
       }
     }catch{}
   }
   await page.waitForTimeout(1250);
 }
 if(required)throw Error("CARD_INPUT_MISSING_"+name);
 return false;
}
async function button(page,patterns){
 for(const frame of page.frames())for(const re of patterns){
   try{
     const x=frame.getByRole("button",{name:re}).first();
     if(await x.count()&&await x.isVisible()){await x.click({timeout:4000});return true}
   }catch{}
 }
 return false;
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({locale:"en-US",timezoneId:"America/New_York",
   viewport:{width:1320,height:930}});
 try{
   const page=await context.newPage();
   await page.route(origin+"/checkout-config.v1.json",route=>route.fulfill({
     status:200,contentType:"application/json",headers:{"cache-control":"no-store"},
     body:JSON.stringify(cfg)
   }));
   let reservation=null;
   const networkTrace=[];
   const browserErrors=[];
   page.on("request",request=>{
     try{
       const u=new URL(request.url());
       if(u.origin===origin && u.pathname.startsWith("/v1/feedhealth/"))
         networkTrace.push({phase:"REQUEST",method:request.method(),path:u.pathname});
     }catch{}
   });
   page.on("requestfailed",request=>{
     try{
       const u=new URL(request.url());
       if(u.origin===origin && u.pathname.startsWith("/v1/feedhealth/"))
         networkTrace.push({phase:"FAILED",path:u.pathname,failure:request.failure()?.slice(0,90)});
     }catch{}
   });
   page.on("pageerror",error=>browserErrors.push(error.name||"PageError"));
   page.on("response",async response=>{
     try{
       const u=new URL(response.url());
       if(u.origin===origin && u.pathname.startsWith("/v1/feedhealth/"))
         networkTrace.push({phase:"RESPONSE",path:u.pathname,status:response.status()});
     }catch{}

     let url;
     try{url=new URL(response.url())}catch{return}
     if(url.origin!==origin || url.pathname!=="/v1/feedhealth/checkout-intents")return;
     const observed={http:response.status()};
     reservation=observed;
     try{
       const j=await response.json();
       observed.decision=j.decision;
       observed.checkout_ref=j.checkout_ref;
       observed.session_mode=j.session_mode;
       observed.error_code=typeof j.error==="string"?j.error.slice(0,80):undefined;
     }catch{observed.parse_failed=true}
   });
   await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:30000});
   await page.locator("#buy-diagnosis").waitFor({state:"attached",timeout:15000});
   const status=await page.evaluate(async()=>{
     const c=await fetch("/checkout-config.v1.json",{cache:"no-store"}).then(r=>r.json());
     return [isSandboxPaddleCheckout(c),sandboxQaFulfillmentReady(c),
       isLivePaddleCheckout(c)];
   });
   assert.equal(JSON.stringify(status),'[true,true,false]');
   console.log("EXISTING_PUBLIC_SITE_WITH_EPHEMERAL_SANDBOX_QA=PASS");
   await page.locator("#manual-panel summary").click();
   await page.locator("#manual-json").fill(JSON.stringify({products:[{
     id:"SYNTHETIC_QA_NON_CUSTOMER_1",title:"Test Art Print No GTIN",
     body_html:"<p>Synthetic QA item. No merchant data.</p>",
     vendor:"Synthetic QA",product_type:"Decor",
     images:[{src:"https://example.invalid/sample.png",alt:"Test"}],
     variants:[{id:"synth_1",sku:"QAT-1",price:"49.00",barcode:""}]
   }]}));
   await page.locator("#manual-button").click();
   await page.locator("#results").waitFor({state:"visible",timeout:15000});
   await page.locator("#diagnosis-delivery-email").fill("feedhealth@qianwuai.com");
   await page.locator("#diagnosis-buyer-consent").check();
   await page.locator("#buy-diagnosis").click();
   const deadline=Date.now()+22000;
   while(!reservation&&Date.now()<deadline)await page.waitForTimeout(350);
   if(!reservation){
     const info=await page.evaluate(async()=>({
       checkoutState:(document.querySelector("#checkout-state")?.textContent||"").slice(0,175),
       qaRoute:(()=>{try{return sandboxQaFulfillmentReady(
         {enabled:true,provider:"PADDLE",environment:"sandbox",
         sandbox_test_purchase_only:true,production_authorization:"DENIED",
         browser_may_assert_success:false,success_confirmation:"TRUSTED_SERVER_ONLY",
         currency:"USD",price:49,checkout_url:null,
         fulfillment_status:"SANDBOX_QA_DELIVERY_UNPROVEN",
         paddle:{client_side_token:"test_123456789abc",price_id:"pri_"+("a".repeat(26)),
         product_id:"pro_"+("b".repeat(26))},
         fulfillment:{mode:"AUTOMATIC_AI_ONLY",status:"SANDBOX_QA_READY",
         intake_path:"/v1/feedhealth/checkout-intents",
         report_path:"/v1/feedhealth/reports/read",
         download_ack_path:"/v1/feedhealth/reports/ack"}})}catch{return "UNAVAILABLE"}})(),
       evidenceSchema:globalThis.feedHealthBuyerEvidenceSnapshotV1?.()?.schema||"NONE",
       evidenceCount:globalThis.feedHealthBuyerEvidenceSnapshotV1?.()?.products?.length||0,
       consent:document.querySelector("#diagnosis-buyer-consent")?.checked===true
     }));
     const actual=await page.evaluate(async()=>{
       const c=await fetch("/checkout-config.v1.json",{cache:"no-store"}).then(r=>r.json());
       const x=globalThis.feedHealthBuyerEvidenceSnapshotV1?.();
       const email=document.querySelector("#diagnosis-delivery-email")?.value||"";
       const consent=document.querySelector("#diagnosis-buyer-consent")?.checked===true;
       return {
         sandbox:isSandboxPaddleCheckout(c),
         qa:sandboxQaFulfillmentReady(c),
         ready:fulfillmentReadyForAuthorizedBuyer(c),
         consent,validEmail:/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,40}$/.test(email),
         evidenceOk:!!x && x.schema==="feedhealth.buyer_evidence_snapshot.v1"
           && Array.isArray(x.products)&&x.products.length>0&&x.products.length<=50,
         mode:c.fulfillment?.mode||null,
         intake:c.fulfillment?.intake_path||null,
         downloadAck:c.fulfillment?.download_ack_path||null,
         testOnly:c.sandbox_test_purchase_only,
         provider:c.provider,
         stage:c.fulfillment?.status
       };
     });
     console.log("SANDBOX_ORIGINAL_UI_SAFE_INTAKE_DIAGNOSTIC="+JSON.stringify(info));
     console.log("SANDBOX_ACTUAL_CONFIG_GATE="+JSON.stringify(actual));
     console.log("SANDBOX_ORIGINAL_INTAKE_NETWORK="+JSON.stringify(networkTrace));
     console.log("SANDBOX_BROWSER_ERROR_CLASSES="+JSON.stringify(browserErrors));
   }
   assert.ok(reservation,"REAL_ORIGINAL_SOR_RESERVATION_NOT_RECEIVED");
   await page.waitForTimeout(800);
   console.log("ORIGINAL_SOR_RESERVATION_RESPONSE_CODE="+JSON.stringify({
     http:reservation.http,error_code:reservation.error_code||null,
     decision:reservation.decision||null
   }));
   assert.equal(reservation.http,201,"ORIGINAL_SOR_RESERVATION_FAILED");
   assert.equal(reservation.decision,"ACCEPTED");
   assert.equal(reservation.session_mode,"HTTP_ONLY_COOKIE");
   console.log("ORIGINAL_SOR_QA_ORDER_RESERVATION=PASS");
   console.log("QA_CHECKOUT_REFERENCE="+reservation.checkout_ref);
   assert.ok((await context.cookies(origin+"/v1/feedhealth/reports/read")).some(
     c=>c.name==="fhpd_v1" && c.httpOnly && c.secure
       && c.sameSite==="Strict" && c.path==="/v1/feedhealth/reports/"));
   console.log("ORIGINAL_BUYER_HTTPONLY_COOKIE=PASS");
   await page.waitForTimeout(5000);
   assert.ok(page.frames().some(f=>/paddle/i.test(f.url())),"PADDLE_OVERLAY_NOT_OPENED");
   console.log("OFFICIAL_PADDLE_SANDBOX_OVERLAY=PASS");
   await fields(page);
   if(mode==="overlay_probe"){
     console.log("TEST_CARD_NOT_USED=TRUE");
     console.log("SIGNED_TRANSACTION_NOT_CLAIMED=TRUE");
     return;
   }
   // Paddle-published test card; not a real or user payment instrument.
   await input(page,["input[type=email]","input[autocomplete=email]",
     "input[name*=email i]"],"feedhealth@qianwuai.com","EMAIL",false);
   await button(page,[/continue/i,/next/i]);
   await input(page,["input[autocomplete=cc-number]","input[name*=card i]",
     "input[placeholder*=card/i]"],"4242424242424242","TEST_CARD",true);
   await input(page,["input[autocomplete=cc-exp]","input[name*=exp i]",
     "input[placeholder*=MM/i]"],"12/31","EXPIRY",true);
   await input(page,["input[autocomplete=cc-csc]","input[name*=cvc i]",
     "input[name*=cvv i]"],"100","CVC",true);
   await input(page,["input[autocomplete=cc-name]","input[name*=holder i]",
     "input[placeholder*=name/i]"],"FeedHealth Test","CARD_NAME",false);
   await input(page,["input[autocomplete=postal-code]","input[name*=zip i]"],
     "10001","POSTAL",false);
   assert.ok(await button(page,[/pay now/i,/complete purchase/i,
     /pay.*49/i,/complete payment/i,/purchase/i]),"TEST_CARD_SUBMIT_NOT_FOUND");
   console.log("PADDLE_SANDBOX_TEST_CARD_SUBMITTED=TRUE");
   let delivered=false;
   const end=Date.now()+210000;
   while(Date.now()<end){
     delivered=await page.evaluate(()=>document.querySelector("#feedhealth-paid-report")?.hidden===false).catch(()=>false);
     if(delivered)break;
     await page.waitForTimeout(4500);
   }
   console.log("ACTUAL_AUTHORIZED_AI_REPORT_VISIBLE="+delivered);
   if(!delivered)throw Error("SIGNED_PAYMENT_AND_BUYER_REPORT_NOT_YET_PROVEN");
   const download=page.locator("#feedhealth-paid-report a[download],#feedhealth-paid-report button").first();
   assert.ok(await download.count(),"ACTUAL_REPORT_DOWNLOAD_CONTROL_MISSING");
   await download.click();
   console.log("ORIGINAL_BUYER_DOWNLOAD_CLICK=PASS");
 }catch(e){
   console.error("SANDBOX_QA_HOLD="+String(e?.message||e).slice(0,180));
   throw e;
 }finally{await browser.close()}
})().catch(()=>{process.exitCode=1});
