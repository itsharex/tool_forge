package aichat

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// streamCallbacks 各协议实现统一通过这个回调向上推数据
type streamCallbacks struct {
	onText     func(string)
	onThinking func(string)
	onDone     func()
	onError    func(error)
}

// 事件名前缀(前端按 conversation id 拼后缀订阅)
const (
	EventChunkPrefix    = "ai-chat:chunk:"    // 正文增量
	EventThinkingPrefix = "ai-chat:thinking:" // 思考增量(deepseek-r1 / o1 / claude extended)
	EventDonePrefix     = "ai-chat:done:"
	EventErrorPrefix    = "ai-chat:error:"
)

// streamRegistry 维护正在进行中的流的取消函数,key 是 conversationID
type streamRegistry struct {
	mu sync.Mutex
	m  map[string]context.CancelFunc
}

func (r *streamRegistry) set(id string, c context.CancelFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.m == nil {
		r.m = map[string]context.CancelFunc{}
	}
	// 同一会话先取消旧的(避免双发)
	if old := r.m[id]; old != nil {
		old()
	}
	r.m[id] = c
}

func (r *streamRegistry) clear(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.m, id)
}

func (r *streamRegistry) cancel(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.m[id]
	if !ok {
		return false
	}
	c()
	delete(r.m, id)
	return true
}

func (s *Service) cancelStream(id string) bool {
	return s.streams.cancel(id)
}

// CancelStream 取消指定会话的进行中流;true=成功取消
func (s *Service) CancelStream(id string) bool {
	return s.cancelStream(id)
}

// SendChat 在指定会话里追加一条 user 消息并启动流式回复。
//  1. 校验 provider/model
//  2. 把 user 消息写入磁盘,创建一条空的 assistant 消息作为占位
//  3. 启动 goroutine 推流;每个 chunk 通过 wails 事件下发,并实时累加到内存
//  4. 流结束(或失败/取消)时,把最终 assistant 消息写回磁盘
//
// 返回的 Conversation 是"刚追加完 user + 空 assistant"的状态,前端拿到后立刻渲染,
// 然后监听三种事件来更新 assistant.content
func (s *Service) SendChat(ctx context.Context, convID, userContent string) (*Conversation, error) {
	c, err := loadConversation(convID)
	if err != nil {
		return nil, err
	}
	prov, err := s.providerSnapshot(c.ProviderID)
	if err != nil {
		return nil, err
	}
	if !prov.Enabled {
		return nil, fmt.Errorf("供应商 %s 未启用", prov.Name)
	}
	if c.ModelID == "" {
		return nil, fmt.Errorf("会话未指定模型")
	}
	if strings.TrimSpace(userContent) == "" {
		return nil, fmt.Errorf("消息不能为空")
	}

	now := time.Now().UnixMilli()
	userMsg := Message{
		ID:        uuid.NewString(),
		Role:      "user",
		Content:   userContent,
		CreatedAt: now,
	}
	asstMsg := Message{
		ID:        uuid.NewString(),
		Role:      "assistant",
		Content:   "",
		Model:     c.ModelID, // 记录这条 assistant 用的模型
		CreatedAt: now + 1,
	}
	c.Messages = append(c.Messages, userMsg, asstMsg)
	c.UpdatedAt = now
	if c.Title == "" || c.Title == "新对话" {
		c.Title = autoTitle(userContent)
	}
	if err := saveConversation(c); err != nil {
		return nil, err
	}

	// 异步流;复制一份 messages 给 goroutine,避免后续磁盘读写并发
	convCopy := *c
	go s.runStream(ctx, prov, convCopy, asstMsg.ID, userContent)
	return c, nil
}

// RegenerateLast 重新生成最后一条 assistant 消息:
//   1. 取消可能进行中的流
//   2. 把最后一条 assistant 消息的内容/思考清空(沿用同一 ID,前端能原地刷新)
//   3. 重新启动 runStream,流的产物写回这条 assistant
// 要求最后一条是 assistant 且前一条是 user
func (s *Service) RegenerateLast(ctx context.Context, convID string) (*Conversation, error) {
	c, err := loadConversation(convID)
	if err != nil {
		return nil, err
	}
	if len(c.Messages) < 2 {
		return nil, fmt.Errorf("没有可重新生成的消息")
	}
	last := &c.Messages[len(c.Messages)-1]
	if last.Role != "assistant" {
		return nil, fmt.Errorf("最后一条不是助手消息")
	}
	prev := c.Messages[len(c.Messages)-2]
	if prev.Role != "user" {
		return nil, fmt.Errorf("找不到对应的用户消息")
	}
	prov, err := s.providerSnapshot(c.ProviderID)
	if err != nil {
		return nil, err
	}
	if !prov.Enabled {
		return nil, fmt.Errorf("供应商 %s 未启用", prov.Name)
	}
	if c.ModelID == "" {
		return nil, fmt.Errorf("会话未指定模型")
	}

	s.cancelStream(convID)

	now := time.Now().UnixMilli()
	last.Content = ""
	last.Thinking = ""
	last.Model = c.ModelID
	last.CreatedAt = now
	c.UpdatedAt = now
	if err := saveConversation(c); err != nil {
		return nil, err
	}

	convCopy := *c
	go s.runStream(ctx, prov, convCopy, last.ID, prev.Content)
	return c, nil
}

func (s *Service) providerSnapshot(id string) (Provider, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return Provider{}, err
	}
	p, idx := s.getProviderLocked(id)
	if idx < 0 {
		return Provider{}, fmt.Errorf("供应商不存在: %s", id)
	}
	return *p, nil
}

// runStream 单个会话的流执行体;一定会发 done 或 error 中的一个,然后清理 registry
func (s *Service) runStream(parent context.Context, prov Provider, conv Conversation, asstMsgID, _ string) {
	ctx, cancel := context.WithCancel(parent)
	s.streams.set(conv.ID, cancel)
	defer s.streams.clear(conv.ID)
	defer cancel()

	var bText, bThink strings.Builder
	cb := streamCallbacks{
		onText: func(d string) {
			if d == "" {
				return
			}
			bText.WriteString(d)
			if s.ctx != nil {
				wailsruntime.EventsEmit(s.ctx, EventChunkPrefix+conv.ID, d)
			}
		},
		onThinking: func(d string) {
			if d == "" {
				return
			}
			bThink.WriteString(d)
			if s.ctx != nil {
				wailsruntime.EventsEmit(s.ctx, EventThinkingPrefix+conv.ID, d)
			}
		},
		onDone: func() {
			s.persistAssistant(conv.ID, asstMsgID, bText.String(), bThink.String(), false)
			if s.ctx != nil {
				wailsruntime.EventsEmit(s.ctx, EventDonePrefix+conv.ID, bText.String())
			}
		},
		onError: func(err error) {
			s.persistAssistant(conv.ID, asstMsgID, bText.String(), bThink.String(), true)
			if s.ctx != nil {
				wailsruntime.EventsEmit(s.ctx, EventErrorPrefix+conv.ID, err.Error())
			}
		},
	}

	switch prov.Type {
	case TypeGemini:
		streamGemini(ctx, prov, conv, cb)
	case TypeAnthropic:
		streamAnthropic(ctx, prov, conv, cb)
	case TypeOpenAICompat:
		streamOpenAI(ctx, prov, conv, false, cb)
	default:
		// "openai" 默认走新版 Responses API
		streamOpenAI(ctx, prov, conv, true, cb)
	}
}

// persistAssistant 流结束时把 assistant 消息(正文 + 思考)写回磁盘
func (s *Service) persistAssistant(convID, msgID, content, thinking string, truncated bool) {
	c, err := loadConversation(convID)
	if err != nil {
		return
	}
	for i := range c.Messages {
		if c.Messages[i].ID == msgID {
			c.Messages[i].Content = content
			c.Messages[i].Thinking = thinking
			if truncated {
				c.Messages[i].Content += " …" // 标记中断
			}
			break
		}
	}
	c.UpdatedAt = time.Now().UnixMilli()
	_ = saveConversation(c)
}

// SetWailsContext 让 Service 持有 wails ctx 用于 EventsEmit
func (s *Service) SetWailsContext(ctx context.Context) {
	s.ctx = ctx
}
