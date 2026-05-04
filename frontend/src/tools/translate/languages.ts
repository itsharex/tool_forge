/**
 * 翻译支持的语言清单
 *
 * - id:稳定标识(ISO 639-1 为主,'auto' 表示自动检测)
 * - name:发给模型的英文语言名(用作 {{target_language}} 替换值)
 * - label:UI 显示中文名(本工具默认中文用户)
 * - country:ISO 3166-1 alpha-2 国家代码(用于 SVG 国旗)
 * - franc:franc-min 返回的 ISO 639-3 代码,用于"算法检测"反查
 */
export interface LangItem {
  id: string
  name: string // 用于 prompt 模板的 {{target_language}}
  label: string
  country?: string // 国旗用,'auto' 没有
  franc?: string
}

export const AUTO_DETECT_ID = 'auto'

export const LANGUAGES: LangItem[] = [
  { id: AUTO_DETECT_ID, name: 'Auto', label: '自动检测' },
  { id: 'zh', name: 'Chinese (Simplified)', label: '简体中文', country: 'CN', franc: 'cmn' },
  { id: 'zh-Hant', name: 'Chinese (Traditional)', label: '繁体中文', country: 'HK' },
  { id: 'en', name: 'English', label: '英语', country: 'GB', franc: 'eng' },
  { id: 'ja', name: 'Japanese', label: '日语', country: 'JP', franc: 'jpn' },
  { id: 'ko', name: 'Korean', label: '韩语', country: 'KR', franc: 'kor' },
  { id: 'fr', name: 'French', label: '法语', country: 'FR', franc: 'fra' },
  { id: 'de', name: 'German', label: '德语', country: 'DE', franc: 'deu' },
  { id: 'es', name: 'Spanish', label: '西班牙语', country: 'ES', franc: 'spa' },
  { id: 'it', name: 'Italian', label: '意大利语', country: 'IT', franc: 'ita' },
  { id: 'pt', name: 'Portuguese', label: '葡萄牙语', country: 'PT', franc: 'por' },
  { id: 'ru', name: 'Russian', label: '俄语', country: 'RU', franc: 'rus' },
  { id: 'ar', name: 'Arabic', label: '阿拉伯语', country: 'SA', franc: 'arb' },
  { id: 'th', name: 'Thai', label: '泰语', country: 'TH', franc: 'tha' },
  { id: 'vi', name: 'Vietnamese', label: '越南语', country: 'VN', franc: 'vie' },
  { id: 'id', name: 'Indonesian', label: '印尼语', country: 'ID', franc: 'ind' },
  { id: 'ms', name: 'Malay', label: '马来语', country: 'MY', franc: 'zlm' },
  { id: 'tr', name: 'Turkish', label: '土耳其语', country: 'TR', franc: 'tur' },
  { id: 'pl', name: 'Polish', label: '波兰语', country: 'PL', franc: 'pol' },
  { id: 'nl', name: 'Dutch', label: '荷兰语', country: 'NL', franc: 'nld' },
  { id: 'sv', name: 'Swedish', label: '瑞典语', country: 'SE', franc: 'swe' },
  { id: 'da', name: 'Danish', label: '丹麦语', country: 'DK', franc: 'dan' },
  { id: 'no', name: 'Norwegian', label: '挪威语', country: 'NO', franc: 'nob' },
  { id: 'fi', name: 'Finnish', label: '芬兰语', country: 'FI', franc: 'fin' },
  { id: 'el', name: 'Greek', label: '希腊语', country: 'GR', franc: 'ell' },
  { id: 'hi', name: 'Hindi', label: '印地语', country: 'IN', franc: 'hin' },
  { id: 'cs', name: 'Czech', label: '捷克语', country: 'CZ', franc: 'ces' },
  { id: 'uk', name: 'Ukrainian', label: '乌克兰语', country: 'UA', franc: 'ukr' },
  { id: 'he', name: 'Hebrew', label: '希伯来语', country: 'IL', franc: 'heb' },
]

export function findLang(id: string): LangItem | undefined {
  return LANGUAGES.find((l) => l.id === id)
}

/** franc(ISO 639-3) → 我们的 LangItem */
export function fromFrancCode(code: string): LangItem | undefined {
  if (!code || code === 'und') return undefined
  return LANGUAGES.find((l) => l.franc === code)
}
