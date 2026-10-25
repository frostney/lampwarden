const HUNDRED = 100;

/** A number rounded to two decimal places. */
export const hundredths = (value: number) => Math.round(value * HUNDRED) / HUNDRED;
