package codexinsight

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// SearchSessions 跨所有会话做大小写无关全文搜索。
// 命中主要来自 response_item.message 的 text 块;function_call 的参数 / output 不搜(噪音大)。
func SearchSessions(codexDir, query string, hitLimit int) (*SearchResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return &SearchResult{
			Hits:      []SearchHit{},
			ScannedAt: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
	if hitLimit <= 0 {
		hitLimit = 200
	}
	qLower := strings.ToLower(q)

	dir, err := resolveCodexDir(codexDir)
	if err != nil {
		return nil, err
	}
	sessionsDir := filepath.Join(dir, "sessions")
	info, err := os.Stat(sessionsDir)
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
		return nil, errors.New("sessions 不是目录")
	}

	files, err := collectJSONLFiles(sessionsDir)
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

func searchFile(path, qLower string) []SearchHit {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, maxScanTokenSize)

	var sessionID, project string
	var out []SearchHit
	msgIndex := 0

	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		// 预筛 reasoning(encrypted_content);搜索也不需要这类内容
		if bytes.Contains(line, encryptedMarker) {
			continue
		}
		var ev struct {
			Timestamp string          `json:"timestamp"`
			Type      string          `json:"type"`
			Payload   json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(line, &ev); err != nil {
			continue
		}
		switch ev.Type {
		case "session_meta":
			var p struct {
				ID  string `json:"id"`
				Cwd string `json:"cwd"`
			}
			if err := json.Unmarshal(ev.Payload, &p); err == nil {
				if sessionID == "" {
					sessionID = p.ID
				}
				if project == "" {
					project = p.Cwd
				}
			}
		case "turn_context":
			var p struct {
				Cwd string `json:"cwd"`
			}
			if err := json.Unmarshal(ev.Payload, &p); err == nil {
				if project == "" && p.Cwd != "" {
					project = p.Cwd
				}
			}
		case "response_item":
			var p struct {
				Type    string          `json:"type"`
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			}
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				continue
			}
			if p.Type != "message" {
				continue
			}
			if p.Role != "user" && p.Role != "assistant" {
				continue
			}
			blocks := extractMessageBlocks(p.Role, p.Content)
			if len(blocks) == 0 {
				continue
			}
			// 本消息对应前端的 uuid = sessionID-<msgIndex>
			for _, b := range blocks {
				lower := strings.ToLower(b.Text)
				idx := strings.Index(lower, qLower)
				if idx < 0 {
					continue
				}
				snippet := extractSnippet(b.Text, idx, len(qLower))
				out = append(out, SearchHit{
					SessionID:   sessionID,
					Project:     project,
					FilePath:    path,
					Role:        p.Role,
					Snippet:     snippet,
					Timestamp:   ev.Timestamp,
					MessageUUID: fmt.Sprintf("%s-%d", sessionID, msgIndex),
				})
			}
			msgIndex++
		}
	}
	// 补回 sessionID / project 到 hit(首条 session_meta 之前的事件已扫完)
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

func extractSnippet(text string, idx, matchLen int) string {
	const window = 200
	const pre = 60
	runes := []rune(text)
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
	if startRune+matchRuneLen > to {
		to = startRune + matchRuneLen
		if to > len(runes) {
			to = len(runes)
		}
	}
	snippet := string(runes[from:to])
	snippet = strings.Join(strings.Fields(snippet), " ")
	if from > 0 {
		snippet = "…" + snippet
	}
	if to < len(runes) {
		snippet += "…"
	}
	return snippet
}
