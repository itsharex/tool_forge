package main

import (
	"context"

	"tool_forge/backend/tools/charles"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// GenerateCharlesKey 根据名称生成 Charles 激活码
func (a *App) GenerateCharlesKey(name string) string {
	return charles.Generate(name)
}
