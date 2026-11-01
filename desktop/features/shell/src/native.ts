type TuffiteNativeBridge = {
  invoke?: unknown;
};

export const isNative =
  typeof window !== "undefined" &&
  typeof (globalThis as typeof globalThis & { tuffite?: TuffiteNativeBridge }).tuffite?.invoke ===
    "function";
