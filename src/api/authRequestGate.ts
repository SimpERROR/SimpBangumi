let pendingTransitions = 0;
let resolveReady: (() => void) | null = null;
let ready = Promise.resolve();

export function waitForAuthReady(): Promise<void> {
  return ready;
}

export async function withAuthTransition<T>(operation: () => Promise<T>): Promise<T> {
  if (pendingTransitions === 0) {
    ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
  }
  pendingTransitions += 1;
  try {
    return await operation();
  } finally {
    pendingTransitions -= 1;
    if (pendingTransitions === 0) {
      const resolve = resolveReady;
      resolveReady = null;
      resolve?.();
    }
  }
}