import { Sparkles } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'claude-insight',
  path: '/tools/claude-insight',
  title: 'Claude 洞察',
  description: '扫描本地 ~/.claude 目录,展示会话、Token 用量与活跃度统计',
  icon: Sparkles,
  category: 'ai',
  order: 10,
  defaultVisible: true,
}
