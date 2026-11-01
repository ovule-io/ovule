import omniboxViewTokens from "./omnibox.token";
import type { Register } from "@ovule/ioc";
import { create, value } from "@ovule/ioc";
import { Omnibox } from "./Omnibox.tsx";

export default function register(register: Register): void {
  register(omniboxViewTokens.omniboxView, value(Omnibox));
}
