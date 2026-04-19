package claudeinsight

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LoadSession 读取单个 jsonl 文件,返回结构化消息列表。
// 系统事件(permission-mode / file-history-snapshot / 命令注入等)都被过滤掉。
func LoadSession(filePath string) (*SessionDetail, error) {
	if filePath == "" {
		return nil, fmt.Errorf("文件路径不能为空")
	}
	// 简单的路径合法性检查:必须以 .jsonl 结尾,避免被用作任意文件读取。
	if !strings.HasSuffix(strings.ToLower(filePath), ".jsonl") {
		return nil, fmt.Errorf("仅支持读取 .jsonl 文件")
	}
	cleanPath := filepath.Clean(filePath)

	f, err := os.Open(cleanPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, maxScanTokenSize)

	detail := &SessionDetail{
		FilePath: cleanPath,
		Messages: []Message{},
	}

	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		msg, ok := parseLine(line, detail)
		if !ok {
			continue
		}
		detail.Messages = append(detail.Messages, msg)
	}
	detail.Messages = pairToolCalls(detail.Messages)
	return detail, nil
}

// pairToolCalls 把 tool_result 的 output/is_error 合并到对应的 tool_use block,
// 并剔除已配对的 tool_result block;若某条 message 合并后没剩下任何 block,整条剔除。
// 未匹配到 tool_use 的孤立 tool_result 原样保留(兜底)。
func pairToolCalls(messages []Message) []Message {
	type loc struct{ msg, block int }
	byID := make(map[string]loc)
	for i := range messages {
		for j := range messages[i].Blocks {
			b := &messages[i].Blocks[j]
			if b.Type == "tool_use" && b.ToolID != "" {
				byID[b.ToolID] = loc{i, j}
			}
		}
	}
	// 合并输出到 tool_use
	for i := range messages {
		for _, b := range messages[i].Blocks {
			if b.Type != "tool_result" || b.ToolID == "" {
				continue
			}
			if lc, ok := byID[b.ToolID]; ok {
				messages[lc.msg].Blocks[lc.block].Output = b.Output
				messages[lc.msg].Blocks[lc.block].IsError = b.IsError
			}
		}
	}
	// 剔除已配对的 tool_result
	for i := range messages {
		kept := make([]Block, 0, len(messages[i].Blocks))
		for _, b := range messages[i].Blocks {
			if b.Type == "tool_result" && b.ToolID != "" {
				if _, ok := byID[b.ToolID]; ok {
					continue
				}
			}
			kept = append(kept, b)
		}
		messages[i].Blocks = kept
	}
	// 剔除 blocks 全空的 message
	out := make([]Message, 0, len(messages))
	for _, m := range messages {
		if len(m.Blocks) > 0 {
			out = append(out, m)
		}
	}
	return out
}

// parseLine 把一行 JSONL 解析成 Message。返回 false 表示该行应被跳过
// (系统事件 / 无效 JSON / 没有消息内容)。
func parseLine(line []byte, detail *SessionDetail) (Message, bool) {
	var ev struct {
		Type      string          `json:"type"`
		Timestamp string          `json:"timestamp"`
		UUID      string          `json:"uuid"`
		SessionID string          `json:"sessionId"`
		Cwd       string          `json:"cwd"`
		Message   json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal(line, &ev); err != nil {
		return Message{}, false
	}
	if detail.SessionID == "" && ev.SessionID != "" {
		detail.SessionID = ev.SessionID
	}
	if detail.Project == "" && ev.Cwd != "" {
		detail.Project = ev.Cwd
	}
	if ev.Type != "user" && ev.Type != "assistant" {
		return Message{}, false
	}
	if len(ev.Message) == 0 {
		return Message{}, false
	}

	blocks, model, tokens := parseMessageBlocks(ev.Type, ev.Message)
	if len(blocks) == 0 {
		return Message{}, false
	}
	return Message{
		UUID:      ev.UUID,
		Role:      ev.Type,
		Timestamp: ev.Timestamp,
		Model:     model,
		Tokens:    tokens,
		Blocks:    blocks,
	}, true
}

// parseMessageBlocks 从 message 字段里抽出 blocks、model、tokens。
// model / tokens 只在 assistant 消息里会有值。
func parseMessageBlocks(role string, raw json.RawMessage) ([]Block, string, *TokenUsage) {
	// assistant: {role,model,content:[...],usage:{...}}
	// user:      {role,content: string | [...]}
	var asObject struct {
		Model   string          `json:"model"`
		Content json.RawMessage `json:"content"`
		Usage   struct {
			InputTokens              int64 `json:"input_tokens"`
			OutputTokens             int64 `json:"output_tokens"`
			CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
			CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &asObject); err != nil {
		return nil, "", nil
	}

	blocks := extractContent(asObject.Content)
	if role == "user" {
		blocks = filterInjectedUserBlocks(blocks)
	}

	var tokens *TokenUsage
	if role == "assistant" {
		if asObject.Usage.InputTokens > 0 ||
			asObject.Usage.OutputTokens > 0 ||
			asObject.Usage.CacheCreationInputTokens > 0 ||
			asObject.Usage.CacheReadInputTokens > 0 {
			tokens = &TokenUsage{
				Input:         asObject.Usage.InputTokens,
				Output:        asObject.Usage.OutputTokens,
				CacheCreation: asObject.Usage.CacheCreationInputTokens,
				CacheRead:     asObject.Usage.CacheReadInputTokens,
			}
		}
	}
	return blocks, asObject.Model, tokens
}

// extractContent 把 content 字段(string 或数组)拆解为 Block 列表。
func extractContent(raw json.RawMessage) []Block {
	if len(raw) == 0 {
		return nil
	}
	// 形态一: 字符串
	var asStr string
	if err := json.Unmarshal(raw, &asStr); err == nil {
		trimmed := strings.TrimSpace(asStr)
		if trimmed == "" {
			return nil
		}
		return []Block{{Type: "text", Text: asStr}}
	}
	// 形态二: 数组
	var asArr []json.RawMessage
	if err := json.Unmarshal(raw, &asArr); err != nil {
		return nil
	}
	out := make([]Block, 0, len(asArr))
	for _, part := range asArr {
		b, ok := parseContentPart(part)
		if ok {
			out = append(out, b)
		}
	}
	return out
}

// parseContentPart 解析单个 content 数组元素。
func parseContentPart(raw json.RawMessage) (Block, bool) {
	var kind struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &kind); err != nil {
		return Block{}, false
	}
	switch kind.Type {
	case "text":
		var p struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return Block{}, false
		}
		if strings.TrimSpace(p.Text) == "" {
			return Block{}, false
		}
		return Block{Type: "text", Text: p.Text}, true

	case "thinking":
		var p struct {
			Thinking string `json:"thinking"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return Block{}, false
		}
		if strings.TrimSpace(p.Thinking) == "" {
			return Block{}, false
		}
		return Block{Type: "thinking", Text: p.Thinking}, true

	case "tool_use":
		var p struct {
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return Block{}, false
		}
		inputStr := ""
		if len(p.Input) > 0 {
			if pretty, err := json.MarshalIndent(json.RawMessage(p.Input), "", "  "); err == nil {
				inputStr = string(pretty)
			} else {
				inputStr = string(p.Input)
			}
		}
		return Block{Type: "tool_use", Name: p.Name, ToolID: p.ID, Input: inputStr}, true

	case "image":
		var p struct {
			Source struct {
				Type      string `json:"type"`       // "base64" | "url"
				MediaType string `json:"media_type"` // "image/png" 等
				Data      string `json:"data"`       // base64 原始数据
				URL       string `json:"url"`
			} `json:"source"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return Block{}, false
		}
		var src string
		switch p.Source.Type {
		case "base64":
			if p.Source.Data == "" {
				return Block{}, false
			}
			mt := p.Source.MediaType
			if mt == "" {
				mt = "image/png"
			}
			src = "data:" + mt + ";base64," + p.Source.Data
		case "url":
			src = p.Source.URL
		default:
			return Block{}, false
		}
		if src == "" {
			return Block{}, false
		}
		// 借用 Text 字段承载 data URL / http URL,前端按 type=image 识别
		return Block{Type: "image", Text: src}, true

	case "tool_result":
		var p struct {
			ToolUseID string          `json:"tool_use_id"`
			IsError   bool            `json:"is_error"`
			Content   json.RawMessage `json:"content"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return Block{}, false
		}
		output := flattenToolResultContent(p.Content)
		return Block{Type: "tool_result", ToolID: p.ToolUseID, Output: output, IsError: p.IsError}, true
	}
	return Block{}, false
}

// flattenToolResultContent 把 tool_result.content 展平为单个字符串。
// content 可能是 string、或 [{type:"text", text:"..."}, ...],偶尔还会有 image。
func flattenToolResultContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var asStr string
	if err := json.Unmarshal(raw, &asStr); err == nil {
		return asStr
	}
	var asArr []json.RawMessage
	if err := json.Unmarshal(raw, &asArr); err != nil {
		return ""
	}
	var sb strings.Builder
	for _, part := range asArr {
		var p struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal(part, &p); err != nil {
			continue
		}
		if p.Type == "text" && p.Text != "" {
			if sb.Len() > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(p.Text)
		}
	}
	return sb.String()
}

// filterInjectedUserBlocks 过滤 user 侧的 "<command-..>"/"<local-command-stdout>"/
// "<system-reminder>" 等非用户真实输入的块。这些是 Claude Code 自动注入的系统信号,
// 对阅读会话没有意义,展示出来反而吵。
func filterInjectedUserBlocks(blocks []Block) []Block {
	out := make([]Block, 0, len(blocks))
	for _, b := range blocks {
		// tool_result 虽然是 user 侧的,但属于真实信号,保留。
		if b.Type != "text" {
			out = append(out, b)
			continue
		}
		trimmed := strings.TrimSpace(b.Text)
		if isInjectedText(trimmed) {
			continue
		}
		out = append(out, b)
	}
	return out
}

func isInjectedText(s string) bool {
	if s == "" {
		return true
	}
	// 这些前缀/包裹均是 Claude Code 自动插入的,不是用户真实键入
	prefixes := []string{
		"<command-name>",
		"<local-command-stdout>",
		"<local-command-stderr>",
		"<system-reminder>",
		"<user-prompt-submit-hook>",
		"<session-start-hook>",
		"<bash-stdout>",
		"<bash-stderr>",
	}
	for _, p := range prefixes {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}
