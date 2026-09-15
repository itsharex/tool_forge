/**
 * 把一串模型 ID 分成人能扫的几堆。
 *
 * 原来这里是两张写死的前缀表 —— 抽屉里一张、供应商详情页另一张,同一批模型在相邻的两处
 * 分法还不一样。更要命的是表里没列到的家族一律掉进「其他」:中转上新出 grok、gpt-6 之后,
 * 二十几个模型全挤在那一堆,分组等于没做。
 *
 * 所以这里不认家族名,只从 ID 的形状里切「家族 + 主版本号」。新家族、新版本都不用改代码。
 */

/**
 * 按用途分的几类。它们横跨各家家族(text-embedding-3、gemini-*-image 都在内),
 * 而且用法和聊天模型完全不同,所以先于家族判断。
 */
const PURPOSE: { match: string; label: string }[] = [
  { match: 'embedding', label: 'Embedding' },
  { match: 'rerank', label: 'Rerank' },
  { match: 'whisper', label: 'Whisper' },
  { match: 'tts', label: 'TTS' },
  { match: 'image', label: 'Image' },
  { match: 'dall', label: 'Image' },
]

/**
 * 少数家族的正规写法。
 *
 * 这只是显示用的:不在表里的照样能正确分组,只是显示成首字母大写(grok → Grok)。
 * 和原来那两张表的区别就在这儿 —— 漏了词最多是不好看,不会把模型丢进「其他」。
 */
const DISPLAY: Record<string, string> = {
  gpt: 'GPT',
  chatgpt: 'ChatGPT',
  glm: 'GLM',
  qwen: 'Qwen',
  qwq: 'QwQ',
  qvq: 'QVQ',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  ernie: 'ERNIE',
}

function display(name: string): string {
  return DISPLAY[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

/** 模型 ID → 分组名 */
export function modelGroup(id: string): string {
  const s = id.toLowerCase().trim()
  // 中转常给模型加命名空间前缀(openai/gpt-4o、deepseek-ai/DeepSeek-V3)。
  // 那是渠道不是型号,按它分会把一家的所有模型糊成一堆
  const bare = s.slice(s.lastIndexOf('/') + 1)
  if (!bare) return '其他'

  for (const p of PURPOSE) {
    if (bare.includes(p.match)) return p.label
  }

  // 只按分隔符切,不切小数点 —— "5.6" 要留成一段才认得出主版本是 5
  const parts = bare.split(/[-_\s:]+/).filter(Boolean)
  if (parts.length === 0) return '其他'

  // 家族名自带版本号的:qwen3-max、o3-mini、glm4v。数字连着字母写,显示时也不加横杠
  const inFamily = /^([a-z]+)(\d+)/.exec(parts[0])
  if (inFamily) {
    const [, name, major] = inFamily
    // o 系列惯例是小写连写(o1 / o3 / o4),照搬 —— 写成 O3 反而认不出来
    return name === 'o' ? name + major : display(name) + major
  }

  // 版本取后面第一个像版本号的段:"4o"、"3.5"、"v3"。
  // 只留主版本 —— 连小版本一起分的话 gpt-5.1 / gpt-5.2 各成一组,
  // 一屏几十个只有一个成员的组比不分还难扫。
  //
  // 只看紧跟家族名的两段:版本号都是挨着家族名写的(gpt-4o、claude-opus-4-5),
  // 离得更远的数字是修订号或尺寸(grok-code-fast-1、llama-3-70b 的 70b),
  // 一路往后找会把 grok-code-fast-1 分进"Grok-1"
  for (const seg of parts.slice(1, 3)) {
    const m = /^v?(\d+)/.exec(seg)
    if (m) return display(parts[0]) + '-' + m[1]
  }
  // 认不出版本就只按家族分(codex-auto-review、deepseek-chat)
  return display(parts[0])
}
