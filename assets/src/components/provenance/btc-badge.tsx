import { clsx } from "clsx";
import { ReactNode } from "react";

interface BitcoinVerifiedBadgeProps {
  verified?: boolean;
  text: number | ReactNode;
  className?: string;
}

export function BtcBadge({
  text,
  verified = false,
  className,
}: BitcoinVerifiedBadgeProps) {
  // Format number with commas
  const formattedAmount =
    typeof text === "number" ? text.toLocaleString("en-US") : text;

  const variantStyles = {
    verified: {
      background:
        "bg-gradient-to-br from-emerald-500 via-green-500 to-teal-600",
      symbolBg: "bg-gradient-to-br from-white to-emerald-50",
      symbolColor: "text-emerald-600",
      shadow: "shadow-md shadow-emerald-500/30",
    },
    pending: {
      background:
        "bg-gradient-to-br from-orange-500 via-amber-500 to-orange-600",
      symbolBg: "bg-gradient-to-br from-white to-orange-50",
      symbolColor: "text-orange-600",
      shadow: "shadow-md shadow-orange-500/30",
    },
  };

  const styles = variantStyles[verified ? "verified" : "pending"];

  return (
    <div
      className={clsx(
        "inline-flex items-center gap-1.5 w-full p-2 rounded-lg",
        styles.background,
        styles.shadow,
        "transition-shadow duration-200 hover:shadow-xl",
        verified ? "hover:shadow-emerald-500/40" : "hover:shadow-orange-500/40",
        className
      )}
    >
      {/* Bitcoin symbol in square with gradient */}
      <div
        className={clsx(
          "flex flex-none items-center justify-center w-8 h-8 rounded shadow-sm",
          styles.symbolBg
        )}
      >
        <span
          className={clsx("font-bold text-xl leading-none", styles.symbolColor)}
        >
          ₿
        </span>
      </div>

      {/* Amount display with enhanced typography */}
      <div className="flex flex-col justify-center text-left space-y-0.5">
        <span className="text-white font-medium text-base leading-tight whitespace-nowrap tracking-wide drop-shadow-sm">
          {formattedAmount}
        </span>
        <span className="text-white/80 font-medium text-[0.5rem] leading-tight whitespace-nowrap">
          Node Drive
        </span>
      </div>
    </div>
  );
}
