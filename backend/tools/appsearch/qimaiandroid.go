package appsearch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

// qimaiAndroidSearchEntry 搜索结果条目
type qimaiAndroidSearchEntry struct {
	AppInfo struct {
		AppID        string  `json:"appId"` // 七麦内部 ID（不是包名）
		AppName      string  `json:"appName"`
		Icon         string  `json:"icon"`
		Publisher    string  `json:"publisher"`
		CommentScore float64 `json:"comment_score"`
		DownloadNum  string  `json:"app_download_num"`
		VersionTime  string  `json:"version_time"`
	} `json:"appInfo"`
	Genre   string `json:"genre"`
	Company struct {
		Name string `json:"name"`
	} `json:"company"`
	RankInfo struct {
		Ranking any `json:"ranking"` // 七麦有时给数字有时给字符串，用 any 兜底
	} `json:"rankInfo"`
}

type qimaiAndroidSearchResp struct {
	Code     int                       `json:"code"`
	Msg      string                    `json:"msg"`
	TotalNum any                       `json:"totalNum"` // 七麦时而数字时而字符串，用 any 兜底
	AppList  []qimaiAndroidSearchEntry `json:"appList"`
	IsLogout int                       `json:"is_logout"`
}

// qimaiAndroidDetailEntry 详情响应里的 appInfo
type qimaiAndroidDetailEntry struct {
	AppBundleID     string `json:"app_bundleid"` // 真·Android 包名 com.tencent.mm
	AppName         string `json:"app_name"`
	AppVersion      string `json:"app_version"`
	AppSize         string `json:"app_size"`
	AppDevName      string `json:"app_dev_name"`
	AppCategory     string `json:"app_category"`
	AppCommentScore string `json:"app_comment_score"`
	AppDownloadNum  string `json:"app_download_num"`
	DownloadNum     string `json:"download_num"`
	AppIcon         string `json:"app_icon"`
	IosID           string `json:"iosId"`
	MarketName      string `json:"market_name"`
	AppURL          string `json:"app_url"`
}

type qimaiAndroidDetailResp struct {
	Code     int                     `json:"code"`
	Msg      string                  `json:"msg"`
	AppInfo  qimaiAndroidDetailEntry `json:"appInfo"`
	IsLogout int                     `json:"is_logout"`
}

// ErrQimaiCredentialRequired 用户还没配七麦登录态
var ErrQimaiCredentialRequired = errors.New("七麦 Android 搜索需要登录态，请在包名搜索页右上角的「配置」里填入 PHPSESSID")

// ErrQimaiCredentialExpired 登录态失效。
// 七麦对此不报错(搜索照回"成功 + 空列表"),是我们问了详情接口才确认的
var ErrQimaiCredentialExpired = errors.New("七麦登录态已失效（搜索会一直返回 0 条），请在包名搜索页右上角的「配置」里重新贴一次")

// sourceNote 一条非致命说明(见 SourceStatus.Note)。
// 做成 error 只是为了搭现成的返回通道,它不表示这一路失败了。
type sourceNote struct{ msg string }

func (e *sourceNote) Error() string { return e.msg }

// errQimaiAndroidEmpty 接口回了成功、零条。
//
// 2026-09-15 实测记录,免得下次再查一遍:
//
// 登录态一过期,/search/android 不报错 —— 它回 code=10000 / msg=成功 / appList=[] /
// is_logout=0,和"这个词真的搜不到"一模一样。换 11 个市场、4 个关键词全是 0 条;
// 把 market 填成 "huawei" 这种非法值、拿 brand 顶掉 market、甚至只发一个 search,
// 它照样回"成功"。也就是说这个端点对"没登录"和"没结果"一视同仁,自己看不出区别。
//
// 换一份新鲜的 cookie 后同样的请求就有 181 条。逐个 cookie 试下来:
// PHPSESSID 单独就够(USERINFO 单独也行,AUTHKEY 单独不行)—— 所以不用整段 Cookie。
//
// 能把猜变成事实的是 /andapp/detail:它对未登录直说 code=10001「请登录」。
// 见 qimaiSessionDead。
var errQimaiAndroidEmpty = &sourceNote{
	msg: "七麦这一路返回「成功」但零条,而登录态是好的 —— 大概率就是这个市场下确实没有匹配的应用,换个市场或关键词试试。",
}

// qimaiSessionDead 用详情接口问一句登录态还在不在。
//
// 只在搜索结果为空时问这一次。搜索接口对"没登录"和"没结果"给的是同一个响应,
// 而详情接口会直说 —— 不问的话,过期只能表现成一个绿色的「0 条」,
// 用户会以为是自己关键词打错了,反复重试。
//
// appid 随便给一个形状合法的就行:登录态没了一律先回 10001;还在的话回成功或参数错误,
// 两者都说明登录态是好的。网络出错按"没死"处理 —— 宁可少报,不要误报过期让人白折腾。
func qimaiSessionDead(ctx context.Context, client *http.Client, cred string) bool {
	path := "/andapp/detail"
	params := map[string]string{"appid": "1", "market": "6"}
	params["analysis"] = qimaiAnalysis(path, params)
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, qimaiBase+path+"?"+q.Encode(), nil)
	if err != nil {
		return false
	}
	applyQimaiHeaders(req, cred)
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var parsed struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return false
	}
	return parsed.Code == qimaiCodeNeedLogin
}

// qimaiCodeNeedLogin 七麦的「请登录」
const qimaiCodeNeedLogin = 10001

// searchQimaiAndroid 七麦 Android 搜索 + 并发回填每条的真实包名（/andapp/detail）。
func searchQimaiAndroid(ctx context.Context, client *http.Client, keyword, country string, market int, phpSessID string) ([]SearchResultItem, error) {
	if phpSessID == "" {
		return nil, ErrQimaiCredentialRequired
	}
	if country == "" {
		country = "cn"
	}
	if market <= 0 {
		market = 6 // 华为
	}

	path := "/search/android"
	marketStr := strconv.Itoa(market)
	params := map[string]string{
		"search":  keyword,
		"country": country,
		"market":  marketStr,
		"page":    "1",
	}
	params["analysis"] = qimaiAnalysis(path, params)

	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, qimaiBase+path+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	applyQimaiHeaders(req, phpSessID)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("qimai Android: http %d", resp.StatusCode)
	}

	var parsed qimaiAndroidSearchResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("qimai Android: decode: %w", err)
	}
	if parsed.Code != 10000 {
		return nil, fmt.Errorf("qimai Android: code=%d msg=%s", parsed.Code, parsed.Msg)
	}
	// is_logout=1 是七麦明确给出的登录失效信号。
	// 但它并不可靠：登录态不全时七麦照样给 is_logout=0 + 成功 + 空列表，
	// 真正会直说的是 /andapp/detail（回 code=10001「请登录」）。所以空结果单独出一条说明。
	if parsed.IsLogout == 1 {
		return nil, ErrQimaiCredentialExpired
	}

	// 「成功 + 空」既可能是真搜不到,也可能是登录态过期 —— 搜索接口对两者一视同仁,
	// 问一句详情接口才分得清(见 qimaiSessionDead)
	if len(parsed.AppList) == 0 {
		if qimaiSessionDead(ctx, client, phpSessID) {
			return nil, ErrQimaiCredentialExpired
		}
		return nil, errQimaiAndroidEmpty
	}

	// 预填列表（包名先留空），再并发拉详情
	items := make([]SearchResultItem, len(parsed.AppList))
	for i, e := range parsed.AppList {
		info := e.AppInfo
		items[i] = SearchResultItem{
			Source:    SourceQimaiAndroid,
			Platform:  PlatformAndroid,
			Name:      info.AppName,
			Developer: info.Publisher,
			Icon:      info.Icon,
			Country:   country,
			Rating:    info.CommentScore,
			Extra: map[string]string{
				"qmAppId":     info.AppID,
				"market":      marketStr,
				"genre":       e.Genre,
				"company":     e.Company.Name,
				"ranking":     anyToString(e.RankInfo.Ranking),
				"downloadNum": info.DownloadNum,
				"versionTime": info.VersionTime,
			},
		}
	}

	enrichQimaiAndroidDetails(ctx, client, items, market, phpSessID)
	return items, nil
}

// enrichQimaiAndroidDetails 并发拉详情，把 app_bundleid / 版本 / 大小填回 items。
// 控制并发数、限制详情拉取前 N 条避免放大（默认前 10 条，剩下只有展示基础信息）。
func enrichQimaiAndroidDetails(ctx context.Context, client *http.Client, items []SearchResultItem, market int, phpSessID string) {
	const detailLimit = 10
	sem := make(chan struct{}, 5) // 并发 5
	var wg sync.WaitGroup

	for i := range items {
		if i >= detailLimit {
			break
		}
		qmID := items[i].Extra["qmAppId"]
		if qmID == "" {
			continue
		}
		wg.Add(1)
		go func(idx int, appID string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			detail, err := qimaiAndroidDetail(ctx, client, appID, market, phpSessID)
			if err != nil || detail == nil {
				return
			}
			items[idx].PkgName = detail.AppBundleID
			if detail.AppVersion != "" {
				items[idx].Version = detail.AppVersion
			}
			if detail.AppSize != "" {
				items[idx].Extra["fileSize"] = detail.AppSize
			}
			if detail.IosID != "" {
				items[idx].Extra["iosTrackId"] = detail.IosID
			}
			if detail.MarketName != "" {
				items[idx].Extra["marketName"] = detail.MarketName
			}
			if detail.AppURL != "" {
				items[idx].Extra["url"] = detail.AppURL
			}
		}(i, qmID)
	}
	wg.Wait()
}

// qimaiAndroidDetail 拉单条详情；失败返回 nil 不报错（降级）。
func qimaiAndroidDetail(ctx context.Context, client *http.Client, appID string, market int, phpSessID string) (*qimaiAndroidDetailEntry, error) {
	path := "/andapp/detail"
	marketStr := strconv.Itoa(market)
	params := map[string]string{
		"appid":  appID,
		"market": marketStr,
	}
	params["analysis"] = qimaiAnalysis(path, params)

	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, qimaiBase+path+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	applyQimaiHeaders(req, phpSessID)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("detail: http %d", resp.StatusCode)
	}
	var parsed qimaiAndroidDetailResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	if parsed.Code != 10000 {
		return nil, fmt.Errorf("detail: code=%d msg=%s", parsed.Code, parsed.Msg)
	}
	return &parsed.AppInfo, nil
}

// anyToString 兼容七麦偶尔返回数字的字符串字段
func anyToString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return fmt.Sprint(x)
	}
}

// applyQimaiHeaders 统一给七麦请求打常规头 + Cookie（若有）
func applyQimaiHeaders(req *http.Request, cred string) {
	req.Header.Set("User-Agent", defaultUA)
	req.Header.Set("Referer", "https://www.qimai.cn/")
	req.Header.Set("Origin", "https://www.qimai.cn")
	if c := qimaiCookieHeader(cred); c != "" {
		req.Header.Set("Cookie", c)
	}
}

// qimaiCookieHeader 把用户存的凭据变成 Cookie 头。
//
// 实测 PHPSESSID 一个就够(见 errQimaiAndroidEmpty 的记录)。这里额外认整段 Cookie,
// 是因为从 DevTools 复制时整条一起带走比单独挑一个字段容易得多 ——
// 用户贴多了也能用,不必回去重挑。
func qimaiCookieHeader(cred string) string {
	s := strings.TrimSpace(cred)
	if s == "" {
		return ""
	}
	// PHPSESSID 的值是一串字母数字,不含 "=";带 "=" 的就是 name=value 形式的整段
	if strings.Contains(s, "=") {
		return s
	}
	return "PHPSESSID=" + s
}
