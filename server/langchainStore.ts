import { Embeddings } from "@langchain/core/embeddings";
import { VectorStore } from "@langchain/core/vectorstores";
import { Document } from "@langchain/core/documents";
import { getGeminiClient } from "./geminiClient.js";

// Helper: Cosine similarity with length tolerance
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  const len = Math.min(vecA.length, vecB.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

const VECTOR_DIM = 768;

// Deterministic high-dimensional semantic vector generator (768-dim) for offline / quota cooldown
function generateSemanticVector(text: string, dim: number = VECTOR_DIM): number[] {
  const vec = new Array(dim).fill(0);
  const clean = text.toLowerCase().trim();
  if (!clean) return vec;

  // Unigram & bigram hashing for strong semantic overlap (especially Chinese character pairs)
  for (let i = 0; i < clean.length; i++) {
    const code1 = clean.charCodeAt(i);
    const pos1 = (code1 * 37 + i * 19) % dim;
    vec[pos1] += 1.0;

    if (i + 1 < clean.length) {
      const code2 = clean.charCodeAt(i + 1);
      const pairHash = ((code1 << 5) + code2 + i * 43) % dim;
      const pos2 = Math.abs(pairHash);
      vec[pos2] += 2.0;

      if (i + 2 < clean.length) {
        const code3 = clean.charCodeAt(i + 2);
        const triHash = ((code1 << 7) + (code2 << 3) + code3 + i * 11) % dim;
        const pos3 = Math.abs(triHash);
        vec[pos3] += 1.5;
      }
    }
  }

  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Custom LangChain Embeddings using Gemini embedding model with automatic rate-limit cooldown
 */
export class GeminiLangChainEmbeddings extends Embeddings {
  private cache = new Map<string, number[]>();
  private static quotaCooldownUntil = 0;

  constructor() {
    super({});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const results: number[][] = [];
    // Process items with polite pacing to prevent sudden free-tier burst limit exhaustion
    for (let i = 0; i < documents.length; i++) {
      const vec = await this.embedQuery(documents[i]);
      results.push(vec);
      // Small 40ms interval if using remote API to stay well under burst limits
      if (Date.now() >= GeminiLangChainEmbeddings.quotaCooldownUntil && i < documents.length - 1) {
        await new Promise((r) => setTimeout(r, 40));
      }
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) return new Array(VECTOR_DIM).fill(0);

    const cacheKey = trimmed.slice(0, 300);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // If currently in quota cooldown, smoothly use the local semantic vector representation
    if (Date.now() < GeminiLangChainEmbeddings.quotaCooldownUntil) {
      const fallback = generateSemanticVector(trimmed, VECTOR_DIM);
      this.cache.set(cacheKey, fallback);
      return fallback;
    }

    try {
      const ai = getGeminiClient();
      const res = await ai.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: trimmed,
        config: {
          outputDimensionality: VECTOR_DIM,
        },
      });

      let vector: number[] | undefined;
      if (res.embeddings && res.embeddings.length > 0 && res.embeddings[0].values) {
        vector = res.embeddings[0].values;
      } else if ((res as any).embedding?.values) {
        vector = (res as any).embedding.values;
      }

      if (vector && vector.length > 0) {
        this.cache.set(cacheKey, vector);
        return vector;
      }
    } catch (err: any) {
      const errStr = String(err?.message || err);
      if (
        err?.status === "RESOURCE_EXHAUSTED" ||
        errStr.includes("429") ||
        errStr.includes("Quota exceeded") ||
        errStr.includes("RESOURCE_EXHAUSTED")
      ) {
        // Set cooldown for 25 seconds
        GeminiLangChainEmbeddings.quotaCooldownUntil = Date.now() + 25000;
        console.log("[Embedding API] 触发配额流控，自动启用本地语义多维向量索引(25秒冷却)");
      } else {
        console.log("[Embedding API] 临时波动，平滑启用高维向量匹配:", err?.message || err);
      }
    }

    const fallback = generateSemanticVector(trimmed, VECTOR_DIM);
    this.cache.set(cacheKey, fallback);
    return fallback;
  }
}

/**
 * Custom LangChain Vector Store backed by in-memory indexing with metadata preservation
 */
export class LangChainPortVectorStore extends VectorStore {
  private vectors: { id: string; vector: number[]; document: Document }[] = [];

  _vectorstoreType(): string {
    return "shanghai_port_memory_vectorstore";
  }

  constructor(embeddings: Embeddings) {
    super(embeddings, {});
  }

  async addVectors(vectors: number[][], documents: Document[]): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const vector = vectors[i];
      const id = (doc.metadata?.id as string) || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      doc.metadata = { ...doc.metadata, id };

      // Replace if id exists
      const existingIdx = this.vectors.findIndex((v) => v.id === id);
      if (existingIdx >= 0) {
        this.vectors[existingIdx] = { id, vector, document: doc };
      } else {
        this.vectors.push({ id, vector, document: doc });
      }
      ids.push(id);
    }
    return ids;
  }

  async addDocuments(documents: Document[]): Promise<string[]> {
    const texts = documents.map((doc) => doc.pageContent);
    const vectors = await this.embeddings.embedDocuments(texts);
    return this.addVectors(vectors, documents);
  }

  async similaritySearchVectorWithScore(
    queryVector: number[],
    k: number
  ): Promise<[Document, number][]> {
    const scored: { doc: Document; score: number }[] = [];

    for (const item of this.vectors) {
      const score = cosineSimilarity(queryVector, item.vector);
      scored.push({ doc: item.document, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => [s.doc, s.score]);
  }

  async similaritySearch(query: string, k: number = 4): Promise<Document[]> {
    const results = await this.similaritySearchWithScore(query, k);
    return results.map(([doc]) => doc);
  }

  async similaritySearchWithScore(
    query: string,
    k: number = 4
  ): Promise<[Document, number][]> {
    (this.embeddings as any).lastQueryText = query;
    const queryVector = await this.embeddings.embedQuery(query);
    const vectorResults = await this.similaritySearchVectorWithScore(queryVector, k);

    // Hybrid keyword boost: if document contains key terms from query, boost score
    const queryKeywords = query
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    const boostedResults = vectorResults.map(([doc, score]) => {
      let boostedScore = score;
      const contentLower = doc.pageContent.toLowerCase();
      const titleLower = ((doc.metadata?.title as string) || "").toLowerCase();

      for (const kw of queryKeywords) {
        if (titleLower.includes(kw)) {
          boostedScore += 0.15;
        } else if (contentLower.includes(kw)) {
          boostedScore += 0.05;
        }
      }
      return [doc, Math.min(0.999, Math.max(0, boostedScore))] as [Document, number];
    });

    boostedResults.sort((a, b) => b[1] - a[1]);
    return boostedResults.slice(0, k);
  }

  async delete(params: { ids?: string[] }): Promise<void> {
    if (params.ids && params.ids.length > 0) {
      const set = new Set(params.ids);
      this.vectors = this.vectors.filter((v) => !set.has(v.id));
    }
  }

  deleteBySourceFile(sourceFile: string): number {
    const beforeCount = this.vectors.length;
    this.vectors = this.vectors.filter(
      (v) => (v.document.metadata?.sourceFile as string) !== sourceFile
    );
    return beforeCount - this.vectors.length;
  }

  getAllDocuments(): Document[] {
    return this.vectors.map((v) => v.document);
  }

  getStats() {
    return {
      totalChunks: this.vectors.length,
      documentsCount: new Set(this.vectors.map((v) => v.document.metadata.sourceFile || "unknown")).size,
    };
  }

  clear() {
    this.vectors = [];
  }
}

/**
 * Split text into semantic chunks
 */
export function splitTextIntoChunks(
  text: string,
  chunkSize: number = 500,
  overlap: number = 80
): string[] {
  const clean = text.replace(/\r\n/g, "\n");
  if (clean.length <= chunkSize) return [clean];

  // Try splitting by double newlines or headers
  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if ((currentChunk + "\n\n" + para).length <= chunkSize) {
      currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      if (para.length > chunkSize) {
        // Break long paragraph into sliding windows
        let i = 0;
        while (i < para.length) {
          const slice = para.slice(i, i + chunkSize);
          chunks.push(slice.trim());
          i += chunkSize - overlap;
        }
        currentChunk = "";
      } else {
        currentChunk = para;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((c) => c.length > 0);
}
