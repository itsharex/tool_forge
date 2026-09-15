import { Boxes } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'ai-config',
  path: '/tools/ai-config',
  title: '本机 AI 配置',
  sidebarTitle: 'AI 配置总览',
  description: '一处看全 Claude Code、Codex、Gemini CLI、Cline 等各家的 MCP、skills 与插件,每条都标着出自哪个文件',
  icon: Boxes,
  category: 'ai',
  order: 12,
  defaultVisible: true,
}
