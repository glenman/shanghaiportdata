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
    text: "海港队史射手王是谁？",
    category: "射手与巨星",
    tag: "武磊传奇",
  },
  {
    id: "q-2018-key-matches",
    text: "2018赛季夺冠关键比赛",
    category: "夺冠决战",
    tag: "天河5-4恒大",
  },
  {
    id: "q-2024-double-trophies",
    text: "2024赛季中超与足协杯双冠王战绩与历史纪录",
    category: "历史荣誉",
    tag: "96球·78分",
  },
  {
    id: "q-wulei-34-goals",
    text: "武磊单赛季34球神迹是哪一年创造的？有没有点球？",
    category: "射手与巨星",
    tag: "34球零点球",
  },
  {
    id: "q-oscar-stats",
    text: "奥斯卡在海港的总进球与助攻数据如何？",
    category: "射手与巨星",
    tag: "中场大脑",
  },
  {
    id: "q-2023-champion",
    text: "2023赛季海港是怎样提前一轮夺得队史第二冠的？",
    category: "夺冠决战",
    tag: "1-1山东泰山",
  },
  {
    id: "q-managers-history",
    text: "海港队史历任主教练有哪些？各带队取得了什么荣誉？",
    category: "名帅战术",
    tag: "穆斯卡特/佩雷拉",
  },
  {
    id: "q-derby-records",
    text: "海港对阵上海申花的上海德比经典大比分记录",
    category: "德比恩怨",
    tag: "6-1 & 5-0",
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
