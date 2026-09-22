import React, { useRef, useEffect, useState } from "react";
import { Send, UploadCloud, Sparkles, Loader2 } from "lucide-react";

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
  const [placeholder, setPlaceholder] = useState("向海港队史专家提问...");

  // Responsive placeholder to prevent unwanted multi-line wrapping on mobile screens
  useEffect(() => {
    const updatePlaceholder = () => {
      if (window.innerWidth >= 640) {
        setPlaceholder("向海港历史专家提问（例如：2018年天河5-4决战细节、武磊中超射手纪录、历任主帅）...");
      } else {
        setPlaceholder("向海港队史专家提问...");
      }
    };
    updatePlaceholder();
    window.addEventListener("resize", updatePlaceholder);
    return () => window.removeEventListener("resize", updatePlaceholder);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input, placeholder]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && input.trim()) {
        onSend();
      }
    }
  };

  return (
    <div className="w-full bg-white border border-slate-300 focus-within:border-red-500 rounded-xl sm:rounded-2xl shadow-xs sm:shadow-sm focus-within:shadow-md transition-all">
      <div className="px-2.5 py-1.5 sm:p-3">
        <textarea
          ref={textareaRef}
          id="chat-input-textarea"
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isLoading}
          className="w-full resize-none border-0 bg-transparent text-sm sm:text-base text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-0 leading-relaxed max-h-28 sm:max-h-36 overflow-y-auto"
        />
      </div>

      <div className="px-2.5 py-1 sm:px-3 sm:pb-2.5 sm:pt-1 flex items-center justify-between border-t border-slate-100">
        {/* Left: file upload button (Admin only) or subtle public indicator */}
        <div className="flex items-center gap-1">
          {isAdmin ? (
            <button
              type="button"
              id="btn-input-upload-doc"
              onClick={onOpenKBModal}
              className="flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] sm:text-xs font-medium text-slate-600 hover:text-red-700 bg-slate-50 hover:bg-red-50 rounded-md sm:rounded-lg transition-colors cursor-pointer border border-slate-200/60"
              title="上传海港数据文档扩充知识库"
            >
              <UploadCloud className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-600" />
              <span>导入文档</span>
            </button>
          ) : (
            <span className="flex items-center gap-1 text-[11px] sm:text-xs text-slate-400 select-none">
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-500" />
              <span className="hidden xs:inline sm:inline">知识库精准校验</span>
            </span>
          )}
        </div>

        {/* Right: Enter hint & Send button */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="hidden sm:inline-flex items-center text-[11px] text-slate-400">
            按 Enter 发送，Shift+Enter 换行
          </span>
          <button
            type="button"
            id="btn-send-message"
            disabled={isLoading || !input.trim()}
            onClick={onSend}
            className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-200 text-white disabled:text-slate-400 transition-all shadow-xs disabled:shadow-none cursor-pointer disabled:cursor-not-allowed"
            title="发送提问"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
