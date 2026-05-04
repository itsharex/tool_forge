import { Languages } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'translate',
  path: '/tools/translate',
  title: '翻译',
  description: '使用已配置的 AI 模型进行翻译,支持 30+ 语言、文件附件、自动语种检测',
  icon: Languages,
  category: 'ai',
  order: 15,
  defaultVisible: true,
}
