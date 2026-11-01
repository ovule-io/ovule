import { redirect, type RouteObject } from "react-router";
import Root, { ErrorBoundary } from "./root";
import { HydrateFallback } from "./HydrateFallback";

export default [
  {
    Component: Root,
    ErrorBoundary,
    HydrateFallback,
    children: [
      { index: true, loader: () => redirect("/main") },
      { path: "main", lazy: async () => ({ Component: (await import("./main/route")).default }) },
      {
        path: "thread",
        lazy: async () => ({ Component: (await import("./thread/route")).default }),
      },
      { path: "pane", lazy: async () => ({ Component: (await import("./pane/route")).default }) },
      {
        path: "explorer",
        lazy: async () => ({ Component: (await import("./explorer/route")).default }),
      },
    ],
  },
] satisfies RouteObject[];
