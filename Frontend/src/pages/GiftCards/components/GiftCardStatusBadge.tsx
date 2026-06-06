import { Badge } from "../../../components/ui/badge";
import type { GiftCardStatus } from "../types";
import { getStatusClasses, getStatusLabel } from "./utils";

interface GiftCardStatusBadgeProps {
  status: GiftCardStatus;
}

export function GiftCardStatusBadge({ status }: GiftCardStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${getStatusClasses(status)}`}
    >
      {getStatusLabel(status)}
    </Badge>
  );
}
