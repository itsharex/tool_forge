package providerswitch

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// CodexWriter 写入 ~/.codex/config.toml + auth.json
//
// API Key 模式:
//
//	auth.json 写入 {"OPENAI_API_KEY": "..."}
//	config.toml 写入 model_provider + model + [model_providers.ccmanager] block
//
// OAuth 模式:
//
//	auth.json 写入 {"auth_mode":"chatgpt","tokens":{...},"last_refresh":"..."}
//	config.toml 只写 model
type CodexWriter interface {
	Apply(p Provider) (writtenTo string, backupPath string, err error)
	ReadActive() map[string]string
}

type codexWriter struct {
	home string
}

func NewCodexWriter(home string) CodexWriter {
	return &codexWriter{home: home}
}

func (w *codexWriter) codexDir() string {
	return filepath.Join(w.home, ".codex")
}

func (w *codexWriter) Apply(p Provider) (string, string, error) {
	dir := w.codexDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	configPath := filepath.Join(dir, "config.toml")
	authPath := filepath.Join(dir, "auth.json")

	// 备份 config.toml
	backupPath := ""
	if data, err := os.ReadFile(configPath); err == nil {
		backupPath = configPath + ".bak"
		_ = os.WriteFile(backupPath, data, 0o600)
	}

	model := p.Model
	if model == "" {
		model = DefaultCodexModel
	}

	if p.IsDefault {
		// default:清掉 OPENAI_API_KEY,把 config.toml 缩到只剩 model(回到 ChatGPT Plus/Pro 订阅 OAuth)
		auth := readJSONMap(authPath)
		delete(auth, "OPENAI_API_KEY")
		// 同时清掉本工具可能写过的 OAuth 残留(让 codex CLI 走自己的 OAuth 流程)
		delete(auth, "auth_mode")
		delete(auth, "tokens")
		delete(auth, "last_refresh")
		if len(auth) == 0 {
			// 空 map 写出来是 "{}",对 codex 友好
			_ = writeJSONAtomic(authPath, struct{}{})
		} else {
			_ = writeJSONAtomic(authPath, auth)
		}
		// config.toml 只留 model
		toml := fmt.Sprintf("model = %q\n", model)
		if err := writeFileAtomic(configPath, []byte(toml)); err != nil {
			return "", "", fmt.Errorf("写 config.toml 失败: %w", err)
		}
		return configPath, backupPath, nil
	}

	switch p.Type {
	case TypeCodex:
		// === API Key 模式 ===
		// 1) auth.json: 只更新 OPENAI_API_KEY,保留其他字段
		auth := readJSONMap(authPath)
		auth["OPENAI_API_KEY"] = p.APIKey
		// 切回 API Key 模式时,清掉 OAuth 残留
		delete(auth, "auth_mode")
		delete(auth, "tokens")
		delete(auth, "last_refresh")
		if err := writeJSONAtomic(authPath, auth); err != nil {
			return "", "", fmt.Errorf("写 auth.json 失败: %w", err)
		}

		// 2) config.toml: 重写整个文件
		const providerKey = "toolforge"
		toml := fmt.Sprintf(`model_provider = %q
model = %q

[model_providers.%s]
name = %q
base_url = %q
wire_api = "responses"
requires_openai_auth = true
`, providerKey, model, providerKey, providerKey, p.BaseURL)

		if err := writeFileAtomic(configPath, []byte(toml)); err != nil {
			return "", "", fmt.Errorf("写 config.toml 失败: %w", err)
		}

	case TypeCodexOAuth:
		// === OAuth 模式 ===
		auth := readJSONMap(authPath)
		auth["auth_mode"] = "chatgpt"
		auth["OPENAI_API_KEY"] = nil
		auth["tokens"] = map[string]any{
			"id_token":      p.OAuthIDToken,
			"access_token":  p.OAuthAccessToken,
			"refresh_token": p.OAuthRefreshToken,
			"account_id":    p.OAuthAccountID,
		}
		auth["last_refresh"] = time.Now().UTC().Format(time.RFC3339)
		if err := writeJSONAtomic(authPath, auth); err != nil {
			return "", "", fmt.Errorf("写 auth.json 失败: %w", err)
		}

		// OAuth 模式只写 model
		toml := fmt.Sprintf("model = %q\n", model)
		if err := writeFileAtomic(configPath, []byte(toml)); err != nil {
			return "", "", fmt.Errorf("写 config.toml 失败: %w", err)
		}

	default:
		return "", "", fmt.Errorf("不支持的 Codex 类型: %s", p.Type)
	}

	return configPath, backupPath, nil
}

// ReadActive 简单读 config.toml 的前两行 model_provider / model,UI 用来对比
func (w *codexWriter) ReadActive() map[string]string {
	data, err := os.ReadFile(filepath.Join(w.codexDir(), "config.toml"))
	if err != nil {
		return nil
	}
	out := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "model_provider") {
			out["model_provider"] = extractTomlValue(line)
		} else if strings.HasPrefix(line, "model =") || strings.HasPrefix(line, "model=") {
			out["model"] = extractTomlValue(line)
		} else if strings.HasPrefix(line, "base_url") {
			out["base_url"] = extractTomlValue(line)
		}
	}
	return out
}

func extractTomlValue(line string) string {
	idx := strings.Index(line, "=")
	if idx < 0 {
		return ""
	}
	v := strings.TrimSpace(line[idx+1:])
	v = strings.Trim(v, `"`)
	return v
}

func readJSONMap(path string) map[string]any {
	data, err := os.ReadFile(path)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return map[string]any{}
	}
	if m == nil {
		return map[string]any{}
	}
	return m
}

func writeJSONAtomic(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data)
}

func writeFileAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// testCodex 发一个 max_tokens=1 的 chat/completions ping
func testCodex(p Provider) TestResult {
	start := time.Now()
	bearer := p.APIKey
	if p.Type == TypeCodexOAuth {
		bearer = p.OAuthAccessToken
	}
	if bearer == "" {
		return TestResult{OK: false, Message: "API Key / Access Token 不能为空"}
	}
	urlStr := strings.TrimRight(p.BaseURL, "/") + "/chat/completions"
	model := p.Model
	if model == "" {
		model = DefaultCodexModel
	}
	bodyJSON := fmt.Sprintf(`{"model":%q,"max_tokens":1,"messages":[{"role":"user","content":"hi"}]}`, model)
	req, err := http.NewRequest("POST", urlStr, strings.NewReader(bodyJSON))
	if err != nil {
		return TestResult{OK: false, Message: "构造请求失败: " + err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
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
