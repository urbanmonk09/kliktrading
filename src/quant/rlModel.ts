export type RLMemory = {
  wins: number;
  losses: number;
  rewardWeight: number;
};

export class ReinforcementModel {
  private memory: Record<string, RLMemory> = {};

  constructor() {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("rlModel");
      if (saved) this.memory = JSON.parse(saved);
    }
  }

  update(symbol: string, result: "WIN" | "LOSS") {
    if (!this.memory[symbol]) {
      this.memory[symbol] = { wins: 0, losses: 0, rewardWeight: 1 };
    }

    const m = this.memory[symbol];

    if (result === "WIN") {
      m.wins++;
      m.rewardWeight = Math.min(m.rewardWeight + 0.05, 2);
    } else {
      m.losses++;
      m.rewardWeight = Math.max(m.rewardWeight - 0.05, 0.5);
    }

    this.save();
  }

  getWeight(symbol: string): number {
    return this.memory[symbol]?.rewardWeight ?? 1;
  }

  private save() {
    if (typeof window !== "undefined") {
      localStorage.setItem("rlModel", JSON.stringify(this.memory));
    }
  }
}

export const RL = new ReinforcementModel();
