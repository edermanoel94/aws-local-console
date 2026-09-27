/**
 * Best-effort cleanup through the Go API (CONTRACT section 7: allowed in afterAll only).
 * Never throws: cleanup problems must not fail a test run.
 */
// The console image serves the API behind its web port (/api/v1 proxy); API_URL can point at a host-run API instead.
const API_URL = process.env.API_URL ?? process.env.BASE_URL ?? "http://localhost:4500";

export async function executeForCleanup(service: string, operation: string, input: Record<string, unknown>, region = "us-east-1"): Promise<unknown> {
  try {
    const res = await fetch(`${API_URL}/api/v1/operations/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Console-Source": "system" },
      body: JSON.stringify({ service, operation, region, input }),
    });
    const body = (await res.json()) as { status?: string; response?: { output?: unknown } };
    return body.status === "success" ? body.response?.output : undefined;
  } catch {
    return undefined;
  }
}

export const cleanup = {
  bucket: (name: string) => executeForCleanup("s3", "DeleteBucket", { Bucket: name }),
  queue: (name: string) => executeForCleanup("sqs", "DeleteQueue", { QueueUrl: `http://localhost:4566/000000000000/${name}` }),
  table: (name: string) => executeForCleanup("dynamodb", "DeleteTable", { TableName: name }),
  topic: (name: string) => executeForCleanup("sns", "DeleteTopic", { TopicArn: `arn:aws:sns:us-east-1:000000000000:${name}` }),
  /** Deletes the function and its log group: like real AWS, Floci keeps /aws/lambda/<name> after DeleteFunction. */
  async function(name: string) {
    await executeForCleanup("lambda", "DeleteFunction", { FunctionName: name });
    await executeForCleanup("logs", "DeleteLogGroup", { logGroupName: `/aws/lambda/${name}` });
  },
  async eventSourceMappings(functionName: string) {
    const out = (await executeForCleanup("lambda", "ListEventSourceMappings", { FunctionName: functionName })) as { EventSourceMappings?: { UUID?: string }[] } | undefined;
    for (const m of out?.EventSourceMappings ?? []) {
      if (m.UUID) await executeForCleanup("lambda", "DeleteEventSourceMapping", { UUID: m.UUID });
    }
  },
};
