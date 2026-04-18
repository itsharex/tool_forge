package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Check 请求 Hub manifest,对比本地版本,返回更新状态。
// 网络/服务器异常会返回 error,调用方负责决定是否报错给用户。
func Check(ctx context.Context, currentVersion string) (*CheckResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ManifestURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 manifest 失败: %w", err)
	}
	defer resp.Body.Close()

	// Hub 侧对 "该 app 尚无 published release" 或 "找不到 app" 返回 404,
	// 从客户端视角这都等价于 "没有可升级的版本",当作"已是最新"处理,不打扰用户。
	if resp.StatusCode == http.StatusNotFound {
		return &CheckResult{
			CurrentVersion: currentVersion,
			LatestVersion:  currentVersion,
			HasUpdate:      false,
			CheckedAt:      time.Now().UTC(),
		}, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var m Manifest
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, fmt.Errorf("解析 manifest 失败: %w", err)
	}

	has := compareVersions(m.Version, currentVersion) > 0
	res := &CheckResult{
		CurrentVersion: currentVersion,
		LatestVersion:  m.Version,
		HasUpdate:      has,
		CheckedAt:      time.Now().UTC(),
	}
	if has {
		mc := m
		res.Manifest = &mc
	}
	return res, nil
}

// compareVersions 返回 a > b = 1, a == b = 0, a < b = -1
// 支持 X.Y.Z 和 X.Y.Z-preid;prerelease 后缀按字典序做 tiebreak
func compareVersions(a, b string) int {
	pa, preA := splitSemver(a)
	pb, preB := splitSemver(b)
	for i := 0; i < 3; i++ {
		if pa[i] > pb[i] {
			return 1
		}
		if pa[i] < pb[i] {
			return -1
		}
	}
	// 数字相同:无 prerelease > 有 prerelease (1.0.0 > 1.0.0-beta)
	switch {
	case preA == "" && preB == "":
		return 0
	case preA == "" && preB != "":
		return 1
	case preA != "" && preB == "":
		return -1
	}
	return strings.Compare(preA, preB)
}

func splitSemver(v string) (parts [3]int, prerelease string) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if idx := strings.IndexAny(v, "-+"); idx >= 0 {
		prerelease = v[idx+1:]
		v = v[:idx]
	}
	ps := strings.Split(v, ".")
	for i := 0; i < 3 && i < len(ps); i++ {
		n, _ := strconv.Atoi(ps[i])
		parts[i] = n
	}
	return
}
