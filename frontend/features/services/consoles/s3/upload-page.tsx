"use client";

import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Panel, TextAreaField, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { formatBytes } from "../_shared/format";
import { KeyValueEditor, RadioCards, type KeyValue } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { readFileForUpload } from "./s3-utils";

const schema = z.object({
  source: z.enum(["file", "text"]),
  key: z.string().trim().min(1, "Enter an object key.").max(1024, "Object keys can be at most 1024 characters."),
  content: z.string(),
  contentType: z.string().trim(),
});

type FormValues = z.infer<typeof schema>;

interface UploadVars extends FormValues {
  file: File | null;
  metadata: KeyValue[];
  tags: KeyValue[];
}

export function UploadPage({ bucket }: { bucket: string }) {
  const { prefix: rawPrefix, navigate } = useConsoleNav();
  const prefix = rawPrefix ?? "";
  const fileInputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [metadata, setMetadata] = useState<KeyValue[]>([]);
  const [tags, setTags] = useState<KeyValue[]>([]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { source: "file", key: prefix, content: "", contentType: "" },
  });
  const source = useWatch({ control: form.control, name: "source" });
  const back = () => navigate({ resource: bucket, prefix: prefix || null });

  const upload = useConsoleAction<UploadVars>({
    run: async (v, exec) => {
      const input: Record<string, unknown> = { Bucket: bucket, Key: v.key };
      if (v.source === "file" && v.file) {
        const data = await readFileForUpload(v.file);
        if ("text" in data) input.Body = data.text;
        else input.BodyBase64 = data.base64;
        input.ContentType = v.contentType || v.file.type || "application/octet-stream";
      } else {
        input.Body = v.content;
        input.ContentType = v.contentType || "text/plain";
      }
      const meta = Object.fromEntries(v.metadata.filter((m) => m.key.trim()).map((m) => [m.key.trim().toLowerCase(), m.value]));
      if (Object.keys(meta).length) input.Metadata = meta;
      const tagging = v.tags
        .filter((t) => t.key.trim())
        .map((t) => `${encodeURIComponent(t.key.trim())}=${encodeURIComponent(t.value)}`)
        .join("&");
      if (tagging) input.Tagging = tagging;
      await exec("s3", "PutObject", input);
    },
    successMessage: (v) => `Object ${v.key} uploaded`,
    onSuccess: back,
  });

  const onSubmit = form.handleSubmit((values) => {
    if (values.source === "file" && !file) {
      setFileError("Choose a file to upload.");
      return;
    }
    upload.mutate({ ...values, file, metadata, tags });
  });

  const { errors } = form.formState;

  return (
    <FormPage
      crumbs={[{ label: "Buckets", to: {} }, { label: bucket, to: { resource: bucket, prefix: prefix || null } }, { label: "Upload" }]}
      title="Upload"
      description={
        <>
          Add a file or text content to <span className="font-mono">s3://{bucket}/{prefix}</span>.
        </>
      }
      onSubmit={onSubmit}
      onCancel={back}
      submitLabel="Upload"
      submitting={upload.isPending}
      error={upload.error}
    >
      <Panel title="Source">
        <div className="flex flex-col gap-4">
          <Controller
            control={form.control}
            name="source"
            render={({ field }) => (
              <RadioCards
                legend="Content source"
                name="source"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: "file", label: "Upload a file", description: "Choose a file from your computer." },
                  { value: "text", label: "Enter text", description: "Type or paste the object content." },
                ]}
              />
            )}
          />
          {source === "file" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={fileInputId} className="text-sm font-bold text-aws-ink">
                File
              </label>
              <input
                id={fileInputId}
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setFileError(undefined);
                  if (f) {
                    form.setValue("key", `${prefix}${f.name}`, { shouldValidate: true });
                    if (!form.getValues("contentType")) form.setValue("contentType", f.type);
                  }
                }}
                className="text-sm file:mr-3 file:rounded-full file:border file:border-aws-border-strong file:bg-aws-surface file:px-4 file:py-1 file:text-sm file:font-bold file:text-aws-ink hover:file:bg-aws-panel"
              />
              {file && (
                <p className="text-xs text-aws-muted">
                  {file.name} - {formatBytes(file.size)}
                </p>
              )}
              {fileError && <p className="text-xs text-aws-red">{fileError}</p>}
            </div>
          ) : (
            <TextAreaField label="Content" rows={8} placeholder="Hello from AWS Local Console" {...form.register("content")} />
          )}
        </div>
      </Panel>
      <Panel title="Destination">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Object key" placeholder="folder/file.txt" error={errors.key?.message} {...form.register("key")} />
          <TextField label="Content type" placeholder={source === "file" ? "Detected from the file" : "text/plain"} {...form.register("contentType")} />
        </div>
      </Panel>
      <Panel title="Metadata - optional" description="User-defined metadata is stored as x-amz-meta-* headers.">
        <KeyValueEditor rows={metadata} onChange={setMetadata} keyLabel="Metadata key" valueLabel="Metadata value" addLabel="Add metadata" emptyText="No metadata." />
      </Panel>
      <Panel title="Tags - optional">
        <KeyValueEditor rows={tags} onChange={setTags} keyLabel="Tag key" valueLabel="Tag value" addLabel="Add new tag" emptyText="No tags associated with this object." />
      </Panel>
    </FormPage>
  );
}
