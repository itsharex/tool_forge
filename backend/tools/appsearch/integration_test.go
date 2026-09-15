package appsearch

import (
	"context"
	"os"
	"testing"
	"time"
)

// 这些测试需要联网，默认跳过；设 APPSEARCH_ONLINE=1 时启用。
func onlineEnabled() bool { return os.Getenv("APPSEARCH_ONLINE") == "1" }

func TestSearchITunes_Online(t *testing.T) {
	if !onlineEnabled() {
		t.Skip("set APPSEARCH_ONLINE=1 to enable")
	}
	svc := New()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	resp, err := svc.Search(ctx, SearchRequest{
		Keyword: "微信",
		Sources: []SourceID{SourceITunes},
		Country: "cn",
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(resp.Items) == 0 {
		t.Fatalf("no items; statuses=%+v", resp.Statuses)
	}
	first := resp.Items[0]
	if first.PkgName == "" {
		t.Errorf("first item has empty PkgName: %+v", first)
	}
	t.Logf("iTunes first: %+v", first)
}

func TestSearchQimaiIOS_Online(t *testing.T) {
	if !onlineEnabled() {
		t.Skip("set APPSEARCH_ONLINE=1 to enable")
	}
	svc := New()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	resp, err := svc.Search(ctx, SearchRequest{
		Keyword: "微信",
		Sources: []SourceID{SourceQimaiIOS},
		Country: "cn",
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	// statuses 里必须有 QimaiIOS 且 OK
	var st *SourceStatus
	for i := range resp.Statuses {
		if resp.Statuses[i].Source == SourceQimaiIOS {
			st = &resp.Statuses[i]
			break
		}
	}
	if st == nil || !st.OK {
		t.Fatalf("qimai_ios failed: %+v", st)
	}
	if st.Count == 0 {
		t.Fatalf("qimai_ios returned no items")
	}
	t.Logf("qimai_ios first 3:")
	withBundle := 0
	for i, it := range resp.Items[:min(3, len(resp.Items))] {
		t.Logf("  [%d] name=%q trackId=%s  bundleId=%s",
			i, it.Name, it.Extra["trackId"], it.PkgName)
		if it.PkgName != "" {
			withBundle++
		}
	}
	if withBundle == 0 {
		t.Errorf("expected at least one item to have bundleId via iTunes lookup, got 0")
	}
}

func TestSearchQimaiAndroid_Online(t *testing.T) {
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
		Keyword: "微信",
		Sources: []SourceID{SourceQimaiAndroid},
		Country: "cn",
		Market:  6,
	}
	req.SetQimaiCredential(sid)
	resp, err := svc.Search(ctx, req)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(resp.Items) == 0 {
		t.Fatalf("no items; statuses=%+v", resp.Statuses)
	}
	withPkg := 0
	for i, it := range resp.Items[:min(3, len(resp.Items))] {
		t.Logf("  [%d] name=%q pkg=%q v=%s qmId=%s", i, it.Name, it.PkgName, it.Version, it.Extra["qmAppId"])
		if it.PkgName != "" {
			withPkg++
		}
	}
	if withPkg == 0 {
		t.Errorf("expected at least one item to have pkgName via detail lookup")
	}
}

func TestSearchYingYongBao_Online(t *testing.T) {
	if !onlineEnabled() {
		t.Skip("set APPSEARCH_ONLINE=1 to enable")
	}
	svc := New()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	resp, err := svc.Search(ctx, SearchRequest{
		Keyword: "微信",
		Sources: []SourceID{SourceYingYongBao},
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(resp.Items) == 0 {
		t.Fatalf("no items; statuses=%+v", resp.Statuses)
	}
	for i, it := range resp.Items[:min(3, len(resp.Items))] {
		t.Logf("  [%d] name=%q pkg=%q v=%s", i, it.Name, it.PkgName, it.Version)
	}
	if resp.Items[0].PkgName == "" {
		t.Errorf("first yyb item has empty pkgName")
	}
}

func TestSearchGooglePlay_Online(t *testing.T) {
	if !onlineEnabled() {
		t.Skip("set APPSEARCH_ONLINE=1 to enable")
	}
	svc := New()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	resp, err := svc.Search(ctx, SearchRequest{
		Keyword: "whatsapp",
		Sources: []SourceID{SourceGooglePlay},
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(resp.Items) == 0 {
		t.Fatalf("no items; statuses=%+v", resp.Statuses)
	}
	withTitle := 0
	withIcon := 0
	for i, it := range resp.Items {
		// 打印 icon URL 尾部 40 字节，便于人眼分辨是 WhatsApp 图标还是 "Everyone" 徽章
		iconTail := it.Icon
		if len(iconTail) > 80 {
			iconTail = "..." + iconTail[len(iconTail)-80:]
		}
		t.Logf("  [%d] pkg=%q name=%q installs=%s\n       icon=%s",
			i, it.PkgName, it.Name, it.Extra["installs"], iconTail)
		if it.Name != "" {
			withTitle++
		}
		if it.Icon != "" {
			withIcon++
		}
	}
	t.Logf("total=%d  with_title=%d  with_icon=%d", len(resp.Items), withTitle, withIcon)
	if withTitle < len(resp.Items)/2 {
		t.Errorf("too few items with title: %d/%d", withTitle, len(resp.Items))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
