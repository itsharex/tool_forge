import {
  Bot,
  Braces,
  Code2,
  Gem,
  Hammer,
  Layers,
  MousePointer2,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * 每家工具的视觉身份:名字、一句话、图标、主色。
 *
 * 顺序就是页面上卡片的顺序 —— 用得最多的排前面,共享池垫底。
 * 颜色刻意各不相同:八家的东西混在一列里,靠颜色一眼分出谁是谁,
 * 比靠文字标签快得多。
 */
export interface OriginMeta {
  id: string
  name: string
  /** 一句话说清它是什么 —— 不是每个人都认得 Cline、Trae 这些名字 */
  blurb: string
  icon: LucideIcon
  /** 图标底色 + 前景色 */
  tone: string
  /** 卡片顶部那道细线的颜色,和 tone 同色系 */
  bar: string
  /** 小标签用的浅色底 */
  chip: string
}

export const ORIGINS: OriginMeta[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    blurb: 'Anthropic 的命令行 agent。配置在 ~/.claude 和 ~/.claude.json',
    icon: Sparkles,
    tone: 'bg-gradient-to-br from-orange-500/20 to-amber-600/10 text-orange-600 dark:text-orange-300',
    bar: 'bg-orange-500',
    chip: 'bg-orange-500/12 text-orange-700 dark:text-orange-300',
  },
  {
    id: 'codex',
    name: 'Codex',
    blurb: 'OpenAI 的命令行 agent。配置在 ~/.codex',
    icon: Code2,
    tone: 'bg-gradient-to-br from-zinc-500/20 to-zinc-700/10 text-zinc-700 dark:text-zinc-200',
    bar: 'bg-zinc-600 dark:bg-zinc-300',
    chip: 'bg-zinc-500/12 text-zinc-700 dark:text-zinc-200',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    blurb: 'Google 的命令行 agent。配置在 ~/.gemini',
    icon: Gem,
    tone: 'bg-gradient-to-br from-blue-500/20 to-indigo-600/10 text-blue-600 dark:text-blue-300',
    bar: 'bg-blue-500',
    chip: 'bg-blue-500/12 text-blue-700 dark:text-blue-300',
  },
  {
    id: 'cline',
    name: 'Cline',
    blurb: 'VS Code 扩展。配置跟着 VS Code 走,不在家目录',
    icon: Bot,
    tone: 'bg-gradient-to-br from-emerald-500/20 to-teal-600/10 text-emerald-600 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  },
  {
    id: 'continue',
    name: 'Continue',
    blurb: '开源 IDE 助手。配置在 ~/.continue',
    icon: Braces,
    tone: 'bg-gradient-to-br from-violet-500/20 to-purple-600/10 text-violet-600 dark:text-violet-300',
    bar: 'bg-violet-500',
    chip: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  },
  {
    id: 'trae',
    name: 'Trae',
    blurb: '字节的 AI IDE。配置在 ~/.trae',
    icon: Layers,
    tone: 'bg-gradient-to-br from-rose-500/20 to-pink-600/10 text-rose-600 dark:text-rose-300',
    bar: 'bg-rose-500',
    chip: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    blurb: 'AI IDE。MCP 在 ~/.cursor/mcp.json',
    icon: MousePointer2,
    tone: 'bg-gradient-to-br from-sky-500/20 to-cyan-600/10 text-sky-600 dark:text-sky-300',
    bar: 'bg-sky-500',
    chip: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  },
  {
    id: 'toolforge',
    name: '工具箱',
    blurb: '本应用自己的 MCP 客户端,给「AI 问答」用。配置在 ~/.toolforge',
    icon: Wrench,
    tone: 'bg-gradient-to-br from-fuchsia-500/20 to-violet-600/10 text-fuchsia-600 dark:text-fuchsia-300',
    bar: 'bg-fuchsia-500',
    chip: 'bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300',
  },
  {
    id: 'shared',
    name: '共享池',
    blurb: '~/.agents/skills —— 跨工具共用的 skills。Continue 和 Trae 的 skills 目录全是指向它的软链',
    icon: Hammer,
    tone: 'bg-gradient-to-br from-slate-500/20 to-slate-600/10 text-slate-600 dark:text-slate-300',
    bar: 'bg-slate-500',
    chip: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',
  },
]

const BY_ID = new Map(ORIGINS.map((o) => [o.id, o]))

/** 认不出的来源给一个中性的兜底,不能因为后端多加了一家就白屏 */
export function originMeta(id: string): OriginMeta {
  return (
    BY_ID.get(id) ?? {
      id,
      name: id,
      blurb: '',
      icon: Bot,
      tone: 'bg-secondary text-foreground',
      bar: 'bg-muted-foreground',
      chip: 'bg-muted text-muted-foreground',
    }
  )
}
