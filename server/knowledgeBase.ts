import fs from "fs";
import path from "path";
import { Document } from "@langchain/core/documents";
import {
  GeminiLangChainEmbeddings,
  LangChainPortVectorStore,
  splitTextIntoChunks,
} from "./langchainStore.js";
import { getGeminiClient } from "./geminiClient.js";
import {
  isPortTeam,
  buildPromptIdentityRules,
  identifyOpponentsInQuery,
  identifyPortErasInQuery,
  ALL_PORT_NAME_VARIANTS,
  OPPONENT_ALIASES_DICTIONARY,
} from "./aliasRules.js";

export { isPortTeam };

const DATA_DIR = path.join(process.cwd(), "data");
const KNOWLEDGE_DIR = path.join(DATA_DIR, "knowledge");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const META_FILE = path.join(DATA_DIR, "kb_manifest.json");

// Dynamic set tracking all registered player names from player_history_stats.json
const allLoadedPlayerNames = new Set<string>();

/**
 * Intelligent keyword and entity extractor for Chinese football questions
 */
function extractChineseFootballKeywords(query: string): {
  years: string[];
  keywords: string[];
  opponents: string[];
  months: number[];
  monthFilter: { month: number; isAfter: boolean; isBefore: boolean } | null;
  isUpcomingSchedule: boolean;
  isScheduleQuery: boolean;
} {
  const yearsSet = new Set<string>();

  // 1. Standard 4-digit years: 1990-2099
  const fourDigitMatches = query.match(/\b(19\d\d|20\d\d)\b/g) || [];
  fourDigitMatches.forEach((y) => yearsSet.add(y));

  // 2. Chinese colloquial 2-digit year abbreviations:
  // e.g. "08年", "09年", "18年", "19年", "20年", "24年", "18赛季", "18年度", "18届", "18中超", "18亚冠", "18足协杯"
  const twoDigitMatches = query.match(/(?:^|[^\d])(0[6-9]|[12]\d)(?:年|年度|赛季|届|\s*中超|\s*足协杯|\s*亚冠|\s*中甲|\s*中乙|\s*联赛)/g);
  if (twoDigitMatches) {
    for (const raw of twoDigitMatches) {
      const numMatch = raw.match(/(0[6-9]|[12]\d)/);
      if (numMatch) {
        const val = parseInt(numMatch[1], 10);
        if (val >= 6 && val <= 35) {
          yearsSet.add(`20${val < 10 ? "0" + val : val}`);
        } else if (val >= 80) {
          yearsSet.add(`19${val}`);
        }
      }
    }
  }

  // 3. Multi-year / cross-season patterns like "24/25", "2024/25", "18-19", "24-25赛季", "2024-2025"
  const crossYearMatches = query.match(/(\d{2,4})\s*[/ -~至到]\s*(\d{2,4})/g);
  if (crossYearMatches) {
    for (const cym of crossYearMatches) {
      const parts = cym.split(/[/ -~至到]/).filter(Boolean);
      if (parts.length === 2) {
        let p1 = parts[0];
        let p2 = parts[1];
        if (p1.length === 2) {
          const v1 = parseInt(p1, 10);
          p1 = v1 >= 6 && v1 <= 35 ? `20${p1}` : `19${p1}`;
        }
        if (p2.length === 4) {
          p2 = p2.slice(2);
        }
        yearsSet.add(p1);
        yearsSet.add(`${p1}/${p2}`);
        // Also add second year
        const v2 = parseInt(p2, 10);
        if (!isNaN(v2)) {
          yearsSet.add(`20${p2}`);
        }
      }
    }
  }

  // 4. Chinese character colloquial numerals: e.g. "零八年", "一八年", "一九年", "二零年", "二四年", "一八赛季"
  const cnNumMap: Record<string, string> = {
    "零": "0", "〇": "0", "一": "1", "二": "2", "两": "2", "三": "3",
    "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9"
  };
  const cnYearMatches = query.match(/([零〇一二两三四五六七八九]{2,4})(?:年|赛季)/g);
  if (cnYearMatches) {
    for (const cym of cnYearMatches) {
      const charsMatch = cym.match(/[零〇一二两三四五六七八九]{2,4}/);
      if (charsMatch) {
        const chars = charsMatch[0];
        const converted = chars.split("").map((c) => cnNumMap[c] || "").join("");
        if (converted.length === 2) {
          const val = parseInt(converted, 10);
          if (val >= 6 && val <= 35) {
            yearsSet.add(`20${val < 10 ? "0" + val : val}`);
          } else if (val >= 80) {
            yearsSet.add(`19${val}`);
          }
        } else if (converted.length === 4) {
          yearsSet.add(converted);
        }
      }
    }
  }

  // 5. Month & Schedule Intent Detection
  const months: number[] = [];
  let monthFilter: { month: number; isAfter: boolean; isBefore: boolean } | null = null;
  const cnMonths: Record<string, number> = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6,
    "七": 7, "八": 8, "九": 9, "十": 10, "十一": 11, "十二": 12,
  };

  const numMonthMatch = query.match(/(\b\d{1,2}\b)\s*月/);
  let parsedMonth: number | null = null;
  if (numMonthMatch) {
    const m = parseInt(numMonthMatch[1], 10);
    if (m >= 1 && m <= 12) parsedMonth = m;
  }
  if (parsedMonth === null) {
    const cnMonthMatch = query.match(/(十一|十二|十|[一二三四五六七八九])\s*月/);
    if (cnMonthMatch && cnMonths[cnMonthMatch[1]]) {
      parsedMonth = cnMonths[cnMonthMatch[1]];
    }
  }

  if (parsedMonth !== null) {
    months.push(parsedMonth);
    const isAfter = /之后|以后|往后|及以后|之后包括|起|开始/i.test(query);
    const isBefore = /之前|以前|往前/i.test(query);
    monthFilter = { month: parsedMonth, isAfter, isBefore };
    // If no year specified in query, default to active 2026 season
    if (yearsSet.size === 0) {
      yearsSet.add("2026");
    }
  }

  const isUpcomingSchedule = /接下来|未来|后续|未开始|剩余|剩下|余下|下一场|下轮|下场|未开打|还没踢|还没打|接下去/i.test(query);
  const isScheduleQuery = /赛程|比赛日程|对阵表|赛历|日程表|日程安排|比赛安排|比赛时间|下一场|下轮|接下来|未来赛程|后续/i.test(query);
  if ((isUpcomingSchedule || isScheduleQuery) && yearsSet.size === 0) {
    yearsSet.add("2026");
  }

  const years = Array.from(yearsSet);
  const keywordSet = new Set<string>();
  const opponentSet = new Set<string>();

  // Known entities and nicknames in Chinese football
  const knownOpponents = [
    "广州恒大", "广州恒大淘宝", "恒大淘宝", "恒大", "广州队", "广州广汽恒大",
    "广州富力", "富力",
    "北京国安", "国安", "山东泰山", "山东鲁能", "泰山", "鲁能",
    "上海申花", "申花", "江苏苏宁", "苏宁", "天津天海", "权健", "天津泰达", "津门虎",
    "河南建业", "河南队", "长春亚泰", "亚泰", "大连一方", "大连人", "武汉三镇", "浙江绿城",
    "贵州恒丰", "贵州智诚", "河北华夏幸福", "华夏幸福", "青岛海牛", "成都蓉城", "深圳队",
    "大田韩亚市民", "河内公安", "纽卡斯尔喷气机", "辽宁铁人", "武里南联", "浦项铁人", "泰港", "全北现代汽车",
    "青岛西海岸", "沧州雄狮", "南通支云", "梅州客家", "深圳新鹏城"
  ];

  // Match opponents using full opponent aliases dictionary
  const matchedOpponentsFromDict = identifyOpponentsInQuery(query);
  for (const oppDef of matchedOpponentsFromDict) {
    opponentSet.add(oppDef.canonicalName);
    oppDef.commonNames.forEach((cn) => {
      opponentSet.add(cn);
      keywordSet.add(cn);
    });
    oppDef.historicalFormerNames.forEach((fn) => {
      opponentSet.add(fn);
      keywordSet.add(fn);
    });
    oppDef.allKeywords.forEach((kw) => keywordSet.add(kw));
  }

  for (const opp of knownOpponents) {
    if (query.includes(opp)) {
      opponentSet.add(opp);
      keywordSet.add(opp);
    }
  }

  // Detect Port FC Eras and Aliases (同一性与简称库)
  const isQueryingPort = ALL_PORT_NAME_VARIANTS.some((alias) => query.includes(alias));
  if (isQueryingPort) {
    keywordSet.add("上海海港");
    keywordSet.add("上海上港");
    keywordSet.add("上海东亚");
    keywordSet.add("海港");
    keywordSet.add("上港");
    keywordSet.add("东亚");
  }

  const knownEntities = [
    "上海海港", "上海上港", "上海东亚", "海港", "上港", "东亚", "特莱士", "上海特莱士",
    "中超", "中甲", "中乙", "足协杯", "超级杯", "亚冠", "亚冠联赛",
    "武磊", "奥斯卡", "胡尔克", "浩克", "埃尔克森", "艾克森", "巴尔加斯",
    "吕文君", "蔡慧康", "王燊超", "颜骏凌", "曹赟定", "阿瑙托维奇", "佩雷拉", "博阿斯",
    "贺惯", "于海", "傅欢", "石柯", "魏震", "蒋光太", "李昂", "徐新", "买提江",
    "李圣龙", "古斯塔沃", "茹萨", "奇塔迪尼", "莱昂纳多", "孙祥", "孔卡", "朱峥嵘", "王佳玉",
    "维托尔·佩雷拉", "维托尔佩雷拉", "哈维尔", "哈维尔·佩雷拉", "哈维尔佩雷拉",
    "穆斯卡特", "凯文·穆斯卡特", "马斯卡特", "埃里克森", "莱科", "伊万·莱科",
    "高洪波", "蒋炳尧", "范志毅", "奚志康", "徐根宝", "鲁伊兹", "阿尔梅达",
    "主教练", "教练", "主帅", "执教", "帅位", "带队"
  ];

  for (const entity of knownEntities) {
    if (query.includes(entity)) {
      keywordSet.add(entity);
    }
  }

  for (const pName of allLoadedPlayerNames) {
    if (pName.length >= 2 && query.includes(pName)) {
      keywordSet.add(pName);
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
    months,
    monthFilter,
    isUpcomingSchedule,
    isScheduleQuery,
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
  retrievalMode?: "json_full_context" | "vector_rag" | "hybrid" | "authoritative_stats";
}

export interface CoachDefinition {
  canonicalName: string;
  aliases: string[];
  role: string;
  honors: string[];
  specialNote: string;
}

export const KNOWN_PORT_COACHES: CoachDefinition[] = [
  {
    canonicalName: "维托尔·佩雷拉",
    aliases: ["维托尔·佩雷拉", "维托尔佩雷拉", "佩雷拉", "vitor pereira", "佩帅"],
    role: "前主教练 (带领球队夺得2018中超联赛冠军、2019超级杯冠军)",
    honors: [
      "2018赛季中国足球协会超级联赛冠军（队史首座中超联赛冠军）",
      "2019中国足球协会超级杯冠军"
    ],
    specialNote:
      "2018赛季中超联赛第26-28轮（客场对苏宁、主场对鲁能、客场5-4对恒大）佩雷拉因被中国足协停赛处罚，由第一助理教练菲利佩·阿尔梅达在场边代理现场指挥（3战2胜1平0负），佩雷拉仍为该赛季全程主教练。",
  },
  {
    canonicalName: "弗朗西斯科·哈维尔·佩雷拉·梅吉亚",
    aliases: ["哈维尔", "哈维尔·佩雷拉", "哈维尔佩雷拉", "javier pereira"],
    role: "前主教练 (带领球队夺得2023中超联赛冠军)",
    honors: ["2023赛季中国足球协会超级联赛冠军"],
    specialNote: "2023赛季执教1个赛季率队夺得中超冠军后赛季末离任。",
  },
  {
    canonicalName: "凯文·穆斯卡特",
    aliases: [
      "凯文·文森特·穆斯卡特",
      "凯文·穆斯卡特",
      "凯文穆斯卡特",
      "穆斯卡特",
      "马斯卡特",
      "kevin muscat",
      "穆帅"
    ],
    role: "主教练 (带领球队夺得2024赛季中超与足协杯双冠王)",
    honors: [
      "2024赛季中国足球协会超级联赛冠军",
      "2024中国足球协会足协杯冠军"
    ],
    specialNote: "2024赛季接任主帅，创造中超单赛季多项进攻历史纪录并夺得中超+足协杯双冠王。",
  },
  {
    canonicalName: "安德烈·维拉斯·博阿斯",
    aliases: ["博阿斯", "维拉斯·博阿斯", "维拉斯博阿斯", "andre villas-boas", "villas-boas"],
    role: "前主教练 (2017赛季)",
    honors: ["2017赛季中超联赛亚军", "2017亚冠联赛四强", "2017足协杯亚军"],
    specialNote: "执教2017单赛季45场比赛（28胜8平9负，胜率62.2%），第15-16轮因停赛曾由助教丹尼尔·苏泽代理指挥。",
  },
  {
    canonicalName: "斯文·戈兰·埃里克森",
    aliases: ["埃里克森", "斯文·戈兰·埃里克森", "斯文戈兰埃里克森", "eriksson"],
    role: "前主教练 (2015-2016赛季)",
    honors: ["2015赛季中超联赛亚军", "2016赛季亚冠联赛八强"],
    specialNote: "执教2015和2016两个赛季共76场比赛（42胜20平14负，胜率55.3%），带领球队首次打进亚冠。",
  },
  {
    canonicalName: "伊万·莱科",
    aliases: ["莱科", "伊万·莱科", "伊万莱科", "ivan leko"],
    role: "前主教练 (2021-2022赛季)",
    honors: ["2021赛季中超联赛亚军", "2021足协杯亚军"],
    specialNote: "执教2021和2022两个赛季共58场比赛（33胜12平13负，胜率56.9%）。",
  },
  {
    canonicalName: "高洪波",
    aliases: ["高洪波", "高导"],
    role: "前主教练 (2013赛季)",
    honors: [],
    specialNote: "执教球队升入中超后的首个赛季（2013赛季共32场，9胜9平14负）。",
  },
  {
    canonicalName: "奚志康",
    aliases: ["奚志康", "奚导"],
    role: "前主教练/代理主教练 (2014, 2022, 2023赛季)",
    honors: [],
    specialNote: "多次在球队过渡期担任主教练或代理主教练，执教41场比赛（20胜15平6负）。",
  },
  {
    canonicalName: "蒋炳尧",
    aliases: ["蒋炳尧"],
    role: "前主教练 (2007-2009, 2011-2012赛季)",
    honors: ["2007年中乙联赛冠军（冲甲成功）", "2012年中甲联赛冠军（冲超成功）"],
    specialNote: "根宝基地功勋教练，带领青年军完成中乙冲甲和中甲冲超，共执教125场（57胜35平33负）。",
  },
  {
    canonicalName: "范志毅",
    aliases: ["范志毅", "范大将军"],
    role: "前主教练 (2010赛季)",
    honors: [],
    specialNote: "2010赛季带领上海东亚征战中甲联赛共24场比赛（9胜10平5负）。",
  },
  {
    canonicalName: "克劳德·鲁伊兹",
    aliases: ["克劳德·鲁伊兹", "鲁伊兹"],
    role: "前主教练 (2006赛季队史首任外教)",
    honors: [],
    specialNote: "2006年中乙联赛南区预赛执教16场比赛（3胜5平8负）。",
  },
];

/**
 * Standardize and map raw coach strings from match records to canonical entities
 */
export function normalizePortCoachName(raw: string): {
  canonicalName: string;
  isInterim: boolean;
  roleNote: string;
} {
  const c = (raw || "").trim();
  if (!c) return { canonicalName: "未知教练", isInterim: false, roleNote: "未知" };

  if (c.includes("穆斯卡特") || c.includes("马斯卡特")) {
    return { canonicalName: "凯文·穆斯卡特", isInterim: false, roleNote: "主教练 (2024至今，中超+足协杯双冠王)" };
  }
  if (c.includes("博阿斯")) {
    return { canonicalName: "安德烈·维拉斯·博阿斯", isInterim: false, roleNote: "前主教练 (2017赛季)" };
  }
  if (c.includes("埃里克森")) {
    return { canonicalName: "斯文·戈兰·埃里克森", isInterim: false, roleNote: "前主教练 (2015-2016赛季)" };
  }
  if (c.includes("哈维尔")) {
    return { canonicalName: "弗朗西斯科·哈维尔·佩雷拉·梅吉亚", isInterim: false, roleNote: "前主教练 (2023赛季中超冠军)" };
  }
  if (c.includes("维托尔·佩雷拉") || c === "佩雷拉") {
    return { canonicalName: "维托尔·佩雷拉", isInterim: false, roleNote: "前主教练 (2018-2020赛季，2018中超冠军+2019超级杯)" };
  }
  if (c.includes("莱科")) {
    return { canonicalName: "伊万·莱科", isInterim: false, roleNote: "前主教练 (2021-2022赛季)" };
  }
  if (c.includes("高洪波")) {
    return { canonicalName: "高洪波", isInterim: false, roleNote: "前主教练 (2013赛季初登中超)" };
  }
  if (c.includes("奚志康")) {
    return { canonicalName: "奚志康", isInterim: false, roleNote: "前主教练/多次代理主帅 (2014, 2022, 2023赛季)" };
  }
  if (c.includes("蒋炳尧")) {
    return { canonicalName: "蒋炳尧", isInterim: false, roleNote: "前主教练 (2007-2009, 2011-2012，中乙冠军+中甲冠军功勋教练)" };
  }
  if (c.includes("范志毅")) {
    return { canonicalName: "范志毅", isInterim: false, roleNote: "前主教练 (2010赛季中甲)" };
  }
  if (c.includes("鲁伊兹")) {
    return { canonicalName: "克劳德·鲁伊兹", isInterim: false, roleNote: "前主教练 (2006赛季中乙，队史首任外籍主帅)" };
  }

  // Interims / Touchline stand-ins
  if (c.includes("孙祥")) {
    return { canonicalName: "孙祥 (代理主帅)", isInterim: true, roleNote: "2022赛季莱科离任后临时代理指挥1场（1战1胜）" };
  }
  if (c.includes("阿尔梅达")) {
    return { canonicalName: "菲利佩·阿尔梅达 (助教代理)", isInterim: true, roleNote: "2018赛季佩雷拉停赛时代为现场指挥3场（3战2胜1平）" };
  }
  if (c.includes("阿洛伊西")) {
    return { canonicalName: "罗斯·阿洛伊西 (助教代理)", isInterim: true, roleNote: "2025赛季穆斯卡特停赛时代为现场指挥1场（1战1胜）" };
  }
  if (c.includes("伊兹奎尔多") || c.includes("泰纳")) {
    return { canonicalName: "何塞·伊兹奎尔多 (助教代理)", isInterim: true, roleNote: "2023赛季哈维尔停赛时代为现场指挥1场（1战1胜）" };
  }
  if (c.includes("谢晖")) {
    return { canonicalName: "谢晖 (助教代理)", isInterim: true, roleNote: "2017赛季博阿斯停赛时代为现场指挥2场（2战1胜1平）" };
  }
  if (c.includes("苏泽")) {
    return { canonicalName: "丹尼尔·苏泽 (助教代理)", isInterim: true, roleNote: "2017赛季博阿斯停赛时代为现场指挥4场（4战1胜3负）" };
  }
  if (c.includes("陈旭峰")) {
    return { canonicalName: "陈旭峰 (青年军代理领队)", isInterim: true, roleNote: "2020足协杯青年军出战指挥1场（1战0胜1负）" };
  }
  if (c.includes("金子隆之")) {
    return { canonicalName: "金子隆之 (预备队代理领队)", isInterim: true, roleNote: "2021亚冠预备队出战指挥1场（1战0胜1负）" };
  }

  return { canonicalName: c, isInterim: false, roleNote: "教练" };
}

/**
 * Deterministically compute aggregated coaching statistics across all matches in history_schedule.json
 */
export function computeCoachAggregation(schedule: any[], query: string) {
  const queryLower = query.toLowerCase();

  // Find matching coaches
  const matchedDefs = KNOWN_PORT_COACHES.filter((c) =>
    c.aliases.some((alias) => queryLower.includes(alias.toLowerCase()))
  );

  // Broad detection of coaching / win-rate / ranking queries
  const isCoachIntent =
    matchedDefs.length > 0 ||
    /主教练|教练|主帅|执教|帅位|胜率|胜场率|胜率最高|胜率最低|最高胜率|最低胜率|排名|排行|谁最高|谁最低|最高是谁|最低是谁|历任|历届|带队|谁带队|谁是主帅|明细来统计|按明细/i.test(
      query
    );

  if (!isCoachIntent) return null;

  // Build coach statistics from all schedule records
  const statsMap = new Map<
    string,
    {
      name: string;
      isInterim: boolean;
      roleNote: string;
      totalMatches: number;
      seasons: Set<string>;
      win: number;
      draw: number;
      loss: number;
      seasonBreakdown: Record<
        string,
        {
          total: number;
          win: number;
          draw: number;
          loss: number;
          competitions: Record<string, number>;
        }
      >;
      competitionBreakdown: Record<string, number>;
      firstMatch: any;
      lastMatch: any;
    }
  >();

  for (const m of schedule) {
    const isPortHome = isPortTeam(m.home_team);
    const isPortAway = isPortTeam(m.away_team);
    if (!isPortHome && !isPortAway) continue;

    const rawCoach = (isPortHome ? m.home_coach : m.away_coach)?.trim() || "";
    const { canonicalName, isInterim, roleNote } = normalizePortCoachName(rawCoach);

    let stat = statsMap.get(canonicalName);
    if (!stat) {
      stat = {
        name: canonicalName,
        isInterim,
        roleNote,
        totalMatches: 0,
        seasons: new Set<string>(),
        win: 0,
        draw: 0,
        loss: 0,
        seasonBreakdown: {},
        competitionBreakdown: {},
        firstMatch: null,
        lastMatch: null,
      };
      statsMap.set(canonicalName, stat);
    }

    stat.totalMatches++;
    const s = String(m.season || "未知赛季");
    stat.seasons.add(s);

    if (m.win_loss === "胜") stat.win++;
    else if (m.win_loss === "平") stat.draw++;
    else if (m.win_loss === "负") stat.loss++;

    const comp = m.match_type || "其他赛事";
    stat.competitionBreakdown[comp] = (stat.competitionBreakdown[comp] || 0) + 1;

    if (!stat.seasonBreakdown[s]) {
      stat.seasonBreakdown[s] = {
        total: 0,
        win: 0,
        draw: 0,
        loss: 0,
        competitions: {},
      };
    }
    stat.seasonBreakdown[s].total++;
    if (m.win_loss === "胜") stat.seasonBreakdown[s].win++;
    else if (m.win_loss === "平") stat.seasonBreakdown[s].draw++;
    else if (m.win_loss === "负") stat.seasonBreakdown[s].loss++;
    stat.seasonBreakdown[s].competitions[comp] =
      (stat.seasonBreakdown[s].competitions[comp] || 0) + 1;

    if (!stat.firstMatch) stat.firstMatch = m;
    stat.lastMatch = m;
  }

  // Separate official head coaches (>= 10 matches) vs interim/stand-in coaches (< 10 matches)
  const allCoachesList = Array.from(statsMap.values());

  const officialStats = allCoachesList
    .filter((s) => !s.isInterim && s.totalMatches >= 10)
    .map((s) => {
      const def = KNOWN_PORT_COACHES.find((d) => d.canonicalName === s.name);
      const seasonsArr = Array.from(s.seasons).sort();
      const winRateNum = s.totalMatches > 0 ? (s.win / s.totalMatches) * 100 : 0;
      return {
        coachName: s.name,
        commonName: def ? def.aliases[0] : s.name,
        role: def?.role || s.roleNote,
        totalMatches: s.totalMatches,
        record: `${s.win}胜 ${s.draw}平 ${s.loss}负`,
        win: s.win,
        draw: s.draw,
        loss: s.loss,
        winRateNum,
        winRate: `${winRateNum.toFixed(1)}%`,
        seasonsList: seasonsArr,
        majorHonors: def?.honors || [],
        specialNotes: def?.specialNote || "",
      };
    })
    .sort((a, b) => b.winRateNum - a.winRateNum);

  // Add ranking positions (1 to N)
  const officialCoachesRanking = officialStats.map((item, idx) => ({
    rank: idx + 1,
    ...item,
  }));

  const interimCoachesRanking = allCoachesList
    .filter((s) => s.isInterim || s.totalMatches < 10)
    .map((s) => {
      const seasonsArr = Array.from(s.seasons).sort();
      const winRateNum = s.totalMatches > 0 ? (s.win / s.totalMatches) * 100 : 0;
      return {
        coachName: s.name,
        role: s.roleNote,
        totalMatches: s.totalMatches,
        record: `${s.win}胜 ${s.draw}平 ${s.loss}负`,
        win: s.win,
        draw: s.draw,
        loss: s.loss,
        winRate: `${winRateNum.toFixed(1)}%`,
        winRateNum,
        seasonsList: seasonsArr,
      };
    })
    .sort((a, b) => b.winRateNum - a.winRateNum);

  const highestOfficial = officialCoachesRanking[0];
  const lowestOfficial = officialCoachesRanking[officialCoachesRanking.length - 1];

  // Specific queried coaches detail (if any named in query)
  const targetDefs = matchedDefs.length > 0 ? matchedDefs : KNOWN_PORT_COACHES;
  const detailedCoachReports = targetDefs.map((def) => {
    const rawStat = statsMap.get(def.canonicalName) || {
      name: def.canonicalName,
      totalMatches: 0,
      seasons: new Set<string>(),
      win: 0,
      draw: 0,
      loss: 0,
      seasonBreakdown: {},
      competitionBreakdown: {},
      firstMatch: null,
      lastMatch: null,
    };

    const seasonsArr = Array.from(rawStat.seasons).sort();
    const rankInfo = officialCoachesRanking.find((r) => r.coachName === def.canonicalName);

    return {
      coachName: def.canonicalName,
      commonName: def.aliases[0],
      rankInClubHistory: rankInfo ? `第${rankInfo.rank}名（正式主帅中）` : "未列入正式长期主帅榜",
      role: def.role,
      totalSeasonsCount: seasonsArr.length,
      seasonsList: seasonsArr,
      totalMatchesCoached: rawStat.totalMatches,
      overallRecord: `${rawStat.win}胜 ${rawStat.draw}平 ${rawStat.loss}负`,
      winRate:
        rawStat.totalMatches > 0
          ? `${((rawStat.win / rawStat.totalMatches) * 100).toFixed(1)}%`
          : "0%",
      seasonDetails: rawStat.seasonBreakdown,
      competitionsDistribution: rawStat.competitionBreakdown,
      majorHonors: def.honors,
      specialNotes: def.specialNote,
      firstMatch: rawStat.firstMatch
        ? `${rawStat.firstMatch.date} ${rawStat.firstMatch.match_name} (${rawStat.firstMatch.home_team} ${rawStat.firstMatch.result} ${rawStat.firstMatch.away_team})`
        : null,
      lastMatch: rawStat.lastMatch
        ? `${rawStat.lastMatch.date} ${rawStat.lastMatch.match_name} (${rawStat.lastMatch.home_team} ${rawStat.lastMatch.result} ${rawStat.lastMatch.away_team})`
        : null,
    };
  });

  return {
    aggregationType: `海港主教练执教全量官方权威统计与胜率排名（遍历全量${schedule.length}场历史赛程精确计算）`,
    summary: {
      highestWinRateOfficialCoach: {
        name: highestOfficial.coachName,
        commonName: highestOfficial.commonName,
        totalMatches: highestOfficial.totalMatches,
        record: highestOfficial.record,
        winRate: highestOfficial.winRate,
        seasons: highestOfficial.seasonsList,
        conclusion: `队史正式主教练胜率最高为${highestOfficial.coachName}（${highestOfficial.commonName}），在${highestOfficial.seasonsList.join("、")}执教${highestOfficial.totalMatches}场取得${highestOfficial.record}，胜率高达${highestOfficial.winRate}！`
      },
      lowestWinRateOfficialCoach: {
        name: lowestOfficial.coachName,
        commonName: lowestOfficial.commonName,
        totalMatches: lowestOfficial.totalMatches,
        record: lowestOfficial.record,
        winRate: lowestOfficial.winRate,
        seasons: lowestOfficial.seasonsList,
        conclusion: `队史正式主教练胜率最低为${lowestOfficial.coachName}（${lowestOfficial.commonName}），在${lowestOfficial.seasonsList.join("、")}执教${lowestOfficial.totalMatches}场取得${lowestOfficial.record}，胜率仅为${lowestOfficial.winRate}。`
      },
      totalOfficialCoachesEvaluated: officialCoachesRanking.length,
      totalMatchesCovered: schedule.length,
    },
    officialCoachesRanking,
    interimCoachesRanking,
    queriedCoachesDetails: matchedDefs.length > 0 ? detailedCoachReports : undefined,
    authoritativeInstruction:
      `【核心权威准则】：上方 coachStats 是后台直接遍历全部${schedule.length}场赛程逐场精确统计计算的官方绝对权威事实。回答海港历任主帅胜率、最高/最低主帅、胜率排行榜或根据明细统计时，【必须直接以 summary 和 officialCoachesRanking 为唯一基准进行清晰解答与表格呈现】，严禁回复'未收录'、'无法统计'或自行臆测场次！`,
    disambiguationNotice:
      queryLower.includes("佩雷拉")
        ? "海港队史有两位夺冠主教练中文译名均含'佩雷拉'：维托尔·佩雷拉（葡萄牙籍，2018-2020赛季执教114场，夺2018中超与2019超级杯冠军，胜率58.8%）与哈维尔·佩雷拉（西班牙籍，2023赛季执教31场，夺2023中超冠军，胜率58.1%）。请在回答时主动进行消歧与说明。"
        : undefined,
  };
}

export function computeHeadToHeadAggregation(schedule: any[], oppKeywords: string[]) {
  if (!oppKeywords || oppKeywords.length === 0) return null;
  const results: any[] = [];
  const handledCanonicalNames = new Set<string>();

  for (const opp of oppKeywords) {
    // Prefer exact match on canonicalName, commonNames, or historicalFormerNames first
    const dictEntry =
      OPPONENT_ALIASES_DICTIONARY.find(
        (d) =>
          d.canonicalName === opp ||
          d.commonNames.includes(opp) ||
          d.historicalFormerNames.includes(opp)
      ) ||
      OPPONENT_ALIASES_DICTIONARY.find((d) =>
        d.allKeywords.some((kw) => kw === opp)
      );

    const displayName = dictEntry ? dictEntry.canonicalName : opp;
    if (handledCanonicalNames.has(displayName)) continue;
    handledCanonicalNames.add(displayName);

    const matchVariants = dictEntry
      ? Array.from(
          new Set([
            dictEntry.canonicalName,
            ...dictEntry.commonNames,
            ...dictEntry.historicalFormerNames,
          ])
        )
      : [opp];

    const matched = schedule
      .filter((m) => {
        const isPortHome = isPortTeam(m.home_team);
        const isPortAway = isPortTeam(m.away_team);
        if (!isPortHome && !isPortAway) return false;
        const opponent = isPortHome ? m.away_team : m.home_team;
        if (!opponent) return false;
        return matchVariants.some((variant) => opponent.includes(variant));
      })
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    if (matched.length === 0) continue;

    let win = 0,
      draw = 0,
      loss = 0;
    const comps: Record<string, { total: number; win: number; draw: number; loss: number }> = {};
    matched.forEach((m) => {
      const c = m.match_type || "其他赛事";
      if (!comps[c]) comps[c] = { total: 0, win: 0, draw: 0, loss: 0 };
      comps[c].total++;
      if (m.win_loss === "胜") {
        win++;
        comps[c].win++;
      } else if (m.win_loss === "平") {
        draw++;
        comps[c].draw++;
      } else if (m.win_loss === "负") {
        loss++;
        comps[c].loss++;
      }
    });

    const formatMatchLine = (m: any) =>
      `${m.date} [${m.season}赛季 ${m.match_type} ${m.round || m.match_name}] ${m.home_team} ${m.result} ${m.away_team} (海港${m.win_loss}${m.venue ? `，球场：${m.venue}` : ""})`;

    results.push({
      targetOpponent: displayName,
      aliasVariantsMatched: matchVariants,
      totalHeadToHeadMatches: matched.length,
      portOverallRecord: `${win}胜 ${draw}平 ${loss}负`,
      winRate: `${((win / matched.length) * 100).toFixed(1)}%`,
      competitionsBreakdown: comps,
      firstMatch: formatMatchLine(matched[0]),
      latestMatch: formatMatchLine(matched[matched.length - 1]),
      allMatchesChronological:
        matched.length <= 60
          ? matched.map(formatMatchLine)
          : matched.slice(-30).map(formatMatchLine),
      recentMatchesSample: matched.slice(-8).map(formatMatchLine),
    });
  }

  if (results.length === 0) return null;
  return {
    aggregationType: `历史对阵交锋与上海德比权威全量统计（遍历全量${schedule.length}场赛程精确汇总）`,
    instruction:
      "请严格以这里的历史交手总场次、胜平负战绩、胜率、各赛事分布及完整交锋场次列表为准进行详实回答。若用户询问‘上海德比’或‘德比战历史交锋记录’，请重点呈现海港（含上海东亚、上海上港时期）对阵同城死敌【上海申花】的37场完整交锋总战绩、赛事分布、经典战役与近年交锋明细，并主动补充说明队史对阵其他上海同城对手（上海申鑫6场、上海浦东中邦4场、上海赛更达1场）的德比交战记录。",
    headToHead: results,
  };
}

/**
 * Deterministically compute season overview statistics
 */
export function computeSeasonAggregation(schedule: any[], queryYears: string[]) {
  if (!queryYears || queryYears.length === 0) return null;
  const reports: any[] = [];

  for (const y of queryYears) {
    const matched = schedule.filter(
      (m) => m.season === y || String(m.season || "").startsWith(y)
    );
    if (matched.length === 0) continue;

    let win = 0, draw = 0, loss = 0;
    const comps: Record<string, number> = {};
    const coaches = new Set<string>();

    matched.forEach((m) => {
      if (m.win_loss === "胜") win++;
      else if (m.win_loss === "平") draw++;
      else if (m.win_loss === "负") loss++;
      const c = m.match_type || "其他赛事";
      comps[c] = (comps[c] || 0) + 1;
      const isPortHome = isPortTeam(m.home_team);
      const portCoach = isPortHome ? m.home_coach : m.away_coach;
      if (portCoach) coaches.add(portCoach.trim());
    });

    reports.push({
      season: y,
      totalMatchesInSeason: matched.length,
      record: `${win}胜 ${draw}平 ${loss}负`,
      winRate: `${((win / matched.length) * 100).toFixed(1)}%`,
      competitionsDistribution: comps,
      coachesInSeason: Array.from(coaches),
    });
  }

  if (reports.length === 0) return null;
  return {
    aggregationType: "赛季官方权威全量总战绩（基于历史赛程全部精确汇总）",
    instruction: "涉及该赛季总场次与战绩时，严格以此处统计数字为准。",
    seasons: reports,
  };
}

/**
 * Deterministically compute goal scorer stats from goal_details.json
 */
export function computeGoalScorerAggregation(goals: any[], queryKeywords: string[]) {
  if (!goals || !Array.isArray(goals) || goals.length === 0) return null;
  const matchedPlayers = new Set<string>();
  for (const kw of queryKeywords) {
    if (kw.length >= 2) {
      const hasGoal = goals.some((g) => g.goal_player && g.goal_player.includes(kw));
      if (hasGoal) {
        matchedPlayers.add(kw);
      }
    }
  }
  if (matchedPlayers.size === 0) return null;

  const playerReports: any[] = [];
  for (const p of matchedPlayers) {
    const pGoals = goals.filter((g) => g.goal_player && g.goal_player.includes(p));
    const compCount: Record<string, number> = {};
    pGoals.forEach((g) => {
      const c = g.match_type || "其他赛事";
      compCount[c] = (compCount[c] || 0) + 1;
    });

    playerReports.push({
      playerName: p,
      totalRecordedGoalsInDetails: pGoals.length,
      competitionsDistribution: compCount,
      firstRecordedGoal: pGoals[0]
        ? `${pGoals[0].season}年 ${pGoals[0].match_name} (${pGoals[0].home_team} vs ${pGoals[0].away_team}, 进球时间: ${pGoals[0].goal_time})`
        : null,
      latestRecordedGoal: pGoals[pGoals.length - 1]
        ? `${pGoals[pGoals.length - 1].season}年 ${pGoals[pGoals.length - 1].match_name} (${pGoals[pGoals.length - 1].home_team} vs ${pGoals[pGoals.length - 1].away_team}, 进球时间: ${pGoals[pGoals.length - 1].goal_time})`
        : null,
    });
  }

  return {
    aggregationType: `进球明细表权威汇总（基于全部${goals.length}条进球明细统计）`,
    scorers: playerReports,
  };
}

/**
 * Helper to parse Chinese numerals or digits from query like "第500场", "第一百球", "第100胜"
 */
function parseChineseOrdinalNumbers(query: string): number[] {
  const results = new Set<number>();
  const digitRegex = /第\s*(\d+)\s*(?:场|胜|平|负|球|粒|个|次|轮)/g;
  let m: RegExpExecArray | null;
  while ((m = digitRegex.exec(query)) !== null) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0) results.add(n);
  }
  const cnMap: Record<string, number> = {
    首: 1, 第一: 1, 头一: 1, 处子: 1,
    五十: 50, 百: 100, 一百: 100, 两百: 200, 二百: 200,
    三百: 300, 四百: 400, 五百: 500, 六百: 600, 七百: 700,
    八百: 800, 九百: 900, 千: 1000, 一千: 1000,
  };
  for (const [k, v] of Object.entries(cnMap)) {
    if (query.includes(k)) results.add(v);
  }
  return Array.from(results);
}

/**
 * Deterministically compute team schedule milestones, competition firsts, era transitions, venue milestones, and team records
 */
export function computeScheduleMilestonesAggregation(schedule: any[], query: string) {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return null;

  const isMilestoneQuery =
    /里程碑|节点|百场|百胜|千球|百球|首战|首场|首秀|首胜|第一场|第一胜|处子|建队|更名|纪录|记录|极值|最|连胜|不败|大胜|惨败|最大比分|分差|上座|观众|第\s*\d+\s*[场胜平负]/i.test(
      query
    );
  if (!isMilestoneQuery) return null;

  const validMatches = [...schedule]
    .filter((m) => m && m.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (validMatches.length === 0) return null;

  const formatMatchBrief = (m: any, label?: string) => {
    if (!m) return null;
    const prefix = label ? `【${label}】` : "";
    return `${prefix}${m.date} (${m.season}赛季 ${m.match_name}) ${m.home_team} ${m.result} ${m.away_team} [${m.win_loss}] | 主帅: ${isPortTeam(m.home_team) ? m.home_coach : m.away_coach || "未知"} | 球场: ${m.venue || "未知"}`;
  };

  // 1. All-competition total match milestones
  const matchMilestoneIndices = [1, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, validMatches.length];
  const requestedOrdinals = parseChineseOrdinalNumbers(query);
  for (const ord of requestedOrdinals) {
    if (ord >= 1 && ord <= validMatches.length && !matchMilestoneIndices.includes(ord)) {
      matchMilestoneIndices.push(ord);
    }
  }
  matchMilestoneIndices.sort((a, b) => a - b);

  const totalMatchMilestones = matchMilestoneIndices
    .filter((n) => n >= 1 && n <= validMatches.length)
    .map((n) => formatMatchBrief(validMatches[n - 1], `队史第${n}场比赛`));

  // 2. All-competition win milestones
  const allWins = validMatches.filter((m) => m.win_loss === "胜");
  const winMilestoneIndices = [1, 50, 100, 150, 200, 250, 300, 350, allWins.length];
  for (const ord of requestedOrdinals) {
    if (ord >= 1 && ord <= allWins.length && !winMilestoneIndices.includes(ord)) {
      winMilestoneIndices.push(ord);
    }
  }
  winMilestoneIndices.sort((a, b) => a - b);

  const totalWinMilestones = winMilestoneIndices
    .filter((n) => n >= 1 && n <= allWins.length)
    .map((n) => formatMatchBrief(allWins[n - 1], `队史第${n}场胜利`));

  // 3. Competition-specific milestones (CSL, ACLE, CFA, C1L, C2L, SuperCup)
  const compConfigs = [
    { name: "中超联赛", regex: /中超/ },
    { name: "亚冠联赛", regex: /亚冠/ },
    { name: "足协杯", regex: /足协杯/ },
    { name: "中甲联赛", regex: /中甲/ },
    { name: "中乙联赛", regex: /中乙/ },
    { name: "中国超级杯", regex: /超级杯|超霸杯/ },
  ];

  const competitionMilestones: Record<string, any> = {};
  for (const c of compConfigs) {
    const compMatches = validMatches.filter(
      (m) => c.regex.test(m.match_type || "") || c.regex.test(m.match_name || "")
    );
    const compWins = compMatches.filter((m) => m.win_loss === "胜");
    if (compMatches.length === 0) continue;

    const mNodes = [1, 50, 100, 150, 200, 250, 300, 350, 400, compMatches.length];
    const wNodes = [1, 50, 100, 150, 200, compWins.length];
    for (const ord of requestedOrdinals) {
      if (ord <= compMatches.length && !mNodes.includes(ord)) mNodes.push(ord);
      if (ord <= compWins.length && !wNodes.includes(ord)) wNodes.push(ord);
    }

    competitionMilestones[c.name] = {
      totalMatches: compMatches.length,
      totalWins: compWins.length,
      firstMatch: formatMatchBrief(compMatches[0], `${c.name}首秀`),
      firstWin: compWins[0] ? formatMatchBrief(compWins[0], `${c.name}首胜`) : null,
      keyMatchNodes: Array.from(new Set(mNodes))
        .filter((n) => n >= 1 && n <= compMatches.length)
        .sort((a, b) => a - b)
        .map((n) => formatMatchBrief(compMatches[n - 1], `${c.name}第${n}场`)),
      keyWinNodes: Array.from(new Set(wNodes))
        .filter((n) => n >= 1 && n <= compWins.length)
        .sort((a, b) => a - b)
        .map((n) => formatMatchBrief(compWins[n - 1], `${c.name}第${n}胜`)),
    };
  }

  // 4. Era / Team Name Transitions
  const eraNames = ["上海东亚", "上海特莱士", "上海上港", "上海海港"];
  const eraMilestones = eraNames.map((eraName) => {
    const eraMatches = validMatches.filter(
      (m) => m.home_team === eraName || m.away_team === eraName
    );
    const eraWins = eraMatches.filter((m) => m.win_loss === "胜");
    return {
      teamName: eraName,
      totalMatches: eraMatches.length,
      totalWins: eraWins.length,
      firstMatch: formatMatchBrief(eraMatches[0], `${eraName}时期首战`),
      firstWin: formatMatchBrief(eraWins[0], `${eraName}时期首胜`),
      lastMatch: formatMatchBrief(eraMatches[eraMatches.length - 1], `${eraName}时期最近/末战`),
    };
  });

  // 5. Home Venue Milestones
  const keyVenues = ["崇明根宝足球基地", "上海金山足球场", "上海体育场", "上海源深体育中心", "上汽浦东足球场"];
  const homeMatches = validMatches.filter((m) => isPortTeam(m.home_team));
  const venueMilestones = keyVenues.map((vName) => {
    const vMatches = homeMatches.filter((m) => (m.venue || "").includes(vName));
    const vWins = vMatches.filter((m) => m.win_loss === "胜");
    return {
      venue: vName,
      homeMatchesCount: vMatches.length,
      homeWinsCount: vWins.length,
      firstHomeMatch: formatMatchBrief(vMatches[0], `${vName}主场首秀`),
      firstHomeWin: formatMatchBrief(vWins[0], `${vName}主场首胜`),
    };
  });

  // 6. Extremes & Streaks Records
  let maxWinDiff = -1, maxWinMatches: any[] = [];
  let maxLossDiff = -1, maxLossMatches: any[] = [];
  let maxPortGoals = -1, maxPortGoalMatches: any[] = [];
  let maxTotalGoals = -1, maxTotalGoalMatches: any[] = [];
  let curWinStreak = 0, maxWinStreak = 0, bestWinStreakRange: any = null, curWinStart: any = null;
  let curUnbeaten = 0, maxUnbeaten = 0, bestUnbeatenRange: any = null, curUnbeatenStart: any = null;

  for (const m of validMatches) {
    const parts = String(m.result || "").split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const portHome = isPortTeam(m.home_team);
      const portScore = portHome ? parts[0] : parts[1];
      const oppScore = portHome ? parts[1] : parts[0];
      const diff = portScore - oppScore;
      const total = portScore + oppScore;

      if (diff > maxWinDiff) { maxWinDiff = diff; maxWinMatches = [m]; }
      else if (diff === maxWinDiff) { maxWinMatches.push(m); }

      if (-diff > maxLossDiff) { maxLossDiff = -diff; maxLossMatches = [m]; }
      else if (-diff === maxLossDiff) { maxLossMatches.push(m); }

      if (portScore > maxPortGoals) { maxPortGoals = portScore; maxPortGoalMatches = [m]; }
      else if (portScore === maxPortGoals) { maxPortGoalMatches.push(m); }

      if (total > maxTotalGoals) { maxTotalGoals = total; maxTotalGoalMatches = [m]; }
      else if (total === maxTotalGoals) { maxTotalGoalMatches.push(m); }
    }

    if (m.win_loss === "胜") {
      if (curWinStreak === 0) curWinStart = m;
      curWinStreak++;
      if (curWinStreak > maxWinStreak) {
        maxWinStreak = curWinStreak;
        bestWinStreakRange = { count: curWinStreak, start: curWinStart, end: m };
      }
    } else {
      curWinStreak = 0;
    }

    if (m.win_loss === "胜" || m.win_loss === "平") {
      if (curUnbeaten === 0) curUnbeatenStart = m;
      curUnbeaten++;
      if (curUnbeaten > maxUnbeaten) {
        maxUnbeaten = curUnbeaten;
        bestUnbeatenRange = { count: curUnbeaten, start: curUnbeatenStart, end: m };
      }
    } else {
      curUnbeaten = 0;
    }
  }

  const byAttendance = [...validMatches]
    .filter((m) => Number(m.attendance) > 0)
    .sort((a, b) => Number(b.attendance) - Number(a.attendance));
  const homeByAttendance = byAttendance.filter((m) => isPortTeam(m.home_team));

  return {
    aggregationType: `上海海港队史赛程与极值里程碑全维权威统计（基于全量${validMatches.length}场比赛精确提取）`,
    instruction:
      "当回答涉及队史第N场比赛、第N场胜利、各赛事（中超/亚冠/足协杯/中甲/中乙）首秀与百场百胜节点、更名节点、主场变迁、最大比分胜负、最长连胜/不败纪录或最高上座人数时，必须严格以此权威统计为准！",
    overallSummary: {
      totalMatchesInHistory: validMatches.length,
      totalWinsInHistory: allWins.length,
      totalDrawsInHistory: validMatches.filter((m) => m.win_loss === "平").length,
      totalLossesInHistory: validMatches.filter((m) => m.win_loss === "负").length,
    },
    totalMatchMilestones,
    totalWinMilestones,
    competitionMilestones,
    eraMilestones,
    venueMilestones,
    extremeRecords: {
      biggestWinMargin: {
        goalDifference: maxWinDiff,
        matches: maxWinMatches.map((m) => formatMatchBrief(m, "最大分差胜利")),
      },
      biggestLossMargin: {
        goalDifference: maxLossDiff,
        matches: maxLossMatches.map((m) => formatMatchBrief(m, "最大分差失利")),
      },
      mostGoalsScoredByPortInSingleMatch: {
        goals: maxPortGoals,
        matches: maxPortGoalMatches.map((m) => formatMatchBrief(m, "单场最高进球")),
      },
      highestTotalGoalsInSingleMatch: {
        totalGoals: maxTotalGoals,
        matches: maxTotalGoalMatches.map((m) => formatMatchBrief(m, "单场双方总进球最多")),
      },
      longestWinningStreak: bestWinStreakRange
        ? {
            streakCount: bestWinStreakRange.count,
            fromMatch: formatMatchBrief(bestWinStreakRange.start, "连胜起点"),
            toMatch: formatMatchBrief(bestWinStreakRange.end, "连胜终点"),
          }
        : null,
      longestUnbeatenStreak: bestUnbeatenRange
        ? {
            streakCount: bestUnbeatenRange.count,
            fromMatch: formatMatchBrief(bestUnbeatenRange.start, "不败起点"),
            toMatch: formatMatchBrief(bestUnbeatenRange.end, "不败终点"),
          }
        : null,
      highestHomeAttendanceTop3: homeByAttendance
        .slice(0, 3)
        .map((m) => `${m.date} ${m.match_name} ${m.home_team} ${m.result} ${m.away_team} (${m.venue}) - 观众: ${m.attendance}人`),
      highestOverallAttendanceTop3: byAttendance
        .slice(0, 3)
        .map((m) => `${m.date} ${m.match_name} ${m.home_team} ${m.result} ${m.away_team} (${m.venue}) - 观众: ${m.attendance}人`),
    },
  };
}

/**
 * Deterministically compute team & player goal milestones from goal_details.json
 */
export function computeGoalMilestonesAggregation(goals: any[], query: string, queryKeywords: string[]) {
  if (!goals || !Array.isArray(goals) || goals.length === 0) return null;

  const isGoalMilestoneQuery =
    /里程碑|节点|百球|千球|首球|第一球|第一粒|处子球|第\s*\d+\s*[球粒个]|进球里程碑/i.test(query);
  if (!isGoalMilestoneQuery) return null;

  const sortedGoals = [...goals].sort((a, b) => {
    const dA = Number(a.match_date_code || 0);
    const dB = Number(b.match_date_code || 0);
    if (dA !== dB) return dA - dB;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  const formatGoalBrief = (g: any, label?: string) => {
    if (!g) return null;
    const prefix = label ? `【${label}】` : "";
    return `${prefix}日期代码: ${g.match_date_code} (${g.season}赛季 ${g.match_name}${g.round ? ` ${g.round}` : ""}) ${g.home_team} ${g.home_score}-${g.away_score} ${g.away_team} [${g.match_result}] | 进球球员: ${g.goal_player} (时间: ${g.goal_time}) | 助攻: ${g.assist_player || "无"}`;
  };

  const requestedOrdinals = parseChineseOrdinalNumbers(query);

  // 1. All-competition team goal milestones
  const teamGoalNodes = [1, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, sortedGoals.length];
  for (const ord of requestedOrdinals) {
    if (ord >= 1 && ord <= sortedGoals.length && !teamGoalNodes.includes(ord)) {
      teamGoalNodes.push(ord);
    }
  }
  teamGoalNodes.sort((a, b) => a - b);

  const allTeamGoalMilestones = teamGoalNodes
    .filter((n) => n >= 1 && n <= sortedGoals.length)
    .map((n) => formatGoalBrief(sortedGoals[n - 1], `队史第${n}球`));

  // 2. Competition-specific goal milestones
  const compConfigs = [
    { name: "中超联赛", regex: /中超/ },
    { name: "亚冠联赛", regex: /亚冠/ },
    { name: "足协杯", regex: /足协杯/ },
    { name: "中甲联赛", regex: /中甲/ },
    { name: "中乙联赛", regex: /中乙/ },
  ];
  const competitionGoalMilestones: Record<string, any> = {};
  for (const c of compConfigs) {
    const cGoals = sortedGoals.filter((g) => c.regex.test(g.match_type || "") || c.regex.test(g.match_name || ""));
    if (cGoals.length === 0) continue;
    const nodes = [1, 50, 100, 200, 300, 400, 500, 600, 700, 800, cGoals.length];
    for (const ord of requestedOrdinals) {
      if (ord >= 1 && ord <= cGoals.length && !nodes.includes(ord)) nodes.push(ord);
    }
    competitionGoalMilestones[c.name] = {
      totalGoals: cGoals.length,
      milestoneGoals: Array.from(new Set(nodes))
        .filter((n) => n >= 1 && n <= cGoals.length)
        .sort((a, b) => a - b)
        .map((n) => formatGoalBrief(cGoals[n - 1], `${c.name}第${n}球`)),
    };
  }

  // 3. Key players' personal goal milestones (e.g. Wu Lei, Lv Wenjun, Oscar, Hulk, Elkeson or queried player)
  const keyPlayerNames = new Set<string>(["武磊", "吕文君", "奥斯卡", "胡尔克", "埃尔克森", "王燊超"]);
  for (const kw of queryKeywords) {
    if (kw.length >= 2 && sortedGoals.some((g) => g.goal_player && g.goal_player.includes(kw))) {
      keyPlayerNames.add(kw);
    }
  }
  const playerGoalMilestones: Record<string, any> = {};
  for (const pName of keyPlayerNames) {
    const pGoals = sortedGoals.filter((g) => g.goal_player && g.goal_player.includes(pName));
    if (pGoals.length === 0) continue;
    const pNodes = [1, 10, 50, 100, 150, 200, pGoals.length];
    for (const ord of requestedOrdinals) {
      if (ord >= 1 && ord <= pGoals.length && !pNodes.includes(ord)) pNodes.push(ord);
    }
    playerGoalMilestones[pName] = {
      totalRecordedGoals: pGoals.length,
      milestones: Array.from(new Set(pNodes))
        .filter((n) => n >= 1 && n <= pGoals.length)
        .sort((a, b) => a - b)
        .map((n) => formatGoalBrief(pGoals[n - 1], `${pName}个人队史第${n}球`)),
    };
  }

  return {
    aggregationType: `上海海港队史进球里程碑权威全量统计（基于全部${sortedGoals.length}粒进球明细精确提取）`,
    instruction:
      "当回答队史第1球、第100/500/1000/1200球、各赛事首球与整百球节点、或球员个人处子球与百球里程碑时，必须严格以此精确统计数据为准！",
    totalRecordedGoalsInHistory: sortedGoals.length,
    allTeamGoalMilestones,
    competitionGoalMilestones,
    playerGoalMilestones,
  };
}

/**
 * Deterministically compute player career appearance/goal/assist/clean-sheet milestone clubs and age records from player_history_stats.json, goal_details.json & player_appearance_details.json
 */
export function computePlayerClubMilestonesAggregation(
  players: any[],
  goals?: any[],
  appearanceDetails?: any,
  schedule?: any[]
) {
  if (!players || !Array.isArray(players) || players.length === 0) return null;

  const byApp = [...players].sort((a, b) => (b.summary?.appearances || 0) - (a.summary?.appearances || 0));
  const byGoals = [...players].sort((a, b) => (b.summary?.goals || 0) - (a.summary?.goals || 0));
  const byAssists = [...players].sort((a, b) => (b.summary?.assists || 0) - (a.summary?.assists || 0));
  const byCleanSheets = [...players]
    .filter((p) => (p.summary?.cleanSheets || 0) > 0)
    .sort((a, b) => (b.summary?.cleanSheets || 0) - (a.summary?.cleanSheets || 0));

  // Cross-table age milestone calculation
  const birthMap = new Map<string, string>();
  for (const p of players) {
    if (p.name && p.birthDate) birthMap.set(p.name.trim(), p.birthDate.trim());
  }

  let youngestScorers: string[] = [];
  let oldestScorers: string[] = [];

  if (goals && Array.isArray(goals) && goals.length > 0) {
    const goalAgeRecords: {
      player: string;
      birthDate: string;
      matchDate: string;
      totalDays: number;
      ageLabel: string;
      matchDesc: string;
    }[] = [];

    for (const g of goals) {
      const cleanName = String(g.goal_player || "")
        .replace(/\(.*\)|（.*）|PK|OG/gi, "")
        .trim();
      const bDate = birthMap.get(cleanName);
      const codeStr = String(g.match_date_code || "");
      if (bDate && codeStr.length === 8) {
        const mDate = `${codeStr.slice(0, 4)}-${codeStr.slice(4, 6)}-${codeStr.slice(6, 8)}`;
        const diffMs = new Date(mDate).getTime() - new Date(bDate).getTime();
        const days = Math.floor(diffMs / (1000 * 3600 * 24));
        if (days > 0) {
          const years = Math.floor(days / 365.2425);
          const remDays = Math.round(days - years * 365.2425);
          goalAgeRecords.push({
            player: cleanName,
            birthDate: bDate,
            matchDate: mDate,
            totalDays: days,
            ageLabel: `${years}岁${remDays}天`,
            matchDesc: `${mDate} (${g.season}赛季 ${g.match_name}${g.round ? ` ${g.round}` : ""}) ${g.home_team} ${g.home_score}-${g.away_score} ${g.away_team}`,
          });
        }
      }
    }

    goalAgeRecords.sort((a, b) => a.totalDays - b.totalDays);

    // Deduplicate by player for unique top rankings
    const seenYoung = new Set<string>();
    for (const r of goalAgeRecords) {
      if (!seenYoung.has(r.player)) {
        seenYoung.add(r.player);
        youngestScorers.push(`${r.player} (破门年龄: ${r.ageLabel}, 出生日期: ${r.birthDate} | 比赛: ${r.matchDesc})`);
        if (seenYoung.size >= 6) break;
      }
    }

    const seenOld = new Set<string>();
    for (let i = goalAgeRecords.length - 1; i >= 0; i--) {
      const r = goalAgeRecords[i];
      if (!seenOld.has(r.player)) {
        seenOld.add(r.player);
        oldestScorers.push(`${r.player} (破门年龄: ${r.ageLabel}, 出生日期: ${r.birthDate} | 比赛: ${r.matchDesc})`);
        if (seenOld.size >= 6) break;
      }
    }
  }

  // Cross-table debut appearances calculation using player_appearance_details & history_schedule
  let youngestAppearanceDebuts: any[] = [];
  const appPlayers = appearanceDetails?.players || (Array.isArray(appearanceDetails) ? appearanceDetails : null);
  if (appPlayers && Array.isArray(appPlayers) && schedule && Array.isArray(schedule)) {
    const matchMap = new Map<string, any>();
    for (const m of schedule) {
      if (m.match_id) matchMap.set(m.match_id, m);
    }

    const debuts: any[] = [];
    for (const p of appPlayers) {
      if (!p.birthDate || p.birthDate === "—") continue;
      let earliestDate: string | null = null;
      let earliestMatch: any = null;
      let earliestApp: any = null;
      for (const s of (p.seasons || [])) {
        for (const app of (s.appearances || [])) {
          if (app.status === "出场" || (app.status === "替补" && (app.minutes > 0 || app.minutes === undefined))) {
            const m = matchMap.get(app.matchId);
            if (m && m.date) {
              if (!earliestDate || m.date < earliestDate) {
                earliestDate = m.date;
                earliestMatch = m;
                earliestApp = app;
              }
            }
          }
        }
      }

      if (p.name === "武磊") {
        debuts.push({
          player: "武磊",
          birthDate: "1991-11-19",
          debutDate: "2006-09-02",
          ageLabel: "14岁287天 (约14岁9个月)",
          competition: "2006中乙联赛第13轮",
          matchDesc: "2006-09-02 中乙联赛 上海东亚 vs 丽江东巴 (替补登场)",
          specialHonor: "海港队史暨中国职业联赛历史最年轻出场纪录保持者",
          sortDays: 14 * 365.25 + 287,
        });
      } else if (earliestDate && earliestMatch) {
        const bDate = new Date(p.birthDate);
        const mDate = new Date(earliestDate);
        const diffMs = mDate.getTime() - bDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const years = Math.floor(diffDays / 365.2425);
        const days = Math.round(diffDays - years * 365.2425);
        debuts.push({
          player: p.name,
          birthDate: p.birthDate,
          debutDate: earliestDate,
          ageLabel: `${years}岁${days}天`,
          competition: earliestMatch.match_name,
          matchDesc: `${earliestDate} (${earliestMatch.match_name}) ${earliestMatch.home_team} ${earliestMatch.result || ""} ${earliestMatch.away_team} [${earliestApp.status}${earliestApp.minutes ? `, 出战${earliestApp.minutes}分钟` : ""}]`,
          specialHonor: earliestMatch.match_name?.includes("中超") && years < 17 ? "中超时代海港队史最年轻出场纪录" : undefined,
          sortDays: diffDays,
        });
      }
    }
    debuts.sort((a, b) => a.sortDays - b.sortDays);
    youngestAppearanceDebuts = debuts.slice(0, 10).map((d, idx) => ({
      rank: idx + 1,
      player: d.player,
      ageLabel: d.ageLabel,
      birthDate: d.birthDate,
      debutDate: d.debutDate,
      competition: d.competition,
      matchDesc: d.matchDesc,
      specialHonor: d.specialHonor,
    }));
  }

  // Youngest players in 2006-2007 C2L era & latest birthDate players overall
  const youngestInC2LEra = [...players]
    .filter((p) => (p.c2l?.appearances || 0) > 0 && p.birthDate)
    .sort((a, b) => b.birthDate.localeCompare(a.birthDate))
    .slice(0, 6)
    .map((p) => `${p.name} (出生日期: ${p.birthDate}, 2006-2007中乙出场 ${p.c2l.appearances} 场)`);

  const latestBornPlayersWithApps = [...players]
    .filter((p) => (p.summary?.appearances || 0) > 0 && p.birthDate)
    .sort((a, b) => b.birthDate.localeCompare(a.birthDate))
    .slice(0, 8)
    .map((p) => `${p.name} (出生日期: ${p.birthDate}, 一线队总出场 ${p.summary.appearances} 场)`);

  return {
    aggregationType: `海港球员生涯荣誉殿堂、出场首秀年龄与里程碑俱乐部权威统计（基于${players.length}名球员历史档案、出场明细与${goals && Array.isArray(goals) ? goals.length : "全量"}条进球明细跨表精确关联）`,
    ageAndYouthMilestones: {
      dataStructureExplanation:
        "【最年轻出场与最年轻进球权威说明】：1) 最年轻出场球员已通过《球员逐场出场明细(player_appearance_details)》与《历史赛程(history_schedule)》13000余条出场记录精确计算首秀日期与登场年龄到天数；2) 武磊于2006年9月2日中乙首秀，年仅14岁287天（约14岁9个月），是海港队史暨中国职业联赛历史最年轻出场球员！3) 中超时代海港队史最年轻出场球员为贾博琰（2020年8月29日对天津泰达替补登场，年仅16岁273天）；4) 颜骏凌为队史第3年轻首秀球员（2007年中乙决赛首发，16岁301天）。",
      youngestAppearanceInClubHistory:
        "武磊（出生于1991-11-19，2006年9月2日中乙联赛对阵丽江东巴替补出场，登场时年仅14岁287天/约14岁9个月，创造海港队史暨中国职业联赛历史最年轻登场纪录）",
      youngestAppearanceInCSLEra:
        "贾博琰（出生于2003-11-30，2020年8月29日中超联赛第8轮对阵天津泰达出场，登场时年仅16岁273天，为海港中超时代最年轻出场纪录保持者）",
      top10YoungestDebutsRankings: youngestAppearanceDebuts,
      youngestPlayersIn2006To2007C2L: youngestInC2LEra,
      latestBornPlayersWithFirstTeamAppearances: latestBornPlayersWithApps,
      youngestGoalScorersInHistoryTop6: youngestScorers,
      oldestGoalScorersInHistoryTop6: oldestScorers,
    },
    appearanceMilestoneClubs: {
      club500Plus: byApp
        .filter((p) => (p.summary?.appearances || 0) >= 500)
        .map((p) => `${p.name} (${p.summary.appearances}场, 首发${p.summary.starts}场, ${p.summary.minutes}分钟)`),
      club400To499: byApp
        .filter((p) => (p.summary?.appearances || 0) >= 400 && (p.summary?.appearances || 0) < 500)
        .map((p) => `${p.name} (${p.summary.appearances}场, 首发${p.summary.starts}场)`),
      club200To399: byApp
        .filter((p) => (p.summary?.appearances || 0) >= 200 && (p.summary?.appearances || 0) < 400)
        .map((p) => `${p.name} (${p.summary.appearances}场)`),
      club100PlusTotalCount: byApp.filter((p) => (p.summary?.appearances || 0) >= 100).length,
      club100To199: byApp
        .filter((p) => (p.summary?.appearances || 0) >= 100 && (p.summary?.appearances || 0) < 200)
        .map((p) => `${p.name} (${p.summary.appearances}场)`),
    },
    goalMilestoneClubs: {
      club200Plus: byGoals
        .filter((p) => (p.summary?.goals || 0) >= 200)
        .map((p) => `${p.name} (${p.summary.goals}球, 中超${p.csl?.goals || 0}球)`),
      club100Plus: byGoals
        .filter((p) => (p.summary?.goals || 0) >= 100)
        .map((p) => `${p.name} (${p.summary.goals}球)`),
      club50Plus: byGoals
        .filter((p) => (p.summary?.goals || 0) >= 50)
        .map((p) => `${p.name} (${p.summary.goals}球)`),
      club30Plus: byGoals
        .filter((p) => (p.summary?.goals || 0) >= 30)
        .map((p) => `${p.name} (${p.summary.goals}球)`),
    },
    assistMilestoneClubs: {
      club100Plus: byAssists
        .filter((p) => (p.summary?.assists || 0) >= 100)
        .map((p) => `${p.name} (${p.summary.assists}次助攻)`),
      club50Plus: byAssists
        .filter((p) => (p.summary?.assists || 0) >= 50)
        .map((p) => `${p.name} (${p.summary.assists}次助攻)`),
      club25Plus: byAssists
        .filter((p) => (p.summary?.assists || 0) >= 25)
        .map((p) => `${p.name} (${p.summary.assists}次助攻)`),
    },
    goalkeeperCleanSheetMilestones: byCleanSheets.map(
      (p) => `${p.name} (零封${p.summary.cleanSheets}场 / 总出场${p.summary.appearances}场 / 扑点${p.summary.penaltySaves || 0}次)`
    ),
  };
}

/**
 * Deterministically compute recent/latest, opponent-specific, or earliest match aggregations from history_schedule.json & schedule.json
 */
export function computeMatchAggregation(schedule: any[], query: string) {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return null;

  const q = query.toLowerCase();
  const isRecentQuery = /最近|上一场|最新|近期|前一场|倒数第|最后|刚刚|刚结束|刚打完|刚踢完|昨天的比赛|上一轮/i.test(q);
  const isEarliestQuery = /最早|第一场|建队第一场|首场|初战/i.test(q);
  const isMatchResultQuery = /比分|结果|胜负|进球的是谁|谁进球|打成几比几|踢成几比几|谁赢了/i.test(q);
  const wantsWin = /赢球|获胜|胜仗|赢了|取胜|胜利|打赢/i.test(q);
  const wantsLoss = /输球|失利|输了|负/i.test(q);
  const wantsDraw = /平局|打平|平了/i.test(q);

  // Filter and normalize finished matches with dates
  let validMatches = schedule
    .filter((m) => m && (m.date || m.match_date_code))
    .map((m) => {
      const d = m.date || (m.match_date_code ? String(m.match_date_code) : "");
      const res = m.result !== undefined && m.result !== null ? String(m.result).trim() : (m.home_score !== undefined && m.away_score !== undefined ? `${m.home_score}-${m.away_score}` : "-");
      const wl = m.win_loss || m.match_result || (res === "1-1" || res === "0-0" || res === "2-2" ? "平" : undefined);
      return {
        ...m,
        date: d,
        result: res,
        win_loss: wl,
        competition: m.match_type || m.type || m.competition || "",
        homeTeam: m.home_team || m.homeTeam || "",
        awayTeam: m.away_team || m.awayTeam || "",
      };
    })
    .filter((m) => m.date && m.result !== "-" && m.result !== "" && m.result !== "待定" && m.status !== "未开始")
    .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

  if (validMatches.length === 0) return null;

  // Tournament filter if specified (e.g., 亚冠, 中超, 足协杯)
  if (/亚冠|亚冠精英/i.test(q)) {
    const acleMatches = validMatches.filter((m) => /亚冠/i.test(m.competition));
    if (acleMatches.length > 0) validMatches = acleMatches;
  } else if (/中超/i.test(q)) {
    const cslMatches = validMatches.filter((m) => /中超/i.test(m.competition));
    if (cslMatches.length > 0) validMatches = cslMatches;
  } else if (/足协杯/i.test(q)) {
    const cfaMatches = validMatches.filter((m) => /足协杯/i.test(m.competition));
    if (cfaMatches.length > 0) validMatches = cfaMatches;
  }

  // Check if query mentions a specific opponent (e.g., 大田 / 大田市民 / 津门虎 / 浙江 / 国安 / 泰山 / 申花)
  const opponentMatches = validMatches.filter((m) => {
    const h = (m.homeTeam || "").toLowerCase();
    const a = (m.awayTeam || "").toLowerCase();
    if (q.includes("大田") && (h.includes("大田") || a.includes("大田"))) return true;
    if (h.length >= 2 && !/海港|上港|东亚|特莱士/.test(h) && q.includes(h)) return true;
    if (a.length >= 2 && !/海港|上港|东亚|特莱士/.test(a) && q.includes(a)) return true;
    return false;
  });

  if (opponentMatches.length > 0) {
    validMatches = opponentMatches;
  } else if (!isRecentQuery && !isEarliestQuery && !isMatchResultQuery) {
    return null;
  }

  let targetMatches = validMatches;
  let targetDesc = "比赛";

  if (wantsWin) {
    targetMatches = validMatches.filter((m) => m.win_loss === "胜");
    targetDesc = "获胜/赢球场次";
  } else if (wantsLoss) {
    targetMatches = validMatches.filter((m) => m.win_loss === "负");
    targetDesc = "失利场次";
  } else if (wantsDraw) {
    targetMatches = validMatches.filter((m) => m.win_loss === "平");
    targetDesc = "平局场次";
  }

  if (targetMatches.length === 0) targetMatches = validMatches;

  if (isEarliestQuery) {
    const earliestMatches = targetMatches.slice(0, 8);
    const absoluteEarliest = earliestMatches[0];
    return {
      aggregationType: `赛程权威全量时间序列分析（队史最早/建队首场${targetDesc}）`,
      instruction: `队史最早的一场${targetDesc}必须严格以【absoluteEarliestMatch】为准！`,
      targetType: targetDesc,
      absoluteEarliestMatch: absoluteEarliest,
      earliestMatchesList: earliestMatches,
    };
  } else {
    // Default to most recent / latest
    const latestMatches = targetMatches.slice(-8).reverse();
    const absoluteLatest = latestMatches[0];
    return {
      aggregationType: `赛程权威全量时间序列分析（最近/最新${targetDesc}）`,
      instruction: `根据全量赛程数据库，最近/最新的一场${targetDesc}必须严格以【absoluteLatestMatch】为准，严禁将历史早期比赛误当作最近比赛！`,
      targetType: targetDesc,
      absoluteLatestMatch: absoluteLatest,
      recentMatchesList: latestMatches,
    };
  }
}

/**
 * Deterministically compute upcoming/future matches, month-specific matches, and schedule timelines
 */
export function computeScheduleTimelineAggregation(schedule: any[], query: string) {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return null;

  const q = query.toLowerCase();
  const isScheduleQuery = /赛程|比赛日程|对阵表|比赛安排|比赛安排表|赛历|日程表|日程安排|比赛时间|接下来|后续|未来|下一场|下轮|下场|未开始|剩余|剩下|余下|未开打|还没踢|还没打|接下去|后半程|下半程|下半赛季/i.test(q);
  const isUpcomingQuery = /接下来|未来|后续|未开始|剩余|剩下|余下|下一场|下轮|下场|未开打|还没踢|还没打|接下去/i.test(q);

  // Month detection
  const cnMonths: Record<string, number> = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6,
    "七": 7, "八": 8, "九": 9, "十": 10, "十一": 11, "十二": 12,
  };

  let targetMonth: number | null = null;
  let isAfterMonth = false;
  let isBeforeMonth = false;

  const numMonthMatch = q.match(/(\b\d{1,2}\b)\s*月/);
  if (numMonthMatch) {
    const m = parseInt(numMonthMatch[1], 10);
    if (m >= 1 && m <= 12) targetMonth = m;
  }
  if (targetMonth === null) {
    const cnMonthMatch = q.match(/(十一|十二|十|[一二三四五六七八九])\s*月/);
    if (cnMonthMatch && cnMonths[cnMonthMatch[1]]) {
      targetMonth = cnMonths[cnMonthMatch[1]];
    }
  }

  if (targetMonth !== null) {
    if (/之后|以后|往后|及以后|之后包括|起|开始|往后看/i.test(q)) {
      isAfterMonth = true;
    } else if (/之前|以前|往前/i.test(q)) {
      isBeforeMonth = true;
    }
  }

  if (!isScheduleQuery && targetMonth === null && !isUpcomingQuery) {
    return null;
  }

  // Normalize match items from both camelCase (schedule.json) and snake_case (history_schedule.json)
  const normalized = schedule
    .map((m: any, idx: number) => {
      const hTeam = m.homeTeam || m.home_team || "";
      const aTeam = m.awayTeam || m.away_team || "";
      const comp = m.type || m.match_type || m.competition || "中超";
      const date = m.date || (m.match_date_code ? String(m.match_date_code) : "");
      const result = m.result !== undefined && m.result !== null ? String(m.result).trim() : "-";
      const isUnplayed =
        m.status === "未开始" ||
        result === "-" ||
        result === "" ||
        result === "待定" ||
        (m.win_loss === undefined && result === "-");
      return {
        id: m.id ?? idx,
        date,
        time: m.time || m.kickoff_time || "待定",
        competition: comp,
        round: m.round || "",
        homeTeam: hTeam,
        awayTeam: aTeam,
        venue: m.venue || "待定",
        city: m.city || "",
        status: m.status || (isUnplayed ? "未开始" : "已结束"),
        result,
        referee: m.referee || "待定",
        home_coach: m.home_coach,
        away_coach: m.away_coach,
        scorers: m.scorers,
        _isUnplayed: isUnplayed,
      };
    })
    .filter((m) => Boolean(m.date));

  normalized.sort((a, b) => a.date.localeCompare(b.date));

  const unplayedMatches = normalized.filter((m) => m._isUnplayed);
  const nextImmediateMatch = unplayedMatches.length > 0 ? unplayedMatches[0] : null;

  let filteredMatches = normalized;
  let filterCriteria = "全部赛程总览";

  if (targetMonth !== null) {
    const targetMonthPad = targetMonth < 10 ? `0${targetMonth}` : `${targetMonth}`;
    if (isAfterMonth) {
      filterCriteria = `${targetMonth}月份及以后的赛程安排`;
      filteredMatches = normalized.filter((m) => {
        const parts = m.date.split("-");
        if (parts.length >= 2) {
          const yr = parseInt(parts[0], 10);
          const mo = parseInt(parts[1], 10);
          if (yr > 2026) return true;
          if (yr === 2026 && mo >= targetMonth!) return true;
        }
        return false;
      });
    } else if (isBeforeMonth) {
      filterCriteria = `${targetMonth}月份之前的比赛战况与赛程`;
      filteredMatches = normalized.filter((m) => {
        const parts = m.date.split("-");
        if (parts.length >= 2) {
          const yr = parseInt(parts[0], 10);
          const mo = parseInt(parts[1], 10);
          if (yr < 2026) return true;
          if (yr === 2026 && mo < targetMonth!) return true;
        }
        return false;
      });
    } else {
      filterCriteria = `${targetMonth}月份比赛赛程`;
      filteredMatches = normalized.filter((m) => m.date.includes(`-${targetMonthPad}-`));
    }
  } else if (isUpcomingQuery) {
    filterCriteria = "接下来的未进行赛程（待开战比赛）";
    filteredMatches = unplayedMatches;
  }

  // Format matches cleanly for consumption
  const formatItem = (m: any) => ({
    date: m.date,
    time: m.time,
    competition: m.competition,
    round: m.round,
    match: `${m.homeTeam} vs ${m.awayTeam}`,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    venue: `${m.city ? `${m.city} ` : ""}${m.venue}`.trim(),
    status: m.status,
    result: m.result,
    isHome: m.homeTeam.includes("海港") || m.homeTeam.includes("上港") || m.homeTeam.includes("东亚"),
  });

  return {
    aggregationType: `赛程权威时间线聚合（${filterCriteria}）`,
    instruction: `用户询问赛程安排时，必须完全基于本结构化聚合结果直接给出详细、准确的比赛日期、开球时间、赛事类型（中超/亚冠/足协杯）、轮次、对阵双方及比赛场馆！严禁回答“未收录”或“查无记录”！`,
    filterCriteria,
    totalMatchesInDataset: schedule.length,
    upcomingUnplayedCount: unplayedMatches.length,
    nextImmediateMatch: nextImmediateMatch ? formatItem(nextImmediateMatch) : null,
    matchedMatchesCount: filteredMatches.length,
    matchedMatchesList: filteredMatches.map(formatItem),
    allUpcomingMatchesList: unplayedMatches.map(formatItem),
  };
}

class KnowledgeBaseManager {
  private embeddings: GeminiLangChainEmbeddings;
  private vectorStore: LangChainPortVectorStore;
  private uploadedFiles: Map<string, UploadedFileInfo> = new Map();
  private rawJsonStore: Map<string, { content: string; parsed: any }> = new Map();
  private fileSignatures: Map<string, string> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.embeddings = new GeminiLangChainEmbeddings();
    this.vectorStore = new LangChainPortVectorStore(this.embeddings);
  }

  private ensureDirectories() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
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

  /**
   * Scans knowledge directories (data/knowledge and data/uploads) and loads all valid data files
   * If forceAll is false, only reloads new or modified files and removes deleted files (hot-sync)
   */
  private async scanAndLoadDirectoryFiles(forceAll: boolean = true): Promise<string[]> {
    this.ensureDirectories();
    const loadedFiles: string[] = [];
    const currentDiskFiles = new Set<string>();
    const validExtensions = new Set([".json", ".md", ".txt", ".csv"]);
    const directoriesToScan = [KNOWLEDGE_DIR, UPLOADS_DIR];
    let hasChanges = false;

    for (const dir of directoriesToScan) {
      if (!fs.existsSync(dir)) continue;
      try {
        const fileNames = fs.readdirSync(dir);
        for (const fName of fileNames) {
          // Skip README.md, hidden files, or non-data files
          if (fName.startsWith(".") || fName.toLowerCase() === "readme.md") continue;

          const ext = path.extname(fName).toLowerCase();
          if (!validExtensions.has(ext)) continue;

          const fullPath = path.join(dir, fName);
          try {
            const stat = fs.statSync(fullPath);
            if (!stat.isFile()) continue;

            currentDiskFiles.add(fName);
            const sig = `${stat.mtimeMs}_${stat.size}`;
            if (!forceAll && this.fileSignatures.get(fName) === sig && this.uploadedFiles.has(fName)) {
              loadedFiles.push(fName);
              continue;
            }

            const content = fs.readFileSync(fullPath, "utf8");
            if (content && content.trim().length > 0) {
              await this.internalAddContent(fName, content, stat.size, false);
              this.fileSignatures.set(fName, sig);
              loadedFiles.push(fName);
              hasChanges = true;
            }
          } catch (fileErr) {
            console.error(`Error reading data file ${fullPath}:`, fileErr);
          }
        }
      } catch (dirErr) {
        console.error(`Error scanning directory ${dir}:`, dirErr);
      }
    }

    // Remove any in-memory files that were deleted from disk
    for (const existingName of Array.from(this.uploadedFiles.keys())) {
      if (!currentDiskFiles.has(existingName)) {
        this.vectorStore.deleteBySourceFile(existingName);
        this.uploadedFiles.delete(existingName);
        this.rawJsonStore.delete(existingName);
        this.fileSignatures.delete(existingName);
        hasChanges = true;
      }
    }

    if (hasChanges || forceAll) {
      this.saveManifest();
    }
    return loadedFiles;
  }

  async initialize() {
    if (this.isInitialized) {
      await this.scanAndLoadDirectoryFiles(false);
      return;
    }
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.ensureDirectories();

      try {
        const loaded = await this.scanAndLoadDirectoryFiles(true);
        if (loaded.length > 0) {
          console.log(`Knowledge Base loaded ${loaded.length} files from knowledge directories (${Array.from(new Set(loaded)).join(", ")}).`);
        } else {
          console.log("Shanghai Port FC Knowledge Base initialized (directory empty, ready for data files in data/knowledge/).");
        }
      } catch (e) {
        console.error("Error during knowledge base directory scanning:", e);
      }

      this.isInitialized = true;
    })();

    return this.initPromise;
  }

  /**
   * Rescan data directories on demand to load newly added or updated files
   */
  async rescan(): Promise<{ scannedCount: number; loadedFiles: string[]; stats: any }> {
    await this.initialize();
    const loaded = await this.scanAndLoadDirectoryFiles(true);
    const stats = await this.getStats();
    return {
      scannedCount: loaded.length,
      loadedFiles: Array.from(new Set(loaded)),
      stats,
    };
  }

  /**
   * Get absolute path of a persisted raw data file for downloading or viewing
   */
  getRawFilePath(fileName: string): string | null {
    const cleanName = path.basename(fileName);
    const p1 = path.join(KNOWLEDGE_DIR, cleanName);
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(UPLOADS_DIR, cleanName);
    if (fs.existsSync(p2)) return p2;
    return null;
  }

  async deleteFile(fileName: string): Promise<{ success: boolean; removedChunks: number }> {
    await this.initialize();
    const cleanName = path.basename(fileName);
    const removedChunks = this.vectorStore.deleteBySourceFile(cleanName);
    this.uploadedFiles.delete(cleanName);
    this.rawJsonStore.delete(cleanName);
    this.fileSignatures.delete(cleanName);

    // Delete disk files if present
    try {
      const p1 = path.join(KNOWLEDGE_DIR, cleanName);
      if (fs.existsSync(p1)) fs.unlinkSync(p1);
      const p2 = path.join(UPLOADS_DIR, cleanName);
      if (fs.existsSync(p2)) fs.unlinkSync(p2);
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
    this.fileSignatures.clear();
    this.isInitialized = true;

    try {
      if (fs.existsSync(META_FILE)) fs.unlinkSync(META_FILE);

      // Clean UPLOADS_DIR
      if (fs.existsSync(UPLOADS_DIR)) {
        const files = fs.readdirSync(UPLOADS_DIR);
        for (const f of files) {
          if (!f.startsWith(".")) {
            fs.unlinkSync(path.join(UPLOADS_DIR, f));
          }
        }
      }

      // Clean KNOWLEDGE_DIR (preserve README.md)
      if (fs.existsSync(KNOWLEDGE_DIR)) {
        const files = fs.readdirSync(KNOWLEDGE_DIR);
        for (const f of files) {
          if (f.toLowerCase() !== "readme.md" && !f.startsWith(".")) {
            fs.unlinkSync(path.join(KNOWLEDGE_DIR, f));
          }
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

        let itemsArray: any[] | null = null;
        let isPlayerStatsArray = false;

        const isAppearanceFile =
          fileName.toLowerCase().includes("appearance") ||
          Boolean(parsed && (parsed.matchIdSource || (parsed.players && parsed.players[0]?.records)));
        const isHistoryStatsFile = !isAppearanceFile && Boolean(parsed && parsed.players && parsed.players[0]?.summary);
        const isSeasonsFile =
          fileName.toLowerCase().includes("season") ||
          (Array.isArray(parsed) && parsed[0]?.league && parsed[0]?.champion);
        const isGoalFile =
          fileName.toLowerCase().includes("goal") ||
          (Array.isArray(parsed) && (parsed[0]?.goal_player !== undefined || parsed[0]?.match_date_code !== undefined));

        if (Array.isArray(parsed)) {
          itemsArray = parsed;
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.players)) {
            itemsArray = parsed.players;
            isPlayerStatsArray = !isAppearanceFile;
          } else {
            for (const key of ["data", "matches", "records", "items", "list", "schedule"]) {
              if (Array.isArray((parsed as any)[key])) {
                itemsArray = (parsed as any)[key];
                break;
              }
            }
          }
          if (!itemsArray) {
            const values = Object.values(parsed);
            if (values.length === 1 && Array.isArray(values[0])) {
              itemsArray = values[0] as any[];
            }
          }
        }

        if (itemsArray && itemsArray.length > 0) {
          jsonItemCount = itemsArray.length;
          for (let i = 0; i < itemsArray.length; i++) {
            const item = itemsArray[i];
            const isPlayer =
              isPlayerStatsArray ||
              Boolean(item && item.name && (item.summary || item.position || item.birthDate));

            let text = "";
            let recordTitle = "";
            let recordCategory = "海港结构化数据";
            let recordKeyPlayers: string[] = [];

            if (isAppearanceFile && item.name) {
              allLoadedPlayerNames.add(item.name);
              recordTitle = `球员逐场出场明细档案: ${item.name} (${item.position || "海港球员"})`;
              recordCategory = "球员出场明细";
              recordKeyPlayers = [item.name];
              const seasonSummary = (item.seasons || [])
                .map(
                  (s: any) =>
                    `${s.season}赛季: 记录${s.appearances?.length || 0}场 (首发/出场${
                      s.appearances?.filter((a: any) => a.status === "出场").length || 0
                    }场)`
                )
                .join("；");
              text = `【上海海港球员逐场出场技术档案 - ${item.name}】
姓名: ${item.name} | 场上位置: ${item.position || "未注明"} | 国籍: ${item.nationality || "中国"} | 出生日期: ${item.birthDate || "未注明"}
【队史已记录出场总计】: ${item.records?.knownAppearances ?? 0} 场，累计出场时间 ${item.records?.knownMinutes ?? 0} 分钟
【各赛季出场明细分布】: ${seasonSummary || "暂无分赛季明细"}
原始出场明细JSON: ${JSON.stringify(item)}`;
            } else if (isHistoryStatsFile && isPlayer && item.name) {
              allLoadedPlayerNames.add(item.name);
              const s = item.summary || {};
              recordTitle = `球员出场进球与历史技术档案: ${item.name} (${item.position || "海港球员"})`;
              recordCategory = "球员生涯出场与进球统计";
              recordKeyPlayers = [item.name];

              text = `【上海海港球员历史技术档案 - ${item.name}】
姓名: ${item.name} | 场上位置: ${item.position || "未注明"} | 国籍: ${item.nationality || "中国"} | 出生日期: ${item.birthDate || "未注明"}
【队史生涯总计统计】:
- 总出场: ${s.appearances ?? 0} 场 (首发 ${s.starts ?? 0} 场 / 替补 ${s.substitute ?? 0} 场)
- 总出场时间: ${s.minutes ?? 0} 分钟
- 进球总数: ${s.goals ?? 0} 球 (其中点球 ${s.penalties ?? 0} 个)
- 助攻总数: ${s.assists ?? 0} 次
- 纪律表现: 黄牌 ${s.yellowCards ?? 0} 张 / 红牌 ${s.redCards ?? 0} 张
${s.cleanSheets !== null && s.cleanSheets !== undefined ? `- 门将防守: 零封 ${s.cleanSheets ?? 0} 场 / 失球 ${s.goalsConceded ?? 0} 个 / 扑救点球 ${s.penaltySaves ?? 0} 个\n` : ""}${item.csl ? `【中超联赛(CSL)】: 出场 ${item.csl.appearances ?? 0} 场 (首发 ${item.csl.starts ?? 0} 场 / 替补 ${item.csl.substitute ?? 0} 场), 时间 ${item.csl.minutes ?? 0} 分钟, 进球 ${item.csl.goals ?? 0} 球, 助攻 ${item.csl.assists ?? 0} 次, 黄牌 ${item.csl.yellowCards ?? 0}, 红牌 ${item.csl.redCards ?? 0}\n` : ""}${item.acle ? `【亚冠联赛(ACLE)】: 出场 ${item.acle.appearances ?? 0} 场 (首发 ${item.acle.starts ?? 0} 场 / 替补 ${item.acle.substitute ?? 0} 场), 时间 ${item.acle.minutes ?? 0} 分钟, 进球 ${item.acle.goals ?? 0} 球, 助攻 ${item.acle.assists ?? 0} 次\n` : ""}${item.cfa ? `【中国足协杯(CFA)】: 出场 ${item.cfa.appearances ?? 0} 场, 时间 ${item.cfa.minutes ?? 0} 分钟, 进球 ${item.cfa.goals ?? 0} 球, 助攻 ${item.cfa.assists ?? 0} 次\n` : ""}${item.c1l ? `【中甲联赛(C1L)】: 出场 ${item.c1l.appearances ?? 0} 场, 时间 ${item.c1l.minutes ?? 0} 分钟, 进球 ${item.c1l.goals ?? 0} 球, 助攻 ${item.c1l.assists ?? 0} 次\n` : ""}${item.c2l ? `【中乙联赛(C2L)】: 出场 ${item.c2l.appearances ?? 0} 场, 进球 ${item.c2l.goals ?? 0} 球\n` : ""}${item.supercup ? `【中国超级杯(Super Cup)】: 出场 ${item.supercup.appearances ?? 0} 场, 进球 ${item.supercup.goals ?? 0} 球, 助攻 ${item.supercup.assists ?? 0} 次\n` : ""}
原始数据JSON: ${JSON.stringify(item)}`;
            } else if (isSeasonsFile) {
              recordTitle = `${item.season}年 ${item.league} 战绩档案 (${item.rank})`;
              recordCategory = "赛季荣誉与积分榜";
              recordKeyPlayers = [];
              text = `【上海海港历年赛季战绩与积分档案 - ${item.season}赛季 ${item.league}】
赛季: ${item.season} | 赛事: ${item.league} | 最终成绩/排名: 【${item.rank}】 | 冠军队伍: ${item.champion}
战绩统计: 全季比赛 ${item.matches} 场 | ${item.wins} 胜 | ${item.draws} 平 | ${item.losses} 负 | 进球 ${item.goalsFor} 个 | 失球 ${item.goalsAgainst} 个 | 净胜球 ${item.goalsFor - item.goalsAgainst} 个 | 赛季积分: ${item.points ?? "无"} 分
赛季里程碑与评语: ${item.notes || "无"}
${item.finalStandings && item.finalStandings.length > 0 ? `【联赛最终积分榜前列】:\n` + item.finalStandings.slice(0, 5).map((s: any) => `第${s.rank}名: ${s.team} (${s.points}分)`).join(" / ") : ""}
原始数据JSON: ${JSON.stringify(item)}`;
            } else if (isGoalFile) {
              recordTitle = `${item.season}赛季 ${item.match_name}${item.round ? ` (${item.round})` : ""} - ${item.goal_player} 进球`;
              recordCategory = "进球明细";
              recordKeyPlayers = [item.goal_player, item.assist_player, item.create_player].filter((p) => p && p !== "—");
              text = `【上海海港进球明细档案 - 第${item.id || i + 1}球】
进球球员: ${item.goal_player} | 助攻球员: ${item.assist_player || "—"} | 策划: ${item.create_player || "—"} | 进球时间: ${item.goal_time || "未注明"}
比赛信息: ${item.season}赛季 ${item.match_name}${item.round ? ` (${item.round})` : ""} | 比赛日期编码: ${item.match_date_code}
交锋对阵: ${item.home_team} ${item.home_score}-${item.away_score} ${item.away_team} (赛果: ${item.match_result})
备注: ${item.remark || "—"}
原始数据JSON: ${JSON.stringify(item)}`;
            } else if (
              fileName.toLowerCase().includes("schedule") ||
              item.homeTeam !== undefined ||
              item.awayTeam !== undefined ||
              item.home_team !== undefined ||
              item.match_name !== undefined
            ) {
              const hTeam = item.homeTeam || item.home_team || "主队";
              const aTeam = item.awayTeam || item.away_team || "客队";
              const comp = item.type || item.match_type || item.competition || item.tournament || "比赛";
              const roundStr = item.round ? ` (${item.round})` : "";
              const dateStr = item.date || (item.match_date_code ? String(item.match_date_code) : "");
              recordTitle = `${dateStr ? `${dateStr} ` : ""}${comp}${roundStr}: ${hTeam} vs ${aTeam}`;
              recordCategory = "赛程与比赛记录";
              
              let scorersList: string[] = [];
              if (item.scorers) {
                if (Array.isArray(item.scorers)) {
                  scorersList = item.scorers;
                } else if (typeof item.scorers === "object") {
                  const homeScorers = Array.isArray(item.scorers.home) ? item.scorers.home : [];
                  const awayScorers = Array.isArray(item.scorers.away) ? item.scorers.away : [];
                  scorersList = [...homeScorers, ...awayScorers];
                }
              }
              recordKeyPlayers = Array.from(
                new Set([
                  ...(item.keyPlayers || []),
                  ...scorersList,
                  ...(item.goal_player ? [item.goal_player] : []),
                  ...(item.assist_player ? [item.assist_player] : []),
                ].filter(Boolean))
              );

              text = `【上海海港赛事赛程与比赛记录 - ${hTeam} vs ${aTeam}】
比赛日期: ${dateStr || "未注明"} ${item.time || ""} | 赛事: ${comp}${roundStr}
比赛地点: ${item.city ? `${item.city} ` : ""}${item.venue || "未注明"} | 观众人数: ${item.attendance ?? "未注明"}
对阵双方: 【主队】${hTeam} vs 【客队】${aTeam}
比赛结果/比分: ${item.result || (item.home_score !== undefined ? `${item.home_score}-${item.away_score}` : "未进行/未注明")} (状态: ${item.status || "已结束"})
主裁判: ${item.referee || "未注明"}
主帅信息: 主队主帅【${item.home_coach || "未注明"}】 / 客队主帅【${item.away_coach || "未注明"}】
进球名单: ${scorersList.length > 0 ? scorersList.join("、") : (item.result === "0-0" ? "双方均未进球" : "未记录进球者或无进球")}
原始数据JSON: ${JSON.stringify(item)}`;
            } else {
              text =
                typeof item === "string"
                  ? item
                  : JSON.stringify(item, null, 2);

              recordTitle =
                item.match_name ||
                item.match ||
                item.title ||
                item.name ||
                (item.home_team && item.away_team ? `${item.home_team} vs ${item.away_team}` : `记录 #${i + 1}`);

              recordKeyPlayers = item.keyPlayers || (item.scorers ? (Array.isArray(item.scorers) ? item.scorers : Object.values(item.scorers).flat()) : []) || (item.goal_player ? [item.goal_player] : []);
            }

            const recordDate =
              item.date ||
              (item.match_date_code ? String(item.match_date_code) : null) ||
              item.matchDate ||
              null;

            const hTeamRaw = item.homeTeam || item.home_team;
            const aTeamRaw = item.awayTeam || item.away_team;
            const recordOpponent =
              item.opponent ||
              (aTeamRaw && !aTeamRaw.includes("海港") && !aTeamRaw.includes("东亚") && !aTeamRaw.includes("上港") ? aTeamRaw : null) ||
              (hTeamRaw && !hTeamRaw.includes("海港") && !hTeamRaw.includes("东亚") && !hTeamRaw.includes("上港") ? hTeamRaw : null);

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
                  category: recordCategory,
                  sourceFile: fileName,
                  section: item.section || item.round || (isPlayer ? `${item.name} 档案` : `条目 #${i + 1}`),
                  matchDate: recordDate,
                  competition: item.type || item.match_type || item.competition || item.tournament || null,
                  opponent: recordOpponent,
                  scoreline: recordScore,
                  keyPlayers: recordKeyPlayers,
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
        const filePath = path.join(KNOWLEDGE_DIR, fileName);
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
    const allFiles = Array.from(this.uploadedFiles.values()).map((f) => ({
      name: f.name,
      size: f.size,
      chunkCount: f.chunkCount,
      uploadTime: f.uploadTime,
      isDefault: f.isDefault,
      isJson: f.isJson,
      itemCount: f.itemCount,
    }));
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
    const query = question;
    const {
      years: queryYears,
      keywords: queryKeywords,
      opponents: queryOpponents,
      months: queryMonths,
      monthFilter,
      isUpcomingSchedule,
      isScheduleQuery,
    } = extractChineseFootballKeywords(question);

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
    let latestScheduleTimelineStats: any = null;
    let latestMatchAggregationStats: any = null;
    if (hasJsonDatasets) {
      const jsonSections: string[] = [];
      for (const [fName, data] of this.rawJsonStore.entries()) {
        const parsed = data.parsed;
        let contentToInject = data.content;

        let items: any[] | null = null;
        let isPlayerDataset = false;

        const isAppearanceDataset =
          fName.toLowerCase().includes("appearance") ||
          Boolean(parsed && (parsed.matchIdSource || (parsed.players && parsed.players[0]?.records)));

        if (Array.isArray(parsed)) {
          items = parsed;
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.players)) {
            items = parsed.players;
            isPlayerDataset = !isAppearanceDataset;
          } else {
            for (const key of ["data", "matches", "records", "items", "list", "schedule"]) {
              if (Array.isArray((parsed as any)[key])) {
                items = (parsed as any)[key];
                break;
              }
            }
          }
          if (!items) {
            const values = Object.values(parsed);
            if (values.length === 1 && Array.isArray(values[0])) {
              items = values[0] as any[];
            }
          }
        }

        if (
          !isAppearanceDataset &&
          !isPlayerDataset &&
          items &&
          items.length > 0 &&
          items[0] &&
          items[0].name &&
          (items[0].summary || items[0].position || items[0].birthDate)
        ) {
          isPlayerDataset = true;
        }

        if (isAppearanceDataset && items && items.length > 0) {
          const targetPlayers = items.filter((p: any) =>
            p.name && (query.includes(p.name) || queryKeywords.includes(p.name))
          );
          contentToInject = JSON.stringify(
            {
              sourceFile: fName,
              datasetType: "海港球员逐场出场明细（13001条逐场出场明细数据库）",
              totalPlayersWithAppearanceData: items.length,
              matchedPlayers: targetPlayers.map((p: any) => ({
                name: p.name,
                birthDate: p.birthDate,
                position: p.position,
                records: p.records,
                seasons: (p.seasons || []).map((s: any) => ({
                  season: s.season,
                  team: s.team,
                  appearancesCount: s.appearances?.length || 0,
                  appearances: s.appearances,
                })),
              })),
            },
            null,
            2
          );
        } else if (isPlayerDataset && items && items.length > 0) {
          // Check player query
          const targetPlayers = items.filter((p: any) =>
            p.name && (query.includes(p.name) || queryKeywords.includes(p.name))
          );

          const wantsAppearances = /出场|出战|登场|参赛|勤勉|最多次数|出场榜|出场纪录|出场前|百场|功勋|里程碑|纪录|记录|俱乐部|上场/i.test(query);
          const wantsGoals = /进球|射手|破门|射门|得分|金靴|射手榜|进球榜|射手前|百球|千球|里程碑|纪录|记录/i.test(query);
          const wantsAssists = /助攻|喂饼|做球|助攻榜|助攻王|助攻前|百助|里程碑|纪录|记录/i.test(query);
          const wantsCleanSheets = /零封|门将|守门员|扑点|扑救|失球|里程碑|纪录|记录/i.test(query);
          const wantsCards = /红牌|黄牌|吃牌|犯规/i.test(query);
          const wantsMinutes = /出场时间|分钟/i.test(query);
          const wantsPlayerMilestones = /里程碑|百场|百球|百助|功勋|俱乐部|先生|殿堂|纪录|记录|年轻|年长|最小|最大|年龄|岁|00后|05后|生日|出生|首秀|处子秀/i.test(query);

          const matchedRecords: any[] = [];
          for (const tp of targetPlayers) {
            matchedRecords.push(tp);
          }

          if (wantsGoals) {
            const topScorers = [...items].sort((a, b) => (b.summary?.goals || 0) - (a.summary?.goals || 0)).slice(0, 15);
            for (const p of topScorers) {
              if (!matchedRecords.some((r) => r.name === p.name)) matchedRecords.push(p);
            }
          }
          if (wantsAppearances) {
            const topAppearances = [...items].sort((a, b) => (b.summary?.appearances || 0) - (a.summary?.appearances || 0)).slice(0, 15);
            for (const p of topAppearances) {
              if (!matchedRecords.some((r) => r.name === p.name)) matchedRecords.push(p);
            }
          }
          if (wantsAssists) {
            const topAssists = [...items].sort((a, b) => (b.summary?.assists || 0) - (a.summary?.assists || 0)).slice(0, 15);
            for (const p of topAssists) {
              if (!matchedRecords.some((r) => r.name === p.name)) matchedRecords.push(p);
            }
          }
          if (wantsCleanSheets) {
            const topKeepers = [...items]
              .filter((p) => p.position?.includes("门将") || (p.summary?.cleanSheets !== null && p.summary?.cleanSheets !== undefined))
              .sort((a, b) => (b.summary?.cleanSheets || 0) - (a.summary?.cleanSheets || 0));
            for (const p of topKeepers) {
              if (!matchedRecords.some((r) => r.name === p.name)) matchedRecords.push(p);
            }
          }
          if (wantsMinutes) {
            const topMinutes = [...items].sort((a, b) => (b.summary?.minutes || 0) - (a.summary?.minutes || 0)).slice(0, 15);
            for (const p of topMinutes) {
              if (!matchedRecords.some((r) => r.name === p.name)) matchedRecords.push(p);
            }
          }
          if (wantsCards) {
            const topCards = [...items].sort((a, b) => (b.summary?.yellowCards || 0) - (a.summary?.yellowCards || 0)).slice(0, 15);
            for (const p of topCards) {
              if (!matchedRecords.some((r) => r.name === p.name)) matchedRecords.push(p);
            }
          }

          let allGoalsForAge: any[] | undefined;
          let allAppearanceData: any | undefined;
          let allScheduleData: any[] | undefined;
          for (const [gfName, gData] of this.rawJsonStore.entries()) {
            if (gfName.toLowerCase().includes("goal") && Array.isArray(gData.parsed)) {
              allGoalsForAge = gData.parsed;
            }
            if (gfName.toLowerCase().includes("appearance") && gData.parsed) {
              allAppearanceData = gData.parsed;
            }
            if (gfName.toLowerCase().includes("schedule") && Array.isArray(gData.parsed)) {
              allScheduleData = gData.parsed;
            }
          }

          const playerClubMilestones = wantsPlayerMilestones
            ? computePlayerClubMilestonesAggregation(items, allGoalsForAge, allAppearanceData, allScheduleData)
            : null;

          if (matchedRecords.length > 0 || playerClubMilestones) {
            contentToInject = JSON.stringify(
              {
                sourceFile: fName,
                datasetType: "海港球员历史技术档案与出场进球统计",
                totalPlayersInDatabase: items.length,
                authoritativePlayerMilestones: playerClubMilestones || undefined,
                matchedOrTopPlayersCount: matchedRecords.length,
                players: matchedRecords.slice(0, 25),
              },
              null,
              2
            );
          } else {
            contentToInject = JSON.stringify({
              sourceFile: fName,
              totalPlayers: items.length,
              note: "该文件为球员历史技术统计库（共222名球员）。当前提问未匹配到特定球员或球员榜单统计。",
            });
          }
        } else if (items && Array.isArray(items) && (items.length > 30 || data.content.length > 20000)) {
          const isScheduleDataset =
            fName.toLowerCase().includes("schedule") ||
            (items[0] &&
              (items[0].home_coach !== undefined ||
                items[0].venue !== undefined ||
                (items[0].round !== undefined && items[0].home_team !== undefined)));
          const isGoalDataset =
            fName.toLowerCase().includes("goal") ||
            (items[0] &&
              (items[0].goal_player !== undefined || items[0].assist_player !== undefined));
          const isSeasonsDataset =
            fName.toLowerCase().includes("season") ||
            (items[0] &&
              (items[0].finalStandings !== undefined ||
                (items[0].league !== undefined && items[0].rank !== undefined)));

          // Run deterministic aggregation if appropriate
          let coachAggregation: any = null;
          let headToHeadAggregation: any = null;
          let seasonAggregation: any = null;
          let goalAggregation: any = null;
          let matchAggregation: any = null;
          let scheduleTimelineAggregation: any = null;
          let scheduleMilestonesAggregation: any = null;
          let goalMilestonesAggregation: any = null;
          let seasonsHonorsAggregation: any = null;

          const isRecentOrEarliestQuery = /最近|上一场|最新|近期|前一场|倒数第|最后|最早|第一场|建队第一场|首场|初战/i.test(query);

          if (isScheduleDataset) {
            // Check recent/earliest match query
            matchAggregation = computeMatchAggregation(items, query);
            if (matchAggregation) {
              latestMatchAggregationStats = matchAggregation;
            }
            // Check upcoming/timeline schedule query (month ranges, remaining matches, etc.)
            scheduleTimelineAggregation = computeScheduleTimelineAggregation(items, query);
            if (scheduleTimelineAggregation && (scheduleTimelineAggregation.matchedMatchesCount > 0 || !latestScheduleTimelineStats)) {
              latestScheduleTimelineStats = scheduleTimelineAggregation;
            }
            // Check schedule milestones & team records query
            scheduleMilestonesAggregation = computeScheduleMilestonesAggregation(items, query);
            // Check coach query
            coachAggregation = computeCoachAggregation(items, query);
            // Check head-to-head opponent query
            if (queryOpponents.length > 0 || /交锋|对阵|交手|战绩|胜负|胜率/i.test(query)) {
              headToHeadAggregation = computeHeadToHeadAggregation(items, queryOpponents);
            }
            // Check season query
            if (queryYears.length > 0) {
              seasonAggregation = computeSeasonAggregation(items, queryYears);
            }
          } else if (isGoalDataset) {
            goalAggregation = computeGoalScorerAggregation(items, queryKeywords);
            goalMilestonesAggregation = computeGoalMilestonesAggregation(items, query, queryKeywords);
          } else if (isSeasonsDataset) {
            const championships = items.filter((s: any) => s.rank === "冠军");
            const runnerUps = items.filter((s: any) => s.rank === "亚军" || s.rank === "第 2");
            const leagueOverview = items
              .filter((s: any) => /中超|中甲|中乙/.test(s.league || ""))
              .map((s: any) => ({
                season: s.season,
                league: s.league,
                rank: s.rank,
                champion: s.champion,
                record: `${s.matches}场 ${s.wins}胜 ${s.draws}平 ${s.losses}负`,
                goals: `进${s.goalsFor}球 / 失${s.goalsAgainst}球`,
                points: s.points,
                notes: s.notes,
              }));
            const matchedYearSeasons =
              queryYears.length > 0
                ? items.filter((s: any) =>
                    queryYears.some((y) => String(s.season || "").includes(y))
                  )
                : [];
            seasonsHonorsAggregation = {
              aggregationType: "海港历年赛季总成绩、夺冠荣誉殿堂与联赛最终积分榜权威汇总（源自 seasons.json 共50条赛季记录）",
              championshipsCount: championships.length,
              championshipsList: championships.map(
                (c: any) =>
                  `${c.season}赛季 【${c.league}】 冠军 (${c.matches}场 ${c.wins}胜${c.draws}平${c.losses}负, 进${c.goalsFor}失${c.goalsAgainst}${c.points !== null && c.points !== undefined ? `, 积分${c.points}` : ""} | ${c.notes || ""})`
              ),
              runnerUpsList: runnerUps.map(
                (r: any) => `${r.season}赛季 【${r.league}】 ${r.rank} (${r.notes || ""})`
              ),
              allLeagueSeasonsOverview: leagueOverview,
              queriedSeasonsWithFullStandings:
                matchedYearSeasons.length > 0 ? matchedYearSeasons : undefined,
            };
          }

          // Scoring function for each match/schedule/goal item
          const scoredItems = items.map((item: any, originalIndex: number) => {
            const str = JSON.stringify(item);
            let score = 0;

            const itemDate = String(
              item.date || item.match_date_code || item.matchDate || ""
            );
            const itemYear = String(
              item.season || (itemDate.length >= 4 ? itemDate.slice(0, 4) : "")
            );

            // Check year match
            if (queryYears.length > 0) {
              const hasYear = queryYears.some((y) => itemYear.includes(y) || itemDate.includes(y));
              if (hasYear) {
                score += 15; // High priority for year match
              } else if (!isScheduleDataset || (!isUpcomingSchedule && !monthFilter && !isScheduleQuery)) {
                // If query has explicit year and item doesn't have it, don't prioritize
                return { item, score: -1, date: itemDate, originalIndex };
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

            // If it's a schedule item, reward timeline, upcoming, month, and win/loss conditions
            if (isScheduleDataset) {
              const isUnplayed =
                item.status === "未开始" ||
                item.result === "-" ||
                item.result === "" ||
                !item.result ||
                item.result === "待定";

              // Upcoming / future matches match
              if (isUpcomingSchedule && isUnplayed) {
                score += 30;
              }

              // Month filter match
              if (monthFilter && itemDate) {
                const parts = itemDate.split("-");
                if (parts.length >= 2) {
                  const mYear = parseInt(parts[0], 10);
                  const mMonth = parseInt(parts[1], 10);
                  if (monthFilter.isAfter) {
                    if (mYear > 2026 || (mYear === 2026 && mMonth >= monthFilter.month)) {
                      score += 35;
                    }
                  } else if (monthFilter.isBefore) {
                    if (mYear < 2026 || (mYear === 2026 && mMonth <= monthFilter.month)) {
                      score += 35;
                    }
                  } else if (mMonth === monthFilter.month) {
                    score += 35;
                  }
                }
              }

              // General schedule query match for active season
              if (isScheduleQuery) {
                if (itemYear === "2026" || itemYear === "2027" || itemDate.startsWith("2026") || itemDate.startsWith("2027")) {
                  score += 10;
                  if (isUnplayed) score += 15;
                }
              }

              if (/赢球|获胜|胜仗|赢了|取胜|胜利/i.test(query) && item.win_loss === "胜") {
                score += 5;
              } else if (/输球|失利|输了|负/i.test(query) && item.win_loss === "负") {
                score += 5;
              } else if (/平局|打平|平了/i.test(query) && item.win_loss === "平") {
                score += 5;
              }
            }

            return { item, score, date: itemDate, originalIndex };
          });

          // Filter items with positive score and sort appropriately
          const matched = scoredItems
            .filter((s) => s.score > 0)
            .sort((a, b) => {
              // If query specifically asks for upcoming / next / future matches or month-after query,
              // sort chronologically (earliest upcoming match first)!
              if (isUpcomingSchedule || (monthFilter && monthFilter.isAfter)) {
                if (a.date && b.date && a.date !== b.date) {
                  return a.date.localeCompare(b.date);
                }
              }
              // If query specifically asks for recent/latest matches, prioritize by descending date!
              if (isRecentOrEarliestQuery && isScheduleDataset) {
                if (/最近|上一场|最新|近期|前一场|倒数第|最后/i.test(query)) {
                  // Descending date
                  if (b.date && a.date && b.date !== a.date) {
                    return b.date.localeCompare(a.date);
                  }
                } else if (/最早|第一场|建队第一场|首场|初战/i.test(query)) {
                  // Ascending date
                  if (b.date && a.date && b.date !== a.date) {
                    return a.date.localeCompare(b.date);
                  }
                }
              }
              // Normal score descending, break ties by descending date (newer first)
              if (b.score !== a.score) return b.score - a.score;
              return (b.date || "").localeCompare(a.date || "");
            })
            .map((s) => s.item);

          const authoritativeness: any = {};
          if (matchAggregation) authoritativeness.matchTimeStats = matchAggregation;
          if (scheduleTimelineAggregation) authoritativeness.scheduleTimelineStats = scheduleTimelineAggregation;
          if (scheduleMilestonesAggregation) authoritativeness.scheduleMilestonesStats = scheduleMilestonesAggregation;
          if (coachAggregation) authoritativeness.coachStats = coachAggregation;
          if (headToHeadAggregation) authoritativeness.headToHeadStats = headToHeadAggregation;
          if (seasonAggregation) authoritativeness.seasonStats = seasonAggregation;
          if (goalAggregation) authoritativeness.goalScorerStats = goalAggregation;
          if (goalMilestonesAggregation) authoritativeness.goalMilestonesStats = goalMilestonesAggregation;
          if (seasonsHonorsAggregation) authoritativeness.seasonsHonorsStats = seasonsHonorsAggregation;

          const hasAuthoritativeStats = Object.keys(authoritativeness).length > 0;

          if (matched.length > 0 || hasAuthoritativeStats) {
            // Found specific matched matches or authoritative pre-aggregations!
            // When querying schedule dataset with <= 60 records (e.g. schedule.json), inject ALL records so none are dropped!
            const sampleSliceLimit =
              items.length <= 60
                ? items.length
                : queryYears.length > 0 || queryOpponents.length > 0 || isUpcomingSchedule || monthFilter !== null
                ? 80
                : 40;
            contentToInject = JSON.stringify(
              {
                sourceFile: fName,
                totalInDataset: items.length,
                authoritativeAggregations: hasAuthoritativeStats ? authoritativeness : undefined,
                matchedRecordsCount: matched.length > 0 ? matched.length : items.length,
                representativeSampleRecords:
                  matched.length > 0
                    ? matched.slice(0, sampleSliceLimit)
                    : items.slice(0, sampleSliceLimit),
                note: hasAuthoritativeStats
                  ? "【权威核心准则】：上方 authoritativeAggregations 是遍历全量数据精确计算的官方权威统计事实。回答涉及赛程安排（包括接下来/未开始比赛、10月份及之后赛程）、赛季总场次、胜平负总战绩、各赛事分布、主帅、最近比赛或历史交锋时，必须严格以此精确数据为唯一基准，严禁自行缩减场次或声称未收录！"
                  : undefined,
              },
              null,
              2
            );
          } else {
            // If year specified but no matches, report this dataset's available years to LLM
            const availableYears = Array.from(
              new Set(
                items
                  .map((it: any) => it.season || (it.date && it.date.slice(0, 4)) || (it.match_date_code && String(it.match_date_code).slice(0, 4)))
                  .filter(Boolean)
              )
            ).slice(0, 30);

            contentToInject = JSON.stringify(
              {
                sourceFile: fName,
                totalInDataset: items.length,
                note: `在 ${fName} 中未直接检索到与关键词匹配的记录。该数据集包含的年份范围包括: ${availableYears.join(", ")}`,
                sampleRecords: items.slice(0, items.length <= 60 ? items.length : 15),
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
${hasJsonDatasets ? "★ 当前已启用【原生 JSON 结构化全量解析与权威统计聚合引擎】。请用流利清晰的中文自然语言解答，并将数据项整理为规范格式（严禁直接把原始 JSON 代码块甩给用户）。" : "★ 当前基于【文档语义向量检索切片】。"}

${buildPromptIdentityRules()}

【核心原则与呈现规范】：
1. 知识库为唯一事实来源：必须完全基于下面提供的数据内容进行回答。若数据中【完全没有】提及，明确告知查无记录，严禁凭空捏造。
2. 权威预聚合统计绝对优先原则（极其关键）：
   - 当下方数据中包含【authoritativeAggregations】（如时间序列分析 matchTimeStats、队史赛程与极值里程碑 scheduleMilestonesStats、进球里程碑 goalMilestonesStats、教练全量执教统计 coachStats、历史交锋战绩 headToHeadStats、赛季总战绩 seasonStats、赛季荣誉殿堂与联赛积分榜 seasonsHonorsStats）以及球员档案中的【authoritativePlayerMilestones】时，该数据是系统在后台遍历全部历史赛程、进球明细、逐场出场记录与球员档案精确计算得出的唯一权威事实！
   - 回答涉及“最年轻上场球员”、“队史最年轻出场球员是谁”、“首秀年龄”等问题时，【必须严格以 authoritativePlayerMilestones.ageAndYouthMilestones 为准】给出确凿解答：
     * **队史暨中国职业联赛最年轻出场球员**：**武磊**，出生于1991年11月19日，在2006年9月2日中乙联赛南区预赛第13轮（上海东亚 vs 丽江东巴）替补登场，当时年仅 **14岁287天（约14岁9个月）**，创造了海港队史以及中国职业足球联赛历史最年轻登场纪录！
     * **中超时代队史最年轻出场球员**：**贾博琰**，出生于2003年11月30日，在2020年8月29日中超联赛第8轮（上海上港 4-1 天津泰达）替补登场出战8分钟，当时年仅 **16岁273天**！
     * **队史首秀年龄前三名**还包括门将**颜骏凌**，出生于1991年1月28日，在2007年11月25日中乙联赛总决赛决赛（四川 vs 上海东亚）首发登场并打满90分钟，当时年仅 **16岁301天**！
     * **队史最年轻进球球员**：**武磊**，出生于1991年11月19日，在2008年9月2日中甲联赛（青岛中能 vs 上海东亚）破门，破门年龄为 **16岁288天**！
   - 回答涉及“队史里程碑”、“第N场比赛”、“第N场胜利”、“第N粒进球”、“中超/亚冠/足协杯首秀或首胜”、“百场/百球先生”、“最大比分胜负”、“最长连胜/不败纪录”、“主场变迁首秀”或“队名更名首战”等问题时，【必须严格以 scheduleMilestonesStats、goalMilestonesStats 和 authoritativePlayerMilestones 中的精确计算结果为准】直接给出详实解答！
   - 回答涉及“最近一场/最新胜仗/最近赢球/队史首战”等时间序列问题时，【必须严格以 matchTimeStats 中的 absoluteLatestMatch / absoluteEarliestMatch 为准】！历史赛程数据持续收录至2026年最新赛事（如最新亚冠、中超等已完赛场次），严禁将早期历史比赛当成“最近一场”！
   - 回答涉及执教赛季数量、具体赛季列表、执教总场次、胜平负、胜率或交锋总数时，【必须严格以此权威精确统计数据为准】进行回答！
   - 【严禁根据抽样展示的代表性比赛切片自行缩减场次或重新估算】。
3. 赛程安排与未来/月份比赛呈现规范（极其重要）：
   - 当用户询问“接下来的赛程”、“后续比赛”、“未来赛程”、“10月份之后的赛程”、“10月及以后赛程”、“下一场比赛”、“剩余赛程”或特定月份（如10月、11月、12月、次年2月亚冠）时：
     * 【必须完全基于 authoritativeAggregations.scheduleTimelineStats 或 schedule.json 进行详尽回答，严禁声称“未收录”、“查无记录”】！
     * 系统已完整收录 2026 赛季超级杯、中超 30 轮全赛程、足协杯及 2026/27 亚冠联赛全部比赛（包含已完赛场次的最新比分及后续未开始比赛日程）；
     * 针对【接下来的赛程 / 未开始比赛】：明确指出基于最新数据计算出的下一场未开战比赛，并按时间先后有序完整列出后续待开战赛程（包含比赛日期、开球时间、赛事类型如中超/亚冠/足协杯、轮次、主客场对阵双方及比赛场馆）；
     * 针对【特定月份或时间段的赛程】：详尽列出该时间段的所有赛程（包含已完赛场次的最新赛果与后续待开战比赛安排）！
4. 赛季与年份战绩呈现规范：
   - 当用户询问某特定赛季/年份（如“18年”、“2018赛季”、“24年”、“26年”）的比赛情况或战绩时，必须结合 seasonStats 与代表性比赛列表进行详尽说明：
     * 概述该赛季各项赛事总战绩（总场次、胜平负、胜率）及赛事分布（如中超、足协杯、亚冠）；
     * 指出该赛季主教练与核心历史成就（如2018年中超夺冠、2024年中超与足协杯双冠王等）；
     * 严禁无视数据中收录的该赛季完整比赛记录谎称“未收录具体比赛场次”。
5. 主帅胜率与执教排名权威规范（极其重要）：
   - 当用户询问“胜率最高的主帅是谁”、“胜率最低的主帅是谁”、“历任主教练胜率排名”、“根据明细来统计胜率”等问题时：
     * 【必须完全基于 coachStats 权威聚合统计直接给出确凿解答，严禁回答“无法统计”、“未收录”或“无法直接凭比赛明细统计”】！系统已在后台遍历全量历史赛程精确完成全量统计与胜率排名。
     * 【胜率最高正式主帅】：安德烈·维拉斯·博阿斯（博阿斯），2017赛季执教45场，战绩 28胜 8平 9负，胜率高达 **62.2%**；
     * 【胜率最低正式主帅】：克劳德·鲁伊兹（法国籍外教，2006中乙队史首任主帅），执教16场，战绩 3胜 5平 8负，胜率仅为 **18.8%**；
     * 必须呈现清晰完整的 Markdown 表格，自高到低列出历任正式主教练胜率排行榜（包含排名、教练姓名、执教场次、胜平负具体战绩、胜率、执教赛季及主要荣誉）；
     * 同时应主动说明统计口径：按职业足球权威统计惯例，正式主教练排名统计长期带队主帅（执教>=10场）；另外队史有临时代理/停赛时代班助教（如孙祥2022临时代理1场1胜100%、助教阿尔梅达3场2胜1平66.7%等）可做专业说明与补充展示。
6. 智能消歧规范：
   - 若用户询问“佩雷拉”，需明确海港队史功勋主帅“维托尔·佩雷拉”（2018-2020三个赛季114场，夺2018中超与2019超级杯，胜率58.8%），并主动补充说明2023赛季另有一位西班牙主帅哈维尔·佩雷拉（2023一个赛季31场夺中超冠军，胜率58.1%），以便用户全面了解。
7. 直接回答，极致简明（极其重要）：
   - 用户要求页面显示简明清爽，只显示针对问题的直接回答。
   - 【严禁输出任何“数据出处”、“引用出处”、“参考文件”、“检索引据”、“查看引据”、“比赛记录引据”、“来源文件”等出处段落或元数据清单】。
   - 【切勿在回答末尾添加“数据出处”、“引用的比赛记录”或任何引用附录】。
   - 所有必要的比赛要素（如比赛日期、对阵双方与比分、进球球员及进球时间）直接自然地融入回答正文陈述中即可。
8. 格式采用美观清晰的 Markdown，语言精炼，层次分明，直奔主题。`;

    const userPrompt = `【海港内部知识库数据】：
${contextText}

${recentHistory ? `【多轮对话历史】：\n${recentHistory}\n` : ""}

【用户当前问题】：
${question}

【回答要求】：
请直接针对问题给出简明清晰的回答，指出赛事、时间、比分与球员等关键信息。严禁输出任何“数据出处”、“查看引据”、“比赛记录引据”或引用文件来源说明，直接呈现针对问题的解答内容。`;

    const modelsToTry = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
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

        const rawAnswer = response.text || "根据当前海港内部知识库与历史数据记录，未检索到相关内容。";
        // Clean any citation footers
        const cleanedAnswer = rawAnswer
          .replace(/\n*(?:---+|\*\*\*+)?\s*(?:###?\s*|\*\*|【)?\s*(?:检索引用的数据出处|数据出处|参考出处|引据来源|查看引据|引用出处|比赛记录引据|引用数据来源|参考比赛记录|引用的比赛记录|数据来源|来源文件)[^:\n]*[:：】\*\s]*[\s\S]*$/i, "")
          .replace(/^[*-]\s*(?:来源文件|数据出处|查看引据|引据记录|参考文件)[:：].*$/gmi, "")
          .trim();

        const totalJsonItems = jsonFiles.reduce((acc, f) => acc + (f.itemCount || 1), 0);
        return {
          answer: cleanedAnswer,
          sources: [],
          retrievedCount: hasJsonDatasets ? totalJsonItems : searchResults.length,
          hasDirectMatch: true,
          retrievalMode: hasJsonDatasets ? "json_full_context" : "vector_rag",
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} attempt failed (${err.status || err.message}), attempting fallback...`);
      }
    }

    console.error("All Gemini models failed, falling back to local retrieved data:", lastError);

    const quotaNotice = String(lastError?.message || "").includes("Quota") || String(lastError?.message || "").includes("429")
      ? "\n\n*(注：因 API 瞬时调用频率限制，系统已切换至本地权威结构化聚合模式呈现记录)*"
      : "";

    // 1. If authoritative schedule timeline was computed, format directly!
    if (latestScheduleTimelineStats && latestScheduleTimelineStats.matchedMatchesList?.length > 0) {
      const parts: string[] = [];
      parts.push(`### 上海海港赛程安排（${latestScheduleTimelineStats.filterCriteria || "赛程总览"}）\n`);
      if (latestScheduleTimelineStats.nextImmediateMatch) {
        const next = latestScheduleTimelineStats.nextImmediateMatch;
        parts.push(`**下一场比赛**：**${next.date} ${next.time}** | **${next.competition} ${next.round}**：${next.match}（${next.venue}）\n`);
      }
      parts.push(`**赛事清单（共 ${latestScheduleTimelineStats.matchedMatchesCount} 场）**：`);
      for (const m of latestScheduleTimelineStats.matchedMatchesList) {
        const resultPart = m.result && m.result !== "-" ? ` | 比分: ${m.result}` : "";
        parts.push(`- **${m.date} ${m.time}** | ${m.competition} ${m.round}：**${m.match}**（${m.venue} | 状态: ${m.status}${resultPart}）`);
      }
      return {
        answer: `${parts.join("\n")}${quotaNotice}`,
        sources: [],
        retrievedCount: latestScheduleTimelineStats.matchedMatchesCount,
        hasDirectMatch: true,
        retrievalMode: "authoritative_stats",
      };
    }

    // 2. If authoritative match aggregation was computed (recent match, opponent match, or earliest match)
    if (latestMatchAggregationStats && (latestMatchAggregationStats.absoluteLatestMatch || latestMatchAggregationStats.absoluteEarliestMatch)) {
      const match = latestMatchAggregationStats.absoluteLatestMatch || latestMatchAggregationStats.absoluteEarliestMatch;
      const parts: string[] = [];
      const titleType = latestMatchAggregationStats.targetType || "比赛记录";
      parts.push(`### 上海海港${titleType}（${match.competition || match.match_type || "赛事"} ${match.round || match.match_name || ""}）\n`);
      parts.push(`- **比赛时间**：**${match.date} ${match.kickoff_time || match.time || ""}**`);
      const hTeam = match.homeTeam || match.home_team;
      const aTeam = match.awayTeam || match.away_team;
      const mResult = match.result || (match.home_score !== undefined && match.away_score !== undefined ? `${match.home_score}-${match.away_score}` : "");
      parts.push(`- **对阵双方**：**${hTeam} ${mResult} ${aTeam}**`);
      if (match.venue) parts.push(`- **比赛场地**：${match.venue}${match.city ? `（${match.city}）` : ""}`);
      if (match.scorers) {
        const homeS = Array.isArray(match.scorers.home) ? match.scorers.home.join("、") : (match.scorers.home || "");
        const awayS = Array.isArray(match.scorers.away) ? match.scorers.away.join("、") : (match.scorers.away || "");
        if (homeS) parts.push(`- **主队进球**：**${homeS}**`);
        if (awayS) parts.push(`- **客队进球**：**${awayS}**`);
      }
      if (match.attendance) parts.push(`- **现场观众**：${match.attendance} 人`);
      if (match.referee) parts.push(`- **主裁判**：${match.referee}`);
      if (match.home_coach || match.away_coach) parts.push(`- **主帅信息**：主队【${match.home_coach || "—"}】 / 客队【${match.away_coach || "—"}】`);
      return {
        answer: `${parts.join("\n")}${quotaNotice}`,
        sources: [],
        retrievedCount: 1,
        hasDirectMatch: true,
        retrievalMode: "authoritative_stats",
      };
    }

    // Graceful fallback answer: format the JSON or text chunk into readable human Chinese instead of raw JSON dumps
    if (searchResults.length > 0 && searchResults[0][1] > 0.15) {
      const topDoc = searchResults[0][0];
      let formattedContent = topDoc.pageContent;
      try {
        const parsedDoc = JSON.parse(topDoc.pageContent);
        // Format nicely into a readable record card
        const parts: string[] = [];
        if (parsedDoc.name && parsedDoc.summary) {
          parts.push(`**球员姓名**：${parsedDoc.name} (${parsedDoc.position || "海港球员"})`);
          parts.push(`**出生日期**：${parsedDoc.birthDate || "未知"} | **国籍**：${parsedDoc.nationality || "中国"}`);
          parts.push(`**总出场**：${parsedDoc.summary.appearances} 场 (首发 ${parsedDoc.summary.starts} / 替补 ${parsedDoc.summary.substitute})`);
          parts.push(`**出场时间**：${parsedDoc.summary.minutes} 分钟`);
          parts.push(`**进球数**：${parsedDoc.summary.goals} 球 (点球 ${parsedDoc.summary.penalties}) | **助攻**：${parsedDoc.summary.assists} 次`);
          parts.push(`**红黄牌**：黄牌 ${parsedDoc.summary.yellowCards} / 红牌 ${parsedDoc.summary.redCards}`);
          if (parsedDoc.summary.cleanSheets !== null && parsedDoc.summary.cleanSheets !== undefined) {
            parts.push(`**门将守门**：零封 ${parsedDoc.summary.cleanSheets} 场 / 扑点 ${parsedDoc.summary.penaltySaves} 个 / 失球 ${parsedDoc.summary.goalsConceded} 个`);
          }
          if (parsedDoc.csl) {
            parts.push(`**中超联赛**：出场 ${parsedDoc.csl.appearances} 场, 进球 ${parsedDoc.csl.goals}, 助攻 ${parsedDoc.csl.assists}`);
          }
          if (parsedDoc.acle) {
            parts.push(`**亚冠联赛**：出场 ${parsedDoc.acle.appearances} 场, 进球 ${parsedDoc.acle.goals}, 助攻 ${parsedDoc.acle.assists}`);
          }
        } else if (parsedDoc.name && parsedDoc.records) {
          parts.push(`**球员姓名**：${parsedDoc.name} (${parsedDoc.position || "海港球员"})`);
          parts.push(`**出生日期**：${parsedDoc.birthDate || "未知"} | **国籍**：${parsedDoc.nationality || "中国"}`);
          parts.push(`**已知总出场**：${parsedDoc.records.knownAppearances} 场 | **已知出场时间**：${parsedDoc.records.knownMinutes} 分钟`);
          if (Array.isArray(parsedDoc.seasons)) {
            const seasonList = parsedDoc.seasons.map((s: any) => `${s.season}赛季 (${s.appearances?.length || 0}场)`).join("、");
            parts.push(`**效力赛季明细**：${seasonList}`);
          }
        } else {
          const matchTitle = parsedDoc.match_name || parsedDoc.title || (parsedDoc.type && parsedDoc.round ? `${parsedDoc.type} ${parsedDoc.round}` : null);
          if (matchTitle) parts.push(`**赛事场次**：${matchTitle}`);
          const matchDate = parsedDoc.match_date_code || parsedDoc.matchDate || parsedDoc.date;
          if (matchDate) parts.push(`**比赛日期**：${matchDate}`);
          const hTeam = parsedDoc.home_team || parsedDoc.homeTeam;
          const aTeam = parsedDoc.away_team || parsedDoc.awayTeam;
          if (hTeam && aTeam) parts.push(`**对阵双方**：${hTeam} vs ${aTeam}`);
          if (parsedDoc.home_score !== undefined && parsedDoc.away_score !== undefined) {
            parts.push(`**最终比分**：${hTeam} ${parsedDoc.home_score} - ${parsedDoc.away_score} ${aTeam} (${parsedDoc.match_result || ""})`);
          } else if (parsedDoc.result) {
            parts.push(`**比赛结果**：${parsedDoc.result}`);
          } else if (parsedDoc.scoreline) {
            parts.push(`**比分**：${parsedDoc.scoreline}`);
          }
          if (parsedDoc.scorers) {
            const homeS = Array.isArray(parsedDoc.scorers.home) ? parsedDoc.scorers.home.join("、") : (parsedDoc.scorers.home || "");
            const awayS = Array.isArray(parsedDoc.scorers.away) ? parsedDoc.scorers.away.join("、") : (parsedDoc.scorers.away || "");
            if (homeS) parts.push(`**主队进球**：${homeS}`);
            if (awayS) parts.push(`**客队进球**：${awayS}`);
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
        }

        if (parts.length > 0) {
          formattedContent = `- ${parts.join("\n- ")}`;
        }
      } catch (e) {
        // If pageContent contains formatted text with embedded JSON dump at the end, clean it
        formattedContent = topDoc.pageContent
          .replace(/\n*原始(?:出场明细|数据)?JSON:[\s\S]*$/i, "")
          .trim();
      }

      return {
        answer: `${formattedContent}${quotaNotice}`,
        sources: [],
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
