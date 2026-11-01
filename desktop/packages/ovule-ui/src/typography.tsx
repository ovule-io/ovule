import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export function Typeset({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-typeset", className)} {...props} />;
}

export function Marker({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <mark className={cn("ui-marker", className)} {...props} />;
}
