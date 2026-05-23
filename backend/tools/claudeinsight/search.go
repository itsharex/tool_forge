package claudeinsight

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// SearchHit 一条搜索结果。Snippet 是命中文本上下文(已截断);
// 前端按 Query 自行做大小写无关的高亮标记。
type SearchHit struct {
	SessionID   string `json:"session_id"`
	Project     string `json:"project"`
	FilePath    string `json:"file_path"`
	Role        string `json:"role"`      // "user" | "assistant"
	Snippet     string `json:"snippet"`   // 命中文本片段(约 200 字符)
	Timestamp   string `json:"timestamp"` // RFC3339
	MessageUUID string `json:"message_uuid"`
}

// SearchResult 搜索整体结果
type SearchResult struct {
	Query     string      `json:"query"`
	Hits      []SearchHit `json:"hits"`
	Truncated bool        `json:"truncated"` // 命中数触达上限,可能有更多结果
	TotalHits int         `json:"total_hits"`
	ScannedAt string      `json:"scanned_at"`
}

// SearchSessions 对所有 jsonl 会话的消息文本做大小写无关子串搜索。
// hitLimit 控制返回的最大命中数(建议 ~200,避免前端爆炸);0 表示走默认值。
func SearchSessions(claudeDir, query string, hitLimit int) (*SearchResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return &SearchResult{
			Query:     "",
			Hits:      []SearchHit{},
			ScannedAt: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
	if hitLimit <= 0 {
		hitLimit = 200
	}
	qLower := strings.ToLower(q)

	dir, err := resolveClaudeDir(claudeDir)
	if err != nil {
		return nil, err
	}
	projectsDir := filepath.Join(dir, "projects")
	info, err := os.Stat(projectsDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &SearchResult{
				Query:     query,
				Hits:      []SearchHit{},
				ScannedAt: time.Now().UTC().Format(time.RFC3339),
			}, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("projects 不是目录")
	}

	files, err := collectJSONLFiles(projectsDir)
	if err != nil {
		return nil, err
	}

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	var mu sync.Mutex
	// 必须用 make([]T, 0) 而非 var hits []T,否则无命中时 JSON 编码为 null,
	// 前端访问 result.hits.length 会抛 TypeError 导致白屏。
	hits := make([]SearchHit, 0)
	total := 0

	for _, p := range files {
		wg.Add(1)
		sem <- struct{}{}
		go func(path string) {
			defer wg.Done()
			defer func() { <-sem }()
			perFile := searchFile(path, qLower)
			if len(perFile) == 0 {
				return
			}
			mu.Lock()
			total += len(perFile)
			// 超过上限时截断,但 total 仍统计全部,用来提示 truncated
			remaining := hitLimit - len(hits)
			if remaining > 0 {
				if len(perFile) > remaining {
					hits = append(hits, perFile[:remaining]...)
				} else {
					hits = append(hits, perFile...)
				}
			}
			mu.Unlock()
		}(p)
	}
	wg.Wait()

	// 按时间倒序
	sort.SliceStable(hits, func(i, j int) bool {
		return hits[i].Timestamp > hits[j].Timestamp
	})

	return &SearchResult{
		Query:     query,
		Hits:      hits,
		Truncated: total > len(hits),
		TotalHits: total,
		ScannedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// searchFile 在一个 jsonl 里扫描关键词,返回该文件的所有命中。
// qLower 必须已经小写化。为了性能,这里只对 user/assistant 的 text 类型 content 做搜索。
func searchFile(path, qLower string) []SearchHit {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, maxScanTokenSize)

	var project string
	var sessionID string
	var out []SearchHit

	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev struct {
			Type      string          `json:"type"`
			Timestamp string          `json:"timestamp"`
			UUID      string          `json:"uuid"`
			SessionID string          `json:"sessionId"`
			Cwd       string          `json:"cwd"`
			Message   json.RawMessage `json:"message"`
		}
		if err := json.Unmarshal(line, &ev); err != nil {
			continue
		}
		if sessionID == "" && ev.SessionID != "" {
			sessionID = ev.SessionID
		}
		if project == "" && ev.Cwd != "" {
			project = ev.Cwd
		}
		if ev.Type != "user" && ev.Type != "assistant" {
			continue
		}
		if len(ev.Message) == 0 {
			continue
		}
		// 快速路径:先把整段 message 的字节 lower 一次做粗筛,没命中的直接跳
		if !containsFold(ev.Message, qLower) {
			continue
		}
		texts := collectTexts(ev.Type, ev.Message)
		for _, t := range texts {
			idx := strings.Index(strings.ToLower(t), qLower)
			if idx < 0 {
				continue
			}
			snippet := extractSnippet(t, idx, len(qLower))
			out = append(out, SearchHit{
				SessionID:   ev.SessionID,
				Project:     ev.Cwd,
				FilePath:    path,
				Role:        ev.Type,
				Snippet:     snippet,
				Timestamp:   ev.Timestamp,
				MessageUUID: ev.UUID,
			})
		}
	}

	// 补全 hit 里可能缺失的 project/sessionID(来自早期行的兜底)
	for i := range out {
		if out[i].SessionID == "" {
			out[i].SessionID = sessionID
		}
		if out[i].Project == "" {
			out[i].Project = project
		}
	}
	return out
}

// containsFold 快速判断字节流里是否包含小写版本的关键词。
// 把字节转小写比较,避免把整段转 string 再 ToLower 一次。
func containsFold(data []byte, qLower string) bool {
	if len(qLower) == 0 {
		return true
	}
	// 小写化一份
	lower := make([]byte, len(data))
	for i, b := range data {
		if b >= 'A' && b <= 'Z' {
			lower[i] = b + 32
		} else {
			lower[i] = b
		}
	}
	return strings.Contains(string(lower), qLower)
}

// collectTexts 从 user/assistant message 里抽所有 text / thinking 的文本,
// 用于逐段做 snippet 提取。tool_use/tool_result 不纳入(噪音大,且原项目搜索也主要是 text)。
func collectTexts(role string, raw json.RawMessage) []string {
	var env struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil
	}
	if len(env.Content) == 0 {
		return nil
	}
	// string 形态
	var asStr string
	if err := json.Unmarshal(env.Content, &asStr); err == nil {
		trim := strings.TrimSpace(asStr)
		if trim == "" || (role == "user" && isInjectedText(trim)) {
			return nil
		}
		return []string{asStr}
	}
	// array 形态
	var arr []json.RawMessage
	if err := json.Unmarshal(env.Content, &arr); err != nil {
		return nil
	}
	var out []string
	for _, part := range arr {
		var kind struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			Thinking string `json:"thinking"`
		}
		if err := json.Unmarshal(part, &kind); err != nil {
			continue
		}
		switch kind.Type {
		case "text":
			if t := strings.TrimSpace(kind.Text); t != "" {
				if role == "user" && isInjectedText(t) {
					continue
				}
				out = append(out, kind.Text)
			}
		case "thinking":
			if t := strings.TrimSpace(kind.Thinking); t != "" {
				out = append(out, kind.Thinking)
			}
		}
	}
	return out
}

// extractSnippet 围绕命中位置截取一段上下文(~200 字符),命中不会出现在最开头。
func extractSnippet(text string, idx, matchLen int) string {
	const window = 200
	const pre = 60
	runes := []rune(text)
	// 先把 byte idx 近似转 rune idx(不精确也可接受,纯展示)
	prefixBytes := text[:idx]
	startRune := len([]rune(prefixBytes))
	matchRuneLen := len([]rune(text[idx : idx+matchLen]))

	from := startRune - pre
	if from < 0 {
		from = 0
	}
	to := from + window
	if to > len(runes) {
		to = len(runes)
	}
	// 保证命中片段也被包含
	if startRune+matchRuneLen > to {
		to = startRune + matchRuneLen
		if to > len(runes) {
			to = len(runes)
		}
	}

	snippet := string(runes[from:to])
	// 去掉首尾换行、合并多空白,单行展示更整洁
	snippet = strings.Join(strings.Fields(snippet), " ")
	if from > 0 {
		snippet = "…" + snippet
	}
	if to < len(runes) {
		snippet += "…"
	}
	return snippet
}
