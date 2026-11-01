import { expect, test } from "bun:test";
import * as construction from "../src";
test("construction API defines identities without owning instances", () => {
  let calls = 0;
  const Service = construction.create(() => ++calls, "Counter");
  expect(calls).toBe(0);
  expect(Object.isFrozen(Service)).toBe(true);
  expect("createScope" in construction).toBe(false);
  expect("createRegistry" in construction).toBe(false);
});

test("token groups retain distinct identities and cannot be mutated", () => {
  const first = construction.createToken<number>("Port");
  const second = construction.createToken<number>("Port");
  const group = construction.tokens({ first, second });
  expect(group.first).toBe(first);
  expect(group.second).not.toBe(first);
  expect(Object.isFrozen(group)).toBe(true);
  expect(Reflect.set(group, "first", second)).toBe(false);
});
