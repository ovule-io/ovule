import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { cn } from "./cn";
import { Popover, PopoverContent, PopoverTrigger } from "./overlays";

export type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function Combobox({
  value,
  options,
  onValueChange,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No options found.",
  ariaLabel,
  disabled,
  className,
}: {
  value?: string;
  options: readonly ComboboxOption[];
  onValueChange(value: string): void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn("ui-combobox-trigger", className)}
        >
          <span className="ui-combobox-value">
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="ui-combobox-content"
        align="start"
        side="bottom"
      >
        <Command>
          <CommandInput
            aria-label={`Search ${ariaLabel}`}
            placeholder={searchPlaceholder}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description ?? ""}`}
                  disabled={option.disabled}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className="ui-combobox-check"
                    data-selected={option.value === value || undefined}
                    size={14}
                    aria-hidden="true"
                  />
                  <span className="ui-combobox-option-copy">
                    <span>{option.label}</span>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
