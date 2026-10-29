import type { Instrumentation } from "next";

// Every error the Next.js server captures (pages, server actions, route handlers) is logged as one
// structured line, with the path and route — never the request headers, cookies or body.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log, errorFields } = await import("@/server/log");
  log("error", "Request failed", {
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    ...errorFields(err),
  });
};
