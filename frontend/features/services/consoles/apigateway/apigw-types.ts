import { ACCOUNT_ID } from "../_shared/aws";

export interface RestApi {
  Id: string;
  Name: string;
  Description?: string;
  CreatedDate?: string;
  EndpointConfiguration?: { Types?: string[] } | null;
}

export interface ApiResource {
  Id: string;
  ParentId?: string;
  Path: string;
  PathPart?: string;
  ResourceMethods?: Record<string, unknown> | null;
}

export interface Integration {
  Type?: string;
  Uri?: string;
  HttpMethod?: string;
  RequestTemplates?: Record<string, string> | null;
  IntegrationResponses?: Record<string, { StatusCode?: string; ResponseTemplates?: Record<string, string> | null }> | null;
}

export interface Method {
  HttpMethod: string;
  AuthorizationType?: string;
  MethodIntegration?: Integration | null;
  MethodResponses?: Record<string, { StatusCode?: string }> | null;
}

export interface Stage {
  StageName: string;
  DeploymentId?: string;
  Description?: string;
  CreatedDate?: string;
  LastUpdatedDate?: string;
}

export interface Deployment {
  Id: string;
  Description?: string;
  CreatedDate?: string;
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "ANY"];

export function lambdaIntegrationUri(region: string, functionArn: string) {
  return `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${functionArn}/invocations`;
}

/** Lambda function ARN embedded in an AWS_PROXY integration URI. */
export function functionArnFromUri(uri = ""): string | null {
  const m = uri.match(/functions\/(arn:aws:lambda:[^/]+)\/invocations/);
  return m ? m[1] : null;
}

export function executeApiArn(region: string, apiId: string, method: string, path: string) {
  return `arn:aws:execute-api:${region}:${ACCOUNT_ID}:${apiId}/*/${method === "ANY" ? "*" : method}${path}`;
}

/** Stage URL on Floci (path-style, usable with curl from the host). */
export function stageUrl(apiId: string, stage: string) {
  return `http://localhost:4566/restapis/${apiId}/${stage}/_user_request_`;
}

export const METHOD_TONES: Record<string, "green" | "blue" | "orange" | "red" | "gray"> = {
  GET: "green",
  POST: "blue",
  PUT: "orange",
  PATCH: "orange",
  DELETE: "red",
};
