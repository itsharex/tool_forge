// Package claudeinsight 读取本地 ~/.claude 目录下的 Claude Code 会话 JSONL,
// 聚合为 Dashboard 统计指标返回给前端。纯本地文件扫描,不产生任何网络请求。
package claudeinsight

// DailyBucket 某一天的活跃度(用于近 7 天 & 日历热力图)
type DailyBucket struct {
	Date     string `json:"date"` // YYYY-MM-DD (本地时区)
	Messages int    `json:"messages"`
	Sessions int    `json:"sessions"`
}

// ModelTokens 按模型聚合的 token 用量
type ModelTokens struct {
	Model                 string `json:"model"`
	InputTokens           int64  `json:"input_tokens"`
	OutputTokens          int64  `json:"output_tokens"`
	CacheCreationTokens   int64  `json:"cache_creation_tokens"`
	CacheReadTokens       int64  `json:"cache_read_tokens"`
	Messages              int    `json:"messages"`
}

// SessionSummary 一个会话的精简摘要(用于最近会话列表 / 最长会话)
type SessionSummary struct {
	ID          string `json:"id"`
	Project     string `json:"project"`      // cwd
	StartedAt   string `json:"started_at"`   // RFC3339
	EndedAt     string `json:"ended_at"`     // RFC3339
	Messages    int    `json:"messages"`     // user+assistant 消息总数
	DurationSec int64  `json:"duration_sec"` // 会话时长
}

// Block 会话消息里的一个内容块。assistant 的 message.content 常是多块组成,
// user 的 message.content 通常是单块(string 或含 tool_result 的数组)。
type Block struct {
	Type    string `json:"type"`              // "text" | "thinking" | "tool_use" | "tool_result"
	Text    string `json:"text,omitempty"`    // text / thinking 的正文
	Name    string `json:"name,omitempty"`    // tool_use 的工具名
	Input   string `json:"input,omitempty"`   // tool_use 的输入,已序列化为 JSON 字符串
	ToolID  string `json:"tool_id,omitempty"` // tool_use id 或 tool_result 对应 id
	Output  string `json:"output,omitempty"`  // tool_result 的输出(如果多块则拼接 text)
	IsError bool   `json:"is_error,omitempty"`
}

// TokenUsage assistant 消息的 token 用量(用于回合容器汇总展示)
type TokenUsage struct {
	Input         int64 `json:"input"`
	Output        int64 `json:"output"`
	CacheCreation int64 `json:"cache_creation"`
	CacheRead     int64 `json:"cache_read"`
}

// Message 一条完整的对话消息(user 或 assistant),blocks 里是若干按序的内容块。
type Message struct {
	UUID      string      `json:"uuid"`
	Role      string      `json:"role"`            // "user" | "assistant"
	Timestamp string      `json:"timestamp"`       // RFC3339
	Model     string      `json:"model,omitempty"` // assistant 才有
	Tokens    *TokenUsage `json:"tokens,omitempty"`
	Blocks    []Block     `json:"blocks"`
}

// SessionDetail 整个会话的结构化详情
type SessionDetail struct {
	SessionID string    `json:"session_id"`
	Project   string    `json:"project"`
	FilePath  string    `json:"file_path"`
	Messages  []Message `json:"messages"`
}

// SessionListItem 会话列表页的一行数据
type SessionListItem struct {
	ID        string `json:"id"`
	Project   string `json:"project"`     // cwd 原值
	StartedAt string `json:"started_at"`  // RFC3339
	EndedAt   string `json:"ended_at"`    // RFC3339
	Messages  int    `json:"messages"`    // user+assistant 总数
	Preview   string `json:"preview"`     // 第一条 user 消息截断后的文本
	FilePath  string `json:"file_path"`   // jsonl 文件绝对路径,详情页按路径再次读取
}

// SessionList 会话列表结果
type SessionList struct {
	Items     []SessionListItem `json:"items"`
	ClaudeDir string            `json:"claude_dir"`
	ScannedAt string            `json:"scanned_at"`
}

// DashboardReport v1 只返回这一个结构;Stats 字段以后可以逐步扩展。
type DashboardReport struct {
	// --- 总量 ---
	TotalSessions int    `json:"total_sessions"`
	TotalMessages int    `json:"total_messages"`
	ActiveDays    int    `json:"active_days"`
	FirstUsedAt   string `json:"first_used_at"` // RFC3339
	LastUsedAt    string `json:"last_used_at"`  // RFC3339

	// --- 分布 ---
	Last7Days        []DailyBucket `json:"last_7_days"`        // 按日期升序,固定 7 条
	Calendar         []DailyBucket `json:"calendar"`           // 近 365 天有记录的天数;前端自己补齐空白
	HourDistribution [24]int       `json:"hour_distribution"`  // 本地时区下每小时消息数

	// --- Token ---
	TokensByModel []ModelTokens `json:"tokens_by_model"` // 按总 token 量降序

	// --- 会话 ---
	LongestSession *SessionSummary  `json:"longest_session,omitempty"` // 按消息数最多
	RecentSessions []SessionSummary `json:"recent_sessions"`           // 按结束时间倒序,前 10 条

	// --- 元信息 ---
	ClaudeDir string `json:"claude_dir"` // 实际扫描的目录
	ScannedAt string `json:"scanned_at"` // RFC3339
}
