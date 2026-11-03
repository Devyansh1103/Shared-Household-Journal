import { CircleCheckIcon, InfoIcon, OctagonXIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type FormAlertProps = {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
  className?: string;
};

const ICONS = { error: OctagonXIcon, success: CircleCheckIcon, info: InfoIcon };

/** Form-level message. Errors interrupt (`alert`); other tones are polite (`status`). */
export function FormAlert({ tone, children, className }: FormAlertProps) {
  const Icon = ICONS[tone];
  return (
    <Alert
      variant={tone === "error" ? "destructive" : "default"}
      role={tone === "error" ? "alert" : "status"}
      className={className}
    >
      <Icon aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
