import { Database } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'mmkv',
  path: '/tools/mmkv',
  title: 'MMKV 解析器',
  description: '解析 Tencent MMKV 文件，查看 key-value 与历史值',
  icon: Database,
  category: 'forensic',
  order: 20,
  defaultVisible: true,
}
