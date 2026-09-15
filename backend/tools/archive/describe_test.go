package archive

import "testing"

// 文件数为 0 时得说清是「只有空目录」还是「什么都没有」——
// "extracted 0 file(s)" 看着像出了事,而它多半只是个本来就空的 media 目录。
// 取证报告里"这个目录我们没提到东西"是个要站得住的结论,日志得给判断依据
func TestDescribeDistinguishesEmptyDirsFromNothing(t *testing.T) {
	cases := []struct {
		res  Result
		want string
	}{
		{Result{Files: 3, Dirs: 2}, "extracted 3 file(s)"},
		{Result{Files: 0, Dirs: 4}, "extracted 0 file(s) —— 包里只有 4 个空目录,没有文件"},
		{Result{Files: 0, Dirs: 0}, "extracted 0 file(s) —— 包里一个成员都没有"},
	}
	for _, tc := range cases {
		if got := Describe(tc.res); got != tc.want {
			t.Errorf("Describe(%+v) = %q, want %q", tc.res, got, tc.want)
		}
	}
}
