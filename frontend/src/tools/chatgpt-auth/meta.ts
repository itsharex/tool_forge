import { KeyRound } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'chatgpt-auth',
  path: '/tools/chatgpt-auth',
  title: 'ChatGPT 凭据转换',
  sidebarTitle: '凭据转换',
  description: '把 chatgpt.com/api/auth/session 的 JSON 转成 auth.json / CPA / Sub2API / Cockpit / 9router / AxonHub 等多种格式',
  icon: KeyRound,
  category: 'ai',
  order: 18,
  defaultVisible: true,
}
