/**
 * 示例 Session JSON。字段结构与 chatgpt.com/api/auth/session 真实返回对齐,
 * accessToken 是一个用 demo 数据动态合成的可解析 JWT(payload 真实可解出邮箱、
 * 计划类型、account_id),签名段是占位字符串,生产环境会被拒绝。
 *
 * 用户点"加载示例"会填充这段 JSON,然后能在右侧看到 7 种格式的真实输出,
 * 不需要真的去 chatgpt.com 拉 session。
 */

import { encodeBase64UrlJson } from './jwt'

const DEMO_EMAIL = 'demo@tool-forge.example.com'
const DEMO_ACCOUNT_ID = 'acc_demo_0000000000'
const DEMO_USER_ID = 'user-demo-0000000000'
const DEMO_PLAN_TYPE = 'plus'

function buildDemoAccessToken(): string {
  const issuedAt = Math.floor(Date.now() / 1000) - 60 // 1 分钟前
  const expiresAt = issuedAt + 90 * 24 * 60 * 60      // 90 天后

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: 'https://auth.openai.com/',
    sub: 'auth0|' + DEMO_USER_ID,
    aud: ['https://api.openai.com/v1', 'https://openai.openai.auth0app.com/userinfo'],
    iat: issuedAt,
    exp: expiresAt,
    azp: 'TdJIcbe16WoTHtN95nyywh5E4yOo6itG',
    scope: 'openid profile email model.request model.read offline',
    'https://api.openai.com/profile': {
      email: DEMO_EMAIL,
      email_verified: true,
      geoip_country: 'US',
    },
    'https://api.openai.com/auth': {
      poid: 'org-demo',
      user_id: DEMO_USER_ID,
      chatgpt_user_id: DEMO_USER_ID,
      chatgpt_account_id: DEMO_ACCOUNT_ID,
      chatgpt_plan_type: DEMO_PLAN_TYPE,
      user_creation_date: '2024-01-01T00:00:00.000Z',
    },
  }
  return encodeBase64UrlJson(header) + '.' + encodeBase64UrlJson(payload) + '.demo_signature_not_valid'
}

export function buildDemoSession(): string {
  const issuedAt = Math.floor(Date.now() / 1000) - 60
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const session = {
    user: {
      id: DEMO_USER_ID,
      name: 'Demo User',
      email: DEMO_EMAIL,
      image: 'https://example.com/avatar.png',
      picture: 'https://example.com/avatar.png',
      idp: 'google-oauth2',
      iat: issuedAt,
      mfa: false,
      groups: [],
      intercom_hash: 'demo-intercom-hash',
    },
    expires,
    accessToken: buildDemoAccessToken(),
    authProvider: 'auth0',
    sessionToken: '__Secure-next-auth.session-token__demo_value__',
    account: {
      id: DEMO_ACCOUNT_ID,
      planType: DEMO_PLAN_TYPE,
      profile: {
        email: DEMO_EMAIL,
      },
    },
  }
  return JSON.stringify(session, null, 2)
}
