import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="alert" className={cn("cm-alert", className)} {...props} />;
}

export function AlertTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("cm-alert-title", className)} {...props} />;
}

export function AlertDescription({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cm-alert-description", className)} {...props} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cn("cm-empty", className)} {...props}>
      {icon ? <div className="cm-empty-icon">{icon}</div> : null}
      <div className="cm-empty-title">{title}</div>
      {description ? (
        <div className="cm-empty-description">{description}</div>
      ) : null}
      {action ? <div className="cm-empty-action">{action}</div> : null}
    </div>
  );
}
