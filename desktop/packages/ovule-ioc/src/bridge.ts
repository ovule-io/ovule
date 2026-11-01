/** Container integration only; not a business-module entry point. */
import { createContext } from "react";
import type { ServiceKey } from "./index";
export interface Reader {
  read<T>(key: ServiceKey<T>): T;
  readAsync<T>(key: ServiceKey<T>): T;
  readOptional<T>(key: ServiceKey<T>): T | undefined;
}
export const ReaderContext = createContext<Reader | undefined>(undefined);
