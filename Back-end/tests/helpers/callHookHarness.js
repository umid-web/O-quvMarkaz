// Deterministic hook lifecycle double for device/network race tests, not a browser renderer.
let current;
const sameDeps = (left, right) => left && right && left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
export function useRef(initial) {
  const runner = current;
  const index = runner.index++;
  return runner.slots[index] ??= { current: initial };
}
export function useState(initial) {
  const runner = current;
  const index = runner.index++;
  if (!(index in runner.slots)) runner.slots[index] = typeof initial === 'function' ? initial() : initial;
  return [runner.slots[index], (value) => { runner.slots[index] = typeof value === 'function' ? value(runner.slots[index]) : value; }];
}
export function useCallback(callback, deps) {
  const runner = current;
  const index = runner.index++;
  if (!sameDeps(runner.slots[index]?.deps, deps)) runner.slots[index] = { callback, deps };
  return runner.slots[index].callback;
}
export function useEffect(effect, deps) {
  const runner = current;
  const index = runner.index++;
  if (!sameDeps(runner.slots[index]?.deps, deps)) {
    const previous = runner.slots[index];
    runner.effects.push(() => {
      previous?.cleanup?.();
      runner.slots[index] = { deps, cleanup: effect() };
    });
  }
}
export function createHookHarness(hook, ...args) {
  const runner = { slots: [], effects: [], index: 0 };
  return {
    render() {
      runner.index = 0;
      current = runner;
      let result;
      try { result = hook(...args); } finally { current = undefined; }
      for (const effect of runner.effects.splice(0)) effect();
      return result;
    },
    unmount() { for (const slot of runner.slots) slot?.cleanup?.(); },
  };
}
