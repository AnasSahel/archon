import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, companies, companyMembers, users } from "@archon/db";
import { sessionMiddleware } from "../middleware/session.js";

export const companiesRouter = new Hono();

companiesRouter.use("*", sessionMiddleware);

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base}-${Date.now()}`;
}

// GET /companies — list companies where user is a member
companiesRouter.get("/companies", async (c) => {
  const user = c.get("user");
  const db = getDb();

  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      mission: companies.mission,
      settings: companies.settings,
      ownerId: companies.ownerId,
      createdAt: companies.createdAt,
      updatedAt: companies.updatedAt,
      role: companyMembers.role,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(eq(companyMembers.userId, user.id));

  return c.json(rows);
});

// POST /companies — create company
companiesRouter.post(
  "/companies",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1),
      mission: z.string().optional(),
    })
  ),
  async (c) => {
    const user = c.get("user");
    const { name, mission } = c.req.valid("json");
    const db = getDb();

    const id = randomUUID();
    const slug = generateSlug(name);

    await db.insert(companies).values({
      id,
      name,
      slug,
      mission: mission ?? null,
      ownerId: user.id,
    });

    const memberId = randomUUID();
    await db.insert(companyMembers).values({
      id: memberId,
      companyId: id,
      userId: user.id,
      role: "board",
    });

    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return c.json(company, 201);
  }
);

// GET /companies/:id — get company detail (must be member)
companiesRouter.get("/companies/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const db = getDb();

  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, user.id)));

  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) {
    return c.json({ error: "Not found" }, 404);
  }

  const memberCount = await db
    .select()
    .from(companyMembers)
    .where(eq(companyMembers.companyId, id));

  return c.json({ ...company, memberCount: memberCount.length, userRole: membership.role });
});

// PATCH /companies/:id — update company (board only)
companiesRouter.patch(
  "/companies/:id",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).optional(),
      mission: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    const [membership] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, user.id)));

    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const updates: Partial<typeof companies.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.name !== undefined) updates.name = body.name;
    if (body.mission !== undefined) updates.mission = body.mission;

    await db.update(companies).set(updates).where(eq(companies.id, id));

    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return c.json(company);
  }
);

// GET /companies/:id/members — list members
companiesRouter.get("/companies/:id/members", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const db = getDb();

  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, user.id)));

  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const members = await db
    .select({
      id: companyMembers.id,
      userId: companyMembers.userId,
      role: companyMembers.role,
      invitedBy: companyMembers.invitedBy,
      joinedAt: companyMembers.joinedAt,
      name: users.name,
      email: users.email,
    })
    .from(companyMembers)
    .innerJoin(users, eq(companyMembers.userId, users.id))
    .where(eq(companyMembers.companyId, id));

  return c.json(members);
});

// POST /companies/:id/members — invite member (board only)
companiesRouter.post(
  "/companies/:id/members",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
      role: z.enum(["board", "manager", "observer", "auditor"]).default("observer"),
    })
  ),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.param();
    const { email, role } = c.req.valid("json");
    const db = getDb();

    const [membership] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, user.id)));

    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [invitedUser] = await db.select().from(users).where(eq(users.email, email));
    if (!invitedUser) {
      return c.json({ error: "User not found" }, 404);
    }

    const [existing] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, invitedUser.id)));

    if (existing) {
      return c.json({ error: "User is already a member" }, 409);
    }

    const memberId = randomUUID();
    await db.insert(companyMembers).values({
      id: memberId,
      companyId: id,
      userId: invitedUser.id,
      role,
      invitedBy: user.id,
    });

    const [newMember] = await db
      .select({
        id: companyMembers.id,
        userId: companyMembers.userId,
        role: companyMembers.role,
        invitedBy: companyMembers.invitedBy,
        joinedAt: companyMembers.joinedAt,
        name: users.name,
        email: users.email,
      })
      .from(companyMembers)
      .innerJoin(users, eq(companyMembers.userId, users.id))
      .where(eq(companyMembers.id, memberId));

    return c.json(newMember, 201);
  }
);

// PATCH /companies/:id/members/:userId — change role (board only)
companiesRouter.patch(
  "/companies/:id/members/:userId",
  zValidator(
    "json",
    z.object({
      role: z.enum(["board", "manager", "observer", "auditor"]),
    })
  ),
  async (c) => {
    const user = c.get("user");
    const { id, userId } = c.req.param();
    const { role } = c.req.valid("json");
    const db = getDb();

    const [membership] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, user.id)));

    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [target] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, userId)));

    if (!target) {
      return c.json({ error: "Member not found" }, 404);
    }

    await db
      .update(companyMembers)
      .set({ role })
      .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, userId)));

    return c.json({ success: true });
  }
);

// DELETE /companies/:id/members/:userId — remove member (board only)
companiesRouter.delete("/companies/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const { id, userId } = c.req.param();
  const db = getDb();

  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, user.id)));

  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }
  if (membership.role !== "board") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [target] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, userId)));

  if (!target) {
    return c.json({ error: "Member not found" }, 404);
  }

  await db
    .delete(companyMembers)
    .where(and(eq(companyMembers.companyId, id), eq(companyMembers.userId, userId)));

  return c.json({ success: true });
});
