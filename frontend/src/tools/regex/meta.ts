import { Regex } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'regex',
  path: '/tools/regex',
  title: '正则表达式',
  description: '实时匹配、分组高亮、替换、片段收藏',
  icon: Regex,
  category: 'text',
  order: 12,
  defaultVisible: true,
}
