import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth.js";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null | undefined;
};

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser;
  }
}

export const sessionMiddleware = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  return next();
});
