import fs from "fs";
import path from "path";
import { Document } from "@langchain/core/documents";
import {
  GeminiLangChainEmbeddings,
  LangChainPortVectorStore,
  splitTextIntoChunks,
} from "./langchainStore.js";
import { getGeminiClient } from "./geminiClient.js";

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const META_FILE = path.join(DATA_DIR, "kb_manifest.json");

/**
 * Intelligent keyword and entity extractor for Chinese football questions
 */
function extractChineseFootballKeywords(query: string): {
  years: string[];
  keywords: string[];
  opponents: string[];
} {
  const years = query.match(/\b(19\d\d|20\d\d)\b/g) || [];
  const keywordSet = new Set<string>();
  const opponentSet = new Set<string>();

  // Known entities and nicknames in Chinese football
  const knownOpponents = [
    "广州恒大", "广州恒大淘宝", "恒大淘宝", "恒大", "广州队", "广州广汽恒大",
    "广州富力", "富力",
    "北京国安", "国安", "山东泰山", "山东鲁能", "泰山", "鲁能",
    "上海申花", "申花", "江苏苏宁", "苏宁", "天津天海", "权健", "天津泰达", "津门虎",
    "河南建业", "河南队", "长春亚泰", "亚泰", "大连一方", "大连人", "武汉三镇", "浙江绿城",
    "贵州恒丰", "贵州智诚", "河北华夏幸福", "华夏幸福", "青岛海牛", "成都蓉城", "深圳队"
  ];

  for (const opp of knownOpponents) {
    if (query.includes(opp)) {
      opponentSet.add(opp);
      keywordSet.add(opp);
    }
  }

  const knownEntities = [
    "上海海港", "上海上港", "上海东亚", "海港", "上港", "东亚",
    "中超", "中甲", "中乙", "足协杯", "超级杯", "亚冠", "亚冠联赛",
    "武磊", "奥斯卡", "胡尔克", "浩克", "埃尔克森", "艾克森", "巴尔加斯",
    "吕文君", "蔡慧康", "王燊超", "颜骏凌", "曹赟定", "阿瑙托维奇", "佩雷拉", "博阿斯"
  ];

  for (const entity of knownEntities) {
    if (query.includes(entity)) {
      keywordSet.add(entity);
    }
  }

  // Add years to keywords
  years.forEach((y) => keywordSet.add(y));

  // Extract English / numbers
  const tokens = query.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ").split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (/^[a-zA-Z0-9]+$/.test(t) && t.length >= 2) {
      keywordSet.add(t.toLowerCase());
    }
  }

  // Extract Chinese 2-gram, 3-gram, 4-gram phrases (excluding stop words)
  const stopWords = new Set([
    "请问", "问一", "比赛", "有几", "几场", "多少", "一下", "什么", "怎么", "哪个",
    "哪些", "是谁", "记录", "历史", "数据", "情况", "何时", "几比几", "比分", "战绩",
    "对阵", "打过", "踢过", "交手", "对战", "交锋", "战报"
  ]);

  const chineseOnly = query.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= chineseOnly.length - len; i++) {
      const sub = chineseOnly.substring(i, i + len);
      if (!stopWords.has(sub)) {
        keywordSet.add(sub);
      }
    }
  }

  return {
    years,
    keywords: Array.from(keywordSet),
    opponents: Array.from(opponentSet),
  };
}

export interface CitedSource {
  id: string;
  title: string;
  category: string;
  sourceFile: string;
  section: string;
  matchDate?: string | null;
  competition?: string | null;
  opponent?: string | null;
  scoreline?: string | null;
  keyPlayers?: string[];
  relevanceScore: number;
  excerpt: string;
}

export interface UploadedFileInfo {
  name: string;
  size: number;
  chunkCount: number;
  uploadTime: number;
  isDefault: boolean;
  isJson?: boolean;
  rawJsonContent?: string;
  itemCount?: number;
}

export interface QAResult {
  answer: string;
  sources: CitedSource[];
  retrievedCount: number;
  hasDirectMatch: boolean;
  retrievalMode?: "json_full_context" | "vector_rag" | "hybrid";
}

class KnowledgeBaseManager {
  private embeddings: GeminiLangChainEmbeddings;
  private vectorStore: LangChainPortVectorStore;
  private uploadedFiles: Map<string, UploadedFileInfo> = new Map();
  private rawJsonStore: Map<string, { content: string; parsed: any }> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.embeddings = new GeminiLangChainEmbeddings();
    this.vectorStore = new LangChainPortVectorStore(this.embeddings);
  }

  private ensureDirectories() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    } catch (e) {
      console.error("Failed to create data directories:", e);
    }
  }

  private saveManifest() {
    try {
      this.ensureDirectories();
      const filesArray = Array.from(this.uploadedFiles.values()).map((f) => ({
        name: f.name,
        size: f.size,
        chunkCount: f.chunkCount,
        uploadTime: f.uploadTime,
        isDefault: f.isDefault,
        isJson: f.isJson,
        itemCount: f.itemCount,
      }));
      fs.writeFileSync(META_FILE, JSON.stringify(filesArray, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save knowledge base manifest to disk:", err);
    }
  }

  async initialize() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.ensureDirectories();

      // Reload files from disk if manifest exists
      if (fs.existsSync(META_FILE)) {
        try {
          const raw = fs.readFileSync(META_FILE, "utf8");
          const list: UploadedFileInfo[] = JSON.parse(raw);
          for (const meta of list) {
            const filePath = path.join(UPLOADS_DIR, meta.name);
            if (fs.existsSync(filePath)) {
              const content = fs.readFileSync(filePath, "utf8");
              await this.internalAddContent(meta.name, content, meta.size, false);
            }
          }
          console.log(`Knowledge Base loaded ${this.uploadedFiles.size} persisted files from disk.`);
        } catch (e) {
          console.error("Error loading persisted files from disk:", e);
        }
      } else {
        console.log("Shanghai Port FC Knowledge Base initialized (clean empty state, awaiting user uploads).");
      }
      this.isInitialized = true;
    })();

    return this.initPromise;
  }

  async deleteFile(fileName: string): Promise<{ success: boolean; removedChunks: number }> {
    await this.initialize();
    const removedChunks = this.vectorStore.deleteBySourceFile(fileName);
    this.uploadedFiles.delete(fileName);
    this.rawJsonStore.delete(fileName);

    // Delete disk file
    try {
      const filePath = path.join(UPLOADS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.saveManifest();
    } catch (e) {
      console.error("Error deleting file from disk:", e);
    }

    return { success: true, removedChunks };
  }

  async clearAll(): Promise<void> {
    this.vectorStore.clear();
    this.uploadedFiles.clear();
    this.rawJsonStore.clear();
    this.isInitialized = true;

    try {
      if (fs.existsSync(META_FILE)) fs.unlinkSync(META_FILE);
      if (fs.existsSync(UPLOADS_DIR)) {
        const files = fs.readdirSync(UPLOADS_DIR);
        for (const f of files) {
          fs.unlinkSync(path.join(UPLOADS_DIR, f));
        }
      }
    } catch (e) {
      console.error("Error clearing disk storage:", e);
    }
  }

  async addFileContent(
    fileName: string,
    content: string,
    fileSize: number
  ): Promise<{ addedChunks: number; isJson?: boolean; itemCount?: number }> {
    await this.initialize();
    return this.internalAddContent(fileName, content, fileSize, true);
  }

  private async internalAddContent(
    fileName: string,
    content: string,
    fileSize: number,
    persistToDisk: boolean = true
  ): Promise<{ addedChunks: number; isJson?: boolean; itemCount?: number }> {
    // If file with same name already exists, replace its previous vectors and json
    if (this.uploadedFiles.has(fileName)) {
      this.vectorStore.deleteBySourceFile(fileName);
      this.uploadedFiles.delete(fileName);
      this.rawJsonStore.delete(fileName);
    }

    let documentsToAdd: Document[] = [];
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    let isJsonFile = false;
    let jsonItemCount = 0;

    if (ext === "json") {
      try {
        const parsed = JSON.parse(content);
        isJsonFile = true;
        this.rawJsonStore.set(fileName, { content, parsed });

        if (Array.isArray(parsed)) {
          jsonItemCount = parsed.length;
          for (let i = 0; i < parsed.length; i++) {
            const item = parsed[i];
            const text =
              typeof item === "string"
                ? item
                : JSON.stringify(item, null, 2);

            const recordTitle =
              item.match_name ||
              item.match ||
              item.title ||
              item.name ||
              (item.home_team && item.away_team ? `${item.home_team} vs ${item.away_team}` : `记录 #${i + 1}`);

            const recordDate =
              item.date ||
              (item.match_date_code ? String(item.match_date_code) : null) ||
              item.matchDate ||
              null;

            const recordOpponent =
              item.opponent ||
              (item.away_team && !item.away_team.includes("海港") && !item.away_team.includes("东亚") && !item.away_team.includes("上港") ? item.away_team : null) ||
              (item.home_team && !item.home_team.includes("海港") && !item.home_team.includes("东亚") && !item.home_team.includes("上港") ? item.home_team : null);

            const recordScore =
              item.result ||
              (item.home_score !== undefined && item.away_score !== undefined ? `${item.home_score}-${item.away_score}` : null) ||
              item.scoreline ||
              item.score ||
              null;

            // Even in JSON mode, we also index item-level documents so user can see granular citations
            documentsToAdd.push(
              new Document({
                pageContent: text,
                metadata: {
                  id: `${fileName}_item_${i}`,
                  title: recordTitle,
                  category: item.category || "海港结构化数据",
                  sourceFile: fileName,
                  section: item.section || item.round || `条目 #${i + 1}`,
                  matchDate: recordDate,
                  competition: item.match_type || item.competition || item.tournament || null,
                  opponent: recordOpponent,
                  scoreline: recordScore,
                  keyPlayers: item.keyPlayers || (item.scorers ? (Array.isArray(item.scorers) ? item.scorers : Object.values(item.scorers).flat()) : []) || (item.goal_player ? [item.goal_player] : []),
                  isDefault: false,
                },
              })
            );
          }
        } else {
          // Single JSON object
          jsonItemCount = 1;
          const text = JSON.stringify(parsed, null, 2);
          const chunks = splitTextIntoChunks(text, 600, 100);
          chunks.forEach((chunk, cIdx) => {
            documentsToAdd.push(
              new Document({
                pageContent: chunk,
                metadata: {
                  id: `${fileName}_c_${cIdx}`,
                  title: parsed.title || fileName,
                  category: "海港结构化JSON",
                  sourceFile: fileName,
                  section: `结构块 #${cIdx + 1}`,
                  isDefault: false,
                },
              })
            );
          });
        }
      } catch (e) {
        // Fallback to text parsing
        const chunks = splitTextIntoChunks(content, 500, 80);
        chunks.forEach((chunk, cIdx) => {
          documentsToAdd.push(
            new Document({
              pageContent: chunk,
              metadata: {
                id: `${fileName}_c_${cIdx}`,
                title: fileName,
                category: "用户上传文本",
                sourceFile: fileName,
                section: `数据切片 #${cIdx + 1}`,
                isDefault: false,
              },
            })
          );
        });
      }
    } else if (ext === "csv") {
      // Split CSV lines
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      const headers = lines[0] || "";
      const chunks = splitTextIntoChunks(content, 500, 80);
      chunks.forEach((chunk, cIdx) => {
        documentsToAdd.push(
          new Document({
            pageContent: `【CSV表头】: ${headers}\n\n${chunk}`,
            metadata: {
              id: `${fileName}_c_${cIdx}`,
              title: `${fileName} (数据表)`,
              category: "CSV数据表",
              sourceFile: fileName,
              section: `表格行块 #${cIdx + 1}`,
              isDefault: false,
            },
          })
        );
      });
    } else {
      // Markdown or Plain Text
      const chunks = splitTextIntoChunks(content, 500, 80);
      chunks.forEach((chunk, cIdx) => {
        // Look for heading in chunk
        const headingMatch = chunk.match(/^(?:#+\s*|【)(.+?)(?:】|\n|$)/);
        const sectionTitle = headingMatch ? headingMatch[1].trim() : `第 ${cIdx + 1} 节`;

        documentsToAdd.push(
          new Document({
            pageContent: chunk,
            metadata: {
              id: `${fileName}_c_${cIdx}`,
              title: `${fileName} - ${sectionTitle}`,
              category: "用户知识库文档",
              sourceFile: fileName,
              section: sectionTitle,
              isDefault: false,
            },
          })
        );
      });
    }

    if (documentsToAdd.length > 0) {
      // For structured JSON arrays, index a concise set of representative items (up to 15)
      // into vectorStore for instant citation snippets, while keeping all records in rawJsonStore for full-context precision.
      // This ensures near-instant initialization without hitting API rate limits or blocking server boot.
      const docsToEmbed = isJsonFile && documentsToAdd.length > 15
        ? documentsToAdd.slice(0, 15)
        : documentsToAdd;
      await this.vectorStore.addDocuments(docsToEmbed);
    }

    this.uploadedFiles.set(fileName, {
      name: fileName,
      size: fileSize,
      chunkCount: documentsToAdd.length,
      uploadTime: Date.now(),
      isDefault: false,
      isJson: isJsonFile,
      itemCount: jsonItemCount,
      rawJsonContent: isJsonFile ? content : undefined,
    });

    if (persistToDisk) {
      try {
        this.ensureDirectories();
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(filePath, content, "utf8");
        this.saveManifest();
      } catch (err) {
        console.error("Failed to persist file to disk:", err);
      }
    }

    return {
      addedChunks: documentsToAdd.length,
      isJson: isJsonFile,
      itemCount: jsonItemCount,
    };
  }

  async resetToDefault() {
    await this.clearAll();
  }

  async getStats() {
    await this.initialize();
    const allFiles = Array.from(this.uploadedFiles.values());
    const totalChunks = allFiles.reduce((acc, f) => acc + f.chunkCount, 0);
    return {
      totalDocuments: allFiles.length,
      totalChunks,
      files: allFiles,
    };
  }

  async query(
    question: string,
    history: { role: "user" | "assistant"; content: string }[] = []
  ): Promise<QAResult> {
    await this.initialize();

    // 0. Check if knowledge base is completely empty
    if (this.uploadedFiles.size === 0) {
      return {
        answer:
          "当前海港足球俱乐部内部知识库中尚未上传任何历史数据文件，知识库为空。\n\n请在右上角或下方点击【导入数据文档】，上传海港相关比赛战报、球员统计表或赛季记录文件（支持 .json / .txt / .md / .csv 格式）。系统现已支持【JSON原生全量语义理解模式】，能精准支持字段统计、射手榜比对与无损赛事溯源！",
        sources: [],
        retrievedCount: 0,
        hasDirectMatch: false,
      };
    }

    // Check if we have JSON structured datasets in the knowledge base
    const jsonFiles = Array.from(this.uploadedFiles.values()).filter((f) => f.isJson);
    const hasJsonDatasets = jsonFiles.length > 0 && this.rawJsonStore.size > 0;

    // Extract football entities, years and query keywords
    const { years: queryYears, keywords: queryKeywords, opponents: queryOpponents } = extractChineseFootballKeywords(question);

    // 1. LangChain VectorStore Similarity Search for granular item citations
    const topK = 6;
    let searchResults: [Document, number][] = [];
    if (this.vectorStore.getStats().totalChunks > 0) {
      try {
        searchResults = await this.vectorStore.similaritySearchWithScore(question, topK);
      } catch (err) {
        console.warn("Vector search minor issue, falling back to full context:", err);
      }
    }

    // Format cited sources for user UI transparency
    const sources: CitedSource[] = searchResults.map(([doc, score]) => ({
      id: (doc.metadata.id as string) || "doc",
      title: (doc.metadata.title as string) || "海港历史文献记录",
      category: (doc.metadata.category as string) || "历史资料",
      sourceFile: (doc.metadata.sourceFile as string) || "内部知识库",
      section: (doc.metadata.section as string) || "数据节选",
      matchDate: doc.metadata.matchDate || null,
      competition: doc.metadata.competition || null,
      opponent: doc.metadata.opponent || null,
      scoreline: doc.metadata.scoreline || null,
      keyPlayers: doc.metadata.keyPlayers || [],
      relevanceScore: Math.round(score * 100) / 100,
      excerpt: doc.pageContent.slice(0, 260) + (doc.pageContent.length > 260 ? "..." : ""),
    }));

    // If sources is empty or we are in pure JSON mode, populate sources from the JSON file definitions
    if (sources.length === 0 && hasJsonDatasets) {
      for (const jf of jsonFiles) {
        sources.push({
          id: `json_${jf.name}`,
          title: `${jf.name} (结构化数据库)`,
          category: "JSON原生数据库",
          sourceFile: jf.name,
          section: "全量结构化数据集 (Direct Full Context)",
          relevanceScore: 0.99,
          excerpt: `包含 ${jf.itemCount || 1} 条海港比赛/球员/赛季结构化数据记录。`,
        });
      }
    }

    const topScore = searchResults.length > 0 ? searchResults[0][1] : 0;
    const hasDirectMatch = topScore > 0.15 || hasJsonDatasets;

    // Build context:
    // If JSON files exist, intelligently extract records matching years, opponents, or players
    let contextText = "";
    if (hasJsonDatasets) {
      const jsonSections: string[] = [];
      for (const [fName, data] of this.rawJsonStore.entries()) {
        const parsed = data.parsed;
        let contentToInject = data.content;

        // If JSON is array, rank items by relevance to user query
        if (Array.isArray(parsed) && (parsed.length > 30 || data.content.length > 20000)) {
          // Scoring function for each item
          const scoredItems = parsed.map((item: any) => {
            const str = JSON.stringify(item);
            let score = 0;

            // Check year match
            if (queryYears.length > 0) {
              const itemYear = String(
                item.season || item.date || item.match_date_code || item.matchDate || ""
              );
              const hasYear = queryYears.some((y) => itemYear.includes(y));
              if (hasYear) {
                score += 15; // High priority for year match
              } else {
                // If query has explicit year and item doesn't have it, don't prioritize
                return { item, score: -1 };
              }
            }

            // High weight for matching target opponent/team
            if (queryOpponents && queryOpponents.length > 0) {
              const matchesOpponent = queryOpponents.some((opp) => str.includes(opp));
              if (matchesOpponent) {
                score += 20; // Strong bonus for actual opponent match
              }
            }

            // Check keyword/entity match
            for (const kw of queryKeywords) {
              if (str.includes(kw)) {
                score += kw.length >= 3 ? 4 : 2;
              }
            }

            return { item, score };
          });

          // Filter items with positive score
          const matched = scoredItems
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((s) => s.item);

          if (matched.length > 0) {
            // Found specific matched matches or records!
            contentToInject = JSON.stringify(
              {
                sourceFile: fName,
                totalInDataset: parsed.length,
                matchedRecordsCount: matched.length,
                matchedRecords: matched.slice(0, 60), // supply up to 60 relevant records
              },
              null,
              2
            );
          } else {
            // If year specified but no matches, report this dataset's available years to LLM
            const availableYears = Array.from(
              new Set(
                parsed
                  .map((it: any) => it.season || (it.date && it.date.slice(0, 4)) || (it.match_date_code && String(it.match_date_code).slice(0, 4)))
                  .filter(Boolean)
              )
            ).slice(0, 30);

            contentToInject = JSON.stringify(
              {
                sourceFile: fName,
                totalInDataset: parsed.length,
                note: `在 ${fName} 中未直接检索到与关键词匹配的记录。该数据集包含的年份范围包括: ${availableYears.join(", ")}`,
                sampleRecords: parsed.slice(0, 15),
              },
              null,
              2
            );
          }
        }

        jsonSections.push(`【海港数据表 - ${fName}】:
\`\`\`json
${contentToInject}
\`\`\``);
      }

      if (searchResults.length > 0) {
        const textSnippets = searchResults
          .filter((s) => !s[0].metadata?.sourceFile?.endsWith(".json"))
          .map(([doc, score], idx) => `【参考文档补充 #${idx + 1} (${doc.metadata.sourceFile})】: ${doc.pageContent}`)
          .join("\n\n");
        if (textSnippets) {
          jsonSections.push(textSnippets);
        }
      }
      contextText = jsonSections.join("\n\n---\n\n");
    } else {
      // Pure text / Markdown RAG snippets
      contextText = searchResults
        .map(([doc, score], idx) => {
          const meta = doc.metadata;
          const matchInfo = meta.matchDate
            ? `[比赛日期: ${meta.matchDate} | 赛事: ${meta.competition || "中超"} | 比分: ${meta.scoreline || "未注明"}]`
            : "";
          return `【参考记录 #${idx + 1}】
来源文件: ${meta.sourceFile} (${meta.section})
标题: ${meta.title} ${matchInfo}
相关度评估: ${(score * 100).toFixed(1)}%
内容:
${doc.pageContent}`;
        })
        .join("\n\n---\n\n");
    }

    // Formulate multi-turn conversation context
    const recentHistory = history
      .slice(-6)
      .map((h) => `${h.role === "user" ? "用户" : "海港专家"}: ${h.content}`)
      .join("\n");

    const systemPrompt = `你是由上海海港足球俱乐部历史数据与内部知识库支持的“海港足球俱乐部历史数据专家”。
你的职责是严谨、专业、详实地解答关于上海海港足球俱乐部（前身上海东亚、上海上港）的队史记录、经典比赛、夺冠历程、球员数据及俱乐部历史事件。

【当前数据读取引擎】：
${hasJsonDatasets ? "★ 当前已启用【原生 JSON 结构化全量解析引擎】。请用流利清晰的中文自然语言解答，并将数据项整理为规范格式（严禁直接把原始 JSON 代码块甩给用户）。" : "★ 当前基于【文档语义向量检索切片】。"}

【核心原则与严禁幻觉说明】：
1. 知识库为唯一事实来源：必须完全基于下面提供的数据内容进行回答。
2. 语言与呈现规范：
   - 严禁用原始未经整理的 JSON 格式直接回复用户。必须转化为清晰的专业足球解说与数据陈述。
   - 包含核心比赛要素：比赛日期、赛事名称、对阵双方与比分、进球球员及进球时间。
3. 统计计算能力：
   - 当用户询问统计（如“总共进了几个球”、“某赛季战绩如何”、“某球员进球数”），根据提供的数据计算并列出明细。
4. 严禁凭空捏造：
   - 若数据中【完全没有】提及用户询问的内容或比赛，你必须明确告知：“根据当前知识库记录，未查到关于该问题的记录。”
5. 格式采用美观清晰的 Markdown。`;

    const userPrompt = `【海港内部知识库数据】：
${contextText}

${recentHistory ? `【多轮对话历史】：\n${recentHistory}\n` : ""}

【用户当前问题】：
${question}

请结合上述海港内部知识库数据，用专业、通顺的自然语言 Markdown 格式进行严谨解答，不要输出无意义的原始代码块。并在回答中指出赛事、时间、比分与球员关键信息。`;

    const modelsToTry = ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        const ai = getGeminiClient();
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.15,
          },
        });

        const answerText = response.text || "根据当前海港内部知识库与历史数据记录，未检索到相关内容。";

        return {
          answer: answerText,
          sources,
          retrievedCount: hasJsonDatasets ? (this.uploadedFiles.get(jsonFiles[0].name)?.itemCount || searchResults.length) : searchResults.length,
          hasDirectMatch: true,
          retrievalMode: hasJsonDatasets ? "json_full_context" : "vector_rag",
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} attempt failed (${err.status || err.message}), attempting fallback...`);
      }
    }

    console.error("All Gemini models failed, falling back to local retrieved data:", lastError);

    // Graceful fallback answer: format the JSON or text chunk into readable human Chinese instead of raw JSON dumps
    if (searchResults.length > 0 && searchResults[0][1] > 0.15) {
      const topDoc = searchResults[0][0];
      let formattedContent = topDoc.pageContent;
      try {
        const parsedDoc = JSON.parse(topDoc.pageContent);
        // Format nicely into a readable record card
        const parts: string[] = [];
        if (parsedDoc.match_name || parsedDoc.title) parts.push(`**赛事场次**：${parsedDoc.match_name || parsedDoc.title}`);
        if (parsedDoc.match_date_code || parsedDoc.matchDate || parsedDoc.date) parts.push(`**比赛日期**：${parsedDoc.match_date_code || parsedDoc.matchDate || parsedDoc.date}`);
        if (parsedDoc.home_team && parsedDoc.away_team) parts.push(`**对阵双方**：${parsedDoc.home_team} vs ${parsedDoc.away_team}`);
        if (parsedDoc.home_score !== undefined && parsedDoc.away_score !== undefined) {
          parts.push(`**最终比分**：${parsedDoc.home_team} ${parsedDoc.home_score} - ${parsedDoc.away_score} ${parsedDoc.away_team} (${parsedDoc.match_result || ""})`);
        } else if (parsedDoc.scoreline) {
          parts.push(`**比分**：${parsedDoc.scoreline}`);
        }
        if (parsedDoc.goal_player) {
          parts.push(`**进球球员**：${parsedDoc.goal_player} (${parsedDoc.goal_time || ""})`);
        }
        if (parsedDoc.assist_player && parsedDoc.assist_player !== "？" && parsedDoc.assist_player !== "—") {
          parts.push(`**助攻球员**：${parsedDoc.assist_player}`);
        }
        if (parsedDoc.remark && parsedDoc.remark !== "—") {
          parts.push(`**备注信息**：${parsedDoc.remark}`);
        }

        if (parts.length > 0) {
          formattedContent = parts.join("\n- ");
          formattedContent = `- ${formattedContent}`;
        }
      } catch (e) {
        // keep as is if not json
      }

      const quotaNotice = String(lastError?.message || "").includes("Quota") || String(lastError?.message || "").includes("429")
        ? "\n\n*(注：因 API 瞬时调用频率限制，系统已自动切换至本地精准匹配模式为您呈现数据库原始记录)*"
        : "";

      return {
        answer: `### 知识库检索记录\n\n${formattedContent}${quotaNotice}`,
        sources,
        retrievedCount: searchResults.length,
        hasDirectMatch: true,
        retrievalMode: "vector_rag",
      };
    }

    return {
      answer: "根据当前上海海港足球俱乐部内部知识库与历史数据记录，未检索到与该问题相关的确切匹配记录。如需了解，您可随时上传相关赛季或比赛数据文档以扩充知识库。",
      sources: [],
      retrievedCount: 0,
      hasDirectMatch: false,
    };
  }
}

export const knowledgeBase = new KnowledgeBaseManager();
