/**
 * Session JSON → 7 种目标格式的转换函数。
 *
 * 移植自 @P0me1oo 的油猴脚本(D:\go_pro\new_tools\linshi_project\abc.txt)。
 * 油猴脚本里写得很 defensive,这里保留同样的字段优先级,确保跨工具兼容性。
 *
 * 注意:除了 raw-session 之外,buildAuthJson 是唯一会因为字段缺失抛错的导出。
 * 其他格式都尽量尝试输出(用 stripUnavailable 删除空字段),并把异常包成 entry.error
 * 返回给 UI,而不是中断整个生成流程。
 */

import { encodeBase64UrlJson, parseJwtPayload } from './jwt'
import type { TargetId } from './targets'

const AXONHUB_PLACEHOLDER_REFRESH_TOKEN = '__missing_refresh_token__'

/** 等价于油猴的 getPath:按 "a.b.c" 路径取值,任一段失败返回 undefined */
function getPath(source: unknown, path: string): unknown {
  const parts = String(path || '').split('.').filter(Boolean)
  let current: unknown = source
  for (const part of parts) {
    if (
      !current ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current as Record<string, unknown>, part)
    ) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 返回第一个非空字符串,trim 后再判断 */
function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return undefined
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function timestampFromUnixSeconds(value: unknown): string | undefined {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  const d = new Date(n * 1000)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function epochSecondsFromValue(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Math.trunc(value.getTime() / 1000)
  }
  const n = Number(value)
  if (Number.isFinite(n)) {
    return Math.trunc(n > 1e11 ? n / 1000 : n)
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0
}

/** 递归剔除 undefined / null / "" / 空对象,让输出更干净 */
function stripUnavailable<T>(value: T): T | undefined {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => stripUnavailable(item))
      .filter((item) => item !== undefined)
    return cleaned as unknown as T
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, stripUnavailable(v)] as const)
      .filter(([, v]) => v !== undefined)
    return (entries.length ? Object.fromEntries(entries) : undefined) as T | undefined
  }
  if (value === undefined || value === null || value === '') return undefined
  return value
}

function toEmailKey(email: string | undefined): string | undefined {
  if (typeof email !== 'string') return undefined
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getExpiresIn(expiresAt: string | undefined, now: Date): number | undefined {
  if (!expiresAt) return undefined
  const ms = new Date(expiresAt).getTime()
  if (Number.isNaN(ms)) return undefined
  return Math.max(0, Math.floor((ms - now.getTime()) / 1000))
}

function getAxonHubLastRefresh(expiresAt: string | undefined, now: Date): string {
  const ms = expiresAt ? new Date(expiresAt).getTime() : Number.NaN
  if (Number.isNaN(ms)) return now.toISOString()
  return new Date(ms - 60 * 60 * 1000).toISOString()
}

function getOpenAIAuthSection(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!isPlainObject(payload)) return {}
  const auth = payload['https://api.openai.com/auth']
  return isPlainObject(auth) ? auth : {}
}

function getOpenAIProfileSection(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!isPlainObject(payload)) return {}
  const profile = payload['https://api.openai.com/profile']
  return isPlainObject(profile) ? profile : {}
}

/**
 * ChatGPT Web session 没有真实 id_token,合成一个 Codex 可解析的占位 JWT。
 * alg=none + cpa_synthetic 标记,签名段固定字符串 "synthetic"。
 */
function buildSyntheticCodexIdToken(
  email: string | undefined,
  accountId: string,
  planType: string | undefined,
  userId: string | undefined,
  expiresAt: string | undefined,
  now: Date,
): string | undefined {
  if (!accountId) return undefined
  const nowSeconds = epochSecondsFromValue(now)
  const expires = epochSecondsFromValue(expiresAt) || nowSeconds + 90 * 24 * 60 * 60
  const authInfo: Record<string, string> = { chatgpt_account_id: accountId }
  if (planType) authInfo.chatgpt_plan_type = planType
  if (userId) {
    authInfo.chatgpt_user_id = userId
    authInfo.user_id = userId
  }
  const payload: Record<string, unknown> = {
    iat: nowSeconds,
    exp: expires,
    'https://api.openai.com/auth': authInfo,
  }
  if (email) payload.email = email
  return (
    encodeBase64UrlJson({ alg: 'none', typ: 'JWT', cpa_synthetic: true }) +
    '.' +
    encodeBase64UrlJson(payload) +
    '.synthetic'
  )
}

export interface ConversionContext {
  accessToken: string
  sessionToken: string | undefined
  accountId: string | undefined
  email: string | undefined
  userId: string | undefined
  planType: string | undefined
  expiresAt: string | undefined
  exportedAt: string
  now: Date
  refreshToken: string | undefined
  codexIdToken: string | undefined
  codexIdTokenSynthetic: boolean
  displayName: string
}

export interface BuildOptions {
  /** 用于稳定化测试 / demo:固定 "now" 时刻 */
  now?: Date | string | number
}

function resolveNow(options?: BuildOptions): Date {
  const raw = options && Object.prototype.hasOwnProperty.call(options, 'now') ? options.now : new Date()
  const normalized = normalizeTimestamp(raw)
  return normalized ? new Date(normalized) : new Date()
}

function readSessionTokens(session: unknown): {
  accessToken: string
  sessionToken: string | undefined
  accountId: string | undefined
} {
  if (!session || typeof session !== 'object') {
    throw new Error('Session 数据不是有效 JSON 对象。')
  }
  const accessToken = String(getPath(session, 'accessToken') || '').trim()
  const sessionToken = String(getPath(session, 'sessionToken') || '').trim()
  const accountId = String(getPath(session, 'account.id') || '').trim()
  if (!accessToken) {
    throw new Error('Session 数据缺少 accessToken。')
  }
  return {
    accessToken,
    sessionToken: sessionToken || undefined,
    accountId: accountId || undefined,
  }
}

function buildLastRefresh(session: Record<string, unknown>, now: Date): string {
  const rawIat = getPath(session, 'user.iat')
  const n = Number(rawIat)
  if (Number.isFinite(n) && n > 0) {
    return new Date(n * 1000).toISOString()
  }
  return new Date(now.getTime() - 60 * 1000).toISOString()
}

export function buildConversionContext(
  session: unknown,
  options?: BuildOptions,
): ConversionContext {
  const tokens = readSessionTokens(session)
  const sessionObj = session as Record<string, unknown>

  const accessPayload = parseJwtPayload(tokens.accessToken)
  const inputIdToken = firstNonEmpty(sessionObj.idToken, sessionObj.id_token)
  const idPayload = parseJwtPayload(inputIdToken)
  const accessAuth = getOpenAIAuthSection(accessPayload)
  const idAuth = getOpenAIAuthSection(idPayload)
  const accessProfile = getOpenAIProfileSection(accessPayload)

  const now = resolveNow(options)
  const exportedAt = now.toISOString()

  const expiresAt = firstNonEmpty(
    timestampFromUnixSeconds(accessPayload && accessPayload.exp),
    normalizeTimestamp(sessionObj.expires),
    normalizeTimestamp(sessionObj.expiresAt),
    normalizeTimestamp(sessionObj.expired),
    normalizeTimestamp(sessionObj.expires_at),
  )

  const email = firstNonEmpty(
    getPath(session, 'user.email'),
    sessionObj.email,
    accessProfile.email,
    idPayload && idPayload.email,
    accessPayload && accessPayload.email,
  )

  const userId = firstNonEmpty(
    getPath(session, 'user.id'),
    sessionObj.user_id,
    accessAuth.chatgpt_user_id,
    accessAuth.user_id,
    idAuth.chatgpt_user_id,
    idAuth.user_id,
  )

  const planType = firstNonEmpty(
    getPath(session, 'account.planType'),
    getPath(session, 'account.plan_type'),
    sessionObj.planType,
    sessionObj.plan_type,
    accessAuth.chatgpt_plan_type,
    idAuth.chatgpt_plan_type,
  )

  const accountId = firstNonEmpty(
    tokens.accountId,
    sessionObj.account_id,
    accessAuth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
  )

  const refreshToken = firstNonEmpty(sessionObj.refreshToken, sessionObj.refresh_token)

  const syntheticIdToken = inputIdToken
    ? undefined
    : accountId
      ? buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt, now)
      : undefined
  const codexIdToken = firstNonEmpty(inputIdToken, syntheticIdToken, tokens.accessToken)

  return {
    accessToken: tokens.accessToken,
    sessionToken: tokens.sessionToken,
    accountId,
    email,
    userId,
    planType,
    expiresAt,
    exportedAt,
    now,
    refreshToken,
    codexIdToken,
    codexIdTokenSynthetic: Boolean(syntheticIdToken),
    displayName: firstNonEmpty(email, accountId, 'ChatGPT Account') ?? 'ChatGPT Account',
  }
}

// =========================================================
// 7 个目标格式
// =========================================================

export function buildAuthJson(
  session: Record<string, unknown>,
  ctx: ConversionContext,
): unknown {
  if (!ctx.sessionToken) {
    throw new Error('auth.json 导出缺少 sessionToken。')
  }
  if (!ctx.accountId) {
    throw new Error('auth.json 导出缺少 account.id,且 accessToken / id_token 中未解析到 chatgpt_account_id。')
  }
  return {
    OPENAI_API_KEY: null,
    auth_mode: 'chatgpt',
    last_refresh: buildLastRefresh(session, ctx.now),
    tokens: {
      access_token: ctx.accessToken,
      account_id: ctx.accountId,
      id_token: ctx.accessToken,
      refresh_token: ctx.sessionToken,
    },
  }
}

export function buildCpaJson(ctx: ConversionContext): unknown {
  return Object.fromEntries(
    Object.entries({
      type: 'codex',
      account_id: ctx.accountId,
      chatgpt_account_id: ctx.accountId,
      email: ctx.email,
      name: ctx.displayName,
      plan_type: ctx.planType,
      chatgpt_plan_type: ctx.planType,
      id_token: ctx.codexIdToken,
      id_token_synthetic: ctx.codexIdTokenSynthetic || undefined,
      access_token: ctx.accessToken,
      refresh_token: ctx.refreshToken || '',
      session_token: ctx.sessionToken,
      last_refresh: ctx.exportedAt,
      expired: ctx.expiresAt,
    }).filter(([, v]) => v !== undefined && v !== null),
  )
}

export function buildCockpitJson(ctx: ConversionContext): unknown {
  return Object.fromEntries(
    Object.entries({
      type: 'codex',
      id_token: ctx.codexIdToken,
      access_token: ctx.accessToken,
      refresh_token: ctx.refreshToken || '',
      account_id: ctx.accountId,
      last_refresh: ctx.exportedAt,
      email: ctx.email,
      expired: ctx.expiresAt,
    }).filter(([, v]) => v !== undefined && v !== null),
  )
}

export function buildSub2apiJson(ctx: ConversionContext): unknown {
  const account = stripUnavailable({
    name: ctx.displayName,
    platform: 'openai',
    type: 'oauth',
    concurrency: 10,
    priority: 1,
    credentials: {
      access_token: ctx.accessToken,
      chatgpt_account_id: ctx.accountId,
      chatgpt_user_id: ctx.userId,
      email: ctx.email,
      expires_at: ctx.expiresAt,
      expires_in: getExpiresIn(ctx.expiresAt, ctx.now),
      plan_type: ctx.planType,
    },
    extra: {
      email: ctx.email,
      email_key: toEmailKey(ctx.email),
      name: ctx.displayName,
      source: 'chatgpt_web_session',
      last_refresh: ctx.exportedAt,
    },
  })
  return {
    exported_at: ctx.exportedAt,
    proxies: [],
    accounts: account ? [account] : [],
  }
}

export function buildNineRouterJson(ctx: ConversionContext): unknown {
  return stripUnavailable({
    accessToken: ctx.accessToken,
    refreshToken: ctx.refreshToken,
    expiresAt: ctx.expiresAt,
    testStatus: 'active',
    expiresIn: getExpiresIn(ctx.expiresAt, ctx.now),
    providerSpecificData: {
      chatgptAccountId: ctx.accountId,
      chatgptPlanType: ctx.planType,
    },
    id: ctx.accountId,
    provider: 'codex',
    authType: 'oauth',
    name: ctx.displayName,
    email: ctx.email,
    priority: 9,
    isActive: true,
    createdAt: ctx.exportedAt,
    updatedAt: ctx.exportedAt,
  })
}

export function buildAxonHubJson(ctx: ConversionContext): unknown {
  const refreshToken = ctx.refreshToken || AXONHUB_PLACEHOLDER_REFRESH_TOKEN
  return stripUnavailable({
    auth_mode: 'chatgpt',
    last_refresh: getAxonHubLastRefresh(ctx.expiresAt, ctx.now),
    tokens: {
      access_token: ctx.accessToken,
      refresh_token: refreshToken,
      id_token: ctx.codexIdToken,
    },
    axonhub_refresh_token_placeholder: ctx.refreshToken ? undefined : true,
    axonhub_note: ctx.refreshToken
      ? undefined
      : 'refresh_token is a placeholder; access_token works only until it expires.',
  })
}

// =========================================================
// 导出条目封装
// =========================================================

export interface ExportEntry {
  id: TargetId
  text: string
  /** 转换失败时的错误说明,UI 用 disabled + tooltip 展示 */
  error?: string
}

/** 文件名清洗:去掉 Windows 非法字符 */
function sanitizeFilenameSegment(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
  return sanitized || undefined
}

export function buildDownloadFilename(
  targetId: TargetId,
  baseFilename: string,
  email: string | undefined,
): string {
  const safeEmail = sanitizeFilenameSegment(email)
  // auth.json 是 Codex 标准文件名,加邮箱前缀会破坏自动识别
  if (targetId === 'auth' || !safeEmail) return baseFilename
  return safeEmail + '----' + baseFilename
}

/** 一次性把 7 个格式都生成出来,失败的格式不会影响其他格式 */
export function buildAllEntries(
  sessionRaw: string,
  options?: BuildOptions,
): {
  ctx?: ConversionContext
  entries: Record<TargetId, ExportEntry>
  fatalError?: string
} {
  let session: Record<string, unknown>
  try {
    const parsed = JSON.parse(sessionRaw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('解析后不是 JSON 对象')
    }
    session = parsed as Record<string, unknown>
  } catch (e) {
    return {
      entries: emptyEntries('JSON 解析失败:' + (e instanceof Error ? e.message : String(e))),
      fatalError: 'JSON 解析失败:' + (e instanceof Error ? e.message : String(e)),
    }
  }

  let ctx: ConversionContext
  try {
    ctx = buildConversionContext(session, options)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { entries: emptyEntries(msg), fatalError: msg }
  }

  return {
    ctx,
    entries: {
      auth: safeBuild('auth', () => buildAuthJson(session, ctx)),
      cpa: safeBuild('cpa', () => buildCpaJson(ctx)),
      sub2api: safeBuild('sub2api', () => buildSub2apiJson(ctx)),
      cockpit: safeBuild('cockpit', () => buildCockpitJson(ctx)),
      '9router': safeBuild('9router', () => buildNineRouterJson(ctx)),
      axonhub: safeBuild('axonhub', () => buildAxonHubJson(ctx)),
    },
  }
}

function safeBuild(id: TargetId, fn: () => unknown): ExportEntry {
  try {
    const payload = fn()
    return { id, text: JSON.stringify(payload, null, 2) }
  } catch (e) {
    return { id, text: '', error: e instanceof Error ? e.message : String(e) }
  }
}

function emptyEntries(error: string): Record<TargetId, ExportEntry> {
  return {
    auth: { id: 'auth', text: '', error },
    cpa: { id: 'cpa', text: '', error },
    sub2api: { id: 'sub2api', text: '', error },
    cockpit: { id: 'cockpit', text: '', error },
    '9router': { id: '9router', text: '', error },
    axonhub: { id: 'axonhub', text: '', error },
  }
}
