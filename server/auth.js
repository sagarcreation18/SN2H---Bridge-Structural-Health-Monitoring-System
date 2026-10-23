import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { query, pool } from "./db.js";
import { asyncRoute as wrap, fail } from "./validation.js";
const scrypt = promisify(scryptCallback),
  cookieName = "sn2h_session";
export function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + (await scrypt(password, salt, 64)).toString("hex");
}
export async function checkPassword(password, encoded) {
  const [salt, hash] = encoded.split(":");
  return equal((await scrypt(password, salt, 64)).toString("hex"), hash);
}
export function validateCredentials(body) {
  if (
    typeof body.username !== "string" ||
    !/^\w[\w.-]{2,63}$/.test(body.username)
  )
    throw fail(
      "Username must be 3–64 letters, numbers, dots, underscores or hyphens",
    );
  if (
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128
  )
    throw fail("Password must contain 12–128 characters");
}
const digest = (token) => createHash("sha256").update(token).digest("hex");
function sessionToken(req) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || ""
  );
}
const userView = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
});
export async function identify(req, res, next) {
  try {
    req.user = null;
    const token = sessionToken(req);
    if (/^[a-f0-9]{64}$/.test(token)) {
      const [user] = await query(
        "SELECT u.id,u.username,u.role,s.csrf_token FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)",
        [digest(token)],
      );
      req.user = user || null;
    }
    next();
  } catch (e) {
    next(e);
  }
}
export function adminAccess(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (equal(token, process.env.ADMIN_TOKEN)) return next();
  if (req.user?.role !== "admin")
    return next(fail("Administrator sign-in required", 401));
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !equal(req.headers["x-csrf-token"], req.user.csrf_token)
  )
    return next(
      fail("Session security token missing or expired; sign in again", 403),
    );
  next();
}
export function authRoutes() {
  const r = Router();
  r.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  r.use(rateLimit({ windowMs: 60000, limit: 20 }));
  r.use((req, res, next) => {
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.get("host")}`
    )
      return next(fail("Cross-origin authentication request rejected", 403));
    next();
  });
  r.get(
    "/status",
    wrap(async (req, res) =>
      res.json({
        setupRequired: !(await query("SELECT id FROM app_users LIMIT 1"))
          .length,
        user: req.user ? userView(req.user) : null,
        csrf: req.user?.csrf_token || null,
      }),
    ),
  );
  r.post(
    "/setup",
    wrap(async (req, res) => {
      if (
        !equal(
          req.headers.authorization?.replace(/^Bearer /, ""),
          process.env.ADMIN_TOKEN,
        )
      )
        throw fail(
          "The local ADMIN_TOKEN is required for first account setup",
          401,
        );
      validateCredentials(req.body);
      const hash = await hashPassword(req.body.password),
        tx = await pool.getConnection();
      try {
        await tx.beginTransaction();
        await tx.query(
          "SELECT id FROM monitoring_settings WHERE id=1 FOR UPDATE",
        );
        if ((await tx.query("SELECT id FROM app_users LIMIT 1"))[0].length)
          throw fail("Initial administrator already exists", 409);
        await tx.execute(
          "INSERT INTO app_users(username,password_hash,role) VALUES (?,?,'admin')",
          [req.body.username, hash],
        );
        await tx.commit();
        res.status(201).json({ created: true });
      } catch (e) {
        await tx.rollback();
        throw e;
      } finally {
        tx.release();
      }
    }),
  );
  r.post(
    "/login",
    wrap(async (req, res) => {
      validateCredentials(req.body);
      const [user] = await query("SELECT * FROM app_users WHERE username=?", [
        req.body.username,
      ]);
      const dummy = "00000000000000000000000000000000:" + "0".repeat(128);
      const valid = await checkPassword(
        req.body.password,
        user?.password_hash || dummy,
      );
      if (!user || !valid) throw fail("Invalid username or password", 401);
      const token = randomBytes(32).toString("hex"),
        csrf = randomBytes(32).toString("hex");
      await query("DELETE FROM app_sessions WHERE expires_at<UTC_TIMESTAMP(3)");
      await query(
        "INSERT INTO app_sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 8 HOUR))",
        [digest(token), user.id, csrf],
      );
      res
        .cookie(cookieName, token, {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.COOKIE_SECURE === "true",
          maxAge: 8 * 3600000,
          path: "/",
        })
        .json({ user: userView(user), csrf });
    }),
  );
  r.post(
    "/logout",
    wrap(async (req, res) => {
      if (req.user && !equal(req.headers["x-csrf-token"], req.user.csrf_token))
        throw fail("Invalid session security token", 403);
      await query("DELETE FROM app_sessions WHERE token_hash=?", [
        digest(sessionToken(req)),
      ]);
      res.clearCookie(cookieName, { path: "/" }).json({ signedOut: true });
    }),
  );
  r.get(
    "/users",
    adminAccess,
    wrap(async (req, res) =>
      res.json(
        await query(
          "SELECT id,username,role,created_at FROM app_users ORDER BY id",
        ),
      ),
    ),
  );
  r.post(
    "/users",
    adminAccess,
    wrap(async (req, res) => {
      validateCredentials(req.body);
      if (!["admin", "viewer"].includes(req.body.role))
        throw fail("Role must be admin or viewer");
      try {
        await query(
          "INSERT INTO app_users(username,password_hash,role) VALUES (?,?,?)",
          [
            req.body.username,
            await hashPassword(req.body.password),
            req.body.role,
          ],
        );
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY")
          throw fail("Username already exists", 409);
        throw e;
      }
      res.status(201).json({ created: true });
    }),
  );
  r.post(
    "/password",
    wrap(async (req, res) => {
      if (!req.user) throw fail("Sign in to change your password", 401);
      if (!equal(req.headers["x-csrf-token"], req.user.csrf_token))
        throw fail("Invalid session security token", 403);
      validateCredentials({
        username: req.user.username,
        password: req.body.password,
      });
      if (
        typeof req.body.currentPassword !== "string" ||
        req.body.currentPassword.length > 128
      )
        throw fail("Current password required");
      const [u] = await query(
        "SELECT password_hash FROM app_users WHERE id=?",
        [req.user.id],
      );
      if (!(await checkPassword(req.body.currentPassword, u.password_hash)))
        throw fail("Current password is incorrect", 401);
      await query("UPDATE app_users SET password_hash=? WHERE id=?", [
        await hashPassword(req.body.password),
        req.user.id,
      ]);
      await query("DELETE FROM app_sessions WHERE user_id=?", [req.user.id]);
      res
        .clearCookie(cookieName, { path: "/" })
        .json({ updated: true, signInAgain: true });
    }),
  );
  return r;
}
