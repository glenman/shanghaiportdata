import express from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { knowledgeBase } from "./server/knowledgeBase.js";
import {
  PORT_CLUB_ERAS,
  ALL_PORT_NAME_VARIANTS,
  OPPONENT_ALIASES_DICTIONARY,
  COMPETITIONS_DICTIONARY,
} from "./server/aliasRules.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB limit
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON and URL-encoded body parsers
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  // Initialize Knowledge Base
  knowledgeBase.initialize().catch((err) => {
    console.error("Error during knowledge base pre-initialization:", err);
  });

  // Admin authentication configuration
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "shport_20051225";

  function checkAdminAuth(req: express.Request): boolean {
    const key = req.headers["x-admin-key"] || req.query.adminKey;
    return typeof key === "string" && key.trim() === ADMIN_PASSWORD;
  }

  function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!checkAdminAuth(req)) {
      return res.status(401).json({
        success: false,
        error: "未授权：仅管理员具备知识库管理与数据上传权限",
      });
    }
    next();
  }

  // Admin verification endpoint
  app.post("/api/admin/verify", (req, res) => {
    const { password } = req.body || {};
    if (password && typeof password === "string" && password.trim() === ADMIN_PASSWORD) {
      return res.json({ success: true, message: "管理员权限验证通过" });
    }
    return res.status(401).json({ success: false, error: "管理密码错误，无法解锁管理权限" });
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "Shanghai Port FC Historical QA Expert",
      timestamp: new Date().toISOString(),
    });
  });

  // Chat QA Endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history } = req.body;
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: "提问内容不能为空 (Message prompt is required)",
        });
      }

      const result = await knowledgeBase.query(message.trim(), history || []);
      return res.json({
        success: true,
        answer: result.answer,
        sources: result.sources,
        retrievedCount: result.retrievedCount,
        hasDirectMatch: result.hasDirectMatch,
        retrievalMode: result.retrievalMode,
      });
    } catch (err: any) {
      console.error("API /api/chat error:", err);
      return res.status(500).json({
        success: false,
        error: "服务器处理问答失败: " + (err?.message || "未知错误"),
      });
    }
  });

  // Knowledge Base Stats
  app.get("/api/kb/stats", async (req, res) => {
    try {
      const stats = await knowledgeBase.getStats();
      return res.json({ success: true, stats });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Clear Knowledge Base (Admin only)
  app.post("/api/kb/clear", requireAdminAuth, async (req, res) => {
    try {
      await knowledgeBase.clearAll();
      const stats = await knowledgeBase.getStats();
      return res.json({
        success: true,
        message: "知识库已清空",
        stats,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete specific file from Knowledge Base (Admin only)
  app.delete("/api/kb/files/:fileName", requireAdminAuth, async (req, res) => {
    try {
      const fileName = decodeURIComponent(req.params.fileName);
      const result = await knowledgeBase.deleteFile(fileName);
      const stats = await knowledgeBase.getStats();
      return res.json({
        success: true,
        message: `文件 ${fileName} 及其向量切片已成功删除`,
        stats,
        ...result,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Download raw original file from Knowledge Base
  app.get("/api/kb/files/:fileName/download", async (req, res) => {
    try {
      const fileName = decodeURIComponent(req.params.fileName);
      const filePath = knowledgeBase.getRawFilePath(fileName);
      if (!filePath) {
        return res.status(404).json({ success: false, error: `未找到原文件: ${fileName}` });
      }
      return res.download(filePath, fileName);
    } catch (err: any) {
      return res.status(500).json({ success: false, error: "下载文件失败: " + err.message });
    }
  });

  // Get Club History Names, Aliases, and Opponent Rules Dictionary
  app.get("/api/kb/aliases", (req, res) => {
    return res.json({
      success: true,
      data: {
        canonicalClubName: "上海海港足球俱乐部",
        identityPrinciple:
          "俱乐部同一性核心准则：上海海港、上海上港、上海东亚、上海特莱士均为同一支队伍在不同历史时期的正式名称与冠名。所有历史数据、进球总数、胜负战绩、荣誉履历必须统筹合并计算，不可切割！",
        eras: PORT_CLUB_ERAS,
        allPortAliases: ALL_PORT_NAME_VARIANTS,
        opponents: OPPONENT_ALIASES_DICTIONARY,
        competitions: COMPETITIONS_DICTIONARY,
      },
    });
  });

  // Rescan Knowledge Base data directory on demand
  app.post("/api/kb/rescan", requireAdminAuth, async (req, res) => {
    try {
      const result = await knowledgeBase.rescan();
      return res.json({
        success: true,
        message: `扫描完成！成功加载 ${result.scannedCount} 个文件，包含 ${result.stats.totalChunks} 个知识切片。`,
        ...result,
      });
    } catch (err: any) {
      console.error("API /api/kb/rescan error:", err);
      return res.status(500).json({
        success: false,
        error: "扫描本地知识库目录失败: " + (err?.message || "未知错误"),
      });
    }
  });

  // Reset Knowledge Base (clears to clean state, Admin only)
  app.post("/api/kb/reset", requireAdminAuth, async (req, res) => {
    try {
      await knowledgeBase.clearAll();
      const stats = await knowledgeBase.getStats();
      return res.json({
        success: true,
        message: "知识库已清空重置",
        stats,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Upload File Endpoint (Admin only, supports both JSON payload and multipart form data)
  app.post("/api/kb/upload", requireAdminAuth, upload.single("file"), async (req, res) => {
    try {
      let fileName = "";
      let content = "";
      let fileSize = 0;

      if (req.file) {
        fileName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
        content = req.file.buffer.toString("utf8");
        fileSize = req.file.size;
      } else if (req.body && req.body.fileName && req.body.content) {
        fileName = req.body.fileName;
        content = req.body.content;
        fileSize = Buffer.byteLength(content, "utf8");
      } else {
        return res.status(400).json({
          success: false,
          error: "未收到文件或文件内容为空",
        });
      }

      const { addedChunks } = await knowledgeBase.addFileContent(
        fileName,
        content,
        fileSize
      );

      const stats = await knowledgeBase.getStats();
      return res.json({
        success: true,
        message: `成功解析文件 ${fileName}，新增 ${addedChunks} 个向量知识切片`,
        fileName,
        addedChunks,
        stats,
      });
    } catch (err: any) {
      console.error("API /api/kb/upload error:", err);
      return res.status(500).json({
        success: false,
        error: "文件解析或向量库入库失败: " + (err?.message || "未知错误"),
      });
    }
  });

  // Custom Logo Upload Endpoint (Admin only)
  app.post("/api/admin/logo/upload", requireAdminAuth, upload.single("logo"), async (req, res) => {
    try {
      let buffer: Buffer | null = null;
      if (req.file && req.file.buffer) {
        buffer = req.file.buffer;
      } else if (req.body && req.body.imageBase64) {
        const base64Data = req.body.imageBase64.replace(/^data:image\/\w+;base64,/, "");
        buffer = Buffer.from(base64Data, "base64");
      }

      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ success: false, error: "未接收到图片数据" });
      }

      // Save directly to public and dist directories
      const fs = await import("fs/promises");
      const publicPath = path.join(process.cwd(), "public", "shanghaiport-logo.png");
      const distPath = path.join(process.cwd(), "dist", "shanghaiport-logo.png");

      await fs.writeFile(publicPath, buffer);
      try {
        await fs.writeFile(distPath, buffer);
      } catch (e) {
        // Dist might not exist in dev mode, ignore
      }

      return res.json({
        success: true,
        message: "队徽图片已成功更新！",
        timestamp: Date.now(),
      });
    } catch (err: any) {
      console.error("Logo upload error:", err);
      return res.status(500).json({
        success: false,
        error: "保存队徽图片失败: " + (err?.message || "未知错误"),
      });
    }
  });

  // Sample JSON structured data download for testing
  app.get("/api/kb/sample-json", (req, res) => {
    const sampleJson = [
      {
        "id": "port_2018_csl_r28",
        "title": "2018赛季中超第28轮：广州恒大淘宝 4-5 上海上港 (天王山争冠之战)",
        "competition": "2018中国足球协会超级联赛",
        "round": "第28轮",
        "matchDate": "2018-11-03",
        "stadium": "广州天河体育场",
        "homeTeam": "广州恒大淘宝",
        "awayTeam": "上海上港",
        "scoreline": "4-5",
        "result": "胜",
        "portGoals": 5,
        "opponentGoals": 4,
        "scorers": [
          { "player": "吕文君", "minute": "14'", "assist": "埃尔克森" },
          { "player": "蔡慧康", "minute": "41'", "assist": "胡尔克" },
          { "player": "武磊", "minute": "51'", "assist": "奥斯卡" },
          { "player": "张成林 (乌龙)", "minute": "79'", "assist": "无" },
          { "player": "胡尔克 (点球)", "minute": "89'", "assist": "巴斯托斯犯规" }
        ],
        "keySignificance": "打破恒大八连冠垄断、提前确立队史首座中超冠军绝对优势的决定性比赛",
        "headCoach": "维托尔·佩雷拉 (Vitor Pereira)"
      },
      {
        "id": "port_2018_csl_r29",
        "title": "2018赛季中超第29轮：上海上港 2-1 北京人和 (正式提前一轮夺冠)",
        "competition": "2018中国足球协会超级联赛",
        "round": "第29轮",
        "matchDate": "2018-11-07",
        "stadium": "上海八万人体育场",
        "homeTeam": "上海上港",
        "awayTeam": "北京人和",
        "scoreline": "2-1",
        "result": "胜",
        "portGoals": 2,
        "opponentGoals": 1,
        "scorers": [
          { "player": "艾哈迈多夫", "minute": "20'", "assist": "奥斯卡" },
          { "player": "武磊", "minute": "47'", "assist": "埃尔克森" }
        ],
        "keySignificance": "上海上港建队13年夺得首座中国顶级联赛冠军，崇明根宝基地十年磨一剑终圆梦",
        "headCoach": "维托尔·佩雷拉 (Vitor Pereira)"
      },
      {
        "id": "port_2019_supercup",
        "title": "2019中国足协超级杯：上海上港 2-0 北京中赫国安 (加冕超级杯双冠)",
        "competition": "2019中国足球协会超级杯",
        "round": "决赛",
        "matchDate": "2019-02-23",
        "stadium": "苏州奥林匹克体育中心",
        "homeTeam": "上海上港",
        "awayTeam": "北京中赫国安",
        "scoreline": "2-0",
        "result": "胜",
        "portGoals": 2,
        "opponentGoals": 0,
        "scorers": [
          { "player": "王燊超", "minute": "62'", "assist": "埃尔克森" },
          { "player": "吕文君", "minute": "66'", "assist": "奥斯卡" }
        ],
        "keySignificance": "夺得队史首座中国足协超级杯冠军",
        "headCoach": "维托尔·佩雷拉 (Vitor Pereira)"
      },
      {
        "id": "port_2023_csl_r29",
        "title": "2023赛季中超第29轮：上海海港 1-1 山东泰山 (提前一轮加冕第二座中超冠军)",
        "competition": "2023中国足球协会超级联赛",
        "round": "第29轮",
        "matchDate": "2023-10-29",
        "stadium": "上汽浦东足球场",
        "homeTeam": "上海海港",
        "awayTeam": "山东泰山",
        "scoreline": "1-1",
        "result": "平",
        "portGoals": 1,
        "opponentGoals": 1,
        "scorers": [
          { "player": "吕文君", "minute": "16'", "assist": "张琳芃" }
        ],
        "keySignificance": "海港俱乐部历史上第二次荣登中超冠军宝座，五星闪耀浦东足球场",
        "headCoach": "哈维尔·佩雷拉 (Javier Pereira)"
      },
      {
        "id": "port_2024_csl_stats",
        "title": "2024赛季上海海港夺冠历史性数据概览",
        "competition": "2024中国足球协会超级联赛",
        "round": "全赛季30轮",
        "matchDate": "2024赛季",
        "stadium": "上汽浦东足球场",
        "totalMatches": 30,
        "record": "25胜3平2负",
        "points": 78,
        "totalGoalsScored": 96,
        "totalGoalsConceded": 30,
        "topScorers": [
          { "player": "武磊", "goals": 34, "note": "刷新中国顶级联赛单赛季进球历史纪录，荣膺金靴" },
          { "player": "古斯塔沃", "goals": 20 },
          { "player": "巴尔加斯", "goals": 12 },
          { "player": "奥斯卡", "goals": 14, "assists": 24, "note": "中超历史助攻王" }
        ],
        "keySignificance": "创下单赛季中超最多积分(78分)及最多进球(96球)历史纪录，卫冕中超冠军",
        "headCoach": "凯文·穆斯卡特 (Kevin Muscat)"
      }
    ];

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sample_shanghai_port_data.json"'
    );
    res.send(JSON.stringify(sampleJson, null, 2));
  });

  // Sample Markdown data download for testing
  app.get("/api/kb/sample", (req, res) => {
    const sampleContent = `# 上海海港2019中国足协超级杯夺冠纪实

## 赛事背景
2019年中国足球协会超级杯于2019年2月23日19:35在苏州奥林匹克体育中心举行。
对阵双方为2018中超联赛冠军上海上港与2018足协杯冠军北京中赫国安。

## 首发阵容与比赛进程
上海上港首发阵容：
- 门将：颜骏凌
- 后卫：傅欢、贺惯、石柯、王燊超
- 中场：蔡慧康、艾哈迈多夫、奥斯卡
- 前锋：吕文君、埃尔克森

比赛关键时刻：
- 第62分钟，埃尔克森禁区内做球，王燊超插上推射破门，上港1-0领先！
- 第66分钟，奥斯卡送出精准传中，吕文君门前冷静垫射破门，上港2-0扩大比分！

## 最终结果
上海上港 2 - 0 战胜北京国安，夺得队史首座中国足协超级杯冠军奖杯！
这也是佩雷拉执教海港期间拿下的第二座重要锦标。`;

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sample_port_supercup_2019.md"'
    );
    res.send(sampleContent);
  });

  // Vite middleware in development vs static serving in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Shanghai Port FC Expert Server] running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal server boot failure:", err);
  process.exit(1);
});
