package appsearch

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// qimaiStub 一个假的七麦:搜索永远回「成功 + 空」,详情按 needLogin 决定说不说「请登录」。
//
// 这正是真实行为:登录态过期时搜索接口一声不吭(见 errQimaiAndroidEmpty 的实测记录),
// 只有详情接口会直说。
func qimaiStub(t *testing.T, needLogin bool) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/andapp/detail") {
			if needLogin {
				_, _ = w.Write([]byte(`{"code":10001,"msg":"请登录","is_logout":0}`))
				return
			}
			_, _ = w.Write([]byte(`{"code":10000,"msg":"成功","appInfo":{"app_bundleid":"com.x"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":10000,"msg":"成功","appList":[],` +
			`"isActualAndroid":1,"totalNum":0,"is_logout":0}`))
	}))
	t.Cleanup(srv.Close)
	old := qimaiBase
	qimaiBase = srv.URL
	t.Cleanup(func() { qimaiBase = old })
}

// 登录态过期:搜索回空,但详情说「请登录」—— 要报成明确的失效,而不是一句"没搜到"。
// 这是这个坑最要命的地方:界面上原来只是一个绿色的「0 条」。
func TestQimaiAndroidExpiredIsReported(t *testing.T) {
	qimaiStub(t, true)

	_, err := searchQimaiAndroid(context.Background(), http.DefaultClient, "微信", "cn", 6, "stale")
	if !errors.Is(err, ErrQimaiPHPSessIDExpired) {
		t.Fatalf("登录态过期应该明确报出来, got %v", err)
	}
	var note *sourceNote
	if errors.As(err, &note) {
		t.Error("过期是真失败,不该降级成说明 —— 那样源还是绿色的")
	}
}

// 登录态好好的、只是这个词真没结果:给一句说明,别把源标红吓人
func TestQimaiAndroidGenuinelyEmptyIsNoted(t *testing.T) {
	qimaiStub(t, false)

	items, err := searchQimaiAndroid(context.Background(), http.DefaultClient, "根本不存在的词", "cn", 6, "good")
	if items != nil {
		t.Errorf("空结果不该带出条目, got %d", len(items))
	}
	var note *sourceNote
	if !errors.As(err, &note) {
		t.Fatalf("登录态没问题的空结果应该给说明, got %v", err)
	}
	if errors.Is(err, ErrQimaiPHPSessIDExpired) {
		t.Error("登录态是好的,不该报成失效 —— 误报会让人白重新登一次")
	}
}

// is_logout=1 是七麦少数会直说的场合,照旧当失效处理
func TestQimaiAndroidLogoutFlagIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"code":10000,"msg":"成功","appList":[],"is_logout":1}`))
	}))
	defer srv.Close()
	old := qimaiBase
	qimaiBase = srv.URL
	defer func() { qimaiBase = old }()

	_, err := searchQimaiAndroid(context.Background(), http.DefaultClient, "微信", "cn", 6, "x")
	if !errors.Is(err, ErrQimaiPHPSessIDExpired) {
		t.Errorf("is_logout=1 应该报失效, got %v", err)
	}
}

// 没配凭据仍然是失败
func TestQimaiAndroidMissingSessionIsError(t *testing.T) {
	_, err := searchQimaiAndroid(context.Background(), http.DefaultClient, "微信", "cn", 6, "")
	if !errors.Is(err, ErrQimaiPHPSessIDRequired) {
		t.Errorf("没配凭据应该直接报要配置, got %v", err)
	}
}

// 凭据两种写法都要认:只有 PHPSESSID 的值(实测够用),或者从 DevTools 整条复制过来的 Cookie
func TestQimaiCookieHeader(t *testing.T) {
	cases := map[string]string{
		"dm6heusso81altoe7k37lqp3qr":       "PHPSESSID=dm6heusso81altoe7k37lqp3qr",
		"  dm6heusso81altoe7k37lqp3qr  ":   "PHPSESSID=dm6heusso81altoe7k37lqp3qr",
		"synct=1; PHPSESSID=abc; AUTHKEY=x": "synct=1; PHPSESSID=abc; AUTHKEY=x",
		"PHPSESSID=abc":                    "PHPSESSID=abc",
		"":                                 "",
		"   ":                              "",
	}
	for in, want := range cases {
		if got := qimaiCookieHeader(in); got != want {
			t.Errorf("qimaiCookieHeader(%q) = %q, want %q", in, got, want)
		}
	}
}

// 说明类"错误"不该把源标成失败 —— 搜一个不存在的词本来就该是 0 条,标红只会让人以为工具坏了
func TestRunSourceSafeNoteKeepsSourceOK(t *testing.T) {
	var status SourceStatus
	out := runSourceSafe(func() ([]SearchResultItem, error) {
		return nil, &sourceNote{msg: "空得可疑"}
	}, &status, 20)

	if out != nil {
		t.Errorf("说明路径不该带出结果, got %v", out)
	}
	if !status.OK {
		t.Error("说明不是失败,OK 应该还是 true")
	}
	if status.Error != "" {
		t.Errorf("说明不该写进 Error: %q", status.Error)
	}
	if status.Note != "空得可疑" {
		t.Errorf("Note = %q", status.Note)
	}
}

// 真错误照旧标失败
func TestRunSourceSafeRealErrorFails(t *testing.T) {
	var status SourceStatus
	runSourceSafe(func() ([]SearchResultItem, error) {
		return nil, errors.New("http 500")
	}, &status, 20)

	if status.OK {
		t.Error("真错误不该算成功")
	}
	if status.Error != "http 500" {
		t.Errorf("Error = %q", status.Error)
	}
	if status.Note != "" {
		t.Errorf("真错误不该写进 Note: %q", status.Note)
	}
}
