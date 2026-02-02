import { signal } from "@preact/signals";

const count = signal(0);

export function Counter() {
  return (
    <div
      class="card"
      style="margin-top: 2rem; padding: 1.5rem; border: 2px solid #0070f3;"
    >
      <h3>Interactive Counter (Client Side)</h3>
      <p>
        This component is transpiled on-the-fly by Abret and uses Preact
        Signals.
      </p>
      <div style="display: flex; gap: 1rem; align-items: center;">
        <button
          type="button"
          style="padding: 0.5rem 1rem; cursor: pointer;"
          onClick={() => count.value--}
        >
          -
        </button>
        <strong style="font-size: 1.5rem;">{count}</strong>
        <button
          type="button"
          style="padding: 0.5rem 1rem; cursor: pointer;"
          onClick={() => count.value++}
        >
          +
        </button>
      </div>
    </div>
  );
}
