# niko-archive

主站与轻小说书库的组合仓库。两个产品分别保存在独立 Git 仓库中：

```text
niko-archive/          主仓库：组合、部署配置
  niko-main/           子仓库：网站收藏首页，提供 /
  niko-wenku/          子仓库：轻小说书库，提供 /nikowenku-archive/
```

首页是 `niko-main/index.html`，书库卡片排在第一位。书库仍由原来的 Node 服务提供 API 和书籍文件，外部入口由 Nginx 路径转发。

## 本地准备

初始化子仓库远端后，将 `.gitmodules` 中的相对地址解析到同一 GitHub 组织下的 `niko-main` 和 `niko-wenku` 仓库：

```sh
git submodule update --init --recursive
```

当前目录已为本机建好两个独立 Git 仓库。新机器在远端创建并推送这两个子仓库后，再把顶层仓库中的 gitlink 推上去即可克隆。

## 构建与运行

Node.js 22 或更新版本：

```sh
npm run setup:wenku
npm run build
npm --prefix niko-wenku start
```

组合仓库的 `npm run build` 会以 `/nikowenku-archive/` 为 Vite base 构建书库。书库 Node 服务继续只监听 `127.0.0.1:4178`；生产入口使用 Nginx 的 80 端口配置 `deploy/nginx.conf`。将配置中的 `/srv/niko-archive` 改成实际部署目录，并让 Nginx 服务用户可读 `niko-main/`。

本地浏览首页可直接打开 `niko-main/index.html`。验证完整的 `/nikowenku-archive/` 子路径需使用相同的 Nginx 路径代理；单独运行书库时仍可通过其本地根路径访问。

## GitHub 仓库

创建同一账号/组织下的三个仓库，建议都使用 `main` 分支：

- `niko-archive`：当前顶层仓库
- `niko-main`：`niko-main/` 子仓库
- `niko-wenku`：`niko-wenku/` 子仓库，沿用书库原有提交历史

顶层仓库与首页仓库建立本地初始提交，书库保留原提交历史；顶层通过 Git submodule 固定两个子仓库的提交。尚未创建或推送新远端。书库原 GitHub 地址仅记录为 `legacy` remote，避免误推回旧仓库。远端创建后，为各仓库设置新的 `origin`；先推送两个子仓库，再推送顶层仓库。

## 原有运行数据

`niko-wenku` 来自原书库的已提交源码，本次不复制 `library/`、`.state/`、`secrets/`、任务队列或其他未提交文件。原 `wenku-archive` 目录和运行服务继续保留。部署时用原有 `ARCHIVE_LIBRARY`、`ARCHIVE_STATE_DIR`、`ARCHIVE_QUEUE`、`ARCHIVE_AUTH_FILE` 指向既有数据目录，避免将数据放进源码仓库；不要同时启动两个服务操作同一任务队列。

模板保留 `/api/` 入口以兼容现有 npm CLI，并保留原 `/worldseed/` 代理。80 端口配置已准备，本次尚未应用到远端。
