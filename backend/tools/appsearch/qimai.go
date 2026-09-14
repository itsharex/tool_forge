package appsearch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

const qimaiBase = "https://api.qimai.cn"

type qimaiIOSEntry struct {
	AppInfo struct {
		AppID     string `json:"appId"` // iTunes trackId（字符串形式）
		AppName   string `json:"appName"`
		Subtitle  string `json:"subtitle"`
		Icon      string `json:"icon"`
		Publisher string `json:"publisher"`
		Country   string `json:"country"`
		FileSize  string `json:"file_size"`
	} `json:"appInfo"`
	Genre  string `json:"genre"`
	IsGame int    `json:"isGame"`
}

type qimaiIOSResp struct {
	Code     int             `json:"code"`
	Msg      string          `json:"msg"`
	TotalNum int             `json:"totalNum"`
	MaxPage  int             `json:"maxPage"`
	AppList  []qimaiIOSEntry `json:"appList"`
	IsLogout int             `json:"is_logout"`
}

// searchQimaiIOS 七麦 iOS 搜索，无需登录。
// 七麦只返回 iTunes trackId；内部会调 iTunes /lookup 批量反查 bundleId 并回填。
func searchQimaiIOS(ctx context.Context, client *http.Client, keyword, country string) ([]SearchResultItem, error) {
	if country == "" {
		country = "cn"
	}
	path := "/search/index"
	params := map[string]string{
		"search":  keyword,
		"country": country,
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
	req.Header.Set("User-Agent", defaultUA)
	req.Header.Set("Referer", "https://www.qimai.cn/")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("qimai iOS: http %d", resp.StatusCode)
	}

	var parsed qimaiIOSResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("qimai iOS: decode: %w", err)
	}
	if parsed.Code != 10000 {
		return nil, fmt.Errorf("qimai iOS: code=%d msg=%s", parsed.Code, parsed.Msg)
	}

	items := make([]SearchResultItem, 0, len(parsed.AppList))
	trackIDs := make([]string, 0, len(parsed.AppList))
	for _, e := range parsed.AppList {
		info := e.AppInfo
		if info.AppID != "" {
			trackIDs = append(trackIDs, info.AppID)
		}
		items = append(items, SearchResultItem{
			Source:    SourceQimaiIOS,
			Platform:  PlatformIOS,
			PkgName:   "", // 稍后用 iTunes lookup 回填
			Name:      info.AppName,
			Developer: info.Publisher,
			Icon:      info.Icon,
			Country:   info.Country,
			Extra: map[string]string{
				"trackId":  info.AppID,
				"subtitle": info.Subtitle,
				"genre":    e.Genre,
				"fileSize": info.FileSize,
				"isGame":   strconv.Itoa(e.IsGame),
			},
		})
	}

	// 批量补 bundleId；失败就留空，不阻断主流程
	bundleMap := itunesLookupBundleIDs(ctx, client, trackIDs, country)
	for i := range items {
		if tid := items[i].Extra["trackId"]; tid != "" {
			if bid, ok := bundleMap[tid]; ok {
				items[i].PkgName = bid
			}
		}
	}
	return items, nil
}
