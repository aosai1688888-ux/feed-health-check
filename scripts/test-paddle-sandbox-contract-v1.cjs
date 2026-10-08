"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {test}=require("node:test");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"first-payment.js"),"utf8");
const production=JSON.parse(fs.readFileSync(path.join(root,"checkout-config.v1.json")));
const sample=()=>({
  enabled:true,provider:"PADDLE",environment:"sandbox",
  sandbox_test_purchase_only:true,browser_may_assert_success:false,
  success_confirmation:"TRUSTED_SERVER_ONLY",checkout_url:null,currency:"USD",price:49,
  paddle:{client_side_token:"test_"+"0123456789abcd",price_id:"pri_"+"a".repeat(26),product_id:"pro_"+"b".repeat(26)}
});
function setup(paddle){
  const loads=[];
  const c=vm.createContext({
    crypto:require("node:crypto").webcrypto,URLSearchParams,URL,Intl,Uint8Array,
    Paddle:paddle,location:{search:"",assign:()=>{throw Error("NAVIGATION_DENIED")}},
    document:{addEventListener(){},createElement:()=>({}),head:{appendChild:e=>{loads.push(e.src);e.onload?.()}}}
  });
  c.globalThis=c;
  vm.runInContext(source,c,{filename:"first-payment.js"});
  return {c,loads};
}
test("production still fails closed",()=>{
  assert.equal(production.enabled,false);
  assert.equal(production.provider,"UNBOUND");
  const {c}=setup();
  assert.equal(vm.runInContext("isSandboxPaddleCheckout("+JSON.stringify(production)+")",c),false);
});
test("sandbox validated and negative cases rejected",()=>{
  const {c}=setup();
  for(const [k,v] of [["enabled",false],["provider","STRIPE"],["environment","live"],["sandbox_test_purchase_only",false],["browser_may_assert_success",true],["success_confirmation","BROWSER"],["currency","GBP"],["price",0],["checkout_url","https://example.test"]]){
    const x=sample();x[k]=v;
    assert.equal(vm.runInContext("isSandboxPaddleCheckout("+JSON.stringify(x)+")",c),false,k);
  }
  for(const [k,v] of [["client_side_token","live_abcd"],["client_side_token","test_1"],["price_id","pri_bad"],["product_id","pro_bad"]]){
    const x=sample();x.paddle[k]=v;
    assert.equal(vm.runInContext("isSandboxPaddleCheckout("+JSON.stringify(x)+")",c),false,k);
  }
  assert.equal(vm.runInContext("isSandboxPaddleCheckout("+JSON.stringify(sample())+")",c),true);
});
test("sandbox opens fixed one-item one-time price, never asserts payment",async()=>{
  const env=[],init=[],opens=[];
  const paddle={
    Environment:{set:x=>env.push(x)},Initialize:x=>init.push(x),
    Checkout:{open:x=>opens.push(x)}
  };
  const {c,loads}=setup(paddle);
  c.testConfig=sample();
  await vm.runInContext('openSandboxPaddleCheckout(testConfig,"REF_1")',c);
  await vm.runInContext('openSandboxPaddleCheckout(testConfig,"REF_2")',c);
  assert.deepEqual(env,["sandbox"]);
  assert.equal(init.length,1);
  assert.equal(init[0].token,c.testConfig.paddle.client_side_token);
  assert.equal(opens.length,2);
  assert.equal(opens[0].items[0].priceId,c.testConfig.paddle.price_id);
  assert.equal(opens[0].items[0].quantity,1);
  assert.equal(opens[0].customData.checkout_ref,"REF_1");
  assert.equal(opens[0].customData.test_only,"true");
  assert.deepEqual(loads,[]);
  assert.ok(!source.includes("PAYMENT_SUCCEEDED"));
  assert.ok(!source.includes("localStorage"));
});
test("invalid source cannot even load checkout library",async()=>{
  const {c,loads}=setup();
  c.invalid=sample();c.invalid.environment="live";
  await assert.rejects(vm.runInContext('openSandboxPaddleCheckout(invalid,"NO")',c));
  assert.deepEqual(loads,[]);
});
console.log("FEEDHEALTH_PADDLE_SANDBOX_CONTRACT=PASS");
