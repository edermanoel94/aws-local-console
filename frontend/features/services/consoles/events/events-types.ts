export interface EventBus {
  Name: string;
  Arn?: string;
  Description?: string;
  CreationTime?: string;
  LastModifiedTime?: string;
}

export interface Rule {
  Name: string;
  Arn?: string;
  EventBusName?: string;
  EventPattern?: string | null;
  ScheduleExpression?: string | null;
  State?: string;
  Description?: string | null;
}

export interface Target {
  Id: string;
  Arn: string;
  Input?: string | null;
  InputPath?: string | null;
}

export const DEFAULT_BUS = "default";

export const PATTERN_TEMPLATES: { value: string; label: string; pattern: object }[] = [
  { value: "s3-object-created", label: "S3 - Object Created", pattern: { source: ["aws.s3"], "detail-type": ["Object Created"], detail: { bucket: { name: ["my-bucket"] } } } },
  { value: "custom-source", label: "Custom application events", pattern: { source: ["my.application"], "detail-type": ["Order Placed"] } },
  { value: "all-from-source", label: "All events from a source", pattern: { source: ["my.application"] } },
];

export type TargetType = "sqs" | "lambda" | "sns";

export const TARGET_TYPES: { value: TargetType; label: string }[] = [
  { value: "sqs", label: "SQS queue" },
  { value: "lambda", label: "Lambda function" },
  { value: "sns", label: "SNS topic" },
];

export function targetTypeOf(arn: string): string {
  if (arn.startsWith("arn:aws:sqs:")) return "SQS queue";
  if (arn.startsWith("arn:aws:lambda:")) return "Lambda function";
  if (arn.startsWith("arn:aws:sns:")) return "SNS topic";
  if (arn.includes(":event-bus/")) return "Event bus";
  return "Other";
}
