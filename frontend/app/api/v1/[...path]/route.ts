/**
 * Same-origin proxy to the Go API.
 *
 * The browser only ever talks to the Next.js origin (`/api/v1/*`), and this handler forwards the
 * request to the Go API. That keeps the console working however it is opened (localhost, 127.0.0.1,
 * a LAN IP, a tunnel or port forward) without CORS, and lets one image run in any environment:
 * the upstream is read at request time from API_INTERNAL_URL (e.g. http://backend:8080 in Compose).
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:8080";

// Hop-by-hop headers must not be forwarded; length/encoding are recomputed because fetch decompresses bodies.
const STRIPPED_REQUEST_HEADERS = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "host", "content-length", "accept-encoding"];
const STRIPPED_RESPONSE_HEADERS = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "content-length", "content-encoding"];

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
    const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
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
