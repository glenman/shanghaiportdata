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

/**
 * Strips out any trailing citation/source or record reference sections
 */
function cleanDisplayContent(content: string): string {
  if (!content) return "";
  let cleaned = content;
  // Remove trailing citation sections (e.g. ### 数据出处, 【检索引用的数据出处】, 查看引据, 比赛记录引据)
  cleaned = cleaned.replace(
    /\n*(?:---+|\*\*\*+)?\s*(?:###?\s*|\*\*|【)?\s*(?:检索引用的数据出处|数据出处|参考出处|引据来源|查看引据|引用出处|比赛记录引据|引用数据来源|参考比赛记录|引用的比赛记录|数据来源|来源文件)[^:\n]*[:：】\*\s]*[\s\S]*$/i,
    ""
  );
  // Remove individual source item bullet lines
  cleaned = cleaned.replace(/^[*-]\s*(?:来源文件|数据出处|查看引据|引据记录|参考文件)[:：].*$/gmi, "");
  return cleaned.trim();
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({ message }) => {
  const [copied, setCopied] = useState(false);

  const isUser = message.role === "user";

  const displayContent = cleanDisplayContent(message.content);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent);
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
          <div className="px-4 py-2 bg-slate-50/60 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-red-600" />
              <span>海港历史数据专家</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                title="复制回答"
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
                <span>正在查询海港数据库并生成解答...</span>
              </div>
            ) : message.error ? (
              <div className="flex items-start gap-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm border border-red-100">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{message.error}</span>
              </div>
            ) : (
              <div className="markdown-body text-sm leading-relaxed [&>*:last-child]:mb-0">
                <Markdown remarkPlugins={[remarkGfm]}>{displayContent}</Markdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
