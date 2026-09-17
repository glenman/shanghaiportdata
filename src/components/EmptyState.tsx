import React from "react";
import { ShieldCheck, Database, Search, Trophy, Sparkles, UploadCloud, FileCheck, ArrowRight } from "lucide-react";
import { PresetQuestions } from "./PresetQuestions.js";
import { KnowledgeBaseStats } from "../types.js";

interface EmptyStateProps {
  stats: KnowledgeBaseStats | null;
  onSelectQuestion: (q: string) => void;
  onOpenKBModal: () => void;
  isAdmin?: boolean;
  logoVersion?: number;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  stats,
  onSelectQuestion,
  onOpenKBModal,
  isAdmin = false,
  logoVersion = 0,
}) => {
  const isKBEmpty = !stats || stats.totalDocuments === 0;

  return (
    <div className="py-6 sm:py-10 max-w-3xl mx-auto text-center space-y-8 animate-fade-in">
      {/* Club Crest & Hero Badge */}
      <div className="flex flex-col items-center gap-3.5">
        <div className="w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center">
          <img
            src={`/shanghaiport-logo.png?v=${logoVersion}`}
            alt="上海海港队徽"
            className="w-full h-full object-contain"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-semibold shadow-2xs">
          <Sparkles className="w-3.5 h-3.5 text-red-600" />
          <span>基于 LangChain 向量数据库的内部数据检索与防幻觉问答</span>
        </div>
      </div>

      {/* Hero Title */}
      <div className="space-y-3">
        <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          上海海港足球俱乐部
          <span className="text-red-600 block sm:inline sm:ml-2">历史数据专家</span>
        </h2>
        <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto leading-relaxed">
          严格结合海港队史数据文档进行严谨检索与记录溯源，绝不臆造未收录的比分或虚构数据。
        </p>
      </div>

      {/* Dynamic Status / Upload Notice Card */}
      {isAdmin ? (
        isKBEmpty ? (
          <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-50/80 via-white to-red-50/40 border border-amber-200 shadow-sm text-left flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-lg">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                <h3 className="text-sm font-bold text-slate-900">
                  【管理员】知识库当前为空，请上传海港历史数据文件
                </h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                系统严格遵循“防幻觉与真实数据溯源”原则，问答完全依赖您上传的数据文件（支持 .txt / .md / .csv / .json）。请上传您的海港历史数据文件以建立专属知识库。
              </p>
            </div>
            <button
              onClick={onOpenKBModal}
              className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <UploadCloud className="w-4 h-4" />
              <span>立即导入数据文档</span>
            </button>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-left flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                <FileCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-900">
                  【管理员】知识库已载入 {stats.totalDocuments} 份数据文件，构建了 {stats.totalChunks} 个向量切片
                </p>
                <p className="text-[11px] text-emerald-700">
                  问答将完全且严格基于已上传文件进行出处溯源与防幻觉验证。
                </p>
              </div>
            </div>
            <button
              onClick={onOpenKBModal}
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 flex items-center gap-1 cursor-pointer"
            >
              <span>管理知识库文件</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      ) : (
        !isKBEmpty && (
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-left flex items-center gap-3 max-w-xl mx-auto shadow-2xs">
            <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
              <FileCheck className="w-4 h-4" />
            </div>
            <div className="text-xs text-slate-600">
              <span className="font-semibold text-slate-800">已就绪海港队史知识库</span>
              <span className="text-slate-400 mx-1.5">·</span>
              <span>所有回答均基于真实比赛记录与技术统计，提供出处标注</span>
            </div>
          </div>
        )
      )}

      {/* 3 Core Architecture Pillars */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
        <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:border-red-200 transition-all group">
          <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mb-2.5 group-hover:bg-red-600 group-hover:text-white transition-colors">
            <Database className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-slate-900 mb-1">
            权威队史数据驱动
          </h3>
          <p className="text-[11px] text-slate-500 leading-normal">
            基于俱乐部历史经典战报、球员技术档案与赛季纪录，支持高精度向量检索。
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:border-red-200 transition-all group">
          <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mb-2.5 group-hover:bg-red-600 group-hover:text-white transition-colors">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-slate-900 mb-1">
            严谨防幻觉机制
          </h3>
          <p className="text-[11px] text-slate-500 leading-normal">
            若上传文件中未检索到相关内容，系统将明确告知查无此项，绝不凭空捏造比分或球员。
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:border-red-200 transition-all group">
          <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mb-2.5 group-hover:bg-red-600 group-hover:text-white transition-colors">
            <Search className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-slate-900 mb-1">
            出处与比赛记录精准溯源
          </h3>
          <p className="text-[11px] text-slate-500 leading-normal">
            回答清晰标注来源于哪份已上传文件及具体比赛记录（日期、对阵双方、比分与进球人）。
          </p>
        </div>
      </div>

      {/* Preset Questions section */}
      <div className="pt-2">
        <PresetQuestions onSelectQuestion={onSelectQuestion} />
      </div>
    </div>
  );
};
