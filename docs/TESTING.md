# 测试与验收清单

本文件提供可执行的项目验收流程，目标是快速判断当前分支是否满足“可构建 + 可运行 + 核心后端测试通过”。

## 1. 前置条件

- Node.js >= 18
- npm >= 9
- Python >= 3.10
- 已在项目根目录执行过 `npm install`

后端依赖（含 `pytest`）：

```bash
python -m pip install -r backend/requirements.txt
```

若本机默认是 `python3`：

```bash
python3 -m pip install -r backend/requirements.txt
```

## 2. 一键验收（推荐）

### Windows

```bat
scripts\windows\run_acceptance.bat
```

首次机器可自动安装后端依赖：

```bat
scripts\windows\run_acceptance.bat --install-backend-deps
```

### macOS / Linux / WSL

```bash
./scripts/qa/run_acceptance.sh
```

首次机器可自动安装后端依赖：

```bash
./scripts/qa/run_acceptance.sh --install-backend-deps
```

## 3. 验收内容（默认执行）

1. 前端构建：`npm run build`
2. 后端语法编译检查：`python -m compileall backend`
3. Studio 核心后端测试：`python -m pytest -q backend/services/studio/tests`

## 4. 可选参数

- `--skip-frontend-build`
- `--skip-backend-compile`
- `--skip-backend-tests`
- `--pytest-path <path>`（覆盖默认测试路径）
- `--queue-smoke`（额外执行任务队列 smoke 测试）

示例：

```bash
python3 scripts/qa/run_acceptance.py --pytest-path backend/services/studio/tests/test_prompt_assembler.py
```

## 5. 通过标准

- 脚本最后输出：`[PASS] All selected checks passed.`
- 任一阶段失败时输出 `[FAIL]` 并返回非 0 退出码，可直接用于 CI 或本地 pre-release 检查。
