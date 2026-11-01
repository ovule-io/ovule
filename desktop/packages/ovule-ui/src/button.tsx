import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button-secondary",
      primary: "ui-button-primary",
      secondary: "ui-button-secondary",
      ghost: "ui-button-ghost",
      danger: "ui-button-danger",
    },
    size: {
      default: "ui-button-default",
      sm: "ui-button-sm",
      icon: "ui-button-icon",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: Props) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export function IconButton({
  variant = "ghost",
  size = "icon",
  ...props
}: Props) {
  return (
    <Button data-slot="icon-button" variant={variant} size={size} {...props} />
  );
}
