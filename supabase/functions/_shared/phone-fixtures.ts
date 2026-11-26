/** Inputs and the stored value both phone normalizers must give for each. */
export const PHONE_FIXTURES: ReadonlyArray<readonly [string, string | null]> = [
  ["(512) 555-0123", "+15125550123"],
  ["5125550123", "+15125550123"],
  ["+15125550123", "+15125550123"],
  ["1 512 555 0123", "+15125550123"],
  ["+442079460958", "+442079460958"],
  ["+11235550123", null],
  ["555-0123", null],
  ["", null],
  ["   ", null],
];
