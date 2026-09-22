import React from "react";
import { Database, Trash2, Trophy, UploadCloud, Lock, Unlock, LogOut, BookOpen } from "lucide-react";
import { KnowledgeBaseStats } from "../types.js";

interface HeaderProps {
  stats: KnowledgeBaseStats | null;
  isAdmin: boolean;
  onOpenKBModal: () => void;
  onOpenAliasModal: () => void;
  onClearChat: () => void;
  onOpenAdminLogin: () => void;
  onLogoutAdmin: () => void;
  messageCount: number;
  logoVersion?: number;
}

export const Header: React.FC<HeaderProps> = ({
  stats,
  isAdmin,
  onOpenKBModal,
  onOpenAliasModal,
  onClearChat,
  onOpenAdminLogin,
  onLogoutAdmin,
  messageCount,
  logoVersion = 0,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-rose-100 shadow-xs">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand & Identity */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={isAdmin ? onOpenKBModal : onOpenAdminLogin}
            className="w-10 h-10 flex items-center justify-center shrink-0 group cursor-pointer"
            title={isAdmin ? "点击更换队徽图片或管理知识库" : "上海海港足球俱乐部队徽"}
          >
            <img
              src={`/shanghaiport-logo.png?v=${logoVersion}`}
              alt="上海海港足球俱乐部队徽"
              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
              referrerPolicy="no-referrer"
            />
          </button>

          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                上海海港足球俱乐部
                <span className="text-red-600 font-extrabold">历史数据专家</span>
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                Shanghai Port FC
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-500">
              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                LangChain 向量检索
              </span>
              <span className="text-slate-300">•</span>
              <span className="hidden md:inline text-slate-500">
                {stats && stats.totalDocuments > 0
                  ? `队史知识库已挂载 (${stats.totalDocuments} 份文档 / ${stats.totalChunks} 切片)`
                  : "队史数据库智能检索已就绪"}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          {/* Rules & Alias Dictionary Button (Available to all users) */}
          <button
            id="btn-open-alias-modal"
            onClick={onOpenAliasModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-slate-700 hover:text-red-700 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded-lg transition-colors cursor-pointer"
            title="查看队史名称（东亚/上港/海港/特莱士）同一性规则与简称对照库"
          >
            <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-600" />
            <span className="hidden sm:inline">队史名称与简称库</span>
            <span className="sm:hidden">简称库</span>
          </button>

          {/* Admin Controls (Only visible to authenticated admin) */}
          {isAdmin ? (
            <>
              {/* Admin status pill */}
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg text-xs font-bold shadow-2xs">
                <Unlock className="w-3.5 h-3.5 text-amber-600" />
                <span className="hidden sm:inline">管理员模式</span>
              </span>

              {/* Knowledge Base Modal Button */}
              <button
                id="btn-open-kb-modal"
                onClick={onOpenKBModal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 hover:text-red-700 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded-lg transition-colors cursor-pointer"
                title="管理海港数据文档与向量库"
              >
                <Database className="w-4 h-4 text-red-600" />
                <span className="hidden sm:inline">知识库管理</span>
                <span className="px-1.5 py-0.2 bg-red-100 text-red-800 rounded-full text-[11px] font-bold">
                  {stats?.totalDocuments || 0}
                </span>
              </button>

              {/* Upload shortcut button */}
              <button
                id="btn-quick-upload"
                onClick={onOpenKBModal}
                className="flex items-center gap-1 px-3 py-1.5 text-xs sm:text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-xs shadow-red-600/30 cursor-pointer"
                title="上传海港历史数据文件"
              >
                <UploadCloud className="w-4 h-4" />
                <span className="hidden sm:inline">导入数据</span>
              </button>

              {/* Exit admin mode */}
              <button
                id="btn-logout-admin"
                onClick={onLogoutAdmin}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-lg transition-colors cursor-pointer"
                title="退出管理员模式，切回公众普通视图"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden md:inline">退出</span>
              </button>
            </>
          ) : (
            <>
              {/* Subtle Admin Entrance for authorized manager */}
              <button
                id="btn-admin-login-entrance"
                onClick={onOpenAdminLogin}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="管理员登录入口"
                aria-label="管理员登录"
              >
                <Lock className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Clear history */}
          {messageCount > 0 && (
            <button
              id="btn-clear-chat"
              onClick={onClearChat}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
              title="清空当前对话记录"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
