// 前端使用的 outlook 邮箱数据类型。
// 跟后端 backend/tools/outlookmail/types.go 一一对应,大部分可以从 wailsjs 生成的
// outlookmail.* 拿,但有些字段(如 time.Time)被生成成 any,这里复制一份手写更清楚。

export type AccountStatus = 'active' | 'token_expired' | 'banned' | 'unknown'
export type Folder = 'inbox' | 'junkemail' | 'deleteditems'
/**
 * 前端展示用的文件夹视图,比后端 Folder 多一个 'all'(收件箱 + 垃圾邮件合并的虚拟视图)。
 * 不会传给后端 — 'all' 时由前端并发拉取两个真实文件夹再合并。
 */
export type FolderView = Folder | 'all'

export interface AccountView {
  id: string
  email: string
  has_password: boolean
  client_id: string
  type: string
  group_id: string
  tags?: string[] | null
  remark?: string
  status: AccountStatus
  last_error?: string
  has_proxy: boolean
  proxy?: string
  disabled: boolean
  order: number
  last_refresh_at?: string
  last_used_at?: string
  created_at: string
  updated_at: string
}

export interface AccountPatch {
  email?: string
  password?: string
  client_id?: string
  group_id?: string
  tags?: string[]
  remark?: string
  proxy?: string
  status?: AccountStatus
  disabled?: boolean
  order?: number
}

export interface AccountSecret {
  id: string
  email: string
  password: string
  client_id: string
  refresh_token: string
}

export interface AuthURLResult {
  auth_url: string
  client_id: string
  redirect_uri: string
}

export interface ExchangeResult {
  client_id: string
  refresh_token: string
  access_token: string
  expires_in: number
  scope: string
  email?: string
}

export interface SaveFromAuthRequest {
  redirected_url: string
  client_id?: string
  redirect_uri?: string
  email?: string
  password?: string
  group_id?: string
  tags?: string[]
  remark?: string
}

export interface ExportSummary {
  group_id: string
  group_name: string
  count: number
}

export interface ExportResult {
  content: string
  total_count: number
  exported_groups: string[]
}

export interface RefreshJobState {
  job_id: string
  start_at: string
  end_at?: string
  total: number
  done: number
  success: number
  failed: number
  canceled: boolean
  results: RefreshResult[]
}

export interface Group {
  id: string
  name: string
  color?: string
  order: number
  created_at: string
}

export interface Mail {
  id: string
  account_id: string
  subject: string
  from: string
  from_name: string
  received: string
  is_read: boolean
  has_attachment: boolean
  body_preview: string
  folder: Folder
}

export interface MailDetail extends Mail {
  body_html: string
  body_text: string
}

export interface MailPage {
  mails: Mail[]
  total: number
  next_page: number
  has_more: boolean
}

export interface RefreshResult {
  account_id: string
  email: string
  success: boolean
  status: AccountStatus
  reason?: string
  new_expires_in?: number
}

export interface ImportRequest {
  group_id: string
  tags?: string[]
  remark?: string
  status?: string
  raw: string
}

export interface ImportResult {
  line: number
  email: string
  success: boolean
  reason?: string
  account_id?: string
}

export interface ImportResponse {
  total: number
  success: number
  failed: number
  results: ImportResult[]
}

export interface ExtractResult {
  code?: string
  links?: string[]
  source?: string
}

export interface Config {
  global_proxy?: string
  schedule_enabled: boolean
  schedule_type?: string
  schedule_interval_sec?: number
  schedule_cron?: string
  account_refresh_gap_ms?: number
}
