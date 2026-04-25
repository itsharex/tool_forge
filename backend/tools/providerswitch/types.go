// Package providerswitch 多 Provider 配置切换器:
// - Claude Code → 写入 ~/.claude/settings.json 的 env 块(只 merge,不覆盖其他字段)
// - Codex      → 写入 ~/.codex/config.toml + auth.json (后续阶段实现)
//
// Provider 列表持久化到 ~/.toolforge/providers.json,
// 写入官方配置文件前会自动备份一份 .bak。
package providerswitch

// ProviderType 当前只支持 claude_code,codex / codex_oauth 留待 Phase 2/3
type ProviderType string

const (
	TypeClaudeCode ProviderType = "claude_code"
	TypeCodex      ProviderType = "codex"
	TypeCodexOAuth ProviderType = "codex_oauth"
)

// Provider 用户保存的一条 Provider 配置
type Provider struct {
	ID      string       `json:"id"`
	Name    string       `json:"name"`
	Type    ProviderType `json:"type"`
	BaseURL string       `json:"baseUrl"`
	APIKey  string       `json:"apiKey"`
	Model   string       `json:"model,omitempty"` // 主模型;为空时走 PresetDefaultModel

	// Claude Code 特有的细分模型(为空 → 自动落到 Model)
	HaikuModel    string `json:"haikuModel,omitempty"`
	SonnetModel   string `json:"sonnetModel,omitempty"`
	OpusModel     string `json:"opusModel,omitempty"`
	ThinkingModel string `json:"thinkingModel,omitempty"`

	// Codex OAuth 字段(Phase 3)
	OAuthAccessToken  string `json:"oauthAccessToken,omitempty"`
	OAuthRefreshToken string `json:"oauthRefreshToken,omitempty"`
	OAuthIDToken      string `json:"oauthIdToken,omitempty"`
	OAuthAccountID    string `json:"oauthAccountId,omitempty"`

	// IsDefault 默认条目;代表用户原本通过 CLI 登录(Claude OAuth / ChatGPT 订阅)
	// 在使用的状态。激活时会清掉本工具写过的 ANTHROPIC_*/OPENAI_* keys,
	// 让 CLI 回到自己的登录态。不可删除,UI 中只允许改名。
	IsDefault bool `json:"isDefault,omitempty"`

	// 元信息
	IsActive  bool  `json:"isActive"`
	CreatedAt int64 `json:"createdAt"` // unix ms
	UpdatedAt int64 `json:"updatedAt"`
}

// 默认条目的固定 ID(便于幂等检查 + 升级时识别)
const (
	DefaultClaudeID = "default-claude"
	DefaultCodexID  = "default-codex"
)

// Claude / Codex 写入器在激活时会写 / 删的 env / config key 集合。
// 用 const 单独维护,激活官方条目时按这个集合做删除,不动其他 env key。
var (
	ClaudeOwnedEnvKeys = []string{
		"ANTHROPIC_AUTH_TOKEN",
		"ANTHROPIC_API_KEY", // 兼容老配置
		"ANTHROPIC_BASE_URL",
		"ANTHROPIC_MODEL",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL",
		"ANTHROPIC_DEFAULT_SONNET_MODEL",
		"ANTHROPIC_DEFAULT_OPUS_MODEL",
		"ANTHROPIC_SMALL_FAST_MODEL",
	}
)

// Preset 预设模板,用于"新增 Provider"时一键预填
type Preset struct {
	Name    string       `json:"name"`
	Type    ProviderType `json:"type"`
	BaseURL string       `json:"baseUrl"`
	Model   string       `json:"model,omitempty"`
	Hint    string       `json:"hint,omitempty"` // 提示申请地址等
}

// TestResult Provider 连通性测试结果
type TestResult struct {
	OK         bool   `json:"ok"`
	StatusCode int    `json:"statusCode,omitempty"`
	DurationMs int    `json:"durationMs"`
	Message    string `json:"message,omitempty"` // 失败原因 / 成功响应摘要
}

// ApplyResult 激活 Provider 的写入结果
type ApplyResult struct {
	OK         bool   `json:"ok"`
	WrittenTo  string `json:"writtenTo,omitempty"` // 写入的目标文件路径
	BackupPath string `json:"backupPath,omitempty"`
	Message    string `json:"message,omitempty"`
}

// 默认模型常量
const (
	DefaultClaudeModel = "claude-sonnet-4-5"
	DefaultCodexModel  = "gpt-5"
)

// Presets 内置预设(从 CCManager 借鉴 + 国内常用)
// 注意:Claude OAuth / ChatGPT 订阅 OAuth 由 default 条目代表(初始已激活);
// 这里的预设都是"用 API Key 接入"的第三方中转或 console.anthropic.com 申请的 Key。
var Presets = []Preset{
	{Name: "Anthropic API Key", Type: TypeClaudeCode, BaseURL: "https://api.anthropic.com", Model: DefaultClaudeModel, Hint: "console.anthropic.com 申请的 API Key"},
	{Name: "GLM 智谱", Type: TypeClaudeCode, BaseURL: "https://open.bigmodel.cn/api/anthropic", Model: "glm-4.6", Hint: "open.bigmodel.cn"},
	{Name: "GLM Global", Type: TypeClaudeCode, BaseURL: "https://api.z.ai/api/anthropic", Model: "glm-4.6", Hint: "z.ai"},
	{Name: "MiniMax", Type: TypeClaudeCode, BaseURL: "https://api.minimaxi.com/anthropic", Model: "MiniMax-M2", Hint: "platform.minimaxi.com"},
	{Name: "Kimi 月之暗面", Type: TypeClaudeCode, BaseURL: "https://api.moonshot.cn/anthropic", Model: "kimi-k2-0905-preview", Hint: "platform.moonshot.cn"},
	{Name: "DeepSeek", Type: TypeClaudeCode, BaseURL: "https://api.deepseek.com/anthropic", Model: "deepseek-chat", Hint: "platform.deepseek.com"},
	{Name: "OpenRouter", Type: TypeClaudeCode, BaseURL: "https://openrouter.ai/api/v1", Model: "anthropic/claude-sonnet-4.5", Hint: "openrouter.ai"},
	{Name: "OpenAI 官方", Type: TypeCodex, BaseURL: "https://api.openai.com/v1", Model: DefaultCodexModel, Hint: "platform.openai.com"},
	{Name: "OpenRouter (Codex)", Type: TypeCodex, BaseURL: "https://openrouter.ai/api/v1", Model: "openai/gpt-5", Hint: "openrouter.ai"},
}
