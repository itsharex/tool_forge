// Package codexinsight 读取本地 ~/.codex 目录下的 Codex CLI 会话 JSONL,
// 聚合为 Dashboard / 会话列表 / 会话详情 / 全文搜索。纯本地文件扫描,不联网。
package codexinsight

// DailyBucket 某一天的活跃度
type DailyBucket struct {
	Date     string `json:"date"` // YYYY-MM-DD 本地时区
	Messages int    `json:"messages"`
	Sessions int    `json:"sessions"`
}

// ModelTokens 按模型聚合的 token 用量
// Codex 的 token_count 是 session 级别,每个 session 归到其"最后一次 turn_context"的 model。
type ModelTokens struct {
	Model           string `json:"model"`
	InputTokens     int64  `json:"input_tokens"`
	OutputTokens    int64  `json:"output_tokens"`
	CachedTokens    int64  `json:"cached_tokens"`
	ReasoningTokens int64  `json:"reasoning_tokens"`
	Sessions        int    `json:"sessions"`
}

// SessionSummary 精简会话摘要
type SessionSummary struct {
	ID          string `json:"id"`
	Project     string `json:"project"` // cwd
	StartedAt   string `json:"started_at"`
	EndedAt     string `json:"ended_at"`
	Messages    int    `json:"messages"`
	DurationSec int64  `json:"duration_sec"`
	Model       string `json:"model"`
}

// ProjectStat 按项目(cwd)聚合的使用排行
type ProjectStat struct {
	Project  string `json:"project"`
	Sessions int    `json:"sessions"`
	Messages int    `json:"messages"`
}

// DailyTokens 按日期的 token 汇总
type DailyTokens struct {
	Date   string `json:"date"` // YYYY-MM-DD
	Tokens int64  `json:"tokens"`
}

// DashboardReport Dashboard 页数据
type DashboardReport struct {
	TotalSessions    int              `json:"total_sessions"`
	TotalMessages    int              `json:"total_messages"`
	ActiveDays       int              `json:"active_days"`
	FirstUsedAt      string           `json:"first_used_at"`
	LastUsedAt       string           `json:"last_used_at"`
	Last7Days        []DailyBucket    `json:"last_7_days"`
	Calendar         []DailyBucket    `json:"calendar"`
	HourDistribution [24]int          `json:"hour_distribution"`
	TokensByModel    []ModelTokens    `json:"tokens_by_model"`
	TopProjects      []ProjectStat    `json:"top_projects"`   // 按消息数降序,前 8
	TokenTrend       []DailyTokens    `json:"token_trend"`    // 近 30 天 token 走势
	LongestSession   *SessionSummary  `json:"longest_session,omitempty"`
	RecentSessions   []SessionSummary `json:"recent_sessions"`
	CodexDir         string           `json:"codex_dir"`
	ScannedAt        string           `json:"scanned_at"`
}

// SessionListItem 会话列表一行
type SessionListItem struct {
	ID        string `json:"id"`
	Project   string `json:"project"`
	StartedAt string `json:"started_at"`
	EndedAt   string `json:"ended_at"`
	Messages  int    `json:"messages"`
	Preview   string `json:"preview"`
	FilePath  string `json:"file_path"`
	Model     string `json:"model"`
	Cli       string `json:"cli"` // cli_version
	// --- Token 用量（取自 token_count 事件的 session running total） ---
	InputTokens     int64 `json:"input_tokens"`
	OutputTokens    int64 `json:"output_tokens"`
	CachedTokens    int64 `json:"cached_tokens"`
	ReasoningTokens int64 `json:"reasoning_tokens"`
	TotalTokens     int64 `json:"total_tokens"`
}

// SessionList 会话列表返回
type SessionList struct {
	Items     []SessionListItem `json:"items"`
	CodexDir  string            `json:"codex_dir"`
	ScannedAt string            `json:"scanned_at"`
}

// Block 单条消息里的一个块(user/assistant 共用这个类型)
type Block struct {
	Type    string `json:"type"` // "text" | "reasoning" | "function_call" | "function_call_output"
	Text    string `json:"text,omitempty"`
	Name    string `json:"name,omitempty"`    // function_call 的工具名
	Input   string `json:"input,omitempty"`   // function_call 的 arguments
	CallID  string `json:"call_id,omitempty"` // 配对用
	Output  string `json:"output,omitempty"`  // function_call_output 的输出(配对后合并到 function_call)
	IsError bool   `json:"is_error,omitempty"`
}

// Message 一条对话消息
// Codex 没有消息级 UUID,前端定位依赖 UUID = "<sessionID>-<index>" 的人造 id
type Message struct {
	UUID      string  `json:"uuid"`
	Role      string  `json:"role"`
	Timestamp string  `json:"timestamp"`
	Model     string  `json:"model,omitempty"` // 跟随最近一次 turn_context
	Blocks    []Block `json:"blocks"`
}

// SessionDetail 单个会话的结构化详情
type SessionDetail struct {
	SessionID string    `json:"session_id"`
	Project   string    `json:"project"`
	FilePath  string    `json:"file_path"`
	Messages  []Message `json:"messages"`
}

// SearchHit 一条搜索命中
type SearchHit struct {
	SessionID   string `json:"session_id"`
	Project     string `json:"project"`
	FilePath    string `json:"file_path"`
	Role        string `json:"role"`
	Snippet     string `json:"snippet"`
	Timestamp   string `json:"timestamp"`
	MessageUUID string `json:"message_uuid"`
}

// SearchResult 搜索结果
type SearchResult struct {
	Query     string      `json:"query"`
	Hits      []SearchHit `json:"hits"`
	Truncated bool        `json:"truncated"`
	TotalHits int         `json:"total_hits"`
	ScannedAt string      `json:"scanned_at"`
}
