import { OTPInput, OTPInputContext, type OTPInputProps } from "input-otp";
import { Minus } from "lucide-react";
import { useContext, type ComponentProps } from "react";

import { cn } from "./cn";

export function InputOTP({
  className,
  containerClassName,
  ...props
}: OTPInputProps) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn("ui-input-otp", containerClassName)}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

export { REGEXP_ONLY_DIGITS } from "input-otp";

export function InputOTPGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn("ui-input-otp-group", className)}
      {...props}
    />
  );
}

export function InputOTPSlot({
  index,
  className,
  ...props
}: ComponentProps<"div"> & { index: number }) {
  const context = useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = context?.slots[index] ?? {};
  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn("ui-input-otp-slot", className)}
      {...props}
    >
      {char}
      {hasFakeCaret && <span className="ui-input-otp-caret" />}
    </div>
  );
}

export function InputOTPSeparator(props: ComponentProps<"div">) {
  return (
    <div data-slot="input-otp-separator" role="separator" {...props}>
      <Minus size={14} />
    </div>
  );
}
