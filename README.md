# wt-pylon-solver

正式部署平台：Cloudflare Pages（`https://<Cloudflare 项目名>.pages.dev/`；实际域名以 Cloudflare 项目为准）。

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

`frontend/public/data/*.json` 是生成物，不提交到 Git。构建还会生成 `data/aircraft-index.json`：只包含成功生成的飞机 ID，以及从 Datamine `lang/units.csv` 读取的中英文名称。

飞机选择支持中文、英文和 Datamine ID 搜索，可按十大科技树系别筛选；系别读取 Datamine 的 `wpcost.blkx` 中 `country` 字段，原始名称中的国籍装饰字符和零宽空格在构建阶段清理。可以直接输入完整 ID 作为回退。最近 8 次成功加载的飞机 ID 保存在站点的第一方 Cookie（`wt_recent_aircraft`，有效期 180 天），不记录挂载配置或搜索历史，清除浏览器 Cookie 后即清空。

## 本地完整构建

如果已经有 War-Thunder-Datamine 的本地 checkout：

```bash
python build_static_data.py --all --clean --datamine-root /path/to/War-Thunder-Datamine
cd frontend
npm install
npm run typecheck
node --experimental-strip-types --test tests/*.test.mjs
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

构建脚本从 War Thunder Datamine 拉取必要数据与 `gameuiskin` 图标，仅复制实际引用的 PNG，然后生成所有飞机 JSON，运行 Vue/TypeScript 类型检查、求解器回归测试并构建静态站点。Cloudflare Git 集成连接 `main` 后，推送会自动构建和部署。

**每日更新 Datamine（可选）：** Cloudflare Pages 项目中进入 **Settings → Builds → Add deploy hook**，选择 `main` 并复制部署钩子 URL。在 GitHub 仓库 **Settings → Secrets and variables → Actions** 新增 Repository secret：`CF_PAGES_DEPLOY_HOOK`，值填入完整 URL。现有 `.github/workflows/cloudflare-refresh.yml` 每天会触发一次 Cloudflare 构建；未配置该 Secret 时自动跳过。请勿将该 URL 提交到 Git。

Cloudflare 连接及首次项目创建须由 Cloudflare 账户所有者完成。本仓库不再维护 GitHub Pages 部署工作流；如果 GitHub Pages 以前已开启，需在仓库设置中手动停用，以免保留历史站点。

## 静态数据结构

每架飞机一个 `data/<aircraft>.json`。武器数据只保存一次；挂点只保存 `option_id` 引用，避免旧 API 结构在每个挂点下重复整份武器对象。静态数据只包含 UI/求解器需要的字段。
