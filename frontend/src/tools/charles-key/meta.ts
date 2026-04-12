import { KeySquare } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'charles-key',
  path: '/tools/charles-key',
  title: 'Charles 激活码',
  description: '根据名称生成 Charles 代理工具的离线激活码',
  icon: KeySquare,
  category: 'dev',
  order: 99,
  defaultVisible: false,
}
