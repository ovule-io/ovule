import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { PanelLeft } from "lucide-react";

import { cn } from "./cn";
import "./sidebar.css";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error("useSidebar must be used inside a <SidebarProvider>");
  }
  return value;
}

export function SidebarProvider({
  open: controlledOpen,
  defaultOpen = true,
  onOpenChange,
  className,
  children,
  ...props
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const value = useMemo<SidebarContextValue>(
    () => ({ open, setOpen, toggle }),
    [open, setOpen, toggle],
  );
  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        data-state={open ? "open" : "closed"}
        className={cn("ui-sidebar-wrapper", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export const Sidebar = forwardRef<
  HTMLElement,
  {
    side?: "left" | "right";
  } & HTMLAttributes<HTMLElement>
>(function Sidebar({ side = "left", className, children, ...props }, ref) {
  return (
    <aside
      ref={ref}
      data-slot="sidebar"
      data-side={side}
      className={cn("ui-sidebar", className)}
      {...props}
    >
      <div data-slot="sidebar-inner" className="ui-sidebar-inner">
        {children}
      </div>
    </aside>
  );
});

export function SidebarHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("ui-sidebar-header", className)}
      {...props}
    />
  );
}

export function SidebarFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("ui-sidebar-footer", className)}
      {...props}
    />
  );
}

export function SidebarContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("ui-sidebar-content", className)}
      {...props}
    />
  );
}

export function SidebarGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-group"
      role="group"
      className={cn("ui-sidebar-group", className)}
      {...props}
    />
  );
}

export function SidebarGroupLabel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn("ui-sidebar-group-label", className)}
      {...props}
    />
  );
}

export function SidebarGroupContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="sidebar-group-content"
      className={cn("ui-sidebar-group-content", className)}
      {...props}
    />
  );
}

export function SidebarSeparator({
  className,
  ...props
}: HTMLAttributes<HTMLHRElement>) {
  return (
    <hr
      data-slot="sidebar-separator"
      className={cn("ui-sidebar-separator", className)}
      {...props}
    />
  );
}

export function SidebarMenu({
  className,
  ...props
}: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("ui-sidebar-menu", className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({
  className,
  ...props
}: HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("ui-sidebar-menu-item", className)}
      {...props}
    />
  );
}

export const SidebarMenuButton = forwardRef<
  HTMLButtonElement,
  {
    isActive?: boolean;
    size?: "sm" | "md";
  } & ComponentProps<"button">
>(function SidebarMenuButton(
  { className, type = "button", isActive = false, size = "md", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // eslint-disable-next-line react/button-has-type
      type={type}
      data-slot="sidebar-menu-button"
      data-active={isActive ? "true" : undefined}
      data-size={size}
      className={cn("ui-sidebar-menu-button", className)}
      {...props}
    />
  );
});

export const SidebarMenuAction = forwardRef<
  HTMLButtonElement,
  {
    showOnHover?: boolean;
  } & ComponentProps<"button">
>(function SidebarMenuAction(
  { className, type = "button", showOnHover = false, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // eslint-disable-next-line react/button-has-type
      type={type}
      data-slot="sidebar-menu-action"
      data-show-on-hover={showOnHover ? "true" : undefined}
      className={cn("ui-sidebar-menu-action", className)}
      {...props}
    />
  );
});

export function SidebarMenuSub({
  className,
  ...props
}: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      className={cn("ui-sidebar-menu-sub", className)}
      {...props}
    />
  );
}

export function SidebarMenuSubItem({
  className,
  ...props
}: HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      className={cn("ui-sidebar-menu-sub-item", className)}
      {...props}
    />
  );
}

export const SidebarMenuSubButton = forwardRef<
  HTMLButtonElement,
  {
    isActive?: boolean;
  } & ComponentProps<"button">
>(function SidebarMenuSubButton(
  { className, type = "button", isActive = false, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // eslint-disable-next-line react/button-has-type
      type={type}
      data-slot="sidebar-menu-sub-button"
      data-active={isActive ? "true" : undefined}
      className={cn("ui-sidebar-menu-sub-button", className)}
      {...props}
    />
  );
});

export const SidebarTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button">
>(function SidebarTrigger(
  { className, onClick, type = "button", children, ...props },
  ref,
) {
  const { toggle } = useSidebar();
  return (
    <button
      ref={ref}
      // eslint-disable-next-line react/button-has-type
      type={type}
      data-slot="sidebar-trigger"
      aria-label="Toggle sidebar"
      className={cn("ui-sidebar-trigger", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggle();
      }}
      {...props}
    >
      {children ?? <PanelLeft size={14} aria-hidden />}
    </button>
  );
});

export function SidebarInset({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("ui-sidebar-inset", className)}
      {...props}
    />
  );
}
