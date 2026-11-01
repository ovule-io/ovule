import type { AnchorHTMLAttributes, HTMLAttributes } from "react";

import { cn } from "./cn";

export function Breadcrumb({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <nav
      aria-label="breadcrumb"
      className={cn("cm-breadcrumb", className)}
      {...props}
    />
  );
}

export function BreadcrumbList({
  className,
  ...props
}: HTMLAttributes<HTMLOListElement>) {
  return <ol className={cn("cm-breadcrumb-list", className)} {...props} />;
}

export function BreadcrumbItem({
  className,
  ...props
}: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn("cm-breadcrumb-item", className)} {...props} />;
}

export function BreadcrumbLink({
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cn("cm-breadcrumb-link", className)} {...props} />;
}

export function BreadcrumbSeparator({
  className,
  children = "/",
  ...props
}: HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      aria-hidden="true"
      className={cn("cm-breadcrumb-separator", className)}
      {...props}
    >
      {children}
    </li>
  );
}
