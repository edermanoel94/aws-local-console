/** Subset of the AWS SDK Go v2 S3 output shapes used by the console (PascalCase pass-through). */

export interface S3Bucket {
  Name: string;
  CreationDate?: string;
  BucketRegion?: string | null;
}

export interface ListBucketsOutput {
  Buckets?: S3Bucket[];
}

export interface S3Object {
  Key: string;
  Size?: number;
  LastModified?: string;
  ETag?: string;
  StorageClass?: string;
}

export interface ListObjectsV2Output {
  Contents?: S3Object[] | null;
  CommonPrefixes?: { Prefix: string }[] | null;
  KeyCount?: number;
  IsTruncated?: boolean;
}

export interface S3Version {
  Key: string;
  VersionId?: string;
  IsLatest?: boolean;
  Size?: number;
  LastModified?: string;
  ETag?: string;
}

export interface ListObjectVersionsOutput {
  Versions?: S3Version[] | null;
  DeleteMarkers?: S3Version[] | null;
}

export interface HeadObjectOutput {
  ContentLength?: number;
  ContentType?: string;
  LastModified?: string;
  ETag?: string;
  VersionId?: string | null;
  StorageClass?: string | null;
  Metadata?: Record<string, string> | null;
  CacheControl?: string | null;
  ContentEncoding?: string | null;
}

export interface GetObjectOutput extends HeadObjectOutput {
  Body?: string | { base64: string };
}

export type NotificationEvent = string;

export interface QueueConfiguration {
  Id?: string | null;
  QueueArn: string;
  Events: NotificationEvent[];
}

export interface LambdaConfiguration {
  Id?: string | null;
  LambdaFunctionArn: string;
  Events: NotificationEvent[];
}

export interface TopicConfiguration {
  Id?: string | null;
  TopicArn: string;
  Events: NotificationEvent[];
}

export interface NotificationConfiguration {
  EventBridgeConfiguration?: Record<string, never> | null;
  QueueConfigurations?: QueueConfiguration[] | null;
  LambdaFunctionConfigurations?: LambdaConfiguration[] | null;
  TopicConfigurations?: TopicConfiguration[] | null;
}
