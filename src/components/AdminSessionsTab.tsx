import React, { useState, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MessageSquare,
  Search,
  Trash2,
  ThumbsUp,
  ThumbsDown,
  LogIn,
  LogOut,
  ShieldAlert,
  Loader2,
  User as UserIcon,
  Bot,
  Clock,
  FileText,
  ChevronLeft,
  AlertCircle,
} from "lucide-react";
import { useFirebase, ADMIN_GOOGLE_EMAIL } from "../contexts/FirebaseContext.js";
import {
  subscribeToAllSessions,
  subscribeToSessionMessages,
  deleteChatSession,
} from "../services/chatHistoryService.js";
import { ChatMessage, ChatSessionRecord } from "../types.js";

function cleanDisplayContent(content: string): string {
  if (!content) return "";
  let cleaned = content;
  cleaned = cleaned.replace(
    /\n*(?:---+|\*\*\*+)?\s*(?:###?\s*|\*\*|【)?\s*(?:检索引用的数据出处|数据出处|参考出处|引据来源|查看引据|引用出处|比赛记录引据|引用数据来源|参考比赛记录|引用的比赛记录|数据来源|来源文件)[^:\n]*[:：】\*\s]*[\s\S]*$/i,
    ""
  );
  cleaned = cleaned.replace(/^[*-]\s*(?:来源文件|数据出处|查看引据|引据记录|参考文件)[:：].*$/gmi, "");
  return cleaned.trim();
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const AdminSessionsTab: React.FC = () => {
  const { user, authLoading, isAdminAuthorized, authError, loginWithGoogle, logout } =
    useFirebase();

  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [asyncError, setAsyncError] = useState<Error | null>(null);

  // Subscribe to all chat sessions ONLY when authorized as admin
  useEffect(() => {
    if (!isAdminAuthorized) {
      setSessions([]);
      setSelectedSessionId(null);
      setMessages([]);
      return;
    }

    setSessionsLoading(true);
    const unsubscribe = subscribeToAllSessions(
      (list) => {
        setSessions(list);
        setSessionsLoading(false);
        setSelectedSessionId((prev) => {
          if (prev && list.some((s) => s.id === prev)) return prev;
          return list.length > 0 ? list[0].id : null;
        });
      },
      (err) => {
        setSessionsLoading(false);
        setAsyncError(err);
      }
    );

    return () => unsubscribe();
  }, [isAdminAuthorized]);

  // Subscribe to selected session messages ONLY when authorized as admin
  useEffect(() => {
    if (!isAdminAuthorized || !selectedSessionId) {
      setMessages([]);
      return;
    }

    setMessagesLoading(true);
    const unsubscribe = subscribeToSessionMessages(
      selectedSessionId,
      (msgs) => {
        setMessages(msgs);
        setMessagesLoading(false);
      },
      (err) => {
        setMessagesLoading(false);
        setAsyncError(err);
      }
    );

    return () => unsubscribe();
  }, [isAdminAuthorized, selectedSessionId]);

  if (asyncError) {
    throw asyncError;
  }

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(sessionId);
    try {
      await deleteChatSession(sessionId);
      setConfirmDeleteId(null);
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setMessages([]);
      }
    } catch (err) {
      setAsyncError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setDeletingId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-red-600" />
        <span>正在检查管理员云端授权状态...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-8 px-4 text-center space-y-4 bg-slate-50/70 rounded-2xl border border-slate-200">
        <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
          <MessageSquare className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-md mx-auto">
          <h3 className="text-sm font-bold text-slate-900">云端会话记录（仅管理员可查）</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            所有访客对话均加密保存于 Firestore 且不对公众开放。请使用管理员 Google 账号（
            <span className="font-mono text-slate-800">{ADMIN_GOOGLE_EMAIL}</span>
            ）授权后查阅历史会话。
          </p>
        </div>
        {authError && (
          <div className="max-w-sm mx-auto p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
            {authError}
          </div>
        )}
        <button
          type="button"
          onClick={loginWithGoogle}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
        >
          <LogIn className="w-4 h-4" />
          <span>使用管理员 Google 账号授权查看</span>
        </button>
      </div>
    );
  }

  if (!isAdminAuthorized) {
    return (
      <div className="py-8 px-4 text-center space-y-4 bg-rose-50/50 rounded-2xl border border-rose-200">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-md mx-auto">
          <h3 className="text-sm font-bold text-slate-900">当前 Google 账号无管理员读取权限</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            当前登录账号为 <span className="font-mono font-semibold">{user.email}</span>。会话记录仅限管理员账号{" "}
            <span className="font-mono font-semibold">{ADMIN_GOOGLE_EMAIL}</span> 查阅。
          </p>
        </div>
        <div className="flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={async () => {
              await logout();
              await loginWithGoogle();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>切换管理员账号</span>
          </button>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>退出</span>
          </button>
        </div>
      </div>
    );
  }

  const filteredSessions = sessions.filter((s) => {
    if (!searchKeyword.trim()) return true;
    const kw = searchKeyword.toLowerCase();
    return (
      s.title.toLowerCase().includes(kw) ||
      s.lastMessagePreview.toLowerCase().includes(kw)
    );
  });

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || null;

  return (
    <div className="space-y-3">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">共 {sessions.length} 个会话</span>
          <span className="text-slate-300">|</span>
          <span className="text-[11px] text-slate-500 truncate max-w-[180px]">
            已授权: {user.email}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索会话主题或内容..."
              className="w-full pl-8 pr-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-red-500"
            />
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-slate-500 hover:text-red-700 hover:bg-rose-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
            title="退出管理员 Google 授权"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>断开授权</span>
          </button>
        </div>
      </div>

      {/* Master-Detail Session Viewer */}
      {sessionsLoading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin text-red-600" />
          <span>正在加载云端会话记录...</span>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
          {sessions.length === 0 ? "暂无记录的用户会话" : "没有匹配搜索关键词的会话"}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 h-[52vh] min-h-[340px]">
          {/* Sessions List */}
          <div
            className={`md:col-span-5 border border-slate-200 rounded-xl bg-slate-50/40 overflow-y-auto divide-y divide-slate-100 ${
              selectedSession ? "hidden md:block" : "block"
            }`}
          >
            {filteredSessions.map((session) => {
              const isSelected = session.id === selectedSessionId;
              const isConfirming = confirmDeleteId === session.id;
              const isDeleting = deletingId === session.id;

              return (
                <div
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  className={`p-3 cursor-pointer transition-colors ${
                    isSelected ? "bg-red-50/90 border-l-2 border-l-red-600" : "hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`text-xs font-semibold line-clamp-1 ${
                        isSelected ? "text-red-800" : "text-slate-800"
                      }`}
                    >
                      {session.title}
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {formatDateTime(session.updatedAtMs)}
                    </span>
                  </div>

                  {session.lastMessagePreview && (
                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-1">
                      {session.lastMessagePreview}
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {session.messageCount} 条消息
                    </span>

                    {isConfirming ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={(e) => handleDeleteSession(session.id, e)}
                          className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px] font-medium hover:bg-red-700 cursor-pointer"
                        >
                          {isDeleting ? "删除中" : "确认删除"}
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-1.5 py-0.5 text-slate-500 hover:bg-slate-200 rounded text-[10px] cursor-pointer"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(session.id);
                        }}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                        title="删除此会话记录"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Session Transcript Detail */}
          <div
            className={`md:col-span-7 border border-slate-200 rounded-xl bg-white flex flex-col overflow-hidden ${
              selectedSession ? "flex" : "hidden md:flex"
            }`}
          >
            {!selectedSession ? (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                请从左侧选择一个会话查看完整对话内容
              </div>
            ) : (
              <>
                <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedSessionId(null)}
                      className="md:hidden p-1 text-slate-500 hover:bg-slate-200 rounded cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {selectedSession.title}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        创建于 {formatDateTime(selectedSession.createdAtMs)} · 共{" "}
                        {messages.length} 条记录
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/30">
                  {messagesLoading ? (
                    <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                      <span>加载会话详情...</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      该会话暂无消息记录
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isUser = msg.role === "user";
                      return (
                        <div
                          key={msg.id}
                          className={`rounded-xl p-2.5 border text-xs space-y-1.5 ${
                            isUser
                              ? "bg-red-50/70 border-red-200/80 ml-4"
                              : "bg-white border-slate-200 mr-2"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 font-semibold">
                              {isUser ? (
                                <>
                                  <UserIcon className="w-3.5 h-3.5 text-red-600" />
                                  <span className="text-red-800">访客提问</span>
                                </>
                              ) : (
                                <>
                                  <Bot className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-slate-800">专家回答</span>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {msg.feedback === "like" && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-medium">
                                  <ThumbsUp className="w-2.5 h-2.5" />
                                  赞
                                </span>
                              )}
                              {msg.feedback === "dislike" && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-medium">
                                  <ThumbsDown className="w-2.5 h-2.5" />
                                  踩
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400">
                                {formatDateTime(msg.timestamp)}
                              </span>
                            </div>
                          </div>

                          {isUser ? (
                            <div className="text-slate-800 whitespace-pre-wrap leading-relaxed break-words text-xs">
                              {msg.content}
                            </div>
                          ) : msg.error ? (
                            <div className="flex items-start gap-2 p-2.5 bg-red-50 text-red-800 rounded-lg text-xs border border-red-100">
                              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                              <span>{msg.error}</span>
                            </div>
                          ) : (
                            <div className="markdown-body text-xs sm:text-[13px] leading-relaxed [&>*:last-child]:mb-0">
                              <Markdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  table: ({ node, ...props }) => (
                                    <div className="markdown-table-wrapper overflow-x-auto my-2.5 border border-slate-200 rounded-lg shadow-2xs">
                                      <table {...props} className="min-w-full border-collapse text-left" />
                                    </div>
                                  ),
                                  th: ({ node, ...props }) => (
                                    <th
                                      {...props}
                                      className="bg-red-50 text-red-900 font-semibold px-2.5 py-1.5 text-xs border border-slate-200 whitespace-nowrap"
                                    />
                                  ),
                                  td: ({ node, ...props }) => (
                                    <td
                                      {...props}
                                      className="px-2.5 py-1.5 text-xs border border-slate-200 whitespace-nowrap"
                                    />
                                  ),
                                }}
                              >
                                {cleanDisplayContent(msg.content)}
                              </Markdown>
                            </div>
                          )}

                          {!isUser && msg.sources && msg.sources.length > 0 && (
                            <div className="pt-1.5 border-t border-slate-100 flex flex-wrap gap-1">
                              {msg.sources.slice(0, 4).map((src, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] max-w-[180px] truncate"
                                  title={src.title}
                                >
                                  <FileText className="w-2.5 h-2.5 shrink-0" />
                                  <span className="truncate">{src.title}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
