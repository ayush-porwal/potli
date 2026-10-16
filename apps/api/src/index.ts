import { Hono } from "hono";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
