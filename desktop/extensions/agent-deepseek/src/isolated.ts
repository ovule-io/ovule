// This adapter is bundled into the owning UI snapshot; it never executes in main world.
type IsolatedBindings = {
  customElements: CustomElementRegistry;
  context(element: HTMLElement): { request(method: string, params: unknown): Promise<unknown> };
};
export const isolated = (
  globalThis as typeof globalThis & { tuffite: { isolated: IsolatedBindings } }
).tuffite.isolated;
export const registry: CustomElementRegistry = isolated.customElements;
export function request<T = unknown>(
  element: HTMLElement,
  method: string,
  params: unknown = null,
): Promise<T> {
  return isolated.context(element).request(method, params) as Promise<T>;
}
