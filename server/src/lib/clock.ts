/** Injectable clock so time-window compliance logic is deterministic under test. */
let fixed: Date | null = null;
export const clock = {
  now: () => (fixed ? new Date(fixed) : new Date()),
  set: (d: Date | null) => { fixed = d; },
};
