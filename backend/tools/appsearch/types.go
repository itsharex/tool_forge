// Package appsearch 搜索 App 包名（iOS bundleId / Android 包名），
// 汇聚 iTunes / 七麦 / 应用宝 / Google Play 多源结果。
package appsearch

// SourceID 搜索源标识
type SourceID string

const (
	SourceITunes       SourceID = "itunes"
	SourceQimaiIOS     SourceID = "qimai_ios"
	SourceQimaiAndroid SourceID = "qimai_android" // Phase 2
	SourceYingYongBao  SourceID = "yingyongbao"   // Phase 2
	SourceGooglePlay   SourceID = "googleplay"    // Phase 3
)

// Platform 应用平台
type Platform string

const (
	PlatformIOS     Platform = "ios"
	PlatformAndroid Platform = "android"
)

// SearchRequest 前端发起的搜索请求
type SearchRequest struct {
	Keyword string     `json:"keyword"`
	Sources []SourceID `json:"sources"` // 空则用该平台下所有默认源
	// iOS 国家码（cn/us/jp/gb/...）。七麦 iOS 也吃这个。
	Country string `json:"country,omitempty"`
	// Android 厂商市场 ID（七麦用；应用宝不需要）
	// 华为=6 应用宝=3 小米=4 OPPO=9 VIVO=8 魅族=7 百度=2 360=1 豌豆荚=5 GooglePlay=10 鸿蒙=11
	Market int `json:"market,omitempty"`
	// LimitPerSource 每个源最多返回多少条;<=0 走默认 5;上限 50。
	// 前端"包名搜索"工具页传 20 保留浏览体验,外部 API 默认 5 拿到精简结果。
	LimitPerSource int `json:"limit_per_source,omitempty"`

	// qimaiPhpSessID 由 app.go 从 keyring 读入后注入，前端看不到也传不进来。
	qimaiPhpSessID string
}

// DefaultLimitPerSource 外部 API 调用 / 调用方未指定时的默认每源上限。
const DefaultLimitPerSource = 5

// MaxLimitPerSource 上限,避免调用方传超大值把后端打爆。
const MaxLimitPerSource = 50

// SetQimaiPhpSessID 供 app 层注入（保持 SearchRequest 的前端可序列化性）。
func (r *SearchRequest) SetQimaiPhpSessID(v string) { r.qimaiPhpSessID = v }
func (r *SearchRequest) QimaiPhpSessID() string     { return r.qimaiPhpSessID }

// KeyringQimaiPhpSessID 七麦 PHPSESSID 在系统凭据库中使用的 key。
// 前后端约定一致，Profile 存、Service 读。
const KeyringQimaiPhpSessID = "tool-forge:appsearch:qimai-phpsessid"

// SearchResultItem 单条搜索结果（跨源统一字段）
type SearchResultItem struct {
	Source    SourceID `json:"source"`
	Platform  Platform `json:"platform"`
	PkgName   string   `json:"pkgName"`             // iOS bundleId 或 Android 包名；拿不到留空
	Name      string   `json:"name"`                // 应用名
	Developer string   `json:"developer,omitempty"` // 开发者/发行方
	Icon      string   `json:"icon,omitempty"`
	Version   string   `json:"version,omitempty"`
	Rating    float64  `json:"rating,omitempty"`
	Country   string   `json:"country,omitempty"`
	// 源特有 ID / 附加字段（iTunes trackId、七麦 qmAppId 等）
	Extra map[string]string `json:"extra,omitempty"`
}

// SourceStatus 单个源的执行状态
type SourceStatus struct {
	Source SourceID `json:"source"`
	OK     bool     `json:"ok"`
	Error  string   `json:"error,omitempty"`
	Count  int      `json:"count"`
}

// SearchResponse 总响应：结果已合并并去重
type SearchResponse struct {
	Items    []SearchResultItem `json:"items"`
	Statuses []SourceStatus     `json:"statuses"`
}
