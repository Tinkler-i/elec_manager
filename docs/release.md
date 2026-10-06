# 发布

## 版本号

两处必须同步改，少一处会导致飞牛面板显示旧版本：

- `package.json` 的 `version`
- `fnos/App.Native.ElecMeter/manifest` 的 `version`

**平时不动版本号。** 只有确定要发版时才改，且改完立刻打 tag。

## 发布流程

### 1. 确认要发

发布由仓库所有者决定。没有明确指示不要自行打 tag。

### 2. 改版本号并提交

```bash
npm version <新版本> --no-git-tag-version
```

这会改 `package.json` 和 `package-lock.json`。然后手动改 `fnos/App.Native.ElecMeter/manifest` 里的 `version`。

同步更新 [CHANGELOG.md](CHANGELOG.md)。

提交：

```
release: v<新版本>
```

推到 `master`。

### 3. 打 tag

```bash
git tag v<新版本>
git push Github v<新版本>
```

tag 必须打在 `master` 上。tag 推送会触发 CI。

### 4. 等 CI

`.github/workflows/build-fpk.yml` 会并行构建两个架构，然后创建 Release 并上传产物。

构建矩阵有三处是修过 bug 的，改 workflow 前先读 [fnos/README.md](fnos/README.md)：

- **`node-version` 必须是 22**。workflow 里有两道断言拦这个：装完依赖后断言 `process.versions.modules === '127'`，打包后再从 fpk 里解出 `better-sqlite3` 实际 require 一次。
- **arm64 的 fnpack 资源名是 `linux-arm`，不是 `linux-arm64`**。官方文档写错了，后者返回 404。
- **矩阵保留 `fail-fast: false`**。否则一个架构失败会把另一个已跑完的 job 也取消，连健康的产物都拿不到。

### 5. 验证产物

两个架构都成功才算发出版。下载产物核对：

```bash
# 版本号
unzip -p elec-meter-v<版本>-amd64.fpk app/manifest | grep version

# 产物哈希
sha256sum elec-meter-v<版本>-amd64.fpk
```

Release 页面上的 `releases/latest` 是应用内更新检查读取的地址，发完可以打开应用的「设置 → 关于」确认能检测到新版本。

### 6. 通知

如果这次修复了用户可见的问题，在 Release 说明里写清楚现象和触发条件。

## 回滚

发版出问题时：

1. **不要删 tag**。删了以后重新发同名 tag 会让已经升级的设备困惑。
2. 直接发下一个补丁版本修掉。
3. 如果 Release 的产物有问题（比如打错了架构），删掉那个 asset 重新上传，不用改 tag。

真要撤掉整个 Release，先确认没有设备依赖它。

## 飞牛端的安装与升级

- 安装目录 `TRIM_APPDEST` 在升级时**整体替换**，持久化目录 `TRIM_PKGVAR` **保留**。
- 数据、备份、日志必须落在 `TRIM_PKGVAR` 下，否则升级会丢。
- `config/privilege` 里 `run-as: package`，用户名和组名都是 `elecmeter`。
- 应用依赖 `nodejs_v22`，在 manifest 的 `install_dep_apps` 里声明。

## Docker

`Dockerfile` 是独立于飞牛的另一种部署形态，用 Next 的 standalone 输出。打 tag 时 CI 也会构建镜像并推送到 GHCR。
