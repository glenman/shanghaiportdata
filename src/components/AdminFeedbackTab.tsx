import React, { useState, useEffect } from "react";
import {
  ThumbsUp,
  ThumbsDown,
  Trash2,
  CheckCircle2,
  Clock,
  RotateCcw,
  MessageSquare,
  AlertTriangle,
  FileText,
  Search,
  Check,
  RefreshCw,
} from "lucide-react";
import { FeedbackRecord } from "../types.js";

interface AdminFeedbackTabProps {
  adminKey: string | null;
}

const REASON_LABELS: Record<string, string> = {
  incorrect_data: "具体数据有误 (比分/进球/时间)",
  wrong_match: "查错比赛/混淆对手",
  incomplete: "回答不全/遗漏要点",
  hallucination: "答非所问/编造数据",
  other: "其他问题",
};

export const AdminFeedbackTab: React.FC<AdminFeedbackTabProps> = ({ adminKey }) => {
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterRating, setFilterRating] = useState<"all" | "dislike" | "like">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "reviewed" | "corrected">("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesText, setNotesText] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const fetchRecords = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/feedback", {
        headers: {
          "x-admin-key": adminKey || "",
        },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.records)) {
        setRecords(data.records);
      }
    } catch (err) {
      console.error("Failed to load feedback records:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [adminKey]);

  const handleUpdateStatus = async (id: string, status: "pending" | "reviewed" | "corrected", notes?: string) => {
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey || "",
        },
        body: JSON.stringify({ status, adminNotes: notes }),
      });
      const data = await res.json();
      if (data.success) {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, status, ...(notes !== undefined ? { adminNotes: notes } : {}) } : r
          )
        );
        setEditingNotesId(null);
        showNotification("反馈状态已更新");
      }
    } catch (e: any) {
      alert("更新失败: " + e.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此条反馈记录吗？")) return;
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "DELETE",
        headers: {
          "x-admin-key": adminKey || "",
        },
      });
      const data = await res.json();
      if (data.success) {
        setRecords((prev) => prev.filter((r) => r.id !== id));
        showNotification("反馈记录已删除");
      }
    } catch (e: any) {
      alert("删除失败: " + e.message);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("确定清空所有点赞与纠错反馈记录吗？此操作不可逆！")) return;
    try {
      const res = await fetch("/api/admin/feedback/clear", {
        method: "POST",
        headers: {
          "x-admin-key": adminKey || "",
        },
      });
      const data = await res.json();
      if (data.success) {
        setRecords([]);
        showNotification("所有反馈记录已清空");
      }
    } catch (e: any) {
      alert("清空失败: " + e.message);
    }
  };

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // Filtered records
  const filteredRecords = records.filter((r) => {
    if (filterRating !== "all" && r.rating !== filterRating) return false;
    if (filterStatus !== "all" && (r.status || "pending") !== filterStatus) return false;
    if (searchKeyword.trim()) {
      const kw = searchKeyword.toLowerCase();
      const matchQuery = (r.userQuery || "").toLowerCase().includes(kw);
      const matchAnswer = (r.assistantAnswer || "").toLowerCase().includes(kw);
      const matchComment = (r.comment || "").toLowerCase().includes(kw);
      if (!matchQuery && !matchAnswer && !matchComment) return false;
    }
    return true;
  });

  const likeCount = records.filter((r) => r.rating === "like").length;
  const dislikeCount = records.filter((r) => r.rating === "dislike").length;
  const pendingCount = records.filter((r) => r.rating === "dislike" && (!r.status || r.status === "pending")).length;

  return (
    <div className="space-y-4">
      {/* Top Banner & Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0">
            <ThumbsUp className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-emerald-800 font-medium">回答获赞数</div>
            <div className="text-lg font-bold text-emerald-900">{likeCount} 次</div>
          </div>
        </div>

        <div className="bg-rose-50/80 border border-rose-200 rounded-xl p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-500 text-white flex items-center justify-center shrink-0">
            <ThumbsDown className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-rose-800 font-medium">点踩与纠错反馈</div>
            <div className="text-lg font-bold text-rose-900">{dislikeCount} 次</div>
          </div>
        </div>

        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-amber-800 font-medium">待核对与校准</div>
            <div className="text-lg font-bold text-amber-900">{pendingCount} 条</div>
          </div>
        </div>
      </div>

      {/* Filter and search bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Rating filter */}
          <div className="flex rounded-lg bg-white border border-slate-200 p-0.5">
            <button
              onClick={() => setFilterRating("all")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                filterRating === "all" ? "bg-slate-800 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              全部 ({records.length})
            </button>
            <button
              onClick={() => setFilterRating("dislike")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                filterRating === "dislike" ? "bg-rose-600 text-white" : "text-rose-600 hover:bg-rose-50"
              }`}
            >
              <ThumbsDown className="w-3 h-3" />
              <span>待纠错 ({dislikeCount})</span>
            </button>
            <button
              onClick={() => setFilterRating("like")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                filterRating === "like" ? "bg-emerald-600 text-white" : "text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              <ThumbsUp className="w-3 h-3" />
              <span>赞 ({likeCount})</span>
            </button>
          </div>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 text-xs cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-red-500"
          >
            <option value="all">核准状态: 全部</option>
            <option value="pending">待核准 (Pending)</option>
            <option value="reviewed">已审阅 (Reviewed)</option>
            <option value="corrected">已校正入库 (Corrected)</option>
          </select>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索问答或意见..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-red-500"
            />
          </div>

          <button
            onClick={fetchRecords}
            className="p-1.5 text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
            title="刷新记录列表"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>

          {records.length > 0 && (
            <button
              onClick={handleClearAll}
              className="px-2.5 py-1.5 text-[11px] text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg cursor-pointer transition-colors shrink-0"
              title="清空所有记录"
            >
              清空
            </button>
          )}
        </div>
      </div>

      {notification && (
        <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-1.5 animate-in fade-in">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>{notification}</span>
        </div>
      )}

      {/* Records List */}
      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {isLoading ? (
          <div className="text-center py-10 text-slate-400 text-xs">正在读取用户反馈记录...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            暂无符合条件的反馈记录
          </div>
        ) : (
          filteredRecords.map((item) => {
            const isDislike = item.rating === "dislike";
            const dateStr = new Date(item.createdAt).toLocaleString("zh-CN", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={item.id}
                className={`p-3.5 rounded-xl border text-xs transition-all ${
                  isDislike
                    ? "bg-rose-50/30 border-rose-200/90"
                    : "bg-emerald-50/20 border-emerald-200/80"
                }`}
              >
                {/* Header info */}
                <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                        isDislike ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {isDislike ? <ThumbsDown className="w-3 h-3" /> : <ThumbsUp className="w-3 h-3" />}
                      <span>{isDislike ? "点踩 / 纠错" : "满意点赞"}</span>
                    </span>

                    {item.reason && (
                      <span className="bg-amber-100/70 text-amber-900 px-2 py-0.5 rounded text-[11px] font-medium">
                        {REASON_LABELS[item.reason] || item.reason}
                      </span>
                    )}

                    <span className="text-[11px] text-slate-400">{dateStr}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Status Pill */}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        item.status === "corrected"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : item.status === "reviewed"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {item.status === "corrected"
                        ? "已校准入库"
                        : item.status === "reviewed"
                        ? "已审阅"
                        : "待核对"}
                    </span>

                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 cursor-pointer"
                      title="删除该条记录"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Question & Answer snapshot */}
                <div className="space-y-1.5">
                  <div className="flex items-start gap-1.5">
                    <span className="font-bold text-slate-700 shrink-0">问：</span>
                    <span className="font-semibold text-slate-900">{item.userQuery || "(提问内容缺失)"}</span>
                  </div>

                  <div className="flex items-start gap-1.5 text-slate-600 bg-white/70 p-2 rounded-lg border border-slate-200/60 max-h-24 overflow-y-auto">
                    <span className="font-bold text-slate-400 shrink-0">答：</span>
                    <div className="line-clamp-3 text-[11px] text-slate-700 leading-relaxed">
                      {item.assistantAnswer}
                    </div>
                  </div>

                  {/* User Comment / Error description */}
                  {item.comment && (
                    <div className="mt-2 p-2 bg-amber-50/90 border border-amber-200 rounded-lg flex items-start gap-1.5 text-amber-900">
                      <MessageSquare className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-[11px]">用户纠错说明：</span>
                        <span className="text-[11px] ml-1">{item.comment}</span>
                      </div>
                    </div>
                  )}

                  {/* Admin Notes */}
                  {item.adminNotes && (
                    <div className="p-2 bg-blue-50/70 border border-blue-200 rounded-lg text-[11px] text-blue-900">
                      <span className="font-bold">管理员核准批注：</span> {item.adminNotes}
                    </div>
                  )}
                </div>

                {/* Admin Actions Footer */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span>核准操作：</span>
                    <button
                      onClick={() => handleUpdateStatus(item.id, "reviewed")}
                      disabled={isUpdating}
                      className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
                        item.status === "reviewed"
                          ? "bg-blue-600 text-white border-blue-600 font-medium"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      标记为已审阅
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(item.id, "corrected")}
                      disabled={isUpdating}
                      className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
                        item.status === "corrected"
                          ? "bg-emerald-600 text-white border-emerald-600 font-medium"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-emerald-50"
                      }`}
                    >
                      标记为已校正
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(item.id, "pending")}
                      disabled={isUpdating}
                      className="px-2 py-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100 cursor-pointer"
                    >
                      重置待查
                    </button>
                  </div>

                  <div>
                    {editingNotesId === item.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={notesText}
                          onChange={(e) => setNotesText(e.target.value)}
                          placeholder="填写核实批注/已录入哪个文件..."
                          className="px-2 py-1 bg-white border border-slate-300 rounded text-[11px] w-48 focus:outline-hidden focus:ring-1 focus:ring-red-500"
                        />
                        <button
                          onClick={() => handleUpdateStatus(item.id, item.status || "reviewed", notesText)}
                          className="px-2 py-1 bg-red-600 text-white rounded text-[11px] cursor-pointer"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingNotesId(null)}
                          className="px-1.5 py-1 text-slate-400 hover:text-slate-600 text-[11px] cursor-pointer"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingNotesId(item.id);
                          setNotesText(item.adminNotes || "");
                        }}
                        className="text-[11px] text-red-600 hover:underline cursor-pointer"
                      >
                        {item.adminNotes ? "修改批注" : "+ 添加核准批注"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
