# Git Submodule 快速参考

## 🎯 常用命令速查

### 首次克隆项目
```bash
git clone --recurse-submodules <repo-url>
```

### 已克隆项目，初始化 submodule
```bash
git submodule update --init --recursive
```

### 更新 submodule 到最新版本
```bash
cd demo/huobao-drama
git pull origin master
cd ../..
git add demo/huobao-drama
git commit -m "更新 huobao-drama"
```

### 查看 submodule 状态
```bash
git submodule status
```

### 重置 submodule（解决冲突）
```bash
git submodule update --force
```

## 📝 注意事项

1. **克隆时必须使用 `--recurse-submodules`** 或手动初始化
2. **更新 submodule 后记得提交主项目**
3. **本地配置不会被跟踪**（data/, configs/config.yaml）
4. **不要直接在 submodule 中推送到官方仓库**

## 🔗 详细文档

参见 [HUOBAO_SUBMODULE_GUIDE.md](../HUOBAO_SUBMODULE_GUIDE.md)
