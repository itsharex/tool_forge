package main

import (
	"reflect"
	"strings"
	"testing"
)

// Go 的 nil 切片过了 Wails 到前端是 null,而前端一律当数组用 ——
// `records.filter is not a function`,整页白屏。
//
// aichat 包里已经有一条同类的契约测试,但它盯的是那个包内部的类型;
// 前端真正调的是这一层的绑定方法,而这一层一直没人管。修「AI 用量」那次白屏时
// 发现 ListAIUsage 两条返回路径都给 nil,顺手把整层一次性钉住 —— 一扫出来十一个。
//
// 只扫「零参数、返回切片」的方法:它们就是前端拿去 map/filter 的那批「列全部」绑定。
// 零值 App 下它们会走各自的「服务未初始化」分支立刻返回,不碰磁盘也不发请求 ——
// 而那条分支恰恰是最容易顺手写成 return nil 的地方。
func TestBindingsNeverReturnNilSlice(t *testing.T) {
	app := &App{}
	v := reflect.ValueOf(app)
	typ := v.Type()

	checked := 0
	for i := 0; i < typ.NumMethod(); i++ {
		m := typ.Method(i)
		mt := m.Type
		if mt.NumIn() != 1 || mt.NumOut() == 0 {
			continue
		}
		if mt.Out(0).Kind() != reflect.Slice {
			continue
		}
		// []byte 是二进制载荷,前端不会拿去 map
		if mt.Out(0).Elem().Kind() == reflect.Uint8 {
			continue
		}
		// 名字像动作的一律不碰:Pick* 会弹系统文件对话框,
		// 一条契约测试不该在 CI 上把窗口弹出来
		if isActionBinding(m.Name) {
			continue
		}

		t.Run(m.Name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("零值 App 上调用就 panic 了: %v —— 缺「服务未初始化」的守卫", r)
				}
			}()
			out := v.Method(i).Call(nil)

			// 同时返回 error 的:出错时 Wails 会 reject,前端走 catch 拿不到这个 nil。
			// 只有「没报错却给了 nil」才会变成前端的 null
			if mt.NumOut() == 2 && mt.Out(1).Name() == "error" && !out[1].IsNil() {
				return
			}
			if out[0].IsNil() {
				t.Errorf("返回了 nil 切片。它到前端是 null,而前端一律当数组用 —— "+
					"改成返回 %s{} 即可", strings.TrimPrefix(mt.Out(0).String(), "[]"))
			}
		})
		checked++
	}

	if checked == 0 {
		t.Fatal("一个方法都没扫到 —— 这条测试自己失效了")
	}
	t.Logf("扫了 %d 个返回切片的零参数绑定", checked)
}

// isActionBinding 名字看起来会产生副作用的绑定。
// 这条测试只该读,不该做事
func isActionBinding(name string) bool {
	for _, p := range []string{
		"Pick", "Open", "Save", "Delete", "Remove", "Clear", "Run", "Start",
		"Stop", "Cancel", "Export", "Import", "Generate", "Reconnect", "Test",
	} {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}
