"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CameraIcon,
  FileTextIcon,
  ReceiptTextIcon,
  UploadIcon,
} from "lucide-react";
import { cn } from "cn";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { imageProblemMessage, sniffType } from "@/lib/receipts/image";
import { RECEIPT_ACCEPT, RECEIPT_PICK_MAX_BYTES } from "@/lib/receipts/limits";
import { PrepareError, prepareReceipt } from "@/lib/receipts/prepare";

export type UploadedReceipt = {
  receiptId: string;
  /** The prepared JPEG that was uploaded (shown on the page). */
  image: Blob;
  /** The same picture, lossless: what OCR reads. */
  ocrImage: Blob;
  fromPdf: boolean;
};

type Status = "idle" | "preparing" | "uploading";

function subscribeToPointer(onChange: () => void) {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Phones and tablets: offer the camera as well as the file picker. */
function useTouchScreen() {
  return useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

function size(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Choose, drop or photograph a receipt; check and prepare it in the browser;
 * upload it. One request key per chosen file, so a repeated click or a retry
 * after a dropped connection stores it once.
 */
export function ReceiptPicker({
  householdId,
  actionLabel,
  onUploaded,
}: {
  householdId: string;
  actionLabel: string;
  onUploaded: (receipt: UploadedReceipt) => void;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const chosen = useRef<File | null>(null);
  const touch = useTouchScreen();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const busy = status !== "idle";

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function choose(next: File | undefined | null) {
    if (!next || busy) return;
    chosen.current = next;
    setFile(next);
    setRequestKey(crypto.randomUUID());
    setPreview(null);
    if (next.size === 0) return setError(imageProblemMessage("empty"));
    if (next.size > RECEIPT_PICK_MAX_BYTES)
      return setError(imageProblemMessage("too_large"));
    setError(null);
    // What it really is, from its first bytes: a preview only for a real
    // image (never for a file that merely claims to be one), and a wrong
    // type said straight away.
    void next
      .slice(0, 16)
      .arrayBuffer()
      .then((head) => {
        if (chosen.current !== next) return; // another file was chosen since
        const type = sniffType(new Uint8Array(head));
        if (type === null) setError(imageProblemMessage("unsupported_type"));
        else if (type !== "application/pdf")
          setPreview(URL.createObjectURL(next));
      })
      .catch(() => setError(imageProblemMessage("corrupt")));
  }

  function clear() {
    chosen.current = null;
    setFile(null);
    setPreview(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  async function upload() {
    if (!file || !requestKey || busy) return;
    setError(null);
    setStatus("preparing");
    try {
      const prepared = await prepareReceipt(file);
      setStatus("uploading");
      const body = new FormData();
      body.append("file", prepared.blob, "receipt.jpg");
      body.append("requestKey", requestKey);
      let response: Response;
      try {
        response = await fetch(`/api/households/${householdId}/receipts`, {
          method: "POST",
          body,
        });
      } catch {
        throw new Error(
          "The upload didn't get through. Check your connection and try again.",
        );
      }
      const answer = (await response.json().catch(() => ({}))) as {
        receiptId?: string;
        message?: string;
      };
      if (!response.ok || typeof answer.receiptId !== "string") {
        throw new Error(
          answer.message ?? "The receipt couldn't be uploaded. Try again.",
        );
      }
      onUploaded({
        receiptId: answer.receiptId,
        image: prepared.blob,
        ocrImage: prepared.ocrImage,
        fromPdf: prepared.fromPdf,
      });
    } catch (problem) {
      setError(
        problem instanceof PrepareError
          ? imageProblemMessage(problem.problem)
          : problem instanceof Error && problem.message
            ? problem.message
            : "The receipt couldn't be uploaded. Try again.",
      );
    } finally {
      setStatus("idle");
    }
  }

  const isPdf =
    file?.type === "application/pdf" || /\.pdf$/i.test(file?.name ?? "");

  return (
    <div className="space-y-4">
      {file ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row">
          {preview ? (
            // A local preview (blob: URL), never uploaded as is.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Preview of the chosen receipt"
              className="h-32 w-24 shrink-0 rounded-md border border-border bg-muted object-cover"
            />
          ) : (
            <div className="flex h-32 w-24 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
              <FileTextIcon
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
              <span className="sr-only">
                {isPdf ? "PDF document" : "Chosen file"}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate type-label" title={file.name}>
              {file.name}
            </p>
            <p className="type-help">
              {size(file.size)}
              {isPdf ? " · PDF (the first page is read)" : ""}
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" onClick={upload} disabled={busy}>
                <UploadIcon aria-hidden="true" data-icon="inline-start" />
                {status === "preparing"
                  ? "Preparing…"
                  : status === "uploading"
                    ? "Uploading…"
                    : error
                      ? "Try again"
                      : actionLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={clear}
                disabled={busy}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0]);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-card p-6 text-center",
            dragging && "border-primary bg-muted",
          )}
        >
          <ReceiptTextIcon
            aria-hidden="true"
            className="size-8 text-muted-foreground"
          />
          <div className="space-y-1">
            <p className="type-label">
              {touch ? "Take a photo of the receipt" : "Drop a receipt here"}
            </p>
            <p className="type-help" id={`${id}-help`}>
              A JPEG, PNG or WebP photo, or a one-page PDF, up to 10 MB.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {touch ? (
              <Button
                type="button"
                onClick={() => cameraInput.current?.click()}
              >
                <CameraIcon aria-hidden="true" data-icon="inline-start" />
                Take a photo
              </Button>
            ) : null}
            <Button
              type="button"
              variant={touch ? "outline" : "default"}
              onClick={() => fileInput.current?.click()}
              aria-describedby={`${id}-help`}
            >
              Choose a file
            </Button>
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={RECEIPT_ACCEPT}
        aria-label="Receipt file"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => choose(event.target.files?.[0])}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Receipt photo"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => choose(event.target.files?.[0])}
      />

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <p className="sr-only" aria-live="polite">
        {status === "preparing"
          ? "Preparing the receipt."
          : status === "uploading"
            ? "Uploading the receipt."
            : ""}
      </p>
    </div>
  );
}
