import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { Button } from "@ovule/ui/button";
import { cn } from "@ovule/ui/cn";
import type { ThemeMode } from "./preferences";
import styles from "./ThemeCards.module.css";

const modes: ThemeMode[] = ["system", "light", "dark"];

export function ThemeCards({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange(value: ThemeMode): void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn("theme-toggle", styles.choices)}
      role="radiogroup"
      aria-labelledby="settings-theme-label"
    >
      {modes.map((mode) => (
        <Button
          variant="ghost"
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          tabIndex={value === mode ? 0 : -1}
          data-theme-choice={mode}
          className={styles.choice}
          onClick={() => onChange(mode)}
          onKeyDown={(event) => {
            const index = modes.indexOf(mode);
            const next =
              event.key === "ArrowRight" || event.key === "ArrowDown"
                ? modes[(index + 1) % modes.length]
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? modes[(index + modes.length - 1) % modes.length]
                  : event.key === "Home"
                    ? modes[0]
                    : event.key === "End"
                      ? modes.at(-1)
                      : undefined;
            if (!next) return;
            event.preventDefault();
            onChange(next);
            event.currentTarget.parentElement
              ?.querySelector<HTMLButtonElement>(`[data-theme-choice="${next}"]`)
              ?.focus();
          }}
        >
          <span className={styles.preview} data-preview-mode={mode} aria-hidden="true">
            <ThemeScene theme={mode} />
          </span>
          <span className={styles.label}>
            {t(mode === "system" ? "settings.system" : `theme.${mode}`)}
          </span>
        </Button>
      ))}
    </div>
  );
}

function ThemeScene({ theme }: { theme: ThemeMode }) {
  const id = useId().replaceAll(":", "");
  const light = {
    surface: "#fff",
    sidebar: "#fafafa",
    border: "#ddd",
    line: "#e4e4e7",
    icon: "#888",
  };
  const dark = {
    surface: "#171717",
    sidebar: "#3b3b3b",
    border: "#4a4a4a",
    line: "#5c5c5c",
    icon: "#aaa",
  };
  const fill = (part: keyof typeof light) =>
    theme === "system" ? `url(#${id}-${part})` : (theme === "dark" ? dark : light)[part];
  return (
    <svg
      className={styles.scene}
      viewBox="0 0 160 100"
      preserveAspectRatio="none"
      focusable="false"
    >
      {theme === "system" && (
        <defs>
          {Object.keys(light).map((part) => (
            <linearGradient
              key={part}
              id={`${id}-${part}`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="160"
            >
              <stop offset="50%" stopColor={light[part as keyof typeof light]} />
              <stop offset="50%" stopColor={dark[part as keyof typeof dark]} />
            </linearGradient>
          ))}
        </defs>
      )}
      <rect
        x="0.5"
        y="0.5"
        width="159"
        height="99"
        rx="8"
        fill={fill("surface")}
        stroke={fill("border")}
      />
      <path d="M8 1H26V99H8Q1 99 1 92V8Q1 1 8 1Z" fill={fill("sidebar")} />
      <path d="M26 1V99" stroke={fill("border")} />
      <Bot x={7} y={7} size={11} stroke={fill("icon")} />
      <rect x="65" y="10" width="83" height="4" rx="2" fill="#2e6bd1" />
      <rect x="35" y="25" width="95" height="4" rx="2" fill={fill("line")} />
      <rect x="35" y="33" width="47" height="4" rx="2" fill={fill("line")} />
      <rect x="35" y="41" width="95" height="4" rx="2" fill={fill("line")} />
      <rect x="55" y="56" width="93" height="4" rx="2" fill="#2e6bd1" />
      <rect x="85" y="64" width="63" height="4" rx="2" fill="#2e6bd1" />
      <rect x="35" y="79" width="114" height="14" rx="7" fill="none" stroke={fill("border")} />
      <circle cx="141" cy="86" r="3.5" fill="#2e6bd1" />
    </svg>
  );
}
