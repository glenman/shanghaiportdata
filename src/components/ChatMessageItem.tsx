import React, { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  Copy,
  ShieldCheck,
  Trophy,
  User,
  AlertCircle
} from "lucide-react";
import { ChatMessage } from "../types.js";

interface ChatMessageItemProps {
  message: ChatMessage;
  onSelectTag?: (tag: string) => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({ message }) => {
  const [copied, setCopied] = useState(false);

  const isUser = message.role === "user";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-2xl flex items-start gap-2.5">
          <div className="bg-red-600 text-white px-4 py-3 rounded-2xl rounded-tr-xs shadow-xs text-sm leading-relaxed">
            <p className="whitespace-pre-wrap font-normal">{message.content}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0 border border-red-200">
            <User className="w-4 h-4" />
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start mb-6">
      <div className="max-w-3xl w-full flex items-start gap-3">
        {/* Port FC Eagle Avatar */}
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-800 text-white flex items-center justify-center shrink-0 shadow-xs border border-red-400/40 relative">
          <Trophy className="w-4 h-4 text-amber-300" />
          <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white"></span>
        </div>

        {/* Message Bubble Card */}
        <div className="flex-1 bg-white rounded-2xl rounded-tl-xs border border-slate-200/90 shadow-xs overflow-hidden">
          {/* Header bar */}
          <div className="px-4 py-2 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-red-600" />
              <span>海港历史数据专家</span>
              <span className="text-slate-300">|</span>
              {message.retrievalMode === "json_full_context" ? (
                <span className="text-[11px] text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 font-medium">
                  原生 JSON 结构化全量解析
                </span>
              ) : (
                <span className="text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-100 font-medium">
                  知识库向量精确验证
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                title="复制完整回答"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-[11px] text-emerald-600">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span className="text-[11px]">复制</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-4 sm:p-5">
            {message.isThinking ? (
              <div className="flex items-center space-x-3 py-4 text-slate-500 text-sm">
                <div className="flex space-x-1">
                  <span className="w-2 h-2 rounded-full bg-red-600 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                  <span className="w-2 h-2 rounded-full bg-red-600 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                  <span className="w-2 h-2 rounded-full bg-red-600 animate-bounce" style={{ animationDelay: "300ms" }}></span>
                </div>
                <span>正在检索海港数据库并进行事实比对与统计计算...</span>
              </div>
            ) : message.error ? (
              <div className="flex items-start gap-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm border border-red-100">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{message.error}</span>
              </div>
            ) : (
              <div className="markdown-body">
                <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
