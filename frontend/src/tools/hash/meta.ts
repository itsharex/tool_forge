import { Shield } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'hash',
  path: '/tools/hash',
  title: '哈希计算',
  description: 'MD5 / SHA-1 / SHA-256 / SHA-512 同步计算',
  icon: Shield,
  category: 'crypto',
  order: 20,
  defaultVisible: true,
}
