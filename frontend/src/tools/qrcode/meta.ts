import { QrCode } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'qrcode',
  path: '/tools/qrcode',
  title: '二维码生成',
  description: '文本或链接生成二维码，支持容错等级与下载 PNG',
  icon: QrCode,
  category: 'gen',
  order: 20,
  defaultVisible: true,
}
