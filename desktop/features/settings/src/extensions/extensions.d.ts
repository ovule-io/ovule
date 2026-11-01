import type { ExtensionCatalogView } from "@ovule/shell-api";
export type { ExtensionCatalogView } from "@ovule/shell-api";

export type ExtensionCatalogHook = () => {
  catalog?: ExtensionCatalogView;
  error?: string;
  refresh(): Promise<void>;
};
