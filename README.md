# niko-archive

主站组合与部署仓库，通过 Git submodule 固定各产品版本：

```text
niko-archive/
  niko-main/                 网站收藏首页 → /
  niko-wenku/                轻小说书库 → /nikowenku-archive/
    tools/nico-cli/          书库打包依赖，固定 CLI 源码版本
  nico-cli/                  独立命令管理仓库
    packages/nikowenku-archive/  可单独安装的书库 CLI 包
  deploy/nginx.conf          80 端口入口配置
```

GitHub 上的四个仓库位于 https://github.com/LastEmbryo2950618641 下。`niko-wenku` 由原 `wenku-archive` 重命名，保留完整提交历史；两个位置引用的 `nico-cli` 是同一个 GitHub 仓库的固定版本。首页第一张卡片是轻小说文库。

## 克隆与更新

```sh
git clone --recurse-submodules https://github.com/LastEmbryo2950618641/niko-archive.git
cd niko-archive
git submodule update --init --recursive
```

更新组合版本：`git pull --ff-only` 后执行 `git submodule sync --recursive` 和 `git submodule update --init --recursive`。顶层仓库不自动追踪子仓库最新分支；子仓库开发并推送后，需要在顶层提交新的 gitlink。

## 构建与运行

需要 Node.js 22+：

```sh
npm run setup:wenku
npm run test:cli
npm run test:wenku
npm run build
npm --prefix niko-wenku start
```

首页为独立静态 HTML，不需要构建；组合构建以 `/nikowenku-archive/` 为 Vite base 生成书库。Node 服务继续只监听 `127.0.0.1:4178`。Nginx 使用 `deploy/nginx.conf` 提供 80 端口入口，将 `/srv/niko-archive` 改为实际部署目录，并确保服务用户可读 `niko-main/`。替换服务器配置前先执行 `nginx -t`。

首页对话另用 Node.js 22+ 的 `niko-home-chat.service`，只监听 `127.0.0.1:4181`。部署 `niko-main/` 的静态资源和 `server/` 后，执行 `sudo bash niko-main/deploy/install-chat.sh https://你的域名`，安装脚本只新增 `/chat-api/` 代理并保留现有书库、星海余页路由。API Key 与配置通过浏览器 Web Crypto 加密后保存在本地，AES 密钥以不可导出 CryptoKey 保存在当前浏览器的 IndexedDB；服务端仅按请求临时转发，不持久保存或记录用户 Key，详情见 `niko-main/README.md`。`npm run test:main` 使用模拟上游测试协议、流式响应和本地配置，不消耗模型额度。公网 IP 部署可运行 `sudo bash niko-main/deploy/enable-https.sh 公网IPv4` 申请 IP 证书、启用首页 HTTPS 与自动续期；HTTP 和 HTTPS 配置相互隔离，切换后需重新填写一次。

代理保留 `/api/` 供已经安装的 npm CLI 使用，并保留原 `/worldseed/` 路由。新的书库页面及其 API、封面、下载通过 `/nikowenku-archive/` 访问。首页的手动新增卡片和主题偏好仅保存在当前浏览器。

## 命令管理与独立书库命令

```sh
npm run pack:cli
```

`nico-cli/dist/` 中生成两个无第三方运行依赖的 npm 包，支持 Windows、Linux、macOS：

```sh
npm install -g --offline ./nico-cli-0.1.0.tgz
nico-cli list
nico-cli nikowenku-archive search "星"

# 或单独使用书库工具
npm install -g --offline ./nikowenku-archive-0.1.1.tgz
nikowenku-archive search "星"
```

网站构建从 `niko-wenku/tools/nico-cli` 打包同一份源码，将两个安装包放进书库的公开下载目录。主站源码、命令源码和运行数据分别管理。现有 npm 发布版本本次不变，新管理器尚未发布 npm。

## 运行数据与部署

原本地 `wenku-archive` 目录继续保留；本次没有复制 `library/`、`.state/`、`secrets/`、任务队列或未提交文件。部署时通过 `ARCHIVE_LIBRARY`、`ARCHIVE_STATE_DIR`、`ARCHIVE_QUEUE`、`ARCHIVE_AUTH_FILE` 指向既有运行数据目录，不要让两个服务同时操作同一任务队列。公开服务还需设置 `ARCHIVE_PUBLIC_ORIGIN` 为完整 origin，具体账号和数据配置见 `niko-wenku/docs/deployment.md`。

Nginx 直接提供首页和带子路径前缀构建的书库静态前端，`/nikowenku-archive/api/` 去掉前缀后转发到既有 Node 服务，原 `/api/` 保留兼容。这样发布网页无需重启正在扫描或下载的后台服务。`/assets/` 临时保留旧前端资源入口供已有标签页继续使用。生产部署位置为 `/srv/niko-archive`；书库后端与运行数据仍由原服务管理。

公开搜索、资料和下载可使用主备 API：主服务仍为本机 `4178`，独立的 `niko-wenku-read-api.service` 只读备用监听 `4179`，由 Nginx 在读取请求失败时切换，主恢复后重新优先使用主服务。备用无任务队列、扫描器、下载器或管理接口；书库挂为只读，仅维护自己的检索缓存，代码与网页、主后端分别发布。现有 CLI 地址和 npm 包无需更改。部署脚本、隔离故障测试、更新与回滚方式见 `niko-wenku/docs/deployment.md` 的“CLI 公开 API 主备冗余”；这属于同机进程冗余，不替代异机数据备份。
