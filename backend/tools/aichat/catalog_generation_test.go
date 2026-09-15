package aichat

import "testing"

// 版本表列到哪一代,就只认到哪一代 —— 再出新一代时,与其一条规则都不命中、
// 标签全空开关全灰,不如按已知最新一代对待。新一代不会比上一代更弱。
func TestFutureGenerationFallsBackToNewestKnown(t *testing.T) {
	cases := []struct {
		name     string
		provider Provider
		model    string
		wantCaps []Capability
	}{
		{
			"比表里更新的 GPT",
			Provider{Type: TypeOpenAI, BaseURL: "https://api.openai.com/v1"},
			"gpt-6-astra",
			[]Capability{CapTools, CapVision, CapReasoning, CapWebSearch},
		},
		{
			"比表里更新的 o 系列",
			Provider{Type: TypeOpenAI, BaseURL: "https://api.openai.com/v1"},
			"o5-mini",
			[]Capability{CapTools, CapVision, CapReasoning},
		},
		{
			"比表里更新的 Gemini",
			Provider{Type: TypeGemini},
			"gemini-4-pro",
			[]Capability{CapTools, CapVision, CapReasoning, CapWebSearch},
		},
		{
			"比表里更新的 Grok",
			Provider{Type: TypeXAI, BaseURL: "https://api.x.ai/v1"},
			"grok-5",
			[]Capability{CapTools, CapVision, CapReasoning, CapWebSearch},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spec := InferModelSpec(tc.provider, tc.model)
			for _, c := range tc.wantCaps {
				if !spec.Has(c) {
					t.Errorf("%s 应该有 %q 能力, got %v", tc.model, c, spec.Capabilities)
				}
			}
			// 折算只用于匹配规则,对外必须仍是用户填的那个 ID —— 请求里发的是它
			if spec.ID != tc.model {
				t.Errorf("对外应是用户填的 ID %q, got %q", tc.model, spec.ID)
			}
		})
	}
}

// 折算只对"比已知最新一代还新"的版本生效,老型号一个都不能被改判
func TestKnownGenerationsUnchanged(t *testing.T) {
	p := Provider{Type: TypeOpenAI, BaseURL: "https://api.openai.com/v1"}
	// gpt-3.5 那批表现太差不给工具,这条是折算最容易误伤的
	if InferModelSpec(p, "gpt-3.5-turbo").Has(CapTools) {
		t.Error("gpt-3.5 不该拿到工具能力")
	}
	if InferModelSpec(p, "gpt-4").Has(CapVision) {
		t.Error("裸 gpt-4 不该拿到视觉能力")
	}
	if InferModelSpec(p, "gpt-4o").Has(CapReasoning) {
		t.Error("gpt-4o 不该拿到思考能力")
	}
	if InferModelSpec(p, "gemini-1.5-pro").Has(CapReasoning) {
		t.Error("gemini-1.5 不该拿到思考能力")
	}
}

// 版本号解析:o 系列和一堆以 o 开头但并非 o 系列的模型挤在同一个前缀上
func TestSplitGeneration(t *testing.T) {
	cases := []struct {
		id, prefix string
		wantGen    float64
		wantRest   string
		wantOK     bool
	}{
		{"gpt-6-astra", "gpt-", 6, "-astra", true},
		{"gpt-5.2-pro", "gpt-", 5.2, "-pro", true},
		{"gpt-4o", "gpt-", 4, "o", true},
		{"gpt-4-1-mini", "gpt-", 4, "-1-mini", true},
		{"o5-mini", "o", 5, "-mini", true},
		{"o1", "o", 1, "", true},
		// 以 o 开头但不是 o 系列,不能被解析成版本号
		{"omni-moderation", "o", 0, "", false},
		{"gpt-turbo", "gpt-", 0, "", false},
		// 小数点后面没数字不算小数
		{"gpt-4.", "gpt-", 4, ".", true},
		{"claude-opus-4", "gpt-", 0, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.id+"|"+tc.prefix, func(t *testing.T) {
			gen, rest, ok := splitGeneration(tc.id, tc.prefix)
			if ok != tc.wantOK || gen != tc.wantGen || rest != tc.wantRest {
				t.Errorf("splitGeneration(%q, %q) = (%v, %q, %v), want (%v, %q, %v)",
					tc.id, tc.prefix, gen, rest, ok, tc.wantGen, tc.wantRest, tc.wantOK)
			}
		})
	}
}
