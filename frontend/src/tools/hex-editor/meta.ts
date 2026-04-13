import { Binary } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'hex-editor',
  path: '/tools/hex-editor',
  title: 'Hex 编辑器',
  description: '十六进制查看 / 多编码文本列 / 数据 Inspector',
  icon: Binary,
  category: 'dev',
  order: 5,
  defaultVisible: true,
}
