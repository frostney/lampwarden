/**
 * The result of the first band whose bound `value` is below, or `otherwise` past the last: a threshold ladder such as
 * `band(tide, [[0.85, "calm"], [1.15, "restless"]], "raging")`. Bands are checked in order, so list the bounds rising.
 */
export function band<T>(value: number, bands: readonly (readonly [below: number, result: T])[], otherwise: T): T {
  for (const [below, result] of bands) {
    if (value < below) {
      return result;
    }
  }
  return otherwise;
}
