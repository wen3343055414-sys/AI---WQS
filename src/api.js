import { HttpError } from "./store.js";

const cookieToken = (request) => request.headers.cookie?.match(/(?:^|;\s*)wqs_session=([a-f0-9]{64})(?:;|$)/)?.[1] || "";
const limit = 16 * 1024 * 1024;
function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")) throw new HttpError(415, "json_required", "请使用 JSON 请求。");
  return new Promise((resolve, reject) => {
    let size = 0, rejected = false;
    const chunks = [];
    request.on("data", chunk => {
      size += chunk.length;
      if (size > limit) { if (!rejected) reject(new HttpError(413, "body_too_large", "工作空间超过 16 MB，请先导出并减少资料。")); rejected = true; return; }
      if (!rejected) chunks.push(chunk);
    });
    request.on("end", () => { if (rejected) return; try { const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required"); resolve(body); } catch { reject(new HttpError(400, "invalid_json", "JSON 格式无效。")); } });
    request.on("error", reject);
  });
}

export function createApi(store, version, modelClient) {
  const attempts = new Map();
  return async (request, response, pathname, json) => {
    if (!pathname.startsWith("/api/")) return false;
    const method = request.method;
    const readOnly = method === "GET" || method === "HEAD";
    const token = cookieToken(request);
    const user = store.sessionUser(token);
    const authenticated = Boolean(user);
    const setSession = value => response.setHeader("Set-Cookie", `wqs_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? 604800 : 0}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`);
    try {
      if (!readOnly) {
        const origin = request.headers.origin;
        let originMatches = !origin;
        if (origin) { try { originMatches = new URL(origin).host === request.headers.host; } catch { originMatches = false; } }
        if (request.headers["sec-fetch-site"] === "cross-site" || !originMatches) throw new HttpError(403, "origin_rejected", "请求来源不匹配。");
      }
      if (pathname === "/api/health") {
        if (!readOnly) { response.setHeader("Allow", "GET, HEAD"); throw new HttpError(405, "method_not_allowed", "Method not allowed"); }
        json(200, { status: "ok", app: "AI---WQS" }); return true;
      }
      if (pathname === "/api/status" && readOnly) {
        json(200, { mode: "server", setupRequired: !store.hasOwner(), authenticated, version, serverId: store.instanceId(), user, legacyAccount: store.legacyLoginHint(), authMethods: { account: true, email: true, sms: false } }); return true;
      }
      if (["/api/sms/send", "/api/login/sms"].includes(pathname) && method === "POST") {
        await readJson(request);
        throw new HttpError(503, "sms_unavailable", "手机验证码登录暂未开通，请使用账号或邮箱登录。");
      }
      if (["/api/setup", "/api/register", "/api/login"].includes(pathname) && method === "POST") {
        const key = (request.socket.remoteAddress || "local") + (pathname === "/api/register" ? ":register" : ":login");
        const attempt = attempts.get(key);
        if (attempt?.count >= 10 && attempt.until > Date.now()) throw new HttpError(429, "rate_limited", "尝试次数过多，请 15 分钟后重试。");
        const body = await readJson(request);
        let signedIn;
        if (pathname === "/api/setup") signedIn = store.setup(body.password);
        else if (pathname === "/api/register") {
          attempts.set(key, { count: attempt?.until > Date.now() ? attempt.count + 1 : 1, until: Date.now() + 15 * 60_000 });
          signedIn = store.register(body);
        } else {
          if (body.method && !["account", "email"].includes(body.method)) throw new HttpError(400, "invalid_method", "请选择可用的登录方式。");
          const loginMethod = body.method === "email" || body.email !== undefined ? "email" : "account";
          const identifier = loginMethod === "email" ? body.email : body.account;
          if (body.method && typeof identifier !== "string") throw new HttpError(400, "missing_identifier", "请输入账号或邮箱。");
          signedIn = store.authenticateUser(identifier, body.password, loginMethod);
          if (!signedIn) {
            attempts.set(key, { count: attempt?.until > Date.now() ? attempt.count + 1 : 1, until: Date.now() + 15 * 60_000 });
            throw new HttpError(401, "invalid_credentials", "账号或密码不正确。");
          }
        }
        if (pathname !== "/api/register") attempts.delete(key);
        setSession(store.createSession(signedIn.id));
        json(pathname === "/api/register" ? 201 : 200, { authenticated: true, user: signedIn });
        return true;
      }
      if (pathname === "/api/logout" && method === "POST") { store.logout(token); setSession(""); json(200, { authenticated: false }); return true; }
      if (!authenticated) throw new HttpError(401, "authentication_required", "请先登录账号。");
      if (pathname === "/api/model-config" && method === "GET") { json(200, await modelClient.config()); return true; }
      if (pathname === "/api/chat" && method === "POST") {
        if (Number(request.headers["content-length"]) > 600_000) throw new HttpError(413, "chat_too_large", "对话请求过大，请新建对话。");
        const input = await readJson(request);
        if (Buffer.byteLength(JSON.stringify(input)) > 600_000) throw new HttpError(413, "chat_too_large", "对话请求过大，请新建对话。");
        if ((input.userId !== undefined && input.userId !== user.id) || (input.userId === undefined && !user.legacy)) throw new HttpError(401, "account_changed", "账号已切换，请重新登录。");
        const { userId, ...chatInput } = input;
        json(200, await modelClient.chat(chatInput, { userId: user.id, legacy: user.legacy })); return true;
      }
      if (pathname === "/api/workspace" && readOnly) { json(200, { ...store.read(user.id), userId: user.id }); return true; }
      if (pathname === "/api/workspace" && method === "PUT") {
        const body = await readJson(request);
        if ((body.userId !== undefined && body.userId !== user.id) || (body.userId === undefined && !user.legacy)) throw new HttpError(401, "account_changed", "账号已切换，请重新登录。");
        json(200, store.save(body.state, body.baseRevision, user.id)); return true;
      }
      throw new HttpError(404, "not_found", "接口不存在。");
    } catch (error) {
      if (error instanceof HttpError) json(error.status, { error: error.code, message: error.message, ...error.extra });
      else { console.error("API error:", error.name); json(500, { error: "server_error", message: "服务器暂时无法完成操作，已有修改仍保留在当前页面。" }); }
      return true;
    }
  };
}
