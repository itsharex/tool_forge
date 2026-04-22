import { ShieldCheck } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'crypto-lab',
  path: '/tools/crypto-lab',
  title: '加密/解密',
  description: 'AES / RSA / ChaCha20 / 国密 SM2 SM4 一站式编解码',
  icon: ShieldCheck,
  category: 'crypto',
  order: 14,
  defaultVisible: true,
}
