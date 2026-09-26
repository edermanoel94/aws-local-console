"use client";

import { useState } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { TextField } from "./field";
import { ErrorAlert } from "./error-alert";

interface ConfirmDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  resourceKind: string;
  resourceName: string;
  loading?: boolean;
  error?: unknown;
}

/** Delete confirmation that requires typing the resource name (CONTRACT section 6). */
export function ConfirmDeleteDialog({ open, onClose, onConfirm, resourceKind, resourceName, loading, error }: ConfirmDeleteDialogProps) {
  const [typed, setTyped] = useState("");
  const close = () => {
    setTyped("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Delete ${resourceKind}`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={typed !== resourceName} loading={loading} onClick={onConfirm}>
            Confirm delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Permanently delete {resourceKind} <strong className="break-all">{resourceName}</strong>? This action cannot be undone.
        </p>
        <TextField label="Type the name to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={resourceName} autoComplete="off" />
        {error ? <ErrorAlert error={error} /> : null}
      </div>
    </Dialog>
  );
}
