/**
 * Same-origin proxy to the Go API.
 *
 * The browser only ever talks to the Next.js origin (`/api/v1/*`), and this handler forwards the
 * request to the Go API. That keeps the console working however it is opened (localhost, 127.0.0.1,
 * a LAN IP, a tunnel or port forward) without CORS, and lets one image run in any environment:
 * the upstream is read at request time from API_INTERNAL_URL (set by docker/entrypoint.mjs in the console image).
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:8080";

// Hop-by-hop headers must not be forwarded; length/encoding are recomputed because fetch decompresses bodies.
const STRIPPED_REQUEST_HEADERS = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "host", "content-length", "accept-encoding"];
const STRIPPED_RESPONSE_HEADERS = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "content-length", "content-encoding"];

/**
 * Why fetch failed, e.g. "ECONNREFUSED 127.0.0.1:8080". Node wraps the socket error in `cause`, and when
 * both IPv6 and IPv4 are refused that cause is an AggregateError whose own message is empty.
 */
function describeFailure(err: unknown): string {
  let cause: unknown = err instanceof Error && err.cause ? err.cause : err;
  if (cause instanceof AggregateError && cause.errors.length > 0) cause = cause.errors[0];
  if (!(cause instanceof Error)) return String(cause);
  const code = (cause as NodeJS.ErrnoException).code;
  return cause.message || code || cause.name;
}

async function proxy(request: Request, { params }: RouteContext<"/api/v1/[...path]">): Promise<Response> {
  const { path } = await params;
  const search = new URL(request.url).search;
  const target = new URL(`/api/v1/${path.map(encodeURIComponent).join("/")}${search}`, API_INTERNAL_URL);

  const headers = new Headers(request.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const cause = describeFailure(err);
    console.error(`[proxy] ERROR Go API unreachable at ${API_INTERNAL_URL} for ${request.method} /api/v1/${path.join("/")}: ${cause}`);
    return Response.json(
      { error: { code: "ApiUnreachable", message: `Go API unreachable at ${API_INTERNAL_URL}: ${cause}` } },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export { proxy as DELETE, proxy as GET, proxy as HEAD, proxy as PATCH, proxy as POST, proxy as PUT };
