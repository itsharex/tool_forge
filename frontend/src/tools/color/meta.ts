import { Palette } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'color',
  path: '/tools/color',
  title: '颜色转换',
  description: 'HEX / RGB / HSL 格式互转 + 色板预览',
  icon: Palette,
  category: 'dev',
  order: 20,
  defaultVisible: true,
}
