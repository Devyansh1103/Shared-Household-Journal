import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type FormAlertProps = {
  tone: "error" | "success" | "info" | "warning";
  children: React.ReactNode;
  className?: string;
};

const ICONS = {
  error: OctagonXIcon,
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
};

const VARIANTS = {
  error: "destructive",
  success: "default",
  info: "default",
  warning: "warning",
} as const;

/** Form-level message. Errors interrupt (`alert`); other tones are polite (`status`). */
export function FormAlert({ tone, children, className }: FormAlertProps) {
  const Icon = ICONS[tone];
  return (
    <Alert
      variant={VARIANTS[tone]}
      role={tone === "error" ? "alert" : "status"}
      className={className}
    >
      <Icon aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
