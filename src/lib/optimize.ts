/**
 * Stop-order optimization over a travel-duration matrix.
 *
 * This is an OPEN path, not a closed tour: a sightseeing day ends wherever the
 * last stop is, so the cost never includes a return leg to the start.
 */

export interface OptimizeOptions {
  /** Keep the first stop where it is (e.g. the hotel you start from). */
  pinStart?: boolean;
  /** Keep the last stop where it is (e.g. a dinner reservation). */
  pinEnd?: boolean;
}

/** Total travel time of a visiting order, in the matrix's units. */
export function pathCost(order: number[], matrix: number[][]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) total += matrix[order[i - 1]][order[i]];
  return total;
}

function nearestNeighbour(matrix: number[][], start: number, allowed: Set<number>): number[] {
  const order = [start];
  const remaining = new Set(allowed);
  remaining.delete(start);

  let current = start;
  while (remaining.size) {
    let best = -1;
    let bestCost = Infinity;
    for (const cand of remaining) {
      const cost = matrix[current][cand];
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
    order.push(best);
    remaining.delete(best);
    current = best;
  }
  return order;
}

/**
 * 2-opt: repeatedly reverse a sub-segment when doing so shortens the path.
 * Bounded by maxPasses so a pathological matrix cannot spin.
 */
function twoOpt(order: number[], matrix: number[][], lockFirst: boolean, lockLast: boolean): number[] {
  const best = order.slice();
  const lo = lockFirst ? 1 : 0;
  const hi = lockLast ? best.length - 2 : best.length - 1;

  let improved = true;
  let passes = 0;
  while (improved && passes < 40) {
    improved = false;
    passes++;
    for (let i = lo; i <= hi - 1; i++) {
      for (let j = i + 1; j <= hi; j++) {
        const candidate = best.slice();
        // Reverse the [i..j] window.
        let a = i;
        let b = j;
        while (a < b) {
          const t = candidate[a];
          candidate[a] = candidate[b];
          candidate[b] = t;
          a++;
          b--;
        }
        if (pathCost(candidate, matrix) < pathCost(best, matrix) - 1e-9) {
          best.splice(0, best.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Returns an index order that is never worse than the input order.
 *
 * Nearest-neighbour alone is greedy and can end badly; 2-opt cleans up the
 * crossings it leaves behind. The final comparison against the original order
 * guarantees pressing "Optimize" can only help.
 */
export function optimizeOrder(matrix: number[][], opts: OptimizeOptions = {}): number[] {
  const n = matrix.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);

  const identity = Array.from({ length: n }, (_, i) => i);
  const { pinStart = false, pinEnd = false } = opts;

  const lastIndex = n - 1;
  const movable = new Set(identity);
  if (pinEnd) movable.delete(lastIndex);

  let candidate: number[];
  if (pinStart) {
    candidate = nearestNeighbour(matrix, 0, movable);
  } else {
    // Without a fixed start, try every seed and keep the cheapest.
    let best: number[] | null = null;
    for (const seed of movable) {
      const attempt = nearestNeighbour(matrix, seed, movable);
      if (!best || pathCost(attempt, matrix) < pathCost(best, matrix)) best = attempt;
    }
    candidate = best ?? identity.slice();
  }
  if (pinEnd) candidate.push(lastIndex);

  candidate = twoOpt(candidate, matrix, pinStart, pinEnd);

  return pathCost(candidate, matrix) < pathCost(identity, matrix) ? candidate : identity;
}
