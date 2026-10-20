const process = require("node:process");
const fetch = require("node-fetch");
const { version } = require("../../package.json");
const { getRuntimeConfig } = require("../config/config");
const { getSchedulerRegistrySnapshot } = require("../services/scheduler");

const CHANGELOG_URL = "https://gitee.com/xlzcandy/qq-classic-farm-update-log/raw/master/README.md";
const SCHEDULER_UNSUPPORTED_MESSAGE = "DataProvider does not support scheduler status";

function registerAdminPublicInfoRoutes({
  app,
  provider,
  store,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  app.get("/api/ping", (req, res) => {
    res.json({
      ok: true,
      data: { ok: true, uptime: process.uptime(), version },
    });
  });

  app.get("/api/game-version", (req, res) => {
    const runtimeConfig = getRuntimeConfig();
    res.json({
      ok: true,
      clientVersion: runtimeConfig.clientVersion,
      wxClientVersion: runtimeConfig.wxClientVersion,
    });
  });

  app.get("/api/changelog", async (req, res) => {
    try {
      const response = await fetch(CHANGELOG_URL);
      if (!response.ok)
        return res.status(500).json({ ok: false, error: "获取更新日志失败" });

      const data = await response.text();
      res.json({ ok: true, data });
    }
    catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/announcement", (req, res) => {
    try {
      const username = req.currentUser?.username || null;
      const announcement = store.getAnnouncement();
      const shouldShow = !!announcement.content
        && store.shouldShowAnnouncement(username || "guest");
      res.json({
        ok: true,
        data: {
          content: announcement.content || "",
          showOnce: announcement.showOnce !== false,
          updatedAt: announcement.updatedAt || 0,
          shouldShow,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/announcement/read", (req, res) => {
    try {
      const username = req.currentUser?.username || req.body?.username || "guest";
      if (username && username !== "guest") {
        store.markAnnouncementRead(username);
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/admin/announcement", (req, res) => {
    try {
      if (!req.currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const role = req.currentUser.role;
      if (role !== "admin" && role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "无权限" });
      }
      const content = String(req.body?.content || "").trim();
      const showOnce = req.body?.showOnce !== false;
      const announcement = store.setAnnouncement(content, showOnce);
      res.json({ ok: true, data: announcement });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/admin/announcement", (req, res) => {
    try {
      if (!req.currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const role = req.currentUser.role;
      if (role !== "admin" && role !== "super_admin") {
        return res.status(403).json({ ok: false, error: "无权限" });
      }
      res.json({ ok: true, data: store.getAnnouncement() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/auth/validate", (req, res) => {
    res.json({ ok: true, data: { valid: true } });
  });

  app.get("/api/scheduler", async (req, res) => {
    try {
      const accountId = getAccountIdFromRequest(req);
      if (accountId && !canAccessAccount(req, accountId))
        return res.status(403).json({ ok: false, error: "无权访问此账号" });

      if (provider && typeof provider.getSchedulerStatus === "function") {
        const status = await provider.getSchedulerStatus(accountId);
        return res.json({ ok: true, data: status });
      }

      return res.json({
        ok: true,
        data: {
          runtime: getSchedulerRegistrySnapshot(),
          worker: null,
          workerError: SCHEDULER_UNSUPPORTED_MESSAGE,
        },
      });
    }
    catch (error) {
      return sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminPublicInfoRoutes };
