import React, { useState, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Trash2,
  UploadCloud,
  X,
  Sparkles,
  Loader2,
  HelpCircle,
  Image as ImageIcon,
  RotateCcw
} from "lucide-react";
import { KnowledgeBaseStats, UploadedFileItem } from "../types.js";

interface KnowledgeBaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: KnowledgeBaseStats | null;
  onRefreshStats: () => void;
  adminKey: string | null;
  onLogoUpdated?: () => void;
}

export const KnowledgeBaseModal: React.FC<KnowledgeBaseModalProps> = ({
  isOpen,
  onClose,
  stats,
  onRefreshStats,
  adminKey,
  onLogoUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<"docs" | "logo">("docs");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Logo upload state
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadMessage(null);

    try {
      const content = await file.text();
      const response = await fetch("/api/kb/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey || "",
        },
        body: JSON.stringify({
          fileName: file.name,
          content: content,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setUploadMessage({
          type: "success",
          text: `成功将《${file.name}》分块解析并注入 LangChain 向量库，生成 ${data.addedChunks} 个检索切片！`,
        });
        onRefreshStats();
      } else {
        setUploadMessage({
          type: "error",
          text: data.error || "上传解析失败",
        });
      }
    } catch (err: any) {
      setUploadMessage({
        type: "error",
        text: "上传出现异常: " + (err.message || "网络请求错误"),
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
      e.target.value = "";
    }
  };

  const executeDeleteFile = async (fileName: string) => {
    setConfirmDeleteFile(null);
    setDeletingFileName(fileName);
    setUploadMessage(null);
    try {
      const res = await fetch(`/api/kb/files/${encodeURIComponent(fileName)}`, {
        method: "DELETE",
        headers: {
          "x-admin-key": adminKey || "",
        },
      });
      const data = await res.json();
      if (data.success) {
        setUploadMessage({
          type: "success",
          text: `已成功删除文件《${fileName}》及相关检索切片`,
        });
        onRefreshStats();
      } else {
        setUploadMessage({ type: "error", text: data.error || "删除失败" });
      }
    } catch (err: any) {
      setUploadMessage({ type: "error", text: "删除异常: " + err.message });
    } finally {
      setDeletingFileName(null);
    }
  };

  const executeClearAll = async () => {
    setConfirmClearAll(false);
    setIsClearing(true);
    setUploadMessage(null);
    try {
      const res = await fetch("/api/kb/clear", {
        method: "POST",
        headers: {
          "x-admin-key": adminKey || "",
        },
      });
      const data = await res.json();
      if (data.success) {
        setUploadMessage({
          type: "success",
          text: "知识库已清空，所有向量索引已重置！",
        });
        onRefreshStats();
      } else {
        setUploadMessage({ type: "error", text: data.error || "清空失败" });
      }
    } catch (err: any) {
      setUploadMessage({ type: "error", text: "清空失败: " + err.message });
    } finally {
      setIsClearing(false);
    }
  };

  const handleDownloadSample = () => {
    window.location.href = "/api/kb/sample";
  };

  const handleDownloadJsonSample = () => {
    window.location.href = "/api/kb/sample-json";
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveLogo = async () => {
    if (!logoPreview) return;
    setIsUploadingLogo(true);
    setUploadMessage(null);
    try {
      const res = await fetch("/api/admin/logo/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey || "",
        },
        body: JSON.stringify({ imageBase64: logoPreview }),
      });
      const data = await res.json();
      if (data.success) {
        setUploadMessage({
          type: "success",
          text: "海港官方队徽已更新成功！全站已同步刷新显示。",
        });
        if (onLogoUpdated) {
          onLogoUpdated();
        }
      } else {
        setUploadMessage({
          type: "error",
          text: data.error || "队徽更新失败",
        });
      }
    } catch (err: any) {
      setUploadMessage({
        type: "error",
        text: "上传出现异常: " + (err.message || "网络请求错误"),
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const getFileIcon = (fileName: string) => {
    if (fileName.endsWith(".csv")) return <FileSpreadsheet className="w-4 h-4 text-emerald-600" />;
    if (fileName.endsWith(".json")) return <Database className="w-4 h-4 text-amber-600" />;
    return <FileText className="w-4 h-4 text-red-600" />;
  };

  const totalFiles = stats?.files?.length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-red-600 to-red-800 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-white/10 backdrop-blur-xs">
              <Database className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">海港俱乐部管理控制台</h2>
              <p className="text-xs text-red-100">
                知识库文档切片检索 · 俱乐部官方队徽管理
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50/70 px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab("docs")}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "docs"
                ? "border-red-600 text-red-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>数据文档知识库</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("logo")}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "logo"
                ? "border-red-600 text-red-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>更换官方队徽图片</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {activeTab === "logo" ? (
            <div className="space-y-5 animate-fade-in">
              <div className="p-4 bg-amber-50/80 rounded-xl border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">直接上传您保存的海港队徽原图</p>
                  <p className="text-amber-700 mt-0.5">
                    支持 PNG、JPG、WEBP 或 SVG 格式。上传后将即刻替换左上角与首页所有展示的队徽图标，真实且权威。
                  </p>
                </div>
              </div>

              {/* Current vs New Preview */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center bg-slate-50/50 space-y-2">
                  <span className="text-xs font-semibold text-slate-500">当前显示的队徽</span>
                  <div className="w-20 h-20 flex items-center justify-center">
                    <img
                      src="/shanghaiport-logo.png"
                      alt="当前队徽"
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <span className="text-[11px] text-slate-400">系统当前图标</span>
                </div>

                <div className="border-2 border-dashed border-red-200 rounded-xl p-4 flex flex-col items-center justify-center bg-red-50/30 space-y-2">
                  <span className="text-xs font-semibold text-red-700">您选中的新图片预览</span>
                  <div className="w-20 h-20 flex items-center justify-center">
                    {logoPreview ? (
                      <img
                        src={logoPreview}
                        alt="新队徽预览"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="text-center p-2 text-slate-400 text-[11px]">
                        未选择新图片
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {logoPreview ? "预览中（请点击下方按钮保存）" : "等待选择图片"}
                  </span>
                </div>
              </div>

              {/* Upload actions */}
              <div className="space-y-3">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleLogoSelect}
                  className="hidden"
                />

                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border border-slate-300 transition-colors cursor-pointer"
                  >
                    <UploadCloud className="w-4 h-4 text-slate-600" />
                    <span>从本地电脑选择队徽图片...</span>
                  </button>

                  {logoPreview && (
                    <button
                      type="button"
                      onClick={handleSaveLogo}
                      disabled={isUploadingLogo}
                      className="py-2.5 px-5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-red-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isUploadingLogo ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>正在更新...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-amber-300" />
                          <span>确认应用此队徽</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Upload Area */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    上传海港数据文件（支持 .json / .txt / .md / .csv）
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleDownloadJsonSample}
                      className="text-xs text-amber-700 hover:text-amber-800 font-medium inline-flex items-center gap-1 hover:underline cursor-pointer bg-amber-50 px-2 py-0.5 rounded border border-amber-200"
                      title="下载包含比分、进球人、赛事统计的高精度结构化JSON样例数据"
                    >
                      <Download className="w-3.5 h-3.5 text-amber-600" />
                      <span>下载测试 JSON 样例</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadSample}
                      className="text-xs text-red-600 hover:text-red-700 font-medium inline-flex items-center gap-1 hover:underline cursor-pointer"
                      title="下载一份标准的2019超级杯比赛Markdown示例数据文件"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>下载 Markdown 样例</span>
                    </button>
                  </div>
                </div>

                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-red-500 bg-red-50/70 scale-[0.99]"
                      : "border-slate-300 hover:border-red-400 bg-slate-50/50 hover:bg-red-50/20"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.txt,.md,.markdown,.csv"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center shadow-xs">
                      {isUploading ? (
                        <Loader2 className="w-6 h-6 animate-spin text-red-600" />
                      ) : (
                        <UploadCloud className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {isUploading
                          ? "正在处理数据并同步建立全量解析索引，请稍候..."
                          : "点击选择或将海港队史数据文档拖拽至此处"}
                      </p>
                      <p className="text-xs text-slate-500 mt-1 max-w-lg mx-auto">
                        ★ <span className="text-amber-700 font-medium">JSON 文件支持原生全量上下文直读</span>：零切片损失、完整保留字段、支持复杂多维统计与比分计算！
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Feedback Message */}
          {uploadMessage && (
            <div
              className={`p-3 rounded-xl flex items-start gap-2 text-xs border ${
                uploadMessage.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : "bg-rose-50 text-rose-800 border-rose-200"
              }`}
            >
              {uploadMessage.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span className="font-medium">{uploadMessage.text}</span>
            </div>
          )}

          {activeTab === "docs" && (
            <>
              {/* File List */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <FileCheck className="w-3.5 h-3.5 text-red-600" />
                    已上传的数据文件 ({totalFiles} 份)
                  </h3>
                  {totalFiles > 0 && (
                    <div className="flex items-center gap-2">
                      {confirmClearAll ? (
                        <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg text-xs animate-fade-in">
                          <span className="text-rose-700 font-medium">确认清空全部数据?</span>
                          <button
                            type="button"
                            onClick={executeClearAll}
                            disabled={isClearing}
                            className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-semibold cursor-pointer"
                          >
                            {isClearing ? "清空中..." : "确认"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmClearAll(false)}
                            className="px-1.5 py-0.5 text-slate-500 hover:text-slate-700 text-[11px] cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmClearAll(true)}
                          disabled={isClearing}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50 cursor-pointer"
                          title="清空所有上传文件与向量索引"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>清空知识库</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-slate-50/40">
                  {stats?.files && stats.files.length > 0 ? (
                    stats.files.map((file, idx) => (
                      <div
                        key={idx}
                        className="p-3 flex items-center justify-between hover:bg-white transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {getFileIcon(file.name)}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-semibold text-slate-800 truncate">
                                {file.name}
                              </p>
                              {file.isJson && (
                                <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-1.5 py-0.2 rounded border border-amber-200 shrink-0">
                                  JSON全量模式
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400">
                              {file.isJson
                                ? `包含 ${file.itemCount || 1} 条结构化数据 · 全量结构化上下文直读 · ${Math.round(file.size / 1024) || 1} KB`
                                : `${file.chunkCount} 个向量知识切片 · ${Math.round(file.size / 1024) || 1} KB`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {confirmDeleteFile === file.name ? (
                            <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg text-xs animate-fade-in">
                              <span className="text-rose-700 font-medium">确认删除?</span>
                              <button
                                type="button"
                                onClick={() => executeDeleteFile(file.name)}
                                disabled={deletingFileName === file.name}
                                className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-semibold cursor-pointer"
                              >
                                {deletingFileName === file.name ? "删除中..." : "确定"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteFile(null)}
                                className="px-1.5 py-0.5 text-slate-500 hover:text-slate-700 text-[11px] cursor-pointer"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteFile(file.name)}
                              disabled={deletingFileName === file.name}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              title={`删除 ${file.name}`}
                            >
                              {deletingFileName === file.name ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-600" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-xs text-slate-500 space-y-1.5">
                      <p className="font-medium text-slate-600">知识库当前为空，未载入任何数据文件</p>
                      <p className="text-slate-400">
                        请通过上方拖拽或选择上传海港数据文档，问答将严格基于您上传的真实内容进行解答。
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-red-50/60 rounded-xl border border-red-100 text-xs">
                <div>
                  <span className="text-slate-500 block">已构建向量切片数 (Chunks)</span>
                  <span className="text-lg font-bold text-red-700">
                    {stats?.totalChunks || 0}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">防幻觉检索状态</span>
                  <span className="text-sm font-semibold text-slate-800">
                    {totalFiles > 0 ? "已接入上传文档索引" : "等待上传数据文档"}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
