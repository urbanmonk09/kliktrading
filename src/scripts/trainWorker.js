// scripts/trainWorker.js
const fetch = require("node-fetch");
const { qUpdate, saveQTableSnapshot } = require("../src/utils/rlAgentServer"); // server utils (we'll create)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function fetchResolvedPairs() {
  // Fetch joined predictions + trade_history that are resolved and not yet used for training
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trade_history?select=*,predictions(*)`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return await res.json();
}

async function main() {
  console.log("Train worker started...");
  const pairs = await fetchResolvedPairs();
  if (!pairs || pairs.length === 0) {
    console.log("No training samples.");
    return process.exit(0);
  }
  // get current Q-table
  const rlAgent = require("../src/utils/rlAgentServer");
  let qtable = await rlAgent.getQTable();

  for (const sample of pairs) {
    try {
      const pred = sample.predictions;
      if (!pred) continue;
      // context must align
      const ctx = pred.context?.context ?? {};
      const state = rlAgent.stateFromContext(ctx);
      // Map pred.signal to action index
      const map = { SELL: 0, HOLD: 1, BUY: 2 };
      const actionIndex = map[pred.signal] ?? 1;
      const reward = Number(sample.reward ?? 0);
      // nextState: we'll approximate with same context (no sequence)
      const nextState = state;
      qtable = rlAgent.qUpdate(qtable, state, actionIndex, reward, nextState, 0.1, 0.95);
    } catch (err) {
      console.warn("sample train err", err);
    }
  }

  // persist snapshot
  await rlAgent.saveQTableSnapshot(qtable);
  console.log("Training done. Q-table snapshot saved.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
