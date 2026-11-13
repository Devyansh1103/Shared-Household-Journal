import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export type AssigneeOption = { userId: string; displayName: string };

/**
 * Who it's for: nobody, or a current member. Someone who has left stays
 * chosen only while it's still assigned to them (D13), marked "(left)".
 * Uncontrolled on purpose: its default is what was submitted, so a form reset
 * after an error keeps the choice (see ExpenseForm).
 */
export function AssigneeField({
  id,
  label,
  description,
  members,
  former,
  defaultValue,
  error,
  viewerId,
}: {
  id: string;
  label: string;
  description?: string;
  /** Active members in the order they joined. */
  members: AssigneeOption[];
  /** The current assignee, when they have left. */
  former?: AssigneeOption | null;
  defaultValue: string;
  error?: string;
  viewerId: string;
}) {
  const describedBy =
    [description ? `${id}-help` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        name="assignee"
        className="w-full"
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      >
        <NativeSelectOption value="">Nobody</NativeSelectOption>
        {members.map((member) => (
          <NativeSelectOption key={member.userId} value={member.userId}>
            {member.userId === viewerId
              ? `${member.displayName} (you)`
              : member.displayName}
          </NativeSelectOption>
        ))}
        {former ? (
          <NativeSelectOption value={former.userId}>
            {former.displayName} (left)
          </NativeSelectOption>
        ) : null}
      </NativeSelect>
      {description ? (
        <FieldDescription id={`${id}-help`}>{description}</FieldDescription>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
