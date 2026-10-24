# wt-pylon-solver

[![Build and deploy](https://github.com/Hg-Spark/wt-pylon-solver/actions/workflows/pages.yml/badge.svg)](https://github.com/Hg-Spark/wt-pylon-solver/actions/workflows/pages.yml)

Cloudflare Pages（启用后）：`https://<Cloudflare 项目名>.pages.dev/`  
原 GitHub Pages 站点：https://hg-spark.github.io/wt-pylon-solver/

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

## Cloudflare Pages（推荐公开访问域名）

此仓库已为 Cloudflare Pages 的 **Git integration（GitHub）** 准备构建脚本。部署时使用 `*.pages.dev` 域名，网址不包含 GitHub 用户名；GitHub 仓库本身仍是公开的。

1. 在 [Cloudflare Workers & Pages](https://dash.cloudflare.com/) 创建 **Pages → Connect to Git → GitHub** 项目，并授权 `Hg-Spark/wt-pylon-solver`。
2. 选择 `main` 作为生产分支，Framework preset 选 **None**；Root directory 留空（仓库根目录）。
3. 设置 **Build command**：`bash scripts/build_cloudflare_pages.sh`。
4. 设置 **Build output directory**：`dist`。Python 3.12 和 Node 22 由根目录的 `.python-version`、`.node-version` 指定。
5. 点击部署。完成后使用 Cloudflare 实际分配的 `<项目名>.pages.dev` 域名（项目名可能被占用）。

构建脚本仅拉取 War Thunder Datamine 必需的目录与文件，随后生成所有飞机 JSON，执行 Vue/TypeScript 检查并构建静态站点。每次向 `main` 推送代码，Cloudflare 都会自动构建和部署。

**每日更新 Datamine（可选）：** Cloudflare Pages 项目中进入 **Settings → Builds → Add deploy hook**，选择 `main` 并复制部署钩子 URL。在 GitHub 仓库 **Settings → Secrets and variables → Actions** 新增 Repository secret：`CF_PAGES_DEPLOY_HOOK`，值填入完整 URL。现有 `.github/workflows/cloudflare-refresh.yml` 每天会触发一次 Cloudflare 构建；未配置该 Secret 时自动跳过。请勿将该 URL 提交到 Git。

确认 Cloudflare 站点可用后，原 GitHub Pages 可自行在仓库 Settings → Pages 中停用，以避免重复构建。Cloudflare 连接及首次项目创建须由 Cloudflare 账户所有者完成。

## GitHub Pages

仓库已经包含 `.github/workflows/pages.yml`。推送到 `main` 后，Actions 会：

1. checkout wt-pylon-solver；
2. checkout 最新 War-Thunder-Datamine；
3. 为所有带 `WeaponSlots` 的飞机生成精简 JSON；
4. typecheck + Vite build；
5. 部署 `dist/` 到 GitHub Pages。

工作流支持手动触发，并每天自动重新构建一次 Datamine 数据。

**首次部署需先启用 GitHub Pages：**

1. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 在 **Actions → Build and deploy wt-pylon-solver → Run workflow** 手动运行一次，或推送到 `main`。
3. 确认 `build`、`deploy` 两个 Job 均成功，再访问上方站点地址。

**私有仓库注意事项：** GitHub Free 的 Pages 需要公开仓库；GitHub Pro、Team、Enterprise 支持私有仓库部署，但网站内容仍会公开。更改仓库可见性将公开源代码，请在 GitHub 设置中自行确认。若 Pages 未启用，工作流会在 `Configure Pages` 处明确失败，不会再将“仅构建成功”报告为“部署成功”。

## 静态数据结构

每架飞机一个 `data/<aircraft>.json`。武器数据只保存一次；挂点只保存 `option_id` 引用，避免旧 API 结构在每个挂点下重复整份武器对象。静态数据只包含 UI/求解器需要的字段。
