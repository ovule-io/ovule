/** Stable identity and a default factory; instances belong to scopes. */
export interface ServiceFactory<T> {
  readonly name: string;
  readonly factory: Factory<T>;
}
export type Factory<T> = (dependsOn: DependsOn) => T | PromiseLike<T>;

export type ServiceOf<F> =
  F extends ServiceFactory<infer T> ? T : F extends Token<infer T> ? T : never;
export type Token<T> = symbol & { readonly __service?: T };
export type ServiceKey<T> = Token<T> | ServiceFactory<T>;

export interface DependsOn {
  <T>(service: ServiceKey<T>): T;
  optional<T>(service: ServiceKey<T>): T | undefined;
  async<T>(service: ServiceKey<T>): Promise<T>;
  onDispose(cleanup: () => void | Promise<void>): void;
}

export function create<T>(
  factory: Factory<T>,
  name = factory.name || "Service",
): ServiceFactory<T> {
  return Object.freeze({ name, factory });
}

export function createToken<T>(name: string): Token<T> {
  return Symbol(name) as Token<T>;
}

/** Group token identities into an immutable, typed module API. */
export function tokens<const T extends Record<string, Token<unknown>>>(
  values: T,
): Readonly<T> {
  return Object.freeze(values);
}

export function value<T>(instance: T): Factory<T> {
  return () => instance;
}

/** Registration capability for package providers; no container access. */
export interface Register {
  <T>(token: Token<T>, factory: Factory<T>): void;
}
