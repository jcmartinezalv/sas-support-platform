import test from "node:test";
import assert from "node:assert/strict";
import { createShortUrlService } from "../src/links/short-url-service.js";
const internal="https://setinfo.sytes.net/i/ABCDEFGH";

test("TinyURL shortens only the anonymous internal installation URL", async()=>{
  let request; const service=createShortUrlService({config:{shortUrlProvider:"tinyurl",tinyUrlApiToken:"secret",tinyUrlDomain:"tinyurl.com",shortUrlTimeoutMs:1000},fetchImpl:async(url,options)=>{request={url,options};return {ok:true,status:200,json:async()=>({data:{tiny_url:"https://tinyurl.com/sas123"}})}}});
  const result=await service.shorten(internal); assert.equal(result.url,"https://tinyurl.com/sas123"); assert.equal(result.provider,"tinyurl");
  assert.equal(request.url,"https://api.tinyurl.com/create"); assert.equal(JSON.parse(request.options.body).url,internal); assert.equal(request.options.headers.Authorization,"Bearer secret");
});

test("Bitly uses its v4 shorten API", async()=>{
  const service=createShortUrlService({config:{shortUrlProvider:"bitly",bitlyAccessToken:"secret",bitlyDomain:"bit.ly"},fetchImpl:async(url,options)=>{assert.equal(url,"https://api-ssl.bitly.com/v4/shorten"); assert.equal(JSON.parse(options.body).long_url,internal); return {ok:true,status:200,json:async()=>({link:"https://bit.ly/sas456"})}}});
  const result=await service.shorten(internal); assert.equal(result.url,"https://bit.ly/sas456"); assert.equal(result.fallback,false);
});

test("automatic mode tries TinyURL then Bitly", async()=>{
  const calls=[]; const service=createShortUrlService({config:{shortUrlProvider:"auto",tinyUrlApiToken:"tiny",bitlyAccessToken:"bit"},fetchImpl:async(url)=>{calls.push(url); if(url.includes("tinyurl")) return {ok:false,status:503,json:async()=>({})}; return {ok:true,status:200,json:async()=>({link:"https://bit.ly/working"})}}});
  const result=await service.shorten(internal); assert.equal(result.provider,"bitly"); assert.equal(calls.length,2); assert.equal(result.attempts[0].provider,"tinyurl");
});

test("service falls back to the SAS internal link without credentials or valid response", async()=>{
  const noCredentials=await createShortUrlService({config:{shortUrlProvider:"auto"}}).shorten(internal); assert.equal(noCredentials.url,internal); assert.equal(noCredentials.provider,"internal"); assert.equal(noCredentials.fallback,true);
  const invalid=await createShortUrlService({config:{shortUrlProvider:"tinyurl",tinyUrlApiToken:"secret"},fetchImpl:async()=>({ok:true,status:200,json:async()=>({data:{tiny_url:"https://evil.example/x"}})})}).shorten(internal); assert.equal(invalid.url,internal); assert.equal(invalid.attempts[0].error,"Unexpected short URL response");
});
