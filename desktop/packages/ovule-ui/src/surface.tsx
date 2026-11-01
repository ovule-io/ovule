import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export const Card = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-card", className)} {...props} />
);
export const CardHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-card-header", className)} {...props} />
);
export const CardTitle = ({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("ui-card-title", className)} {...props} />
);
export const CardDescription = ({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("ui-card-description", className)} {...props} />
);
export const CardContent = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-card-content", className)} {...props} />
);
export const CardFooter = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="card-footer"
    className={cn("ui-card-footer", className)}
    {...props}
  />
);
export const Badge = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("ui-badge", className)} {...props} />
);
export const Separator = ({
  className,
  ...props
}: HTMLAttributes<HTMLHRElement>) => (
  <hr className={cn("ui-separator", className)} {...props} />
);
