import { FileBox } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'plist',
  path: '/tools/plist',
  title: 'Plist 解析器',
  description: '解析 XML / 二进制 Plist，自动解包 NSKeyedArchive',
  icon: FileBox,
  category: 'data',
  order: 10,
  defaultVisible: true,
}
