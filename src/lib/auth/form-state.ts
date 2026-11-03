/** Result of a form Server Action, read by `useActionState`. */
export type FormState = {
  status: "idle" | "error" | "success";
  /** Shown above the form (errors) or in place of it (success). */
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Entered values to put back after an error. Never includes passwords. */
  values?: Record<string, string>;
};

export const initialFormState: FormState = { status: "idle" };

export function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
