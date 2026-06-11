/**
 * Glicko-2 rating engine. Pure functions only — no I/O, no clocks.
 * Constants per Glickman (2013), "Example of the Glicko-2 system".
 * See ADR-0003 for why Glicko-2 over ELO.
 *
 * Reference: http://www.glicko.net/glicko/glicko2.pdf
 *
 * The system internally works in a transformed scale (mu, phi):
 *   mu  = (r  - 1500) / 173.7178
 *   phi =  rd        / 173.7178
 * and converts back to the public (r, rd) scale at the end.
 */
export interface Rating {
  r: number;
  rd: number;
  vol: number;
}

export const UNRATED: Rating = { r: 1500, rd: 350, vol: 0.06 };
export const TAU = 0.5; // volatility constraint — documented, not magic
const SCALE = 173.7178; // Glicko-2 scale factor (= 400 / ln(10))
const RD_MAX = 350; // RD ceiling; new/fully-uncertain players sit here
const CONVERGENCE = 1e-6; // ε for the volatility iteration

/** Public (r,rd) -> internal (mu,phi). */
function toGlicko2(r: Rating): { mu: number; phi: number; sigma: number } {
  return { mu: (r.r - 1500) / SCALE, phi: r.rd / SCALE, sigma: r.vol };
}

/** g(phi): how much an opponent's RD dampens the expected-score function. */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(mu, mu_j, phi_j): expected score of this player vs opponent j. */
function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Solve for the new volatility sigma' via the Illinois (regula-falsi) variant,
 * exactly per Glickman (2013) §5.1 step 5.
 */
function newVolatility(
  sigma: number,
  phi: number,
  v: number,
  delta: number,
): number {
  const a = Math.log(sigma * sigma);
  const tau = TAU;
  const phi2 = phi * phi;
  const delta2 = delta * delta;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta2 - phi2 - v - ex);
    const den = 2 * (phi2 + v + ex) * (phi2 + v + ex);
    return num / den - (x - a) / (tau * tau);
  };

  // Initialize the bracket [A, B] (step 2).
  let A = a;
  let B: number;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);

  // Illinois iteration (step 4).
  while (Math.abs(B - A) > CONVERGENCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

/**
 * Update one player's rating from a batch of results in a rating period.
 *
 * If `opponents` is empty, this is a "no games this period" step: rating and
 * volatility are unchanged and RD inflates by the standard
 * phi' = sqrt(phi^2 + sigma^2) rule (Glickman §5.1, "did not compete").
 */
export function update(
  player: Rating,
  opponents: ReadonlyArray<{ opponent: Rating; score: 0 | 0.5 | 1 }>,
): Rating {
  const { mu, phi, sigma } = toGlicko2(player);

  if (opponents.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return {
      r: player.r,
      rd: Math.min(phiStar * SCALE, RD_MAX),
      vol: sigma,
    };
  }

  // Step 3: variance v of the rating from game outcomes.
  let vInv = 0;
  // Step 4: delta — estimated improvement.
  let deltaSum = 0;
  for (const { opponent, score } of opponents) {
    const oj = toGlicko2(opponent);
    const gj = g(oj.phi);
    const ej = E(mu, oj.mu, oj.phi);
    vInv += gj * gj * ej * (1 - ej);
    deltaSum += gj * (score - ej);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: new volatility.
  const sigmaPrime = newVolatility(sigma, phi, v, delta);

  // Step 6: pre-rating-period RD.
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);

  // Step 7: new RD and rating.
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return {
    r: muPrime * SCALE + 1500,
    rd: Math.min(phiPrime * SCALE, RD_MAX),
    vol: sigmaPrime,
  };
}

/**
 * RD inflation for inactivity: confidence decays, rating does not.
 *
 * Applies the "did not compete" RD step `periodsInactive` times:
 *   phi <- sqrt(phi^2 + sigma^2)   (per period)
 * which monotonically inflates RD toward the RD_MAX ceiling while leaving
 * r and vol untouched. periodsInactive = 0 is the identity.
 */
export function decay(player: Rating, periodsInactive: number): Rating {
  if (periodsInactive < 0 || !Number.isInteger(periodsInactive)) {
    throw new Error("periodsInactive must be a non-negative integer");
  }
  let { phi } = toGlicko2(player);
  const sigma = player.vol;
  for (let i = 0; i < periodsInactive; i++) {
    phi = Math.sqrt(phi * phi + sigma * sigma);
    if (phi * SCALE >= RD_MAX) {
      phi = RD_MAX / SCALE;
      break;
    }
  }
  return {
    r: player.r,
    rd: Math.min(phi * SCALE, RD_MAX),
    vol: sigma,
  };
}
