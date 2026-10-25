// Command-line options the pipeline scripts share.

/**
 * A count given on the command line (`--concurrency`, `--candidates`, `--vcpus`, ...): digits only, from 1 to `maximum`,
 * or the fallback when it is not given. Anything else stops the script before it does any work, since 0, a typo or
 * `1e3` would otherwise run nothing (and still report success) or far too much.
 */
export function countOption(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  const count = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!(count >= 1 && count <= maximum))
    throw new Error(
      maximum === Number.MAX_SAFE_INTEGER
        ? `--${name} takes a whole number of at least 1, not "${value}"`
        : `--${name} takes a whole number from 1 to ${maximum}, not "${value}"`,
    );
  return count;
}
