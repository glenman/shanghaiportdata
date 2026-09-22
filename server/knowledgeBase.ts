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
    "贵州恒丰", "贵州智诚", "河北华夏幸福", "华夏幸福", "青岛海牛", "成都蓉城", "深圳队"
  ];

  // Match opponents using full opponent aliases dictionary
  const matchedOpponentsFromDict = identifyOpponentsInQuery(query);
  for (const oppDef of matchedOpponentsFromDict) {
    opponentSet.add(oppDef.canonicalName);
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
 * Deterministically compute aggregated coaching statistics across all matches in history_schedule.json
 */
export function computeCoachAggregation(schedule: any[], query: string) {
  const queryLower = query.toLowerCase();

  // Find matching coaches
  let matchedDefs = KNOWN_PORT_COACHES.filter((c) =>
    c.aliases.some((alias) => queryLower.includes(alias.toLowerCase()))
  );

  // If query asks generally about coaches without mentioning a specific name
  const isGeneralCoachQuery =
    /历任主帅|历任教练|执教最多|历任主教练|胜率最高的主帅|哪些教练|历届主帅/i.test(query);
  if (matchedDefs.length === 0 && isGeneralCoachQuery) {
    matchedDefs = KNOWN_PORT_COACHES.slice(0, 10);
  }

  if (matchedDefs.length === 0) return null;

  // Build coach statistics from all schedule records
  const statsMap = new Map<
    string,
    {
      name: string;
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

    const rawCoach = (isPortHome ? m.home_coach : m.away_coach)?.trim() || "未知教练";
    let canonical = rawCoach;
    if (rawCoach.includes("穆斯卡特") || rawCoach.includes("马斯卡特")) {
      canonical = "凯文·穆斯卡特";
    }

    let stat = statsMap.get(canonical);
    if (!stat) {
      stat = {
        name: canonical,
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
      statsMap.set(canonical, stat);
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

  // Format result
  const coachReports = matchedDefs.map((def) => {
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
    return {
      coachName: def.canonicalName,
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
    aggregationType: "海港主教练执教全量官方权威统计（遍历全量693场历史赛程精确计算）",
    instruction:
      "必须严格以本段统计数据为唯一准则回答执教赛季数量、具体赛季列表、执教总场次、胜平负及胜率。绝对严禁根据局部抽样的比赛切片自行缩减或重新推算！",
    coaches: coachReports,
    disambiguationNotice:
      queryLower.includes("佩雷拉")
        ? "海港队史有两位夺冠主教练中文译名均含'佩雷拉'：维托尔·佩雷拉（葡萄牙籍，2018-2020赛季执教114场，夺2018中超与2019超级杯冠军）与哈维尔·佩雷拉（西班牙籍，2023赛季执教31场，夺2023中超冠军）。请在回答时主动进行消歧与说明。"
        : undefined,
  };
}

/**
 * Deterministically compute head-to-head statistics vs specified opponents
 */
export function computeHeadToHeadAggregation(schedule: any[], oppKeywords: string[]) {
  if (!oppKeywords || oppKeywords.length === 0) return null;
  const results: any[] = [];
  const handledCanonicalNames = new Set<string>();

  for (const opp of oppKeywords) {
    // Check if opp matches any entry in OPPONENT_ALIASES_DICTIONARY
    const dictEntry = OPPONENT_ALIASES_DICTIONARY.find(
      (d) =>
        d.canonicalName === opp ||
        d.allKeywords.some((kw) => kw === opp || opp.includes(kw) || kw.includes(opp))
    );

    const displayName = dictEntry ? dictEntry.canonicalName : opp;
    if (handledCanonicalNames.has(displayName)) continue;
    handledCanonicalNames.add(displayName);

    const matchVariants = dictEntry
      ? dictEntry.allKeywords
      : [opp];

    const matched = schedule.filter((m) => {
      const isPortHome = isPortTeam(m.home_team);
      const isPortAway = isPortTeam(m.away_team);
      if (!isPortHome && !isPortAway) return false;
      const opponent = isPortHome ? m.away_team : m.home_team;
      if (!opponent) return false;
      return matchVariants.some((variant) => opponent.includes(variant));
    });

    if (matched.length === 0) continue;

    let win = 0, draw = 0, loss = 0;
    const comps: Record<string, number> = {};
    matched.forEach((m) => {
      if (m.win_loss === "胜") win++;
      else if (m.win_loss === "平") draw++;
      else if (m.win_loss === "负") loss++;
      const c = m.match_type || "其他赛事";
      comps[c] = (comps[c] || 0) + 1;
    });

    results.push({
      targetOpponent: displayName,
      aliasVariantsMatched: matchVariants,
      totalHeadToHeadMatches: matched.length,
      portOverallRecord: `${win}胜 ${draw}平 ${loss}负`,
      winRate: `${((win / matched.length) * 100).toFixed(1)}%`,
      competitionsBreakdown: comps,
      recentMatchesSample: matched.slice(-5).map(
        (m) =>
          `${m.date} ${m.match_name}: ${m.home_team} ${m.result} ${m.away_team} (${m.win_loss})`
      ),
    });
  }

  if (results.length === 0) return null;
  return {
    aggregationType: "历史对阵交锋权威全量统计（遍历全量693场赛程精确汇总）",
    instruction: "请严格以这里的历史交手总场次、胜平负战绩及胜率为准进行回答。",
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
    aggregationType: "进球明细表权威汇总（基于全部1255条进球明细统计）",
    scorers: playerReports,
  };
}

/**
 * Deterministically compute recent/latest or earliest match aggregations from history_schedule.json
 */
export function computeMatchAggregation(schedule: any[], query: string) {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return null;

  const q = query.toLowerCase();
  const isRecentQuery = /最近|上一场|最新|近期|前一场|倒数第|最后/i.test(q);
  const isEarliestQuery = /最早|第一场|建队第一场|首场|初战/i.test(q);
  const wantsWin = /赢球|获胜|胜仗|赢了|取胜|胜利|打赢/i.test(q);
  const wantsLoss = /输球|失利|输了|负/i.test(q);
  const wantsDraw = /平局|打平|平了/i.test(q);

  if (!isRecentQuery && !isEarliestQuery) return null;

  // Filter valid matches with dates
  const validMatches = schedule
    .filter((m) => m && m.date)
    .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

  if (validMatches.length === 0) return null;

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

  if (targetMatches.length === 0) return null;

  if (isRecentQuery) {
    const latestMatches = targetMatches.slice(-8).reverse();
    const absoluteLatest = latestMatches[0];
    return {
      aggregationType: `赛程权威全量时间序列分析（最近/最新${targetDesc}）`,
      instruction: `根据全量693场赛程数据库（时间跨度从2006年至最新），最近/最新的一场${targetDesc}必须严格以【absoluteLatestMatch】为准，严禁将历史早期（如2006-2008东亚时期）比赛误当作最近比赛！`,
      targetType: targetDesc,
      absoluteLatestMatch: absoluteLatest,
      recentMatchesList: latestMatches,
    };
  } else if (isEarliestQuery) {
    const earliestMatches = targetMatches.slice(0, 8);
    const absoluteEarliest = earliestMatches[0];
    return {
      aggregationType: `赛程权威全量时间序列分析（队史最早/建队首场${targetDesc}）`,
      instruction: `队史最早的一场${targetDesc}必须严格以【absoluteEarliestMatch】为准！`,
      targetType: targetDesc,
      absoluteEarliestMatch: absoluteEarliest,
      earliestMatchesList: earliestMatches,
    };
  }

  return null;
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
   */
  private async scanAndLoadDirectoryFiles(): Promise<string[]> {
    this.ensureDirectories();
    const loadedFiles: string[] = [];
    const validExtensions = new Set([".json", ".md", ".txt", ".csv"]);
    const directoriesToScan = [KNOWLEDGE_DIR, UPLOADS_DIR];

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

            const content = fs.readFileSync(fullPath, "utf8");
            if (content && content.trim().length > 0) {
              await this.internalAddContent(fName, content, stat.size, false);
              loadedFiles.push(fName);
            }
          } catch (fileErr) {
            console.error(`Error reading data file ${fullPath}:`, fileErr);
          }
        }
      } catch (dirErr) {
        console.error(`Error scanning directory ${dir}:`, dirErr);
      }
    }

    this.saveManifest();
    return loadedFiles;
  }

  async initialize() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.ensureDirectories();

      try {
        const loaded = await this.scanAndLoadDirectoryFiles();
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
   * Rescan data directories on demand to load newly added files
   */
  async rescan(): Promise<{ scannedCount: number; loadedFiles: string[]; stats: any }> {
    await this.initialize();
    const loaded = await this.scanAndLoadDirectoryFiles();
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

        if (Array.isArray(parsed)) {
          itemsArray = parsed;
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.players)) {
            itemsArray = parsed.players;
            isPlayerStatsArray = true;
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
            const isPlayer = isPlayerStatsArray || Boolean(item && item.name && (item.summary || item.position || item.birthDate));

            let text = "";
            let recordTitle = "";
            let recordCategory = "海港结构化数据";
            let recordKeyPlayers: string[] = [];

            if (isPlayer && item.name) {
              allLoadedPlayerNames.add(item.name);
              const s = item.summary || {};
              recordTitle = `球员技术档案: ${item.name} (${item.position || "海港球员"})`;
              recordCategory = "球员生涯统计";
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
                  category: recordCategory,
                  sourceFile: fileName,
                  section: item.section || item.round || (isPlayer ? `${item.name} 档案` : `条目 #${i + 1}`),
                  matchDate: recordDate,
                  competition: item.match_type || item.competition || item.tournament || null,
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

        let items: any[] | null = null;
        let isPlayerDataset = false;

        if (Array.isArray(parsed)) {
          items = parsed;
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.players)) {
            items = parsed.players;
            isPlayerDataset = true;
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

        if (!isPlayerDataset && items && items.length > 0 && items[0] && items[0].name && (items[0].summary || items[0].position || items[0].birthDate)) {
          isPlayerDataset = true;
        }

        if (isPlayerDataset && items && items.length > 0) {
          // Check player query
          const targetPlayers = items.filter((p: any) =>
            p.name && (query.includes(p.name) || queryKeywords.includes(p.name))
          );

          const wantsAppearances = /出场|出战|登场|参赛|勤勉|最多次数|出场榜|出场纪录|出场前/i.test(query);
          const wantsGoals = /进球|射手|破门|射门|得分|金靴|射手榜|进球榜|射手前/i.test(query);
          const wantsAssists = /助攻|喂饼|做球|助攻榜|助攻王|助攻前/i.test(query);
          const wantsCleanSheets = /零封|门将|守门员|扑点|扑救|失球/i.test(query);
          const wantsCards = /红牌|黄牌|吃牌|犯规/i.test(query);
          const wantsMinutes = /出场时间|分钟/i.test(query);

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

          if (matchedRecords.length > 0) {
            contentToInject = JSON.stringify(
              {
                sourceFile: fName,
                datasetType: "海港球员历史技术档案与出场进球统计",
                totalPlayersInDatabase: items.length,
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
                items[0].round !== undefined));
          const isGoalDataset =
            fName.toLowerCase().includes("goal") ||
            (items[0] &&
              (items[0].goal_player !== undefined || items[0].assist_player !== undefined));

          // Run deterministic aggregation if appropriate
          let coachAggregation: any = null;
          let headToHeadAggregation: any = null;
          let seasonAggregation: any = null;
          let goalAggregation: any = null;
          let matchAggregation: any = null;

          const isRecentOrEarliestQuery = /最近|上一场|最新|近期|前一场|倒数第|最后|最早|第一场|建队第一场|首场|初战/i.test(query);

          if (isScheduleDataset) {
            // Check recent/earliest match query
            matchAggregation = computeMatchAggregation(items, query);
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
          }

          // Scoring function for each match/schedule/goal item
          const scoredItems = items.map((item: any, originalIndex: number) => {
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
                return { item, score: -1, date: item.date || "", originalIndex };
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

            // If it's a schedule item, reward specific win/loss match condition
            if (isScheduleDataset) {
              if (/赢球|获胜|胜仗|赢了|取胜|胜利/i.test(query) && item.win_loss === "胜") {
                score += 5;
              } else if (/输球|失利|输了|负/i.test(query) && item.win_loss === "负") {
                score += 5;
              } else if (/平局|打平|平了/i.test(query) && item.win_loss === "平") {
                score += 5;
              }
            }

            return { item, score, date: item.date || "", originalIndex };
          });

          // Filter items with positive score and sort appropriately
          const matched = scoredItems
            .filter((s) => s.score > 0)
            .sort((a, b) => {
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
          if (coachAggregation) authoritativeness.coachStats = coachAggregation;
          if (headToHeadAggregation) authoritativeness.headToHeadStats = headToHeadAggregation;
          if (seasonAggregation) authoritativeness.seasonStats = seasonAggregation;
          if (goalAggregation) authoritativeness.goalScorerStats = goalAggregation;

          const hasAuthoritativeStats = Object.keys(authoritativeness).length > 0;

          if (matched.length > 0 || hasAuthoritativeStats) {
            // Found specific matched matches or authoritative pre-aggregations!
            // When querying specific year/season, inject up to 70 records to cover full 40-50 matches of that season completely!
            const sampleSliceLimit = queryYears.length > 0 ? 70 : 40;
            contentToInject = JSON.stringify(
              {
                sourceFile: fName,
                totalInDataset: items.length,
                authoritativeAggregations: hasAuthoritativeStats ? authoritativeness : undefined,
                matchedRecordsCount: matched.length,
                representativeSampleRecords: matched.slice(0, sampleSliceLimit),
                note: hasAuthoritativeStats
                  ? "【权威核心准则】：上方 authoritativeAggregations 是遍历全量数据精确计算的官方权威统计事实。回答涉及赛季总场次、胜平负总战绩、各赛事分布、主帅、最近比赛或历史交锋时，必须严格以此精确数据为唯一基准，严禁自行缩减场次！"
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
                sampleRecords: items.slice(0, 15),
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
   - 当下方数据中包含【authoritativeAggregations】（如时间序列分析 matchTimeStats、教练全量执教统计 coachStats、历史交锋战绩 headToHeadStats、赛季总战绩 seasonStats）时，该数据是系统在后台遍历全部 693 场历史赛程精确计算得出的唯一权威事实！
   - 回答涉及“最近一场/最新胜仗/最近赢球/队史首战”等时间序列问题时，【必须严格以 matchTimeStats 中的 absoluteLatestMatch / absoluteEarliestMatch 为准】！历史赛程数据收录至2026年，严禁将早期（如2006-2008东亚时期）的历史比赛当成“最近一场”！
   - 回答涉及执教赛季数量、具体赛季列表、执教总场次、胜平负、胜率或交锋总数时，【必须严格以此权威精确统计数据为准】进行回答！
   - 【严禁根据抽样展示的代表性比赛切片自行缩减场次或重新估算】。
3. 赛季与年份战绩呈现规范：
   - 当用户询问某特定赛季/年份（如“18年”、“2018赛季”、“24年”）的比赛情况或战绩时，必须结合 seasonStats 与代表性比赛列表进行详尽说明：
     * 概述该赛季各项赛事总战绩（总场次、胜平负、胜率）及赛事分布（如中超、足协杯、亚冠）；
     * 指出该赛季主教练与核心历史成就（如2018年中超夺冠、2024年中超与足协杯双冠王等）；
     * 严禁无视数据中收录的该赛季完整比赛记录谎称“未收录具体比赛场次”。
4. 智能消歧规范：
   - 若用户询问“佩雷拉”，需明确海港队史功勋主帅“维托尔·佩雷拉”（2018-2020三个赛季114场，夺2018中超与2019超级杯），并主动补充说明2023赛季另有一位西班牙主帅哈维尔·佩雷拉（2023一个赛季31场夺中超冠军），以便用户全面了解。
5. 直接回答，极致简明（极其重要）：
   - 用户要求页面显示简明清爽，只显示针对问题的直接回答。
   - 【严禁输出任何“数据出处”、“引用出处”、“参考文件”、“检索引据”、“查看引据”、“比赛记录引据”、“来源文件”等出处段落或元数据清单】。
   - 【切勿在回答末尾添加“数据出处”、“引用的比赛记录”或任何引用附录】。
   - 所有必要的比赛要素（如比赛日期、对阵双方与比分、进球球员及进球时间）直接自然地融入回答正文陈述中即可。
6. 格式采用美观清晰的 Markdown，语言精炼，层次分明，直奔主题。`;

    const userPrompt = `【海港内部知识库数据】：
${contextText}

${recentHistory ? `【多轮对话历史】：\n${recentHistory}\n` : ""}

【用户当前问题】：
${question}

【回答要求】：
请直接针对问题给出简明清晰的回答，指出赛事、时间、比分与球员等关键信息。严禁输出任何“数据出处”、“查看引据”、“比赛记录引据”或引用文件来源说明，直接呈现针对问题的解答内容。`;

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
        } else {
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
        }

        if (parts.length > 0) {
          formattedContent = parts.join("\n- ");
          formattedContent = `- ${formattedContent}`;
        }
      } catch (e) {
        // keep as is if not json
      }

      const quotaNotice = String(lastError?.message || "").includes("Quota") || String(lastError?.message || "").includes("429")
        ? "\n\n*(注：因 API 瞬时调用频率限制，系统已切换至本地快速匹配模式呈现数据库记录)*"
        : "";

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
