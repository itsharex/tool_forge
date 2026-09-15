package aichat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// 工具箱自带工具接入聊天。
//
// 这些工具本来只挂在本地 API server 的 /mcp 上,那个口是给外部 agent(Claude Code、
// Codex)用的。自带的聊天要用,理论上可以让它绕一圈去连 127.0.0.1:11435 ——
// 但那等于为了让自己的进程调自己的函数而把一个端口开着,机器上任何程序都能访问。
// 这里直接在进程内接。
//
// 用结构化接口而不是 import apiserver:那个包带着 net/http 和整套 HTTP 路由,
// 聊天这边一点都用不上。apiserver 的 ToolHandler 天然满足下面这个接口。

// LocalTool 一个工具箱内置工具。形状取自 apiserver.ToolHandler,
// 但不引用那个包 —— 少一条依赖,也免得把 HTTP 那套拖进来。
type LocalTool interface {
	Name() string
	Title() string
	Description() string
	Handle(ctx context.Context, body []byte) ([]byte, error)
}

// localSchemaProvider 可选:提供入参 JSON Schema。
// 没实现的话模型只能照着描述猜参数,猜错就是一次白跑。
type localSchemaProvider interface {
	InputSchema() map[string]any
}

// localToolPrefix 声明给模型时统一加的前缀。
//
// 一来和 MCP 工具(带服务器名前缀)、内置工具区分开,模型能看出这东西来自哪儿;
// 二来避免和用户自己配的 MCP 服务器撞名。
const localToolPrefix = "toolbox_"

// LocalToolSource 工具清单里这批工具的来源标签(和 MCP 的服务器名同一个位置)
const LocalToolSource = "工具箱"

var (
	localMu    sync.RWMutex
	localTools []LocalTool
	// localOn 用户是否允许聊天使用这批工具。
	//
	// 单独一个开关,不复用本地 API server 的 EnabledTools:那个开关的含义是
	// "允许外部 agent 通过网络调用",和"我自己的聊天能不能调"是两件事。
	// 混用会变成一开聊天的文件访问,就等于同时对端口开放了。
	//
	// 默认关:这批工具读的是本机文件和连着的设备,而工具的返回结果是要发给
	// 模型供应商的。这个决定必须由用户明确做出,不能靠默认值替他做。
	localOn bool
)

// SetLocalTools 注入工具箱自带工具(由 app.go 在启动时调用一次)。
//
// 传进来的是精选过的一批,不是全部已注册的工具 —— 取舍见 app.go 那边的说明。
func SetLocalTools(tools []LocalTool) {
	localMu.Lock()
	defer localMu.Unlock()
	localTools = tools
}

// SetLocalToolsEnabled 开关这批工具。由 Service 在加载 / 保存配置时同步过来 ——
// 工具声明发生在协议层深处,一路把 config 传下去要改四个协议的十几个函数签名。
func SetLocalToolsEnabled(on bool) {
	localMu.Lock()
	defer localMu.Unlock()
	localOn = on
}

// localToolList 当前可用的工具箱工具;开关关着时返回空
func localToolList() []LocalTool {
	localMu.RLock()
	defer localMu.RUnlock()
	if !localOn {
		return nil
	}
	return localTools
}

// wrapLocalTool 把一个工具箱工具包成模型能调的 Tool
func wrapLocalTool(lt LocalTool) Tool {
	schema, ok := any(lt).(localSchemaProvider)
	params := map[string]any{"type": "object", "additionalProperties": true}
	if ok {
		if s := schema.InputSchema(); s != nil {
			params = s
		}
	}
	return Tool{
		Name: localToolPrefix + sanitizeToolName(lt.Name()),
		// 标题带上:工具名是英文 ID,中文标题能让模型更快对上号
		Description: "[工具箱] " + lt.Title() + ":" + lt.Description(),
		Parameters:  params,
		Handler: func(ctx context.Context, args string) (string, error) {
			// 模型可能给空串(无参工具),后端一律按 JSON 解,给个空对象兜底
			body := strings.TrimSpace(args)
			if body == "" {
				body = "{}"
			}
			if !json.Valid([]byte(body)) {
				return "", fmt.Errorf("参数不是合法 JSON: %s", args)
			}
			out, err := lt.Handle(ctx, []byte(body))
			if err != nil {
				return "", err
			}
			return string(out), nil
		},
	}
}

// findLocalTool 按声明出去的名字找回对应工具
func findLocalTool(name string) (Tool, bool) {
	if !strings.HasPrefix(name, localToolPrefix) {
		return Tool{}, false
	}
	for _, lt := range localToolList() {
		if localToolPrefix+sanitizeToolName(lt.Name()) == name {
			return wrapLocalTool(lt), true
		}
	}
	return Tool{}, false
}

// sanitizeToolName 工具名只留 [a-z0-9_-];我们的工具名带连字符(device-browse),
// 各家对函数名的字符集要求宽严不一,统一收一遍省得踩。
func sanitizeToolName(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
			out = append(out, r)
		case r >= 'A' && r <= 'Z':
			out = append(out, r+('a'-'A'))
		default:
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "tool"
	}
	return string(out)
}
