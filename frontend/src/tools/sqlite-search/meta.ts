import { Database } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'sqlite-search',
  path: '/tools/sqlite-search',
  title: 'SQLite 搜索',
  description: '在取证导出里按关键词搜所有数据库，命中哪一行就给哪一行',
  icon: Database,
  category: 'forensic',
  order: 4,
  defaultVisible: true,
}
