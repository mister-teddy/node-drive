import { useMemo, useTransition } from "react";
import { Tooltip, Typography } from "antd";
import clsx from "clsx";
import { ProvenanceBadgeProps } from "./types";
import { BtcBadge } from "./btc-badge";

const { Text } = Typography;

// Format number with commas
const formatBlockNumber = (num: number | string) => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export function ProvenanceBadge({ stamp, onClick }: ProvenanceBadgeProps) {
  const [loading, startTransition] = useTransition();

  if (!stamp) {
    return (
      <Text type="secondary" className="text-[11px]">
        —
      </Text>
    );
  }

  const [verified, text, tooltip] = useMemo(() => {
    if (stamp.status === "verified") {
      return [
        true,
        stamp.verified_height ?? 0,
        `This file's authorship proof was verified on Bitcoin block ${formatBlockNumber(
          stamp.verified_height ?? 0
        )} on ${new Date(
          (stamp.verified_timestamp ?? 0) * 1000
        ).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`,
        "#f59e0b",
      ];
    }

    return [
      false,
      <span className="text-sm">Pending</span>,
      "This file's authorship proof is pending verification on Bitcoin. Estimated completion: 1-12 hours.",
    ];
  }, [stamp]);

  return (
    <Tooltip title={tooltip}>
      <div
        onClick={
          onClick
            ? () => {
                startTransition(onClick);
              }
            : undefined
        }
        className={clsx("cursor-pointer relative", loading && "animate-pulse")}
      >
        <BtcBadge verified={verified} text={text} />
      </div>
    </Tooltip>
  );
}
