package sqlitex

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

// 两个工具,不合成一个:MCP 那头每个工具一套入参 schema,
// "搜"和"翻表"要的参数完全不同,揉在一起只会让 agent 猜错该填什么。

// SearchHandler 按关键词搜一棵目录树里的所有 SQLite 库
type SearchHandler struct{}

func NewSearchHandler() *SearchHandler { return &SearchHandler{} }

func (h *SearchHandler) Name() string  { return "sqlite-search" }
func (h *SearchHandler) Title() string { return "SQLite 关键词搜索" }
func (h *SearchHandler) Description() string {
	return "在一个目录树(或单个文件)里找出所有 SQLite 库,按关键词搜全部表的全部列,返回命中的整行。" +
		"按文件头识别,不看扩展名;不改动原始文件"
}
func (h *SearchHandler) Methods() []string { return []string{http.MethodPost} }

func (h *SearchHandler) Handle(ctx context.Context, body []byte) ([]byte, error) {
	var req SearchOptions
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			return nil, errors.New("请求体不是合法 JSON: " + err.Error())
		}
	}
	if req.Root == "" {
		return nil, errors.New("root 不能为空")
	}
	if len(req.Keywords) == 0 {
		return nil, errors.New("keywords 不能为空")
	}
	res, err := Search(ctx, req)
	if err != nil {
		return nil, err
	}
	return json.Marshal(res)
}

func (h *SearchHandler) InputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"root", "keywords"},
		"properties": map[string]any{
			"root": map[string]any{
				"type": "string",
				"description": "搜哪儿。可以是取证导出的整个目录(会递归找出里面所有 SQLite 库)," +
					"也可以是单个 db 文件",
			},
			"keywords": map[string]any{
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"description": "关键词,命中任意一个即可。里面的 _ 和 % 按字面量处理,不是通配符",
			},
			"maxHits": map[string]any{
				"type":        "integer",
				"description": "总共最多返回多少行,默认 500。行里可能有很长的文本,别一次要太多",
			},
			"maxHitsPerTable": map[string]any{
				"type":        "integer",
				"description": "每张表最多返回多少行,默认 50。防着一张表就把额度吃光",
			},
		},
		"examples": []any{
			map[string]any{
				"root":     `D:\exhibits\案件一\闲鱼-android`,
				"keywords": []string{"13800138000"},
			},
		},
	}
}

// ReadHandler 翻一个库:列出表,或者读某张表的数据
type ReadHandler struct{}

func NewReadHandler() *ReadHandler { return &ReadHandler{} }

func (h *ReadHandler) Name() string  { return "sqlite-read" }
func (h *ReadHandler) Title() string { return "SQLite 读表" }
func (h *ReadHandler) Description() string {
	return "读一个 SQLite 库:不给 table 时列出所有表(含列名和行数),给了 table 就按页返回数据。" +
		"不改动原始文件 —— 旁边有 -wal 时会先复制一份再读"
}
func (h *ReadHandler) Methods() []string { return []string{http.MethodPost} }

type readRequest struct {
	// Path 库文件路径
	Path string `json:"path"`
	// Table 要读哪张表;空 = 只列表结构
	Table string `json:"table,omitempty"`
	// Offset 从第几行开始
	Offset int `json:"offset,omitempty"`
	// Limit 要几行
	Limit int `json:"limit,omitempty"`
}

func (h *ReadHandler) Handle(ctx context.Context, body []byte) ([]byte, error) {
	var req readRequest
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			return nil, errors.New("请求体不是合法 JSON: " + err.Error())
		}
	}
	if req.Path == "" {
		return nil, errors.New("path 不能为空")
	}
	db, err := Open(req.Path)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	if req.Table == "" {
		tables, err := db.Tables(ctx)
		if err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{
			"path": req.Path,
			// copied 说明这个库旁边有未合并的 WAL —— 读到的内容比主库自己多,
			// 这一点对结果的解释有影响,不能不说
			"copied": db.Copied,
			"tables": tables,
		})
	}
	page, err := db.Rows(ctx, req.Table, req.Offset, req.Limit)
	if err != nil {
		return nil, err
	}
	return json.Marshal(page)
}

func (h *ReadHandler) InputSchema() map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"path"},
		"properties": map[string]any{
			"path":  map[string]any{"type": "string", "description": "SQLite 库文件路径"},
			"table": map[string]any{"type": "string", "description": "要读的表名;不给就只列出有哪些表"},
			"offset": map[string]any{
				"type": "integer", "description": "从第几行开始,默认 0",
			},
			"limit": map[string]any{
				"type": "integer", "description": "要多少行,默认 200,最多 2000",
			},
		},
		"examples": []any{
			map[string]any{"path": `D:\exhibits\a\databases\EnMicroMsg.db`},
			map[string]any{"path": `D:\exhibits\a\databases\EnMicroMsg.db`, "table": "message", "limit": 50},
		},
	}
}
