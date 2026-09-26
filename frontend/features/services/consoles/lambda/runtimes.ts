/** Runtimes offered for inline code editing (Floci runs them with the public.ecr.aws/lambda base images). */

type Family = "nodejs" | "python" | "ruby";

export interface RuntimeOption {
  value: string;
  label: string;
  family: Family;
}

export const RUNTIMES: RuntimeOption[] = [
  { value: "nodejs22.x", label: "Node.js 22.x", family: "nodejs" },
  { value: "nodejs20.x", label: "Node.js 20.x", family: "nodejs" },
  { value: "python3.13", label: "Python 3.13", family: "python" },
  { value: "python3.12", label: "Python 3.12", family: "python" },
  { value: "python3.11", label: "Python 3.11", family: "python" },
  { value: "ruby3.3", label: "Ruby 3.3", family: "ruby" },
];

export const DEFAULT_ROLE = "arn:aws:iam::000000000000:role/lambda-role";

const EXTENSIONS: Record<Family, string> = { nodejs: ".mjs", python: ".py", ruby: ".rb" };

export function runtimeFamily(runtime: string | undefined): Family | null {
  return RUNTIMES.find((r) => r.value === runtime)?.family ?? (runtime?.startsWith("nodejs") ? "nodejs" : runtime?.startsWith("python") ? "python" : runtime?.startsWith("ruby") ? "ruby" : null);
}

export function defaultHandler(runtime: string): string {
  return runtimeFamily(runtime) === "nodejs" ? "index.handler" : "lambda_function.lambda_handler";
}

/** "index.handler" + nodejs -> "index.mjs"; "src/app.main" + python -> "src/app.py". */
export function codeFileName(handler: string, runtime: string): string {
  const family = runtimeFamily(runtime) ?? "nodejs";
  const dot = handler.lastIndexOf(".");
  const moduleName = dot > 0 ? handler.slice(0, dot) : handler || "index";
  return `${moduleName}${EXTENSIONS[family]}`;
}

export function defaultCode(runtime: string): string {
  switch (runtimeFamily(runtime)) {
    case "python":
      return `import json


def lambda_handler(event, context):
    print("Received event: " + json.dumps(event))
    return {
        "statusCode": 200,
        "body": json.dumps({"message": "Hello from Lambda!", "input": event}),
    }
`;
    case "ruby":
      return `require 'json'

def lambda_handler(event:, context:)
  puts "Received event: #{event.to_json}"
  { statusCode: 200, body: { message: 'Hello from Lambda!', input: event }.to_json }
end
`;
    default:
      return `export const handler = async (event, context) => {
  console.log("Received event:", JSON.stringify(event));
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello from Lambda!", input: event }),
  };
};
`;
  }
}

/**
 * Remembers inline code deployed from this browser, keyed by function and CodeSha256,
 * because Floci serves the deployed package only through Code.Location (not reachable from the browser).
 */
const STORAGE_PREFIX = "aws-local-console:lambda-code:";

export interface StoredCode {
  sha: string;
  fileName: string;
  code: string;
}

export function rememberCode(region: string, functionName: string, value: StoredCode) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${region}:${functionName}`, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode); the editor falls back to the template.
  }
}

export function recallCode(region: string, functionName: string): StoredCode | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${region}:${functionName}`);
    return raw ? (JSON.parse(raw) as StoredCode) : null;
  } catch {
    return null;
  }
}

export function forgetCode(region: string, functionName: string) {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${region}:${functionName}`);
  } catch {
    // ignore
  }
}

export const ENV_KEY_PATTERN = /^[a-zA-Z]([a-zA-Z0-9_])+$/;
