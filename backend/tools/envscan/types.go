// Package envscan 扫描本机已安装的开发者工具（语言、包管理器、AI CLI 等），
// 提取版本号返回给前端展示。不存在的工具不返回，未展示的条目不占带宽。
package envscan

// Category 工具大类
type Category string

const (
	CategoryLanguage  Category = "language"        // 语言 / 运行时
	CategoryPackage   Category = "package_manager" // 包管理器
	CategoryAI        Category = "ai_cli"          // AI 命令行
	CategoryToolchain Category = "toolchain"       // 开发工具链
	CategoryDatabase  Category = "database"        // 数据库客户端
)

// Status 扫描状态。未安装的条目不会返回，所以这里没有 not_installed。
type Status string

const (
	StatusInstalled Status = "installed" // 装了并拿到版本
	StatusError     Status = "error"     // 装了但执行 / 解析版本失败
)

// Item 清单项（catalog 硬编码）。
type Item struct {
	// Name 展示名，如 "Go" "Node.js"
	Name string
	// Command 可执行文件名，会走 PATH 查找
	Command string
	// Args 传给命令的参数，典型是 []string{"--version"}
	Args []string
	// VersionRegex 从命令输出里提取版本号的正则；必须有一个 capture group。
	// 为空时取输出里首个匹配 \d+\.\d+(?:\.\d+)? 的子串。
	VersionRegex string
	// Category 归类
	Category Category
}

// Result 返回给前端的单条结果
type Result struct {
	Name     string   `json:"name"`
	Command  string   `json:"command"`
	Version  string   `json:"version"`
	Path     string   `json:"path"`
	Category Category `json:"category"`
	Status   Status   `json:"status"`
	Error    string   `json:"error,omitempty"`
}

// ScanReport 顶层扫描结果；前端一次拿完。
type ScanReport struct {
	Results   []Result `json:"results"`
	ScannedAt string   `json:"scanned_at"` // RFC3339
}
