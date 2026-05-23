/**
 * 7 个输出目标格式的配置。
 *
 * group:
 *   - 'primary' 主要目标,显示在前排
 *   - 'more'    次要目标,默认折叠在"更多"分组下
 */

export type TargetGroup = 'primary' | 'more'

export interface TargetConfig {
  /** 稳定 ID,用作 store key 和 URL 锚点 */
  id: TargetId
  /** UI 显示名 */
  label: string
  /** 下载文件名(下载时若有 email,会拼上 <email>---- 前缀,除了 auth.json) */
  filename: string
  /** 一句话描述,放在按钮 tooltip / 帮助里 */
  description: string
  /** 分组 */
  group: TargetGroup
}

export type TargetId =
  | 'auth'
  | 'cpa'
  | 'sub2api'
  | 'cockpit'
  | '9router'
  | 'axonhub'

export const DEFAULT_TARGET_ID: TargetId = 'auth'

export const TARGETS: TargetConfig[] = [
  {
    id: 'auth',
    label: 'auth',
    filename: 'auth.json',
    description: 'Codex CLI / Codex App 标准格式,放在 ~/.codex/auth.json 即可登录',
    group: 'primary',
  },
  {
    id: 'cpa',
    label: 'CPA',
    filename: 'cpa.json',
    description: 'codex-power-api 多账号管理格式',
    group: 'primary',
  },
  {
    id: 'sub2api',
    label: 'Sub2API',
    filename: 'sub2api.json',
    description: 'Sub2API 项目的账号导入格式',
    group: 'primary',
  },
  {
    id: 'cockpit',
    label: 'Cockpit',
    filename: 'cockpit.json',
    description: 'Cockpit 控制台账号格式',
    group: 'more',
  },
  {
    id: '9router',
    label: '9router',
    filename: '9router.json',
    description: '9router 项目的 OAuth provider 配置',
    group: 'more',
  },
  {
    id: 'axonhub',
    label: 'AxonHub',
    filename: 'axonhub-auth.json',
    description: 'AxonHub 的 auth.json 变体(没有真实 refresh_token 时会用占位)',
    group: 'more',
  },
]

export const TARGET_MAP: Record<TargetId, TargetConfig> = TARGETS.reduce(
  (acc, t) => {
    acc[t.id] = t
    return acc
  },
  {} as Record<TargetId, TargetConfig>,
)
