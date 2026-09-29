import React, { useState } from "react";
import { X, ThumbsDown, MessageSquare, Check, AlertCircle } from "lucide-react";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  messageId: string;
  userQuery: string;
  assistantAnswer: string;
  retrievedCount?: number;
  retrievalMode?: string;
  onSubmitted: (messageId: string) => void;
}

const REASON_OPTIONS: { key: "incorrect_data" | "incomplete" | "wrong_match" | "hallucination" | "other"; label: string }[] = [
  { key: "incorrect_data", label: "比分/时间/球员等具体数据有误" },
  { key: "wrong_match", label: "查错了比赛或混淆了对手" },
  { key: "incomplete", label: "回答不全 / 遗漏重要信息" },
  { key: "hallucination", label: "答非所问 / 编造不实记录" },
  { key: "other", label: "其他问题 / 有补充意见" },
];

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  onClose,
  messageId,
  userQuery,
  assistantAnswer,
  retrievedCount,
  retrievalMode,
  onSubmitted,
}) => {
  const [selectedReason, setSelectedReason] = useState<"incorrect_data" | "incomplete" | "wrong_match" | "hallucination" | "other">("incorrect_data");
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          userQuery,
          assistantAnswer,
          rating: "dislike",
          reason: selectedReason,
          comment: comment.trim(),
          retrievedCount,
          retrievalMode,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onSubmitted(messageId);
        onClose();
      } else {
        setErrorMessage(data.error || "提交反馈失败，请重试");
      }
    } catch (err: any) {
      setErrorMessage("网络异常，无法提交反馈: " + (err?.message || ""));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-red-600 to-red-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
              <ThumbsDown className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold">纠错与反馈（点踩）</h2>
              <p className="text-[11px] text-red-100">帮助海港队史知识库校准并改进解答</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {/* User question reminder */}
          {userQuery && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">您的问题</div>
              <p className="text-xs text-slate-700 font-medium line-clamp-2">{userQuery}</p>
            </div>
          )}

          {/* Reason selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">请指出该回答存在的问题类型：</label>
            <div className="space-y-1.5 pt-1">
              {REASON_OPTIONS.map((opt) => (
                <label
                  key={opt.key}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    selectedReason === opt.key
                      ? "bg-red-50/70 border-red-300 text-red-900 font-medium"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="feedback-reason"
                    value={opt.key}
                    checked={selectedReason === opt.key}
                    onChange={() => setSelectedReason(opt.key)}
                    className="w-3.5 h-3.5 text-red-600 focus:ring-red-500 border-slate-300"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Optional detailed comment or correct answer */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5 text-red-600" />
              <span>补充纠错说明或正确的队史数据（选填）：</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例如：正确的比分应为2-1，进球球员是武磊不是奥斯卡..."
              rows={3}
              className="w-full text-xs text-slate-800 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all resize-none"
            />
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-slate-300 rounded-xl shadow-xs transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <span>提交中...</span>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>提交反馈记录</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
