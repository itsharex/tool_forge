// Package aiconfig 把本机各家 AI 工具的配置汇到一处看。
//
// 为什么要有这个包:同一台机器上,MCP 服务器散在四个地方(我们自己的 servers.json、
// Claude 的 ~/.claude.json 全局段、~/.claude.json 里每个项目各自一份、Codex 的
// config.toml),skills 散在三个地方(~/.claude/skills、~/.codex/skills、还有插件自带的),
// 插件的"装了"和"启用了"又分别记在两个文件里。
//
// 人要回答"我现在到底有哪些 MCP / 这个 skill 是哪来的",得挨个去翻。翻错一个就以为
// 某个东西没配,实际是配在了另一处。所以这个包只做一件事:扫全、并且每一条都带上
// 它出自哪个文件的绝对路径。
//
// 只读扫描。改动走各自的 owner —— 见 file.go 的说明。
package aiconfig

// Origin 这条配置属于哪家工具。
//
// 列的是 2026-09 在一台开发机上实际扫到的:装了、且把 MCP 或 skills 落成了文件的。
// Cursor 装了但什么都没配,所以它没有专门的扫描;哪天配了,按 ~/.cursor/mcp.json 补一条即可。
type Origin string

const (
	OriginToolForge Origin = "toolforge"
	OriginClaude    Origin = "claude"
	OriginCodex     Origin = "codex"
	OriginGemini    Origin = "gemini"
	OriginCline     Origin = "cline"
	OriginContinue  Origin = "continue"
	OriginTrae      Origin = "trae"
	OriginCursor    Origin = "cursor"
	// OriginShared ~/.agents/skills:跨工具共享的 skills 池。
	// Continue / Trae 的 skills 目录里全是指向它的软链
	OriginShared Origin = "shared"
)

// Source 一条配置的出处。
//
// File 是绝对路径,整个包的价值就在这个字段上 —— 不写明出自哪个文件,
// 汇总页就只是把四个地方的东西混成一锅,反而更难查。
type Source struct {
	File   string `json:"file"`
	Origin Origin `json:"origin"`
	// Scope 人话形式的范围:「全局」「项目 C:\xxx」「插件 codex」
	Scope string `json:"scope"`
}

// MCPEntry 一台 MCP 服务器
type MCPEntry struct {
	Name string `json:"name"`
	// Kind stdio / http
	Kind    string   `json:"kind"`
	Command string   `json:"command,omitempty"`
	Args    []string `json:"args,omitempty"`
	URL     string   `json:"url,omitempty"`
	// EnvKeys 只给键名,不给值 —— 环境变量里常年躺着 API key,
	// 汇总页没有任何理由把它们摊开
	EnvKeys []string `json:"envKeys,omitempty"`
	Enabled bool     `json:"enabled"`
	// Toggleable 这一条能不能在本页启停。
	// 只有我们自己注册表里的可以;别家的配置由别家的程序在管,
	// 我们去改它的启停语义(各家还不一样)只会把人坑了
	Toggleable bool   `json:"toggleable"`
	ID         string `json:"id,omitempty"` // 我们自己的那条才有,启停要用
	Source     Source `json:"source"`
}

// SkillEntry 一个 skill
type SkillEntry struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Dir         string `json:"dir"`
	FileCount   int    `json:"fileCount"`
	HasSkillMD  bool   `json:"hasSkillMd"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	// LinkTarget 这个目录是软链时,它真正指向哪里。
	// 不标的话,同一份 skill 在三家各出现一次,看着像三份,实际改一处全变
	LinkTarget string `json:"linkTarget,omitempty"`
	Source     Source `json:"source"`
}

// PluginEntry 一个插件
type PluginEntry struct {
	// Name 形如 codex@openai-codex(插件名@市场名)
	Name        string `json:"name"`
	Version     string `json:"version,omitempty"`
	Description string `json:"description,omitempty"`
	InstallPath string `json:"installPath,omitempty"`
	// Installed / Enabled 是两件事,分别记在两个文件里:
	// installed_plugins.json 记装没装,settings.json 的 enabledPlugins 记启没启用。
	// 实测这两边会对不上(启用了但没装),那正是最该让人看见的状态
	Installed bool `json:"installed"`
	Enabled   bool `json:"enabled"`
	// SkillCount 这个插件自带几个 skill
	SkillCount int    `json:"skillCount"`
	Source     Source `json:"source"`
}

// Problem 扫描过程中遇到的麻烦。
//
// 必须单独报出来,不能默默跳过:一个配置文件解析失败时,页面上的表现是
// "这一处什么都没有",和"这一处本来就是空的"一模一样 —— 而前者是要处理的。
type Problem struct {
	File   string `json:"file"`
	Detail string `json:"detail"`
}

// OriginInfo 一家工具的扫描概况:它在这台机器上到底有没有、配置在哪
type OriginInfo struct {
	Origin Origin `json:"origin"`
	// Present 这家工具在本机有没有留下配置目录。没有的也列出来,
	// 页面上才能回答"我装了 Cursor 吗"这种问题,而不是让它凭空消失
	Present bool `json:"present"`
	// Root 这家的配置根目录(或主配置文件)
	Root    string `json:"root,omitempty"`
	MCP     int    `json:"mcp"`
	Skills  int    `json:"skills"`
	Plugins int    `json:"plugins"`
}

// Snapshot 一次全量扫描的结果
type Snapshot struct {
	MCP      []MCPEntry    `json:"mcp"`
	Skills   []SkillEntry  `json:"skills"`
	Plugins  []PluginEntry `json:"plugins"`
	Problems []Problem     `json:"problems"`
	// Origins 每家一条,含没装的 —— 页面按来源分组时要有个稳定的顺序和空态
	Origins []OriginInfo `json:"origins"`
	// Roots 这次扫了哪几个根目录,给界面显示"我看的是这些地方"
	Roots []string `json:"roots"`
}
