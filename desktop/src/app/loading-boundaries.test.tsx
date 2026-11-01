import { describe, expect, test } from "bun:test";
import { Suspense } from "react";
import { renderToString } from "react-dom/server";
import { createToken } from "@ovule/ioc";
import { createRegistry } from "@ovule/ioc-container";
import { useServiceAsync } from "@ovule/ioc/react";
import { ScopeProvider } from "@ovule/ioc-container/react";

const DeferredToken = createToken<string>("DeferredViewData");
function DeferredView() {
  return <section>{useServiceAsync(DeferredToken)}</section>;
}

// A pending feature must select its explicit boundary, rather than an implicit
// boundary around all services and the application shell.
describe("feature loading boundaries", () => {
  test("service providers preserve the caller's loading boundary", () => {
    const container = createRegistry().register(DeferredToken, () => new Promise<string>(() => {}));
    const html = renderToString(
      <Suspense fallback={<span>feature pending</span>}>
        <ScopeProvider registry={container}>
          <DeferredView />
        </ScopeProvider>
      </Suspense>,
    );
    expect(html).toContain("feature pending");
  });

  test("a delayed feature leaves shell and independent surfaces visible", () => {
    const container = createRegistry().register(DeferredToken, () => new Promise<string>(() => {}));
    const html = renderToString(
      <ScopeProvider registry={container}>
        <header>window controls</header>
        <Suspense fallback={null}>
          <DeferredView />
        </Suspense>
        <section>conversation stays mounted</section>
      </ScopeProvider>,
    );
    expect(html).toContain("window controls");
    expect(html).toContain("conversation stays mounted");
  });
});
