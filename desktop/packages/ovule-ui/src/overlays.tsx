import { Check } from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Context from "@radix-ui/react-context-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const DropdownMenu = Dropdown.Root;
export const DropdownMenuTrigger = Dropdown.Trigger;
export function DropdownMenuContent({
  className,
  ...props
}: ComponentProps<typeof Dropdown.Content>) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        data-slot="dropdown-menu-content"
        className={cn("ui-menu-content", className)}
        sideOffset={4}
        {...props}
      />
    </Dropdown.Portal>
  );
}
export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof Dropdown.Item>) {
  return (
    <Dropdown.Item
      data-slot="dropdown-menu-item"
      className={cn("ui-menu-item", className)}
      {...props}
    />
  );
}
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Dropdown.CheckboxItem>) {
  return (
    <Dropdown.CheckboxItem className={cn("ui-menu-item", className)} {...props}>
      <span className="ui-menu-indicator">
        <Dropdown.ItemIndicator>
          <Check size={14} />
        </Dropdown.ItemIndicator>
      </span>
      {children}
    </Dropdown.CheckboxItem>
  );
}
export const DropdownMenuRadioGroup = Dropdown.RadioGroup;
export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Dropdown.RadioItem>) {
  return (
    <Dropdown.RadioItem className={cn("ui-menu-item", className)} {...props}>
      <span className="ui-menu-indicator">
        <Dropdown.ItemIndicator>
          <Check size={14} />
        </Dropdown.ItemIndicator>
      </span>
      {children}
    </Dropdown.RadioItem>
  );
}
export const DropdownMenuSeparator = Dropdown.Separator;

export const ContextMenu = Context.Root;
export const ContextMenuTrigger = Context.Trigger;
export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof Context.Content>) {
  return (
    <Context.Portal>
      <Context.Content
        data-slot="context-menu-content"
        className={cn("ui-menu-content", className)}
        {...props}
      />
    </Context.Portal>
  );
}
export function ContextMenuItem({
  className,
  ...props
}: ComponentProps<typeof Context.Item>) {
  return (
    <Context.Item
      data-slot="context-menu-item"
      className={cn("ui-menu-item", className)}
      {...props}
    />
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({
  className,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        className={cn("ui-popover-content", className)}
        sideOffset={4}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
export const HoverCard = HoverCardPrimitive.Root;
export const HoverCardTrigger = HoverCardPrimitive.Trigger;
export function HoverCardContent({
  className,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        className={cn("ui-popover-content", className)}
        sideOffset={4}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}
export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const CollapsibleContent = CollapsiblePrimitive.Content;
