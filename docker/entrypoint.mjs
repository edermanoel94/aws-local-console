// Container entrypoint: runs the Go API and the Next.js web server in one container.
//
// The API listens on API_PORT (8080) and is reached only through the web server's /api/v1 proxy
// (API_INTERNAL_URL). If the API exits unexpectedly the whole container exits with its status, so
// Docker's restart policy (or the healthcheck) surfaces the failure instead of a half-working console.
import { spawn } from "node:child_process";

const apiPort = process.env.API_PORT ?? "8080";
process.env.API_INTERNAL_URL ??= `http://127.0.0.1:${apiPort}`;

let stopping = false;

const api = spawn("/app/bin/api", [], {
  // The Go API reads PORT; the web server keeps its own PORT.
  env: { ...process.env, PORT: apiPort },
  stdio: "inherit",
});

api.on("error", (err) => {
  console.error(`[entrypoint] failed to start the API: ${err.message}`);
  process.exit(1);
});

api.on("exit", (code, signal) => {
  // During `docker stop` the API is signalled first; once it is gone the container can exit.
  if (stopping) process.exit(0);
  console.error(`[entrypoint] API exited unexpectedly (${signal ?? `code ${code}`}); stopping the container`);
  process.exit(code ?? 1);
});

// Registered before the web server loads, so the API is signalled first on `docker stop`.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    api.kill(signal);
  });
}

// Next.js standalone server (listens on HOSTNAME:PORT).
await import("/app/server.js");
