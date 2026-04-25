package providerswitch

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ClaudeWriter 写入 ~/.claude/settings.json 的 env 块,
// 不动其他字段(hooks / permissions / statusline 等用户手写的内容)
type ClaudeWriter interface {
	Apply(p Provider) (writtenTo string, backupPath string, err error)
	ReadEnv() map[string]string
}

type claudeWriter struct {
	home string
}

func NewClaudeWriter(home string) ClaudeWriter {
	return &claudeWriter{home: home}
}

func (w *claudeWriter) settingsPath() string {
	return filepath.Join(w.home, ".claude", "settings.json")
}

// Apply 把 Provider 写入 settings.json:
//  1. 读现有 JSON
//  2. 备份到 settings.json.bak(覆盖上次备份)
//  3. 改 env 里的 ANTHROPIC_* key
//  4. 原子写回
func (w *claudeWriter) Apply(p Provider) (string, string, error) {
	target := w.settingsPath()
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}

	// 读现有 settings(可能不存在)
	settings := map[string]any{}
	if data, err := os.ReadFile(target); err == nil {
		if err := json.Unmarshal(data, &settings); err != nil {
			return "", "", fmt.Errorf("现有 settings.json 不是合法 JSON: %w", err)
		}
		// 备份
	}

	// 备份(只有当原文件存在时才备份)
	backupPath := ""
	if data, err := os.ReadFile(target); err == nil {
		backupPath = target + ".bak"
		_ = os.WriteFile(backupPath, data, 0o600)
	}

	// 取出 / 创建 env 块
	env, _ := settings["env"].(map[string]any)
	if env == nil {
		env = map[string]any{}
	}

	if p.IsDefault {
		// default:删掉本工具写过的 ANTHROPIC_* keys,让 Claude CLI 回到 OAuth 登录态
		// 不动其他用户手写的 env(NODE_OPTIONS / DISABLE_TELEMETRY 等)
		for _, k := range ClaudeOwnedEnvKeys {
			delete(env, k)
		}
	} else {
		mainModel := p.Model
		if mainModel == "" {
			mainModel = DefaultClaudeModel
		}
		env["ANTHROPIC_AUTH_TOKEN"] = p.APIKey
		env["ANTHROPIC_BASE_URL"] = p.BaseURL
		env["ANTHROPIC_MODEL"] = mainModel
		env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = pickModel(p.HaikuModel, mainModel)
		env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = pickModel(p.SonnetModel, mainModel)
		env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = pickModel(p.OpusModel, mainModel)
		env["ANTHROPIC_SMALL_FAST_MODEL"] = pickModel(p.ThinkingModel, mainModel)
	}
	settings["env"] = env

	// 原子写
	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return "", "", err
	}
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, out, 0o600); err != nil {
		return "", "", err
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return "", "", err
	}
	return target, backupPath, nil
}

// ReadEnv 读 settings.json 里 env 中的 ANTHROPIC_* 字段;不存在时返回 nil
func (w *claudeWriter) ReadEnv() map[string]string {
	data, err := os.ReadFile(w.settingsPath())
	if err != nil {
		return nil
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil
	}
	env, _ := settings["env"].(map[string]any)
	if env == nil {
		return nil
	}
	out := map[string]string{}
	for _, key := range []string{
		"ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
		"ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_SMALL_FAST_MODEL",
	} {
		if v, ok := env[key].(string); ok {
			out[key] = v
		}
	}
	return out
}

func pickModel(specific, fallback string) string {
	if strings.TrimSpace(specific) != "" {
		return specific
	}
	return fallback
}

// testClaude 发一个 max_tokens=1 的 ping,验证 baseUrl + apiKey + model 可用
func testClaude(p Provider) TestResult {
	start := time.Now()
	urlStr := strings.TrimRight(p.BaseURL, "/") + "/v1/messages"
	model := p.Model
	if model == "" {
		model = DefaultClaudeModel
	}
	bodyJSON := fmt.Sprintf(`{"model":%q,"max_tokens":1,"messages":[{"role":"user","content":"hi"}]}`, model)
	req, err := http.NewRequest("POST", urlStr, strings.NewReader(bodyJSON))
	if err != nil {
		return TestResult{OK: false, Message: "构造请求失败: " + err.Error()}
	}
	req.Header.Set("x-api-key", p.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return TestResult{OK: false, Message: prettifyNetErr(err), DurationMs: int(time.Since(start).Milliseconds())}
	}
	defer resp.Body.Close()
	dur := int(time.Since(start).Milliseconds())

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return TestResult{OK: true, StatusCode: resp.StatusCode, DurationMs: dur, Message: "响应正常"}
	}
	return TestResult{
		OK:         false,
		StatusCode: resp.StatusCode,
		DurationMs: dur,
		Message:    fmt.Sprintf("HTTP %d %s", resp.StatusCode, resp.Status),
	}
}

func prettifyNetErr(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "no such host"):
		return "DNS 解析失败,检查 baseUrl 是否正确或网络是否能访问"
	case strings.Contains(msg, "connection refused"):
		return "连接被拒绝,目标端口可能没开"
	case strings.Contains(msg, "timeout"), strings.Contains(msg, "deadline"):
		return "请求超时,网络慢或代理未正常工作"
	case strings.Contains(msg, "x509"), strings.Contains(msg, "certificate"):
		return "TLS 证书问题: " + msg
	}
	var ne interface{ Timeout() bool }
	if errors.As(err, &ne) && ne.Timeout() {
		return "请求超时"
	}
	return msg
}
