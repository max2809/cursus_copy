function sendJson(res, statusCode, body) {
  res.status(statusCode);
  res.setHeader("content-type", "application/json");
  return res.json(body);
}

function noContent(res) {
  res.status(204);
  return res.end();
}

function routePath(req) {
  return new URL(req.url, "https://cursus-copy.vercel.app").pathname;
}

function handler(req, res) {
  res.setHeader("access-control-allow-origin", "https://cursus-copy.vercel.app");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,accept");

  if (req.method === "OPTIONS") return noContent(res);

  const path = routePath(req);
  if (path === "/health" || path === "/api/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (path === "/api/auth/magic-link" && req.method === "POST") {
    return sendJson(res, 200, { ok: true });
  }

  if (path === "/api/auth/session" && req.method === "DELETE") {
    return noContent(res);
  }

  if (
    path === "/api/deadlines" ||
    path === "/api/auth/me" ||
    path.startsWith("/api/courses") ||
    path.startsWith("/api/study-plan") ||
    path === "/api/sync"
  ) {
    return sendJson(res, 401, { detail: "not authenticated" });
  }

  return sendJson(res, 404, { detail: "not found" });
}

module.exports = handler;
