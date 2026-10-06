# 飞牛 fnOS 应用包（fpk）

这个目录用来把 elec 打包成飞牛应用中心能装的 `.fpk`。

```
fnos/
├── build.sh                    本地构建脚本（按架构改写 manifest 后调 fnpack）
├── fnpack.exe                  Windows 版 fnpack（gitignore，build.sh 会按需下载）
└── App.Native.ElecMeter/       应用包本体
    ├── manifest                应用元数据
    ├── config/privilege        运行身份
    ├── config/resource         资源声明
    ├── app/ui/config           桌面入口
    ├── app/ui/images/          图标
    ├── cmd/                    生命周期脚本
    ├── wizard/uninstall        卸载向导
    ├── ICON.PNG / ICON_256.PNG
    └── app/server/             构建产物（gitignore，build.sh 生成）
```

## 打包

正式产物走 CI（`.github/workflows/build-fpk.yml`），打 tag 时同时出 amd64 和 arm64 两个包：

```bash
# 本地构建，架构默认跟本机
./fnos/build.sh

# 指定架构
./fnos/build.sh amd64
./fnos/build.sh arm64
```

`build.sh` 会把 manifest 的 `platform` 改成目标架构，打完包再还原，不会把构建结果写回版本库。

## 几个不能改错的地方

### platform 必须按架构写，不能是 all

官方对 `platform=all` 的定义是「包里没有任何架构相关二进制」。本包带了 better-sqlite3 的 `.node` 原生模块，不符合这个前提。写成 all 的后果是 ARM 设备能装上 amd64 的包，装完打不开。CI 的矩阵构建会按架构改写这个字段。

### Node 运行时要在 manifest 里声明

飞牛不把 Node 放在系统 PATH 里，运行时是独立的应用包：

```
install_dep_apps=nodejs_v22
```

`cmd/main` 启动前把 `/var/apps/nodejs_v22/target/bin` 加进 PATH。不声明这一条，装到干净的设备上会直接找不到 node。

### 以 package 用户运行，不用 root

`config/privilege` 用的是 `run-as: package`。这是个长期监听端口、对外提供页面和 API 的进程，官方文档对这类应用的默认建议就是专用用户；root 只留给确实要做特权准备的生命周期脚本。端口 16543 大于 1024，不需要 root 就能绑。

### 数据写在 TRIM_PKGVAR，不写安装目录

安装目录（`TRIM_APPDEST`）在升级时会被整体替换。数据库、备份、日志全部落在 `TRIM_PKGVAR`：

| 内容 | 路径 |
|---|---|
| 数据库 | `$TRIM_PKGVAR/elec.db` |
| 备份 | `$TRIM_PKGVAR/backups` |
| 运行日志 | `$TRIM_PKGVAR/info.log` |

应用侧的备份目录跟着数据库走（`src/lib/db.ts` 的 `BACKUP_DIR`）。不能按 `process.cwd()` 推算：Next standalone 的 `server.js` 一启动就 `chdir` 到自己的目录，备份会落进安装目录，升级时跟着一起消失。

### 卸载按用户的选择处理数据

`wizard/uninstall` 让用户选保留还是删除，`cmd/uninstall_callback` 读 `wizard_data_action` 执行。默认保留，用户明确选了 delete 才删 `TRIM_PKGVAR`。

### 桌面入口用 type=url，不是 iframe

`app/ui/config` 里是 `"type": "url"`。应用在 `src/proxy.ts` 里发了 `X-Frame-Options: DENY`，用 `iframe` 打开会被浏览器拒绝，只剩一个空白框。

### 没有安装向导

端口由 manifest 的 `service_port=16543` 固定声明，`cmd/main` 用 `$TRIM_SERVICE_PORT` 读。原来 `wizard/install` 里有个 `wizard_port` 字段，但脚本从来没读过它，填了不生效；而 `service_port` 是静态的，两者没法同时作为准。要做可配置端口得整套改成 `wizard/config` + `${wizard_port}`，这轮没动。

## 生命周期脚本的失败处理

`cmd/main` 在启动后 5 秒内确认进程是否真的活着（包括排掉「已退出但还没被回收」的僵尸进程）。端口被占、原生模块加载失败这类问题会立刻退出，不检查的话应用中心显示「运行中」，用户却打不开页面。

失败时会把一句能照做的话写进 `TRIM_TEMP_LOGFILE`，飞牛会把它显示在应用中心，例如：

```
未找到 Node.js 运行时（nodejs_v22）。请在应用中心确认依赖应用已安装。
```

## 更新提醒

设置页的「关于」里会检查有没有新版本，底栏「设置」图标上会点一个小圆点。

只检查、不下载也不安装 —— 装新版本仍然由应用中心完成。应用没有安装应用的权限，飞牛的开放 API 第一期也没有这类能力。

几个可调项：

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `ELEC_UPDATE_REPO` | 更新来源仓库 | `Tinkler-i/elec_manager` |
| `GITHUB_TOKEN` | 提高 GitHub 接口配额（60 → 5000 次/小时） | 不设，走匿名 |

检查走 `api.github.com/repos/{owner}/{repo}/releases/latest`。实测设备所在网络到 `github.com` 的 443 直连超时，而 `api.github.com` 正常，所以没有用「跟随 `releases/latest` 重定向」那种不依赖 API 的做法。结果在服务端缓存 30 分钟，点「检查更新」按钮时带 `?force=1` 绕过缓存；失败不缓存，下次会重试。

网络不通时界面显示「没能检查更新」和具体原因，不会显示成「已是最新」—— 那是两件事。

## 还没在真机上验证的

- `os_min_version=0.9.27`：沿用了原来的值。装了 `nodejs_v22` 依赖之后，这个下限是否需要抬高，得在设备上试。
- `run-as: package` 下 `cmd/main` 的执行身份：按文档，生命周期脚本应跟随 `run-as` 以专用用户执行。启动日志里会打一行 `run-as=$(id -un)`，装完看一眼 `info.log` 就能确认。
- `allUsers: false`：桌面图标目前只对管理员可见。应用自带登录密码，要放开给所有飞牛用户就把这个值改成 `true`。
