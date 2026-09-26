export interface FunctionConfiguration {
  FunctionName: string;
  FunctionArn: string;
  Runtime?: string;
  Handler?: string;
  Role?: string;
  CodeSize?: number;
  CodeSha256?: string;
  Description?: string;
  Timeout?: number;
  MemorySize?: number;
  LastModified?: string;
  State?: string;
  LastUpdateStatus?: string;
  PackageType?: string;
  Architectures?: string[];
  Environment?: { Variables?: Record<string, string> | null } | null;
  LoggingConfig?: { LogGroup?: string } | null;
}

export interface EventSourceMapping {
  UUID: string;
  EventSourceArn?: string;
  FunctionArn?: string;
  State?: string;
  BatchSize?: number;
  LastModified?: string;
}

export function logGroupOf(fn: Pick<FunctionConfiguration, "FunctionName" | "LoggingConfig">) {
  return fn.LoggingConfig?.LogGroup || `/aws/lambda/${fn.FunctionName}`;
}
