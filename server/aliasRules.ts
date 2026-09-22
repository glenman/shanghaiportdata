/**
 * Shanghai Port FC - Historical Names & Aliases Knowledge Dictionary & Rules Engine
 * 
 * 预设规则与队史名称/简称库：
 * 1. 俱乐部同一性法则：上海海港、上海上港、上海东亚、上海特莱士均为同一支队伍在不同历史时期的正式名称与冠名。
 * 2. 简称库：包含海港、上港、东亚、特莱士、港队、SIPG等各类口语与历史简称。
 * 3. 对手历史队名映射库：包含恒大/广州队、鲁能/泰山、国安、苏宁/舜天、泰达/津门虎等。
 * 4. 赛事全称与简称库：中超、中甲、中乙、足协杯、超级杯、亚冠等。
 */

export interface ClubEraDefinition {
  eraId: "east_asia" | "sipg" | "port";
  canonicalName: string;
  shortName: string;
  timeRange: string;
  description: string;
  aliases: string[];
  majorHonors: string[];
  representativeFigures: string[];
  sampleQuestions: string[];
}

export interface OpponentAliasDefinition {
  canonicalName: string;
  commonNames: string[];
  historicalFormerNames: string[];
  allKeywords: string[];
  cityOrRegion: string;
  sampleQuestion: string;
}

export interface CompetitionAliasDefinition {
  canonicalName: string;
  shortNames: string[];
  englishName: string;
  description: string;
}

/**
 * 俱乐部核心三大历史时期定义与全量别名
 */
export const PORT_CLUB_ERAS: ClubEraDefinition[] = [
  {
    eraId: "east_asia",
    canonicalName: "上海东亚足球俱乐部",
    shortName: "上海东亚 / 东亚",
    timeRange: "2005年12月 - 2014年12月",
    description:
      "由中国足球名宿徐根宝在崇明根宝足球基地创建，以崇明青年军为班底。历经中乙、中甲一路打入中超，2012-2013年曾冠名为上海特莱士队。",
    aliases: [
      "上海东亚",
      "东亚",
      "东亚队",
      "上海东亚队",
      "上海东亚足球俱乐部",
      "上海特莱士",
      "特莱士",
      "上海特莱士队",
      "东亚特莱士",
      "东亚青年军",
      "根宝基地青年军",
      "崇明一代"
    ],
    majorHonors: [
      "2007年中国足球协会乙级联赛冠军（冲甲成功）",
      "2012年中国足球协会甲级联赛冠军（冲超成功）",
      "2009年第十一届全运会男足甲组冠军（东亚班底）",
      "2013年第十二届全运会男足甲组冠军（东亚班底）"
    ],
    representativeFigures: ["徐根宝", "蒋炳尧", "武磊", "吕文君", "王燊超", "颜骏凌", "蔡慧康", "曹赟定", "朱峥嵘"],
    sampleQuestions: [
      "上海东亚时期队史第一场正式比赛是在什么时候？",
      "东亚时期哪一年冲超成功，当时的主教练是谁？",
      "上海特莱士是哪一年的冠名，取得了什么战绩？"
    ]
  },
  {
    eraId: "sipg",
    canonicalName: "上海上港集团足球俱乐部",
    shortName: "上海上港 / 上港",
    timeRange: "2014年12月 - 2021年1月",
    description:
      "2014年底上港集团完成全资收购，加大引援力度，相继引进孔卡、埃尔克森、胡尔克、奥斯卡等世界级巨星，夺得队史首座中超冠军及超级杯冠军。",
    aliases: [
      "上海上港",
      "上港",
      "上港队",
      "上海上港队",
      "上海上港集团足球俱乐部",
      "上港集团队",
      "SIPG",
      "Shanghai SIPG"
    ],
    majorHonors: [
      "2018年中国足球协会超级联赛冠军（队史首座中超联赛冠军）",
      "2019年中国足球协会超级杯冠军",
      "2015、2017年中国足球协会超级联赛亚军",
      "2017年亚冠联赛四强"
    ],
    representativeFigures: ["维托尔·佩雷拉", "埃里克森", "博阿斯", "奥斯卡", "胡尔克", "武磊", "埃尔克森", "孔卡"],
    sampleQuestions: [
      "上海上港在2018赛季是如何提前一轮夺冠的？",
      "上港时期客场5-4战胜广州恒大的天河决战进球记录",
      "上港时期的历任外籍主教练有哪些？"
    ]
  },
  {
    eraId: "port",
    canonicalName: "上海海港足球俱乐部",
    shortName: "上海海港 / 海港",
    timeRange: "2021年1月 - 至今",
    description:
      "为响应中国足协俱乐部名称中性化要求更名为上海海港。2023赛季提前夺得中超第二冠；2024赛季由穆斯卡特带队创中超历史进攻纪录，斩获中超+足协杯双冠王。",
    aliases: [
      "上海海港",
      "海港",
      "海港队",
      "上海海港队",
      "上海海港足球俱乐部",
      "港队",
      "Port FC",
      "Shanghai Port",
      "Shanghai Port FC"
    ],
    majorHonors: [
      "2023年中国足球协会超级联赛冠军（队史中超第二冠）",
      "2024年中国足球协会超级联赛冠军（队史中超第三冠）",
      "2024年中国足球协会足协杯冠军（中超+足协杯双冠王）"
    ],
    representativeFigures: ["凯文·穆斯卡特", "哈维尔·佩雷拉", "武磊", "奥斯卡", "古斯塔沃", "巴尔加斯", "茹萨", "奇塔迪尼", "颜骏凌"],
    sampleQuestions: [
      "2024赛季海港夺得双冠王打破了哪些中超历史纪录？",
      "武磊在2024赛季打进34球的数据统计与有无点球？",
      "海港目前的主场浦东足球场第一场比赛记录"
    ]
  }
];

/**
 * 全量主队别名与简称集合（用于快速判断与模糊包含）
 */
export const ALL_PORT_NAME_VARIANTS: string[] = Array.from(
  new Set([
    "上海海港", "海港", "上海上港", "上港", "上海东亚", "东亚",
    "上海特莱士", "特莱士", "港队", "海港队", "上港队", "东亚队", "特莱士队",
    "上海东亚足球俱乐部", "上海上港集团足球俱乐部", "上海海港足球俱乐部",
    "东亚青年军", "根宝基地青年军", "SIPG", "Shanghai Port", "Port FC", "我港"
  ])
);

/**
 * 校验某个名称是否指代上海海港俱乐部本队
 */
export function isPortTeam(teamName?: string): boolean {
  if (!teamName) return false;
  const t = teamName.trim();
  return (
    t.includes("海港") ||
    t.includes("上港") ||
    t.includes("东亚") ||
    t.includes("特莱士") ||
    t.toLowerCase().includes("sipg") ||
    t.toLowerCase().includes("port")
  );
}

/**
 * 对手俱乐部全称、曾用名与常用简称映射库
 */
export const OPPONENT_ALIASES_DICTIONARY: OpponentAliasDefinition[] = [
  {
    canonicalName: "上海申花",
    commonNames: ["上海申花", "申花", "申花队"],
    historicalFormerNames: ["上海绿地申花", "绿地申花", "上海申花联盛"],
    allKeywords: ["上海申花", "申花", "绿地申花", "上海绿地申花", "申花队", "同城对手", "上海德比"],
    cityOrRegion: "上海",
    sampleQuestion: "海港对阵上海申花的历史交锋总战绩与经典大比分胜利"
  },
  {
    canonicalName: "北京国安",
    commonNames: ["北京国安", "国安", "国安队"],
    historicalFormerNames: ["北京中赫国安", "中赫国安", "北京中信国安", "北京国安乐视"],
    allKeywords: ["北京国安", "国安", "中赫国安", "北京中赫国安", "御林军", "国安队"],
    cityOrRegion: "北京",
    sampleQuestion: "海港对阵北京国安的历史交手总场次与胜率"
  },
  {
    canonicalName: "山东泰山",
    commonNames: ["山东泰山", "泰山", "泰山队"],
    historicalFormerNames: ["山东鲁能", "鲁能", "山东鲁能泰山", "鲁能泰山"],
    allKeywords: ["山东泰山", "泰山", "山东鲁能", "鲁能", "山东鲁能泰山", "鲁能泰山", "泰山队"],
    cityOrRegion: "山东济南",
    sampleQuestion: "海港对阵山东泰山（含山东鲁能时期）的历史交锋战绩"
  },
  {
    canonicalName: "广州队",
    commonNames: ["广州队", "广州恒大", "恒大"],
    historicalFormerNames: ["广州恒大淘宝", "恒大淘宝", "广州广汽恒大", "广州医药", "广药"],
    allKeywords: ["广州队", "广州恒大", "恒大", "广州恒大淘宝", "恒大淘宝", "广药", "广州医药"],
    cityOrRegion: "广东广州",
    sampleQuestion: "海港对阵广州恒大（广州队）的经典战役与历史交战记录"
  },
  {
    canonicalName: "天津津门虎",
    commonNames: ["天津津门虎", "津门虎"],
    historicalFormerNames: ["天津泰达", "泰达", "天津天海", "天津权健", "权健"],
    allKeywords: ["天津津门虎", "津门虎", "天津泰达", "泰达", "天津天海", "权健"],
    cityOrRegion: "天津",
    sampleQuestion: "海港对阵天津津门虎（原天津泰达）的历史战绩"
  },
  {
    canonicalName: "浙江队",
    commonNames: ["浙江队", "浙江绿城", "绿城"],
    historicalFormerNames: ["杭州绿城", "浙江能源绿城"],
    allKeywords: ["浙江队", "浙江绿城", "绿城", "杭州绿城"],
    cityOrRegion: "浙江杭州",
    sampleQuestion: "海港对阵浙江绿城的交锋记录与进球统计"
  },
  {
    canonicalName: "江苏队",
    commonNames: ["江苏队", "江苏苏宁", "苏宁"],
    historicalFormerNames: ["江苏舜天", "舜天", "江苏国信舜天"],
    allKeywords: ["江苏队", "江苏苏宁", "苏宁", "江苏舜天", "舜天"],
    cityOrRegion: "江苏南京",
    sampleQuestion: "海港对阵江苏苏宁（江苏舜天）历史战绩"
  },
  {
    canonicalName: "河南队",
    commonNames: ["河南队", "河南建业", "建业"],
    historicalFormerNames: ["河南嵩山龙门", "嵩山龙门", "河南双汇"],
    allKeywords: ["河南队", "河南建业", "建业", "河南嵩山龙门", "嵩山龙门"],
    cityOrRegion: "河南郑州",
    sampleQuestion: "海港对阵河南建业的比赛记录与客场表现"
  },
  {
    canonicalName: "武汉三镇",
    commonNames: ["武汉三镇", "三镇"],
    historicalFormerNames: ["武汉尚文"],
    allKeywords: ["武汉三镇", "三镇"],
    cityOrRegion: "湖北武汉",
    sampleQuestion: "海港对阵武汉三镇的战绩统计"
  },
  {
    canonicalName: "成都蓉城",
    commonNames: ["成都蓉城", "蓉城"],
    historicalFormerNames: ["成都兴城"],
    allKeywords: ["成都蓉城", "蓉城", "成都兴城"],
    cityOrRegion: "四川成都",
    sampleQuestion: "海港对阵成都蓉城的凤凰山之战与交锋数据"
  },
  {
    canonicalName: "长春亚泰",
    commonNames: ["长春亚泰", "亚泰"],
    historicalFormerNames: [],
    allKeywords: ["长春亚泰", "亚泰"],
    cityOrRegion: "吉林长春",
    sampleQuestion: "海港对阵长春亚泰的历史胜负记录"
  },
  {
    canonicalName: "大连人",
    commonNames: ["大连人", "大连队"],
    historicalFormerNames: ["大连一方", "一方", "大连阿尔滨", "阿尔滨"],
    allKeywords: ["大连人", "大连一方", "一方", "大连阿尔滨", "阿尔滨", "大连队"],
    cityOrRegion: "辽宁大连",
    sampleQuestion: "海港对阵大连一方/大连阿尔滨的经典8-0大胜与历史交锋"
  },
  {
    canonicalName: "广州城",
    commonNames: ["广州城", "广州富力", "富力"],
    historicalFormerNames: ["长沙金德", "沈阳金德"],
    allKeywords: ["广州城", "广州富力", "富力"],
    cityOrRegion: "广东广州",
    sampleQuestion: "海港对阵广州富力的越秀山对攻战"
  },
  {
    canonicalName: "沧州雄狮",
    commonNames: ["沧州雄狮"],
    historicalFormerNames: ["石家庄永昌", "永昌"],
    allKeywords: ["沧州雄狮", "石家庄永昌", "永昌"],
    cityOrRegion: "河北沧州/石家庄",
    sampleQuestion: "海港对阵沧州雄狮（石家庄永昌）战绩"
  },
  {
    canonicalName: "深圳队",
    commonNames: ["深圳队"],
    historicalFormerNames: ["深圳佳兆业", "佳兆业", "深圳红钻", "深圳健力宝"],
    allKeywords: ["深圳队", "深圳佳兆业", "佳兆业", "深圳红钻"],
    cityOrRegion: "广东深圳",
    sampleQuestion: "海港对阵深圳佳兆业（深圳队）胜负统计"
  }
];

/**
 * 赛事名称规范化与简称字典
 */
export const COMPETITIONS_DICTIONARY: CompetitionAliasDefinition[] = [
  {
    canonicalName: "中国足球协会超级联赛",
    shortNames: ["中超", "中超联赛", "CSL"],
    englishName: "Chinese Super League",
    description: "中国顶级职业足球联赛，海港在2018、2023、2024夺得三次中超联赛冠军。"
  },
  {
    canonicalName: "中国足球协会杯",
    shortNames: ["足协杯", "足协杯赛", "FA Cup"],
    englishName: "Chinese FA Cup",
    description: "全国规模最大的全国性淘汰制杯赛，海港在2024赛季夺得队史首座足协杯冠军。"
  },
  {
    canonicalName: "中国足球协会超级杯",
    shortNames: ["超级杯", "超霸杯", "Super Cup"],
    englishName: "Chinese Super Cup",
    description: "赛季揭幕单场决胜赛，由上赛季联赛冠军对阵足协杯冠军，海港在2019年夺得冠军。"
  },
  {
    canonicalName: "亚足联冠军联赛",
    shortNames: ["亚冠", "亚冠联赛", "亚冠精英联赛", "ACL", "ACLE"],
    englishName: "AFC Champions League",
    description: "亚洲最高级别俱乐部赛事，海港队史多次杀入淘汰赛，2017年获得四强。"
  },
  {
    canonicalName: "中国足球协会甲级联赛",
    shortNames: ["中甲", "中甲联赛"],
    englishName: "China League One",
    description: "第二级联赛，上海东亚在2012赛季夺得中甲冠军冲超。"
  },
  {
    canonicalName: "中国足球协会乙级联赛",
    shortNames: ["中乙", "中乙联赛"],
    englishName: "China League Two",
    description: "第三级联赛，上海东亚在2007赛季以中乙冠军身份冲甲。"
  }
];

/**
 * 根据用户输入识别对应的对手名称（包含所有曾用名扩展）
 */
export function identifyOpponentsInQuery(query: string): OpponentAliasDefinition[] {
  const queryLower = query.toLowerCase();
  const matched: OpponentAliasDefinition[] = [];

  for (const opp of OPPONENT_ALIASES_DICTIONARY) {
    const isHit = opp.allKeywords.some((kw) => queryLower.includes(kw.toLowerCase()));
    if (isHit) {
      matched.push(opp);
    }
  }

  return matched;
}

/**
 * 根据输入识别提到的海港历史时期
 */
export function identifyPortErasInQuery(query: string): ClubEraDefinition[] {
  const queryLower = query.toLowerCase();
  return PORT_CLUB_ERAS.filter((era) =>
    era.aliases.some((alias) => queryLower.includes(alias.toLowerCase()))
  );
}

/**
 * 生成植入给大模型 Prompt 的俱乐部同一性与简称预设规则
 */
export function buildPromptIdentityRules(): string {
  return `
【预设俱乐部同一性法则与简称规则库（必须严格遵守）】：
1. 核心同一性法则：
   - 本知识库与问答系统唯一的核心主体是【上海海港足球俱乐部】。
   - 【上海东亚】（2005-2014）、【上海特莱士】（2012-2013）、【上海上港】（2015-2020）、【上海海港】（2021-至今）是该俱乐部在不同历史时期的正式名称与冠名，全部属于【同一个队伍】！
   - 口语与常见简称：“海港”、“上港”、“东亚”、“特莱士”、“港队”、“SIPG”、“Port FC”等，均指代本俱乐部。
   - 历史进球数（如武磊、吕文君等）、历史战绩、交手记录、夺冠荣誉、历任教练带队数据必须跨越东亚、上港、海港三个时期统筹合并计算，严禁人为分割或漏计东亚/上港时期的场次！
2. 历史对手队名映射准则（用户提问对手任一名称，需覆盖其所有历史曾用名）：
   - 山东泰山 = 山东鲁能 = 山东鲁能泰山
   - 广州队 = 广州恒大 = 广州恒大淘宝 = 广州广汽恒大
   - 北京国安 = 北京中赫国安 = 北京中信国安
   - 上海申花 = 上海绿地申花
   - 天津津门虎 = 天津泰达 = 天津天海
   - 江苏队 = 江苏苏宁 = 江苏舜天
   - 河南队 = 河南建业 = 河南嵩山龙门
   - 大连人 = 大连一方 = 大连阿尔滨
   - 广州城 = 广州富力
   - 成都蓉城 = 成都兴城
   - 浙江队 = 浙江绿城 = 杭州绿城
3. 赛事简称映射：
   - 中超 = 中国足球协会超级联赛；足协杯 = 中国足球协会杯；超级杯 = 中国足球协会超级杯；亚冠 = 亚足联冠军联赛 / 亚冠精英联赛；中甲 = 中国足球协会甲级联赛；中乙 = 中国足球协会乙级联赛。
`;
}
