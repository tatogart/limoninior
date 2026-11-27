// One handler per drawer opening; native button clicks also support keyboard activation.
export function createAdminTapHandler({ isAdmin, open, now = () => Date.now() }) {
  let taps = 0, last = -Infinity;
  return () => {
    if (!isAdmin()) { taps = 0; last = -Infinity; return; }
    const time = now();
    if (time - last > 1800 || time < last) taps = 0;
    last = time;
    if (++taps === 5) {
      taps = 0; last = -Infinity;
      open();
    }
  };
}
