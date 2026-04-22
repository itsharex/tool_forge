import { Braces } from 'lucide-react'
import type { ToolMeta } from '@/stores/tools'

export const meta: ToolMeta = {
  id: 'protobuf',
  path: '/tools/protobuf',
  title: 'Protobuf 编解码',
  description: '贴 .proto + 二进制（hex/base64）消息 → JSON；反向亦可',
  icon: Braces,
  category: 'codec',
  order: 15,
  defaultVisible: true,
}
