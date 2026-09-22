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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  sources?: CitedSource[];
  isThinking?: boolean;
  error?: string;
  retrievedCount?: number;
  retrievalMode?: "json_full_context" | "vector_rag" | "hybrid";
}

export interface UploadedFileItem {
  name: string;
  size: number;
  chunkCount: number;
  uploadTime: number;
  isDefault: boolean;
  isJson?: boolean;
  itemCount?: number;
}

export interface KnowledgeBaseStats {
  totalDocuments: number;
  totalChunks: number;
  files: UploadedFileItem[];
}

export interface PresetQuestion {
  id: string;
  text: string;
  category: "射手与巨星" | "夺冠决战" | "历史荣誉" | "名帅战术" | "德比恩怨";
  tag: string;
}

export interface ClubEraInfo {
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

export interface OpponentAliasInfo {
  canonicalName: string;
  commonNames: string[];
  historicalFormerNames: string[];
  allKeywords: string[];
  cityOrRegion: string;
  sampleQuestion: string;
}

export interface CompetitionAliasInfo {
  canonicalName: string;
  shortNames: string[];
  englishName: string;
  description: string;
}

export interface ClubAliasRulesData {
  canonicalClubName: string;
  identityPrinciple: string;
  eras: ClubEraInfo[];
  allPortAliases: string[];
  opponents: OpponentAliasInfo[];
  competitions: CompetitionAliasInfo[];
}
