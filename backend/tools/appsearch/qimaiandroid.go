package appsearch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
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

// ErrQimaiPHPSessIDRequired 用户未在 Profile 配置 PHPSESSID
var ErrQimaiPHPSessIDRequired = errors.New("七麦 Android 搜索需要 PHPSESSID，请在个人主页 → 外部工具 里配置")

// ErrQimaiPHPSessIDExpired 后端收到 is_logout=1 或结果异常
var ErrQimaiPHPSessIDExpired = errors.New("七麦 PHPSESSID 已失效，请在个人主页 → 外部工具 里重新录入")

// searchQimaiAndroid 七麦 Android 搜索 + 并发回填每条的真实包名（/andapp/detail）。
func searchQimaiAndroid(ctx context.Context, client *http.Client, keyword, country string, market int, phpSessID string) ([]SearchResultItem, error) {
	if phpSessID == "" {
		return nil, ErrQimaiPHPSessIDRequired
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
	// 空结果本身不判失效：360/百度/豌豆荚 即使登录也常年 0 条，
	// 应用宝/小米/VIVO/OPPO/GP 还会 totalNum=0 但 appList 非空。
	if parsed.IsLogout == 1 {
		return nil, ErrQimaiPHPSessIDExpired
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
func applyQimaiHeaders(req *http.Request, phpSessID string) {
	req.Header.Set("User-Agent", defaultUA)
	req.Header.Set("Referer", "https://www.qimai.cn/")
	req.Header.Set("Origin", "https://www.qimai.cn")
	if phpSessID != "" {
		req.AddCookie(&http.Cookie{Name: "PHPSESSID", Value: phpSessID})
	}
}
