import React, { useState, useEffect, useRef } from "react";
import { Header } from "./components/Header.js";
import { ChatMessageItem } from "./components/ChatMessageItem.js";
import { ChatInput } from "./components/ChatInput.js";
import { EmptyState } from "./components/EmptyState.js";
import { KnowledgeBaseModal } from "./components/KnowledgeBaseModal.js";
import { AdminLoginModal } from "./components/AdminLoginModal.js";
import { PresetQuestions } from "./components/PresetQuestions.js";
import { ChatMessage, KnowledgeBaseStats } from "./types.js";
import { Sparkles, ChevronDown } from "lucide-react";

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [kbStats, setKbStats] = useState<KnowledgeBaseStats | null>(null);
  const [isKBModalOpen, setIsKBModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [showPresetBar, setShowPresetBar] = useState(false);
  const [logoVersion, setLogoVersion] = useState<number>(() => Date.now());

  // Admin authentication state
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      return localStorage.getItem("haigang_admin_auth") === "true";
    } catch {
      return false;
    }
  });

  const [adminKey, setAdminKey] = useState<string | null>(() => {
    try {
      return localStorage.getItem("haigang_admin_key");
    } catch {
      return null;
    }
  });

  const handleAdminLoginSuccess = (key: string) => {
    setIsAdmin(true);
    setAdminKey(key);
    try {
      localStorage.setItem("haigang_admin_auth", "true");
      localStorage.setItem("haigang_admin_key", key);
    } catch (e) {
      console.warn("Storage error", e);
    }
    setIsKBModalOpen(true);
  };

  const handleLogoutAdmin = () => {
    setIsAdmin(false);
    setAdminKey(null);
    try {
      localStorage.removeItem("haigang_admin_auth");
      localStorage.removeItem("haigang_admin_key");
    } catch (e) {
      console.warn("Storage error", e);
    }
    setIsKBModalOpen(false);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch Knowledge Base stats on load
  const fetchStats = async () => {
    try {
      const res = await fetch("/api/kb/stats");
      const data = await res.json();
      if (data.success) {
        setKbStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to fetch knowledge base stats:", err);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Auto-scroll when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Send message handler
  const handleSendMessage = async (queryText?: string) => {
    const textToSend = (queryText || input).trim();
    if (!textToSend || isLoading) return;

    setInput("");

    // Create user message
    const userMsgId = `user_${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: textToSend,
      timestamp: Date.now(),
    };

    // Temporary placeholder for assistant thinking
    const assistantMsgId = `assistant_${Date.now() + 1}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isThinking: true,
    };

    const newMessages = [...messages, userMessage, assistantPlaceholder];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Build conversation history payload
      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          history: historyPayload,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: data.answer,
                  sources: data.sources,
                  retrievedCount: data.retrievedCount,
                  isThinking: false,
                }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: "抱歉，检索处理出现错误。",
                  error: data.error || "请求失败",
                  isThinking: false,
                }
              : m
          )
        );
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: "请求发送遇到网络问题，请稍后重试。",
                error: err.message || "网络异常",
                isThinking: false,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    if (window.confirm("确定要清空当前所有对话历史吗？")) {
      setMessages([]);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-red-200 selection:text-red-900">
      {/* Top Header */}
      <Header
        stats={kbStats}
        isAdmin={isAdmin}
        onOpenKBModal={() => setIsKBModalOpen(true)}
        onClearChat={handleClearChat}
        onOpenAdminLogin={() => setIsAdminModalOpen(true)}
        onLogoutAdmin={handleLogoutAdmin}
        messageCount={messages.length}
        logoVersion={logoVersion}
      />

      {/* Main Conversation Container */}
      <main className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-4 sm:px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center">
            <EmptyState
              stats={kbStats}
              isAdmin={isAdmin}
              onSelectQuestion={(q) => handleSendMessage(q)}
              onOpenKBModal={() => setIsKBModalOpen(true)}
              logoVersion={logoVersion}
            />
          </div>
        ) : (
          <div className="flex-1 space-y-4 pb-4 overflow-y-auto">
            {messages.map((msg) => (
              <ChatMessageItem key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Floating Bottom Input Area */}
      <footer className="sticky bottom-0 z-20 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent pt-3 pb-4">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-2.5">
          {/* Collapsible hot questions drawer when in active chat */}
          {messages.length > 0 && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <button
                onClick={() => setShowPresetBar(!showPresetBar)}
                className="flex items-center gap-1 hover:text-red-600 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-red-500" />
                <span>{showPresetBar ? "收起预设热点问题" : "展开预设热点问题速查"}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showPresetBar ? "rotate-180" : ""}`} />
              </button>

              <span className="text-[11px] text-slate-400">
                已启用 RAG 溯源检索与防幻觉校对
              </span>
            </div>
          )}

          {showPresetBar && messages.length > 0 && (
            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm animate-fade-in">
              <PresetQuestions
                onSelectQuestion={(q) => {
                  handleSendMessage(q);
                  setShowPresetBar(false);
                }}
                disabled={isLoading}
              />
            </div>
          )}

          {/* Main Input Component */}
          <ChatInput
            input={input}
            onChange={setInput}
            onSend={() => handleSendMessage()}
            isLoading={isLoading}
            onOpenKBModal={() => setIsKBModalOpen(true)}
            isAdmin={isAdmin}
          />

          <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
            <span>上海海港足球俱乐部历史数据专家 · 内部知识库严谨校验 · 数据仅供球迷与研究参考</span>
            <span>·</span>
            {isAdmin ? (
              <button
                onClick={handleLogoutAdmin}
                className="text-amber-700 hover:text-amber-900 hover:underline cursor-pointer font-medium"
              >
                退出管理
              </button>
            ) : (
              <button
                onClick={() => setIsAdminModalOpen(true)}
                className="text-slate-400 hover:text-slate-600 hover:underline cursor-pointer"
              >
                管理员入口
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Admin Login Modal */}
      <AdminLoginModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        onLoginSuccess={handleAdminLoginSuccess}
      />

      {/* Knowledge Base Modal (Admin Only) */}
      <KnowledgeBaseModal
        isOpen={isKBModalOpen}
        onClose={() => setIsKBModalOpen(false)}
        stats={kbStats}
        onRefreshStats={fetchStats}
        adminKey={adminKey}
        onLogoUpdated={() => setLogoVersion(Date.now())}
      />
    </div>
  );
}
