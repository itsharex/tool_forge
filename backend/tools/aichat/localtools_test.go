package aichat

import (
	"context"
	"strings"
	"testing"
)

// fakeLocalTool 一个最小的工具箱工具
type fakeLocalTool struct {
	name   string
	schema map[string]any
	got    string
	out    string
	err    error
}

func (f *fakeLocalTool) Name() string        { return f.name }
func (f *fakeLocalTool) Title() string       { return "假工具" }
func (f *fakeLocalTool) Description() string { return "测试用" }
func (f *fakeLocalTool) Handle(_ context.Context, body []byte) ([]byte, error) {
	f.got = string(body)
	if f.err != nil {
		return nil, f.err
	}
	return []byte(f.out), nil
}

// withSchema 带 InputSchema 的变体
type fakeSchemaTool struct{ *fakeLocalTool }

func (f *fakeSchemaTool) InputSchema() map[string]any { return f.schema }

// installLocalTools 装一批工具并在用例结束后还原(包级状态,不还原会串台)
func installLocalTools(t *testing.T, on bool, tools ...LocalTool) {
	t.Helper()
	localMu.RLock()
	prevTools, prevOn := localTools, localOn
	localMu.RUnlock()
	t.Cleanup(func() {
		SetLocalTools(prevTools)
		SetLocalToolsEnabled(prevOn)
	})
	SetLocalTools(tools)
	SetLocalToolsEnabled(on)
}

func hasToolNamed(list []Tool, name string) bool {
	for _, t := range list {
		if t.Name == name {
			return true
		}
	}
	return false
}

// 开关默认关着:这批工具读的是本机文件和连着的设备,返回内容会发给模型供应商,
// 必须由用户明确打开。默认值一旦滑到"开",没人会注意到。
func TestLocalToolsOffByDefault(t *testing.T) {
	f := &fakeLocalTool{name: "device-browse", out: `{"ok":true}`}
	installLocalTools(t, false, f)

	if got := localToolList(); len(got) != 0 {
		t.Fatalf("开关关着时不该有工具, got %d", len(got))
	}
	if hasToolNamed(listTools(), "toolbox_device-browse") {
		t.Error("开关关着时 listTools 不该带上工具箱工具")
	}
	if _, ok := findTool("toolbox_device-browse"); ok {
		t.Error("开关关着时 findTool 不该找得到 —— 否则模型凭名字就能绕过开关调到")
	}
	for _, v := range ToolsView().Tools {
		if strings.HasPrefix(v.Name, localToolPrefix) {
			t.Errorf("开关关着时工具清单不该列出 %q", v.Name)
		}
	}

	// 打开之后才出现
	SetLocalToolsEnabled(true)
	if !hasToolNamed(listTools(), "toolbox_device-browse") {
		t.Error("打开后 listTools 应该带上工具箱工具")
	}
	if _, ok := findTool("toolbox_device-browse"); !ok {
		t.Error("打开后 findTool 应该找得到")
	}
}

// 参数原样透传给 handler;模型给空串时补成空对象
func TestLocalToolArgsPassthrough(t *testing.T) {
	f := &fakeLocalTool{name: "sqlite-read", out: `{"rows":[]}`}
	installLocalTools(t, true, f)

	tool, ok := findTool("toolbox_sqlite-read")
	if !ok {
		t.Fatal("找不到工具")
	}

	out, err := tool.Handler(context.Background(), `{"path":"a.db"}`)
	if err != nil {
		t.Fatalf("调用失败: %v", err)
	}
	if f.got != `{"path":"a.db"}` {
		t.Errorf("handler 收到的 body = %q,应该原样透传", f.got)
	}
	if out != `{"rows":[]}` {
		t.Errorf("返回 = %q", out)
	}

	// 无参工具:模型常给空串,后端一律按 JSON 解,不补会当场解析失败
	if _, err := tool.Handler(context.Background(), ""); err != nil {
		t.Fatalf("空参数调用失败: %v", err)
	}
	if f.got != "{}" {
		t.Errorf("空参数应补成空对象, got %q", f.got)
	}

	// 模型偶尔会把参数拼坏。与其把半截字节交给 handler 去解,不如当场说清楚 ——
	// 这条错误会回给模型,它能据此重试
	if _, err := tool.Handler(context.Background(), "{不是 JSON"); err == nil {
		t.Error("非法 JSON 应该报错")
	}
}

// 有 schema 就用 schema,没有给一个宽松对象 —— 模型照着 schema 决定传什么,
// 给 nil 会让它完全没法下手
func TestLocalToolSchema(t *testing.T) {
	want := map[string]any{"type": "object", "properties": map[string]any{"op": map[string]any{"type": "string"}}}
	withSchema := &fakeSchemaTool{&fakeLocalTool{name: "with-schema", schema: want}}
	plain := &fakeLocalTool{name: "no-schema"}
	installLocalTools(t, true, withSchema, plain)

	tool, _ := findTool("toolbox_with-schema")
	if _, ok := tool.Parameters["properties"]; !ok {
		t.Errorf("应该用工具自己的 schema, got %v", tool.Parameters)
	}

	tool, _ = findTool("toolbox_no-schema")
	if tool.Parameters["type"] != "object" {
		t.Errorf("没有 schema 时要给一个宽松对象兜底, got %v", tool.Parameters)
	}
}

// 工具清单要标明来源,不然界面上分不清哪个是工具箱的、哪个是用户自己配的 MCP
func TestLocalToolsViewSource(t *testing.T) {
	installLocalTools(t, true, &fakeLocalTool{name: "plist-parse"})
	for _, v := range ToolsView().Tools {
		if v.Name == "toolbox_plist-parse" {
			if v.Source != LocalToolSource {
				t.Errorf("Source = %q, want %q", v.Source, LocalToolSource)
			}
			return
		}
	}
	t.Error("工具清单里没有工具箱工具")
}

// 工具名带连字符,统一收一遍字符集
func TestSanitizeToolName(t *testing.T) {
	cases := map[string]string{
		"device-browse": "device-browse",
		"SQLite Read":   "sqlite_read",
		"包名搜索":          "____", // 每个中文字符换一个下划线
		"":              "tool",
	}
	for in, want := range cases {
		if got := sanitizeToolName(in); got != want {
			t.Errorf("sanitizeToolName(%q) = %q, want %q", in, got, want)
		}
	}
}
