import type { ReactNode } from "react";
type Props = {
  threadId?: string;
  onComplete(): void;
};
export interface RouteRuntime {
  OnboardingPage: (arg0: Props) => ReactNode;
}
