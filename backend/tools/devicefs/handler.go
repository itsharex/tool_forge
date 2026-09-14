package devicefs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

// 把真机浏览开给 agent。
//
// 有几件事是刻意这么定的:
//
//   - **不让 agent 管会话**。工具只收路径,会话在后端找现成的用、没有就连一个。
//     让 agent 记一个 session id 意味着多两次往返,还多一类"忘了断开"的毛病。
//
//   - **和界面共用同一个 Manager**。用户在界面上连着的那条,agent 直接接着用;
//     反过来 agent 连上之后界面也看得见。两条会话同时抢一台设备是要出事的。
//
//   - **密码绝不做成入参**。MCP 的入参会进 agent 的对话记录。iOS 的密码只从
//     系统凭据库读(就是界面上「记住密码」存的那个),读不到就明说让人去界面连一次。
//     Android 不需要密码,直接连。

// PasswordFunc 从系统凭据库取密码。注入进来而不是直接调 system 包:
// 那个包是桌面侧的,测试里没法替换
type PasswordFunc func(key string) (string, error)

// iosPasswordKey 界面上「记住密码」用的 key,和「移动取证」共用一个。
// 写死是因为两边本来就说好用同一个 —— 改这里必须同时改界面
const iosPasswordKey = "forensic:ssh:root@127.0.0.1:22"

// Handler 真机浏览的 MCP 工具
type Handler struct {
	m        *Manager
	password PasswordFunc
	// cacheDir 预览时那份本地副本放哪儿
	cacheDir string
}

func NewHandler(m *Manager, pw PasswordFunc, cacheDir string) *Handler {
	return &Handler{m: m, password: pw, cacheDir: cacheDir}
}

func (h *Handler) Name() string  { return "device-browse" }
func (h *Handler) Title() string { return "真机数据浏览" }
func (h *Handler) Description() string {
	return "直接看连着的手机上的文件,不用先导出。" +
		"op=list 列目录,read 读一个文件(plist / MMKV / SQLite / 文本会自动解析),search 按名字找," +
		"changes 对比这个目录和上次看到的样子(用来定位「在手机上做了某个操作之后,哪些文件变了」)," +
		"sessions 看现在连着什么。" +
		"Android 会自动连;iOS 需要先在界面里连一次(密码不走这个接口)"
}
func (h *Handler) Methods() []string { return []string{http.MethodPost} }

type browseRequest struct {
	// Op list | read | search | changes | sessions
	Op string `json:"op"`
	// Platform android | ios;不给时优先用已经连着的那台
	Platform string `json:"platform,omitempty"`
	// Path 要看的路径;list / changes 给目录,read 给文件
	Path string `json:"path,omitempty"`
	// Pattern search 用:按名字匹配的片段
	Pattern string `json:"pattern,omitempty"`
	// Limit search 最多返回几条
	Limit int `json:"limit,omitempty"`
	// Reset changes 用:丢掉旧基线,这次重新开始
	Reset bool `json:"reset,omitempty"`
}

func (h *Handler) Handle(_ context.Context, body []byte) ([]byte, error) {
	var req browseRequest
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			return nil, errors.New("请求体不是合法 JSON: " + err.Error())
		}
	}
	if req.Op == "" {
		req.Op = "list"
	}
	if req.Op == "sessions" {
		return json.Marshal(map[string]any{"sessions": h.m.Sessions()})
	}

	s, err := h.session(req.Platform)
	if err != nil {
		return nil, err
	}

	switch req.Op {
	case "list":
		dir := req.Path
		if dir == "" {
			dir = s.StartPath
		}
		lst, err := h.m.List(s.ID, dir)
		if err != nil {
			return nil, err
		}
		return json.Marshal(lst)

	case "read":
		if req.Path == "" {
			return nil, errors.New("read 要给 path")
		}
		p, err := h.m.Preview(s.ID, req.Path, h.cacheDir)
		if err != nil {
			return nil, err
		}
		return json.Marshal(p)

	case "search":
		if req.Pattern == "" {
			return nil, errors.New("search 要给 pattern")
		}
		root := req.Path
		if root == "" {
			root = s.StartPath
		}
		res, err := h.m.Search(s.ID, root, req.Pattern, req.Limit)
		if err != nil {
			return nil, err
		}
		return json.Marshal(res)

	case "changes":
		dir := req.Path
		if dir == "" {
			dir = s.StartPath
		}
		if req.Reset {
			h.m.ResetSnapshot(s.ID, dir)
		}
		res, err := h.m.Diff(s.ID, dir)
		if err != nil {
			return nil, err
		}
		return json.Marshal(res)

	default:
		return nil, fmt.Errorf("不认识的 op %q,可选 list / read / search / changes / sessions", req.Op)
	}
}

// session 拿一条能用的会话。
//
// 已经连着的优先(界面上连的也算)。都没有时:安卓自己连,
// iOS 去凭据库找密码 —— 找不到就说清楚该怎么办,而不是让 agent 去要密码
func (h *Handler) session(platform string) (*Session, error) {
	live := h.m.Sessions()
	if platform == "" {
		if len(live) > 0 {
			return h.m.get(live[0].ID)
		}
		// 一台都没连时默认试安卓:它不需要密码,试了不成也只是一条错误
		platform = "android"
	}
	for _, s := range live {
		if s.Platform == platform {
			return h.m.get(s.ID)
		}
	}

	opt := ConnectOptions{Platform: platform}
	if platform == "ios" {
		pw, err := h.password(iosPasswordKey)
		if err != nil || pw == "" {
			return nil, errors.New("还没连上 iOS 设备,而且凭据库里没有存过密码 —— " +
				"请先在「真机浏览」里连一次(勾上「记住密码」),之后这里就能直接用")
		}
		opt.Password = pw
	}
	return h.m.EnsureSession(opt)
}

func (h *Handler) InputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"op"},
		"properties": map[string]any{
			"op": map[string]any{
				"type": "string",
				"enum": []string{"list", "read", "search", "changes", "sessions"},
				"description": "list 列目录 · read 读文件(自动解析 plist/MMKV/SQLite/文本) · " +
					"search 按名字找 · changes 和上次看到的样子对比 · sessions 看连着什么",
			},
			"platform": map[string]any{
				"type": "string", "enum": []string{"android", "ios"},
				"description": "不给就用已经连着的那台",
			},
			"path": map[string]any{
				"type":        "string",
				"description": "设备上的绝对路径。list/changes 给目录,read 给文件;不给就用该平台的默认起点",
			},
			"pattern": map[string]any{"type": "string", "description": "search 用:文件名里的一段"},
			"limit":   map[string]any{"type": "integer", "description": "search 最多返回几条"},
			"reset": map[string]any{
				"type":        "boolean",
				"description": "changes 用:丢掉旧基线重新开始。想测「做某个操作前后的差异」时,操作前先带 reset 调一次",
			},
		},
		"examples": []any{
			map[string]any{"op": "sessions"},
			map[string]any{"op": "list", "path": "/data/data/com.example.chat/databases"},
			map[string]any{"op": "read", "path": "/data/data/com.example.chat/shared_prefs/config.xml"},
			map[string]any{"op": "search", "pattern": ".db", "limit": 50},
			// 先 reset 拍基线 → 去手机上操作 → 再调一次看差异
			map[string]any{"op": "changes", "path": "/data/data/com.example.chat", "reset": true},
			map[string]any{"op": "changes", "path": "/data/data/com.example.chat"},
		},
	}
}

// DefaultCacheDir 预览副本放哪儿。和界面用的是同一个位置,
// 省得同一个文件被拉两遍
func DefaultCacheDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "toolforge-device-cache")
	}
	return filepath.Join(home, ".toolforge", "device-cache")
}
