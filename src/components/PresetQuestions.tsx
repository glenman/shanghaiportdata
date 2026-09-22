import React from "react";
import { Award, Flame, History, Sparkles, Target, Users } from "lucide-react";
import { PresetQuestion } from "../types.js";

interface PresetQuestionsProps {
  onSelectQuestion: (question: string) => void;
  disabled?: boolean;
}

const PRESET_QUESTIONS: PresetQuestion[] = [
  {
    id: "q-top-scorer",
    text: "海港队史射手王是谁，总进球是多少？",
    category: "射手与巨星",
    tag: "武磊传奇",
  },
  {
    id: "q-east-asia-era",
    text: "上海东亚时期是哪一年冲超成功的，当时的主教练和核心班底是谁？",
    category: "历史荣誉",
    tag: "东亚时期·崇明一代",
  },
  {
    id: "q-sipg-2018-champion",
    text: "上海上港时期夺得2018中超首冠的历程与天河决战记录",
    category: "夺冠决战",
    tag: "上港时期·首座中超",
  },
  {
    id: "q-2024-double-trophies",
    text: "2024赛季海港夺得中超与足协杯双冠王战绩与历史纪录",
    category: "历史荣誉",
    tag: "海港时期·双冠王",
  },
  {
    id: "q-pereira-stats",
    text: "佩雷拉执教了几个赛季，多少场比赛？",
    category: "名帅战术",
    tag: "功勋名帅·权威统计",
  },
  {
    id: "q-vs-taishan-luneng",
    text: "海港对阵山东泰山（含山东鲁能时期）的历史交手总战绩",
    category: "历史荣誉",
    tag: "对手映射·鲁能/泰山",
  },
  {
    id: "q-vs-guangzhou-evergrande",
    text: "海港对阵广州恒大（广州队）的历史交手总战绩与经典战役",
    category: "夺冠决战",
    tag: "对手映射·恒大/广州",
  },
  {
    id: "q-derby-records",
    text: "海港对阵上海申花的上海德比历史交锋与经典大比分胜利",
    category: "德比恩怨",
    tag: "上海德比·6-1/5-0",
  },
];

export const PresetQuestions: React.FC<PresetQuestionsProps> = ({
  onSelectQuestion,
  disabled,
}) => {
  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
        <Flame className="w-3.5 h-3.5 text-red-600" />
        <span>海港热点档案速查</span>
        <span className="text-[11px] font-normal text-slate-400">（点击直接提问）</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {PRESET_QUESTIONS.map((q) => (
          <button
            key={q.id}
            id={`preset-btn-${q.id}`}
            disabled={disabled}
            onClick={() => onSelectQuestion(q.text)}
            className="group text-left p-2.5 rounded-xl bg-white hover:bg-rose-50/70 border border-slate-200/80 hover:border-red-300 transition-all shadow-2xs hover:shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 border border-red-100 group-hover:bg-red-600 group-hover:text-white transition-colors">
                {q.tag}
              </span>
              <Sparkles className="w-3 h-3 text-slate-300 group-hover:text-red-500 transition-colors" />
            </div>
            <p className="text-xs font-medium text-slate-800 group-hover:text-red-900 line-clamp-2 transition-colors">
              {q.text}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
