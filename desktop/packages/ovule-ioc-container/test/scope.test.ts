import { expect, test } from "bun:test";
import { create, createToken, value } from "@ovule/ioc";
import {
  createRegistry,
  createScope,
  INTERNAL_SUSPENSE_READ,
} from "@ovule/ioc-container";

test("definitions are lazy and cached per owning scope; configuration freezes", async () => {
  let calls = 0;
  const A = create(() => ({ id: ++calls }), "A");
  const registry = createRegistry().register(A);
  const root = createScope(registry);
  expect(calls).toBe(0);
  expect(() => registry.register(A, value({ id: 8 }))).toThrow("frozen");
  const child = createScope(createRegistry(), root);
  expect(child.get(A)).toBe(root.get(A));
  const override = createScope(
    createRegistry().register(A, value({ id: 8 })),
    root,
  );
  expect(override.get(A).id).toBe(8);
  await child.dispose();
  expect(root.get(A).id).toBe(1);
});
test("parent factories resolve in parent, child overrides cannot rewrite them", () => {
  const A = create(() => "root", "A");
  const B = create((d) => d(A), "B");
  const root = createScope(createRegistry().register(B));
  const child = createScope(createRegistry().register(A, value("child")), root);
  expect(child.get(A)).toBe("child");
  expect(child.get(B)).toBe("root");
});
test("reports sync paths and concurrent async waiting cycles", async () => {
  const A = createToken<number>("A"),
    B = createToken<number>("B");
  const sync = createScope(
    createRegistry()
      .register(A, (d) => d(B))
      .register(B, (d) => d(A)),
  );
  expect(() => sync.get(A)).toThrow("B -> A -> B");
  const scope = createScope(
    createRegistry()
      .register(A, async (d) => {
        await Promise.resolve();
        return d.async(B);
      })
      .register(B, async (d) => {
        await Promise.resolve();
        return d.async(A);
      }),
  );
  const results = await Promise.allSettled([
    scope.getAsync(A),
    scope.getAsync(B),
  ]);
  expect(results.every((r) => r.status === "rejected")).toBe(true);
});
test("Suspense reuses pending result and failure; dispose cleans reverse dependency order", async () => {
  const order: string[] = [];
  const A = create((d) => {
    d.onDispose(() => {
      order.push("A");
    });
    return 1;
  }, "A");
  const B = create(async (d) => {
    const a = d(A);
    d.onDispose(() => {
      order.push("B");
    });
    await Promise.resolve();
    return a + 1;
  }, "B");
  const scope = createScope(createRegistry());
  let first: unknown, second: unknown;
  try {
    scope[INTERNAL_SUSPENSE_READ](B);
  } catch (e) {
    first = e;
  }
  try {
    scope[INTERNAL_SUSPENSE_READ](B);
  } catch (e) {
    second = e;
  }
  expect(first).toBe(second);
  await first;
  expect(scope.get(B)).toBe(2);
  await scope.dispose();
  expect(order).toEqual(["B", "A"]);
  expect(scope.dispose()).toBe(scope.dispose());
  expect(() => scope.get(A)).toThrow("disposed");
});
test("late async results and failed construction resources are cleaned", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((r) => {
    finish = r;
  });
  const cleaned: string[] = [];
  const A = create(async (d) => {
    d.onDispose(() => {
      cleaned.push("late");
    });
    await gate;
    return {};
  });
  const B = create((d) => {
    d.onDispose(() => {
      cleaned.push("failed");
    });
    throw new Error("failure");
  });
  const scope = createScope(createRegistry());
  const pending = scope.getAsync(A);
  expect(() => scope.get(B)).toThrow("failure");
  const disposal = scope.dispose();
  finish();
  await Promise.all([pending, disposal]);
  expect(cleaned).toEqual(["late", "failed"]);
});

test("parent disposal awaits child consumers before disposing dependencies", async () => {
  const order: string[] = [];
  const A = create((d) => {
    d.onDispose(() => {
      order.push("parent");
    });
    return 1;
  }, "A");
  const B = create((d) => {
    const a = d(A);
    d.onDispose(async () => {
      await Promise.resolve();
      order.push("child");
    });
    return a;
  }, "B");
  const root = createScope(createRegistry().register(A));
  const child = createScope(createRegistry().register(B, B.factory), root);
  child.get(B);
  await root.dispose();
  expect(order).toEqual(["child", "parent"]);
  expect(() => child.get(B)).toThrow("disposed");
});

test("missing bindings, thenables and cached failure retain their semantics", async () => {
  const Missing = createToken<number>("Missing");
  const Answer = create<number>(
    () => ({ then: (resolve) => Promise.resolve(resolve(42)) }),
    "Answer",
  );
  let calls = 0;
  const Broken = create(() => {
    calls++;
    throw new Error("broken");
  }, "Broken");
  const scope = createScope(createRegistry());
  expect(scope.getOptional(Missing)).toBeUndefined();
  expect(() => scope.get(Missing)).toThrow(
    "No provider registered for Missing",
  );
  expect(() => scope.get(Answer)).toThrow("use getAsync");
  expect(await scope.getAsync(Answer)).toBe(42);
  await expect(scope.getAsync(Broken)).rejects.toThrow("broken");
  expect(() => scope.get(Broken)).toThrow("broken");
  expect(calls).toBe(1);
  await scope.dispose();
});

test("failed consumers clean before dependencies, even when a cleanup fails", async () => {
  const order: string[] = [];
  const A = create((d) => {
    d.onDispose(() => {
      order.push("A");
    });
    return 1;
  }, "A");
  const B = create((d) => {
    d(A);
    d.onDispose(() => {
      order.push("B");
      throw new Error("cleanup failed");
    });
    throw new Error("construction failed");
  }, "B");
  const scope = createScope(createRegistry());
  expect(() => scope.get(B)).toThrow("construction failed");
  await expect(scope.dispose()).rejects.toBeInstanceOf(AggregateError);
  expect(order).toEqual(["B", "A"]);
});

test("unregistered defaults belong to the requesting scope and consume its overrides", async () => {
  const Backend = createToken<string>("Backend");
  const View = create((dependsOn) => ({ backend: dependsOn(Backend) }));
  const root = createScope(createRegistry().register(Backend, value("root")));
  const child = createScope(
    createRegistry().register(Backend, value("child")),
    root,
  );
  expect(child.get(View).backend).toBe("child");
  expect(root.get(View).backend).toBe("root");
  expect(child.get(View)).not.toBe(root.get(View));
  await root.dispose();
});

test("optional factory dependencies preserve missing binding semantics", async () => {
  const Missing = createToken<string>("optional backend");
  const Consumer = create(
    (dependsOn) => dependsOn.optional(Missing) ?? "fallback",
  );
  const scope = createScope(createRegistry());
  expect(scope.get(Consumer)).toBe("fallback");
  await scope.dispose();
});

test("factory capabilities expire before service methods execute", async () => {
  const Backend = create(() => "backend");
  const Consumer = create((dependsOn) => ({
    lateRead: () => dependsOn(Backend),
  }));
  const scope = createScope(createRegistry());
  const service = scope.get(Consumer);
  expect(() => service.lateRead()).toThrow("only valid during construction");
  await scope.dispose();
});
