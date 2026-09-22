import React, { useState, useEffect } from "react";
import {
  X,
  BookOpen,
  History,
  Shield,
  Layers,
  ChevronRight,
  ExternalLink,
  Sparkles,
  Trophy,
  CheckCircle2,
  HelpCircle,
  Swords,
  Calendar,
} from "lucide-react";
import { ClubAliasRulesData, ClubEraInfo, OpponentAliasInfo, CompetitionAliasInfo } from "../types.js";

interface ClubAliasModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuestion: (question: string) => void;
}

export const ClubAliasModal: React.FC<ClubAliasModalProps> = ({
  isOpen,
  onClose,
  onSelectQuestion,
}) => {
  const [activeTab, setActiveTab] = useState<"eras" | "opponents" | "competitions">("eras");
  const [data, setData] = useState<ClubAliasRulesData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const fetchRules = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/kb/aliases");
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
        }
      } catch (err) {
        console.error("Failed to load alias rules:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchRules();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-red-50/60 via-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center shadow-sm shadow-red-600/30">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  队史名称与常用简称规则库
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800 border border-red-200">
                  内置规则
                </span>
              </div>
              <p className="text-xs text-slate-500">
                支持以任何曾用名、简称提问，系统预设同一性法则与对手映射库全局自动聚合
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="关闭窗口"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Identity Principle Rule Banner */}
        <div className="px-4 sm:px-6 py-3 bg-red-50/80 border-b border-red-100 flex items-start gap-2.5">
          <Shield className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs text-red-950 leading-relaxed">
            <span className="font-bold text-red-900">【俱乐部同一性核心法则】：</span>
            系统已预设规则：<strong className="underline decoration-red-400 font-semibold">上海东亚（含特莱士）= 上海上港 = 上海海港</strong>，均为同一支队伍！
            提问任一名称（如“东亚战绩”、“上港射手榜”、“海港对阵恒大”），系统均会自动跨越队史三大时期全量检索与统筹统计，绝不割裂历史。
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 px-4 sm:px-6 bg-slate-50/60 gap-2">
          <button
            onClick={() => setActiveTab("eras")}
            className={`py-3 px-3.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "eras"
                ? "border-red-600 text-red-600 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <History className="w-4 h-4" />
            <span>队史三大时期演变</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700">
              3个时期
            </span>
          </button>

          <button
            onClick={() => setActiveTab("opponents")}
            className={`py-3 px-3.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "opponents"
                ? "border-red-600 text-red-600 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Swords className="w-4 h-4" />
            <span>对手曾用名与简称对照</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700">
              {data?.opponents?.length || 15}支球队
            </span>
          </button>

          <button
            onClick={() => setActiveTab("competitions")}
            className={`py-3 px-3.5 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "competitions"
                ? "border-red-600 text-red-600 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>赛事简称规范</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loading ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-red-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs">加载规则字典中...</p>
            </div>
          ) : activeTab === "eras" ? (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                <span>
                  💡 <strong>提问提示：</strong>无论提问包含哪一时期的名称，知识库均能精准理解并返回准确数据。点击下方任一问题示例可直接提问。
                </span>
              </div>

              <div className="space-y-3">
                {(data?.eras || []).map((era) => (
                  <div
                    key={era.eraId}
                    className="p-4 rounded-xl border border-slate-200 bg-white hover:border-red-200 transition-shadow shadow-xs space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span>
                        <h3 className="text-sm sm:text-base font-bold text-slate-900">
                          {era.canonicalName}
                        </h3>
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                          {era.shortName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{era.timeRange}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      {era.description}
                    </p>

                    {/* Aliases Pills */}
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                        <span>支持的简称与常用别名：</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {era.aliases.map((alias) => (
                          <span
                            key={alias}
                            className="px-2 py-0.5 rounded-md text-xs bg-slate-100 text-slate-800 border border-slate-200/80"
                          >
                            {alias}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Major Honors */}
                    {era.majorHonors && era.majorHonors.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200/60 text-xs space-y-1 text-amber-950">
                        <div className="font-semibold flex items-center gap-1 text-amber-900 text-[11px]">
                          <Trophy className="w-3 h-3 text-amber-600" />
                          <span>该时期主要荣誉：</span>
                        </div>
                        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-900/90">
                          {era.majorHonors.map((honor, idx) => (
                            <li key={idx}>{honor}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Sample Questions */}
                    <div className="pt-1 space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-red-500" />
                        <span>该时期典型提问示例（点击立即提问）：</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {era.sampleQuestions.map((q, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              onSelectQuestion(q);
                              onClose();
                            }}
                            className="text-left px-2.5 py-1 text-xs bg-red-50/60 hover:bg-red-100/80 text-red-700 hover:text-red-900 border border-red-200/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <span>{q}</span>
                            <ChevronRight className="w-3 h-3 text-red-400 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : activeTab === "opponents" ? (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
                <span>
                  💡 <strong>对手曾用名映射法则：</strong>
                  当您提问“对阵山东泰山”时，系统会自动将历史上对阵“山东鲁能”、“山东鲁能泰山”的场次全部并入统计；
                  提问“对阵广州队”或“广州恒大”时，也会无缝合并所有历史交锋。
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(data?.opponents || []).map((opp) => (
                  <div
                    key={opp.canonicalName}
                    className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-red-200 transition-colors shadow-2xs space-y-2 flex flex-col justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{opp.canonicalName}</span>
                          <span className="text-[11px] font-normal text-slate-500">
                            ({opp.cityOrRegion})
                          </span>
                        </h4>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {opp.allKeywords.length}个别名识别
                        </span>
                      </div>

                      <div className="text-xs space-y-1">
                        <div className="flex items-center gap-1 text-[11px] text-slate-500">
                          <span className="font-semibold">曾用名/别名：</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {opp.allKeywords.map((kw) => (
                            <span
                              key={kw}
                              className={`px-1.5 py-0.2 rounded text-[11px] ${
                                kw === opp.canonicalName
                                  ? "bg-red-50 text-red-700 font-semibold border border-red-200"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <button
                        onClick={() => {
                          onSelectQuestion(opp.sampleQuestion);
                          onClose();
                        }}
                        className="w-full text-left text-xs font-medium text-red-600 hover:text-red-800 hover:underline flex items-center justify-between group cursor-pointer"
                        title="点击提问与该对手的交手战绩"
                      >
                        <span className="truncate">{opp.sampleQuestion}</span>
                        <ChevronRight className="w-3.5 h-3.5 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
                <span>
                  💡 <strong>赛事简称对照：</strong>
                  提问时无需输入赛事全称（如“中国足球协会超级联赛”），直接输入“中超”、“足协杯”、“亚冠”、“超级杯”即可精准定位。
                </span>
              </div>

              <div className="space-y-2.5">
                {(data?.competitions || []).map((comp) => (
                  <div
                    key={comp.canonicalName}
                    className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-red-200 transition-colors shadow-2xs space-y-2"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-amber-500" />
                        <h4 className="text-sm font-bold text-slate-900">
                          {comp.canonicalName}
                        </h4>
                        <span className="text-xs text-slate-400">
                          ({comp.englishName})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500 font-medium">支持简称：</span>
                        {comp.shortNames.map((s) => (
                          <span
                            key={s}
                            className="px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {comp.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>所有规则已内置于知识库检索与统计聚合引擎，随时可提问。</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            完成了解，开始提问
          </button>
        </div>
      </div>
    </div>
  );
};
