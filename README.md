# wt-pylon-solver

wt-pylon-solver 现为纯静态站点：Python 只在构建阶段从 War Thunder Datamine 生成飞机挂载 JSON；浏览器直接读取 JSON，并在 Web Worker 中完成求解。线上不需要 Flask、VPS、Docker 或其他常驻后端。

## 本地开发

安装 Python 数据生成依赖：

```bash
python -m pip install -r requirements.txt
```

只生成正在测试的飞机即可；不指定本地 Datamine 时会从 GitHub 按需读取：

```bash
python build_static_data.py su_34 f_15e
```

然后启动前端：

```bash
cd frontend
npm install
npm run dev
```

`frontend/public/data/*.json` 是生成物，不提交到 Git。

## 本地完整构建

如果已经有 War-Thunder-Datamine 的本地 checkout：

```bash
python build_static_data.py --all --clean --datamine-root /path/to/War-Thunder-Datamine
cd frontend
npm install
npm run typecheck
npm run build
```

最终静态站点输出到根目录 `dist/`，可以直接交给任何静态托管平台。

## GitHub Pages

仓库已经包含 `.github/workflows/pages.yml`。推送到 `main` 后，Actions 会：

1. checkout wt-pylon-solver；
2. checkout 最新 War-Thunder-Datamine；
3. 为所有带 `WeaponSlots` 的飞机生成精简 JSON；
4. typecheck + Vite build；
5. 部署 `dist/` 到 GitHub Pages。

工作流也支持手动触发，并每天自动重新构建一次 Datamine 数据。仓库首次使用时，只需在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

## 静态数据结构

每架飞机一个 `data/<aircraft>.json`。武器数据只保存一次；挂点只保存 `option_id` 引用，避免旧 API 结构在每个挂点下重复整份武器对象。静态数据只包含 UI/求解器需要的字段。
