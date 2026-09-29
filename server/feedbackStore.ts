import fs from "fs";
import path from "path";
import { FeedbackRecord } from "../src/types.js";

const DATA_DIR = path.join(process.cwd(), "data");
const FEEDBACK_FILE = path.join(DATA_DIR, "feedback_records.json");

export class FeedbackStore {
  private records: FeedbackRecord[] = [];
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(FEEDBACK_FILE)) {
        const raw = fs.readFileSync(FEEDBACK_FILE, "utf-8");
        this.records = JSON.parse(raw);
      } else {
        this.records = [];
        this.save();
      }
    } catch (e) {
      console.error("[FeedbackStore] Failed to load feedback records:", e);
      this.records = [];
    }
    this.initialized = true;
  }

  private save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(this.records, null, 2), "utf-8");
    } catch (e) {
      console.error("[FeedbackStore] Failed to save feedback file:", e);
    }
  }

  public getAll(): FeedbackRecord[] {
    this.ensureInitialized();
    // Return latest first
    return [...this.records].sort((a, b) => b.createdAt - a.createdAt);
  }

  public add(item: Omit<FeedbackRecord, "id" | "createdAt" | "status">): FeedbackRecord {
    this.ensureInitialized();
    const newRecord: FeedbackRecord = {
      ...item,
      id: "fb_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      createdAt: Date.now(),
      status: "pending",
    };
    // If feedback already submitted for same messageId, update or append
    const existingIndex = this.records.findIndex((r) => r.messageId === item.messageId);
    if (existingIndex >= 0) {
      this.records[existingIndex] = {
        ...this.records[existingIndex],
        ...newRecord,
        createdAt: Date.now(),
      };
      this.save();
      return this.records[existingIndex];
    } else {
      this.records.unshift(newRecord);
      this.save();
      return newRecord;
    }
  }

  public updateStatus(id: string, status: "pending" | "reviewed" | "corrected", adminNotes?: string): boolean {
    this.ensureInitialized();
    const index = this.records.findIndex((r) => r.id === id);
    if (index >= 0) {
      this.records[index].status = status;
      if (adminNotes !== undefined) {
        this.records[index].adminNotes = adminNotes;
      }
      this.save();
      return true;
    }
    return false;
  }

  public deleteRecord(id: string): boolean {
    this.ensureInitialized();
    const index = this.records.findIndex((r) => r.id === id);
    if (index >= 0) {
      this.records.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  public clearAll() {
    this.ensureInitialized();
    this.records = [];
    this.save();
  }
}

export const feedbackStore = new FeedbackStore();
