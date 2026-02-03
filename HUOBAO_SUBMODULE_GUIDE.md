# Huobao Drama Submodule 使用指南

## 📦 什么是 Git Submodule？

Git Submodule 允许你将一个 Git 仓库作为另一个 Git 仓库的子目录。这样可以：
- 保持 huobao-drama 的独立版本管理
- 方便更新到官方最新版本
- 避免代码重复和冲突

## 🎯 当前配置

- **Submodule 路径**: `demo/huobao-drama`
- **官方仓库**: https://github.com/chatfire-AI/huobao-drama.git
- **当前版本**: v1.0.4+

## 🚀 常用操作

### 1. 克隆项目（首次）

```bash
# 方式一：克隆时同时初始化 submodule
git clone --recurse-submodules https://github.com/Ashleymmy/ai001.git

# 方式二：先克隆主项目，再初始化 submodule
git clone https://github.com/Ashleymmy/ai001.git
cd ai001
git submodule update --init --recursive
```

### 2. 更新 Huobao Drama 到最新版本

```bash
# 进入 submodule 目录
cd demo/huobao-drama

# 拉取最新代码
git fetch origin
git checkout main
git pull origin main

# 返回主项目目录
cd ../..

# 提交 submodule 版本更新
git add demo/huobao-drama
git commit -m "更新 huobao-drama 到最新版本"
```

### 3. 查看 Submodule 状态

```bash
# 查看所有 submodule 状态
git submodule status

# 查看 submodule 的详细信息
git submodule summary
```

### 4. 切换到特定版本

```bash
cd demo/huobao-drama

# 查看可用的版本标签
git tag -l

# 切换到特定版本（例如 v1.0.4）
git checkout v1.0.4

cd ../..
git add demo/huobao-drama
git commit -m "切换 huobao-drama 到 v1.0.4"
```

### 5. 在 Submodule 中进行本地修改

```bash
cd demo/huobao-drama

# 创建本地分支
git checkout -b my-custom-changes

# 进行修改...
# 提交修改
git add .
git commit -m "我的自定义修改"

# 返回主项目
cd ../..
git add demo/huobao-drama
git commit -m "使用自定义的 huobao-drama 版本"
```

## ⚙️ 配置管理

### 本地配置文件（不会被 Git 跟踪）

以下文件已添加到 `.gitignore`，不会被提交：

- `demo/huobao-drama/data/` - 数据库和存储文件
- `demo/huobao-drama/configs/config.yaml` - 本地配置
- `demo/huobao-drama/web/node_modules/` - 前端依赖

### 首次配置

```bash
cd demo/huobao-drama

# 复制配置模板
cp configs/config.example.yaml configs/config.yaml

# 编辑配置文件
vim configs/config.yaml
```

## 🔄 启动服务

项目的启动脚本已经集成了 huobao-drama：

```bash
# Windows PowerShell
npm run start

# 或者手动启动
cd demo/huobao-drama
go run main.go
```

启动后访问：
- 主项目前端: http://localhost:5173
- Huobao Drama: http://localhost:5678

## 🔧 故障排除

### 问题 1: Submodule 目录为空

```bash
git submodule update --init --recursive
```

### 问题 2: Submodule 版本冲突

```bash
# 重置 submodule 到主项目记录的版本
git submodule update --force
```

### 问题 3: 无法拉取 Submodule 更新

```bash
cd demo/huobao-drama
git fetch origin
git reset --hard origin/main
cd ../..
git add demo/huobao-drama
git commit -m "重置 huobao-drama 到官方最新版本"
```

### 问题 4: 想要移除 Submodule

```bash
# 1. 从 .gitmodules 中删除配置
git config -f .gitmodules --remove-section submodule.demo/huobao-drama

# 2. 从 .git/config 中删除配置
git config -f .git/config --remove-section submodule.demo/huobao-drama

# 3. 从 git 索引中移除
git rm --cached demo/huobao-drama

# 4. 删除目录
rm -rf demo/huobao-drama

# 5. 提交更改
git commit -m "移除 huobao-drama submodule"
```

## 📚 更多资源

- [Huobao Drama 官方文档](https://github.com/chatfire-AI/huobao-drama)
- [Git Submodule 官方文档](https://git-scm.com/book/zh/v2/Git-%E5%B7%A5%E5%85%B7-%E5%AD%90%E6%A8%A1%E5%9D%97)

## 🔗 集成说明

### API 配置同步

项目启动时会自动执行 `scripts/sync_huobao_ai_config.py`，将主项目的 AI 配置同步到 huobao-drama（默认禁用，需在 demo 的 AI 配置页面手动启用）。

### 前端集成

在 `src/pages/CanvasPage.tsx` 中通过 iframe 嵌入了 huobao-drama 的前端界面。

## ⚠️ 注意事项

1. **不要直接在 submodule 中提交到官方仓库**，除非你有权限
2. **本地配置和数据不会被 Git 跟踪**，迁移时需要手动备份
3. **更新 submodule 后记得在主项目中提交**，否则其他人拉取代码时会使用旧版本
4. **团队协作时确保所有人都初始化了 submodule**
