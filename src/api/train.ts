// src/pages/api/train.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { spawn } from "child_process";
import path from "path";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // spawn worker for training (non-blocking). Make sure node can run scripts/trainWorker.js
    const workerPath = path.join(process.cwd(), "scripts", "trainWorker.js");
    const child = spawn(process.execPath, [workerPath], {
      env: { ...process.env },
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      console.log(`Train worker exited ${code}`);
    });

    return res.status(200).json({ ok: true, message: "training started" });
  } catch (err: any) {
    console.error("train start failed", err);
    return res.status(500).json({ error: err.message || "train failed" });
  }
}
