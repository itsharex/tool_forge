export type SourceID =
  | 'itunes'
  | 'qimai_ios'
  | 'qimai_android'
  | 'yingyongbao'
  | 'googleplay'

export interface SourceOption {
  id: SourceID
  label: string
  platform: 'ios' | 'android'
  hint?: string
  enabled: boolean // 未实现的源先禁用
  /** 用不了之前要先配置。界面据此把提示换成"未配置 · 去配置" */
  needsConfig?: boolean
}

// 源列表顺序即前端展示顺序
export const SOURCES: SourceOption[] = [
  { id: 'itunes', label: 'Apple Store', platform: 'ios', hint: '官方 iTunes Search', enabled: true },
  { id: 'qimai_ios', label: '七麦 iOS', platform: 'ios', hint: '无需登录', enabled: true },
  { id: 'qimai_android', label: '七麦 Android', platform: 'android', hint: '需七麦登录态', enabled: true, needsConfig: true },
  { id: 'yingyongbao', label: '应用宝', platform: 'android', hint: '腾讯，无需登录', enabled: true },
  { id: 'googleplay', label: 'Google Play', platform: 'android', hint: '需代理/TUN', enabled: true },
]

// 七麦 Android 市场 ID（来自前端 bundle 常量）
export const ANDROID_MARKETS: { value: number; label: string }[] = [
  { value: 6, label: '华为' },
  { value: 3, label: '应用宝' },
  { value: 4, label: '小米' },
  { value: 9, label: 'OPPO' },
  { value: 8, label: 'VIVO' },
  { value: 7, label: '魅族' },
  { value: 2, label: '百度' },
  { value: 1, label: '360' },
  { value: 5, label: '豌豆荚' },
  { value: 11, label: '鸿蒙' },
  { value: 10, label: 'Google Play' },
]

// 常见 iOS 国家
export const COUNTRIES: { value: string; label: string }[] = [
  { value: 'cn', label: '中国 (cn)' },
  { value: 'us', label: '美国 (us)' },
  { value: 'jp', label: '日本 (jp)' },
  { value: 'gb', label: '英国 (gb)' },
  { value: 'hk', label: '香港 (hk)' },
  { value: 'tw', label: '台湾 (tw)' },
  { value: 'kr', label: '韩国 (kr)' },
  { value: 'sg', label: '新加坡 (sg)' },
]
