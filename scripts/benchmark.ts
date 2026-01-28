import { render } from "../src/html";
import { jsx } from "../src/jsx";

const ITERATIONS = 100_000;

console.log(
  `Running benchmarks with ${ITERATIONS.toLocaleString()} iterations...`,
);

// ---------------------------------------------------------
// 1. VNode Creation
// ---------------------------------------------------------
const startVNode = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  jsx("div", { id: "test", children: "hello" });
}
const endVNode = performance.now();
const vnodeTime = endVNode - startVNode;
console.log(
  `[VNode Creation] Total: ${vnodeTime.toFixed(2)}ms | Avg: ${((vnodeTime * 1000) / ITERATIONS).toFixed(4)}µs/op | Ops/sec: ${(ITERATIONS / (vnodeTime / 1000)).toLocaleString()}`,
);

// ---------------------------------------------------------
// 2. Simple Render (Sync)
// ---------------------------------------------------------
const vnode = jsx("div", { id: "test", children: "hello" });

const startRender = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const res = render(vnode);
  res.toString();
}
const endRender = performance.now();
const renderTime = endRender - startRender;
console.log(
  `[Simple Render]  Total: ${renderTime.toFixed(2)}ms | Avg: ${((renderTime * 1000) / ITERATIONS).toFixed(4)}µs/op | Ops/sec: ${(ITERATIONS / (renderTime / 1000)).toLocaleString()}`,
);

// ---------------------------------------------------------
// 3. Complex Tree Render
// ---------------------------------------------------------
const Complex = ({ depth = 0 }: { depth?: number }) => {
  if (depth > 5) return jsx("span", { children: "leaf" });
  return jsx("div", {
    children: [
      jsx("span", { children: "1" }),
      jsx(Complex, { depth: depth + 1 }),
    ],
  });
};
const complexNode = jsx(Complex, {});

// Warmup
await render(complexNode);

const startComplex = performance.now();
// Reducing iterations for complex render to avoid taking too long
const COMPLEX_ITERATIONS = 10_000;
for (let i = 0; i < COMPLEX_ITERATIONS; i++) {
  const res = render(complexNode);
  if (res instanceof Promise) await res;
  else res.toString();
}
const endComplex = performance.now();
const complexTime = endComplex - startComplex;
console.log(
  `[Complex Render] Total: ${complexTime.toFixed(2)}ms | Avg: ${((complexTime * 1000) / COMPLEX_ITERATIONS).toFixed(4)}µs/op | Ops/sec: ${(COMPLEX_ITERATIONS / (complexTime / 1000)).toLocaleString()} (Iterations: ${COMPLEX_ITERATIONS.toLocaleString()})`,
);
