import { LoaderCircle } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";

import { cn } from "./cn";

export const Skeleton = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-skeleton", className)} aria-hidden="true" {...props} />
);

export function Spinner({
  className,
  ...props
}: ComponentProps<typeof LoaderCircle>) {
  return (
    <LoaderCircle
      className={cn("ui-spinner", className)}
      aria-hidden="true"
      {...props}
    />
  );
}
