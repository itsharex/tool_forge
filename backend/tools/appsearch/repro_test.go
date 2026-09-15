package appsearch

import (
	"context"
	"os"
	"testing"
	"time"
)

// 精确复现用户报的 bug：搜 "闲鱼" + 华为 当前代码会不会炸
func TestXianyuHuawei_Online(t *testing.T) {
	if !onlineEnabled() {
		t.Skip("set APPSEARCH_ONLINE=1 to enable")
	}
	sid := os.Getenv("QIMAI_PHPSESSID")
	if sid == "" {
		t.Skip("set QIMAI_PHPSESSID to enable")
	}
	svc := New()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req := SearchRequest{
		Keyword: "闲鱼",
		Sources: []SourceID{SourceQimaiAndroid},
		Market:  6,
	}
	req.SetQimaiCredential(sid)
	resp, err := svc.Search(ctx, req)
	if err != nil {
		t.Fatalf("search returned error: %v", err)
	}
	st := resp.Statuses[0]
	t.Logf("huawei status: ok=%v count=%d err=%q", st.OK, st.Count, st.Error)
	if !st.OK {
		t.Errorf("expected OK, got error: %s", st.Error)
	}
	if st.Count == 0 {
		t.Errorf("expected items for 闲鱼 on 华为, got 0")
	}
}
