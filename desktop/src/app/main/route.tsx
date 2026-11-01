import { RouteServicesProvider } from "@/providers";
import { App } from "./App";
import { registerMainServices } from "./services";

export default function MainRoute() {
  return (
    <RouteServicesProvider register={registerMainServices}>
      <App />
    </RouteServicesProvider>
  );
}
