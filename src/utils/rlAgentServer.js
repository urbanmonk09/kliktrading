// src/utils/rlAgentServer.js
const { getQTable: _get, qUpdate: _qUpdate, saveQTableSnapshot: _save } = require("./rlAgent.cjs"); 
// If your TS compiled output isn't available, you can reimplement small helpers here.
// For simplicity, you can implement same functions directly in JS that worker uses.

module.exports = {
  getQTable: _get,
  qUpdate: _qUpdate,
  saveQTableSnapshot: _save,
  stateFromContext: (ctx) => {
    // same as client stateFromContext
    const bucket = (v,b)=>{for(let i=0;i<b.length;i++){if(v<=b[i])return i;}return b.length;}
    const rsiBucket = bucket(Math.round(ctx.rsi ?? 50), [30,40,50,60,70]);
    const emaBucket = ctx.ema50 && ctx.ema200 ? (ctx.ema50 > ctx.ema200 ? 2 : ctx.ema50 < ctx.ema200 ? 0 : 1) : 1;
    const smcBucket = bucket(ctx.smcConfidence ?? 50, [20,40,60,80]);
    const trend = ctx.trendBias === "BULLISH" ? "B" : ctx.trendBias === "BEARISH" ? "S" : "N";
    return `r${rsiBucket}_e${emaBucket}_s${smcBucket}_t${trend}`;
  }
};
