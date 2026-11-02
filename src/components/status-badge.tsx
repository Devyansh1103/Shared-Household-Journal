import {
  CircleCheckIcon,
  CircleDashedIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const statuses = {
  success: { icon: CircleCheckIcon, variant: "success" },
  warning: { icon: TriangleAlertIcon, variant: "warning" },
  danger: { icon: OctagonXIcon, variant: "destructive" },
  info: { icon: InfoIcon, variant: "info" },
  neutral: { icon: CircleDashedIcon, variant: "outline" },
} as const;

type StatusBadgeProps = {
  status: keyof typeof statuses;
  /** Visible label — required so status is never conveyed by colour alone. */
  children: React.ReactNode;
  className?: string;
};

export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  const { icon: Icon, variant } = statuses[status];
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {children}
    </Badge>
  );
}
