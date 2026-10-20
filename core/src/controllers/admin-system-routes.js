const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const { getDataFile } = require("../config/runtime-paths");

const LOGIN_ASSETS_DIR = getDataFile("login-assets");
const LOGIN_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGIN_LOGO_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/svg+xml", ".svg"],
  ["image/x-icon", ".ico"],
  ["image/vnd.microsoft.icon", ".ico"],
]);

fs.mkdirSync(LOGIN_ASSETS_DIR, { recursive: true });

const loginLogoUpload = multer({
  storage: multer.diskStorage({
    destination: LOGIN_ASSETS_DIR,
    filename(req, file, callback) {
      callback(null, `${crypto.randomUUID()}${LOGIN_LOGO_EXTENSIONS.get(file.mimetype)}`);
    },
  }),
  limits: { fileSize: LOGIN_LOGO_MAX_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    if (!LOGIN_LOGO_EXTENSIONS.has(file.mimetype)) {
      return callback(new Error("仅支持 PNG、JPG、WebP、GIF、SVG 或 ICO 图片"));
    }
    return callback(null, true);
  },
}).single("file");

function deleteManagedLoginLogo(logoUrl) {
  const prefix = "/login-assets/";
  const value = String(logoUrl || "");
  if (!value.startsWith(prefix)) return;
  const filename = path.basename(value.slice(prefix.length));
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(LOGIN_ASSETS_DIR, filename));
  } catch {}
}

function registerAdminSystemRoutes({
  app,
  store,
  logger,
  requireAdminToken,
  requireAdminRole,
  requireSuperAdminRole,
  requireDangerConfirmation,
  getDefaultSystemConfig,
  getRuntimeConfig,
  updateRuntimeConfig,
}) {
  const isAllowedPublicLink = (value) => {
    const link = String(value || "").trim();
    return (
      !link ||
      link.startsWith("/") ||
      /^https?:\/\//i.test(link) ||
      /^mqqapi:\/\//i.test(link)
    );
  };

  const isAllowedImageLink = (value) => {
    const link = String(value || "").trim();
    return !link || link.startsWith("/") || /^https?:\/\//i.test(link);
  };

  app.get(
   "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({
          ok: true,
          data: {
            saved: store.getSystemConfig(),
            default: getDefaultSystemConfig(),
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get("/api/public/login-links", (req, res) => {
    try {
      res.json({ ok: true, data: store.getLoginLinks() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post(
   "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_SYSTEM_CONFIG")) return;
        const { serverUrl, clientVersion, wxClientVersion, platform, os, napcatLoginEnabled } = req.body || {};
        const saved = store.setSystemConfig({
          serverUrl,
          clientVersion,
          wxClientVersion,
          platform,
          os,
          napcatLoginEnabled,
        });
        updateRuntimeConfig(saved);
        logger.warn("更新系统配置", {
          admin: req.currentUser?.username || "",
          serverUrl: saved?.serverUrl || "",
          clientVersion: saved?.clientVersion || "",
          wxClientVersion: saved?.wxClientVersion || "",
          platform: saved?.platform || "",
          os: saved?.os || "",
          confirmation: "UPDATE_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/system-config/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "RESET_SYSTEM_CONFIG")) return;
        const saved = getDefaultSystemConfig();
        store.setSystemConfig(saved);
        updateRuntimeConfig(saved);
        logger.warn("重置系统配置", {
          admin: req.currentUser?.username || "",
          confirmation: "RESET_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

}

module.exports = { registerAdminSystemRoutes };
