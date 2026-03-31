// Geometric Brownian Motion synthetic mid-price generator

export interface GBMState {
  price: number;
  mu: number;       // drift per tick (e.g., 0)
  sigma: number;    // volatility per tick (e.g., 0.005)
  meanReversionTarget: number;
  meanReversionStrength: number; // e.g., 0.05
}

export function createGBMState(startPrice: number): GBMState {
  return {
    price: startPrice,
    mu: 0,
    sigma: 0.005,
    meanReversionTarget: startPrice,
    meanReversionStrength: 0.05,
  };
}

export function tickGBM(
  state: GBMState,
  rng: () => number = Math.random,
): { state: GBMState; newPrice: number } {
  // GBM with mean reversion:
  // dp = mu*dt + sigma*dW + meanReversionStrength*(target - price)*dt
  // Use Box-Muller for normal random variate
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);

  const drift = state.mu + state.meanReversionStrength * (state.meanReversionTarget - state.price);
  const newPrice = Math.max(1, Math.round(state.price * (1 + drift + state.sigma * z)));

  return {
    state: { ...state, price: newPrice },
    newPrice,
  };
}
