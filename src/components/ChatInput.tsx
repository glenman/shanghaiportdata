import React, { useRef, useEffect } from "react";
import { Send, UploadCloud, CornerDownLeft, Sparkles, Loader2 } from "lucide-react";

interface ChatInputProps {
  input: string;
  onChange: (val: string) => void;
  onSend: () => void;
  isLoading: boolean;
  onOpenKBModal: () => void;
  isAdmin?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  input,
  onChange,
  onSend,
  isLoading,
  onOpenKBModal,
  isAdmin = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && input.trim()) {
        onSend();
      }
    }
  };

  return (
    <div className="w-full bg-white border border-slate-300 focus-within:border-red-500 rounded-2xl shadow-sm focus-within:shadow-md transition-all">
      <div className="p-3">
        <textarea
          ref={textareaRef}
          id="chat-input-textarea"
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="向海港历史专家提问（例如：2018年天河5-4决战细节、武磊中超射手纪录、历任主帅）..."
          rows={1}
          disabled={isLoading}
          className="w-full resize-none border-0 bg-transparent text-sm sm:text-base text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-0 leading-relaxed max-h-40 overflow-y-auto"
        />
      </div>

      <div className="px-3 pb-2.5 pt-1 flex items-center justify-between border-t border-slate-100">
        {/* Left: file upload button (Admin only) or subtle public indicator */}
        <div className="flex items-center gap-1">
          {isAdmin ? (
            <button
              type="button"
              id="btn-input-upload-doc"
              onClick={onOpenKBModal}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-red-700 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors cursor-pointer border border-slate-200/60"
              title="上传海港数据文档扩充知识库"
            >
              <UploadCloud className="w-3.5 h-3.5 text-red-600" />
              <span className="hidden sm:inline">导入数据文档</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 select-none">
              <Sparkles className="w-3.5 h-3.5 text-red-500" />
              <span className="hidden sm:inline">纯净 AI 问答 · 严谨数据溯源</span>
            </span>
          )}
        </div>

        {/* Right: Enter hint & Send button */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center text-[11px] text-slate-400">
            按 Enter 发送，Shift+Enter 换行
          </span>
          <button
            type="button"
            id="btn-send-message"
            disabled={isLoading || !input.trim()}
            onClick={onSend}
            className="flex items-center justify-center w-8 h-8 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-200 text-white disabled:text-slate-400 transition-all shadow-xs disabled:shadow-none cursor-pointer disabled:cursor-not-allowed"
            title="发送提问"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
