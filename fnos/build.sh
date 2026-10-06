#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="${APP_DIR}/App.Native.ElecMeter"
SERVER_DIR="${PACKAGE_DIR}/app/server"
MANIFEST="${PACKAGE_DIR}/manifest"

# 目标架构：默认跟本机一致，可用第一个参数覆盖（amd64 / arm64）
TARGET_ARCH="${1:-}"
if [ -z "${TARGET_ARCH}" ]; then
    case "$(uname -m)" in
        x86_64|amd64)  TARGET_ARCH=amd64 ;;
        aarch64|arm64) TARGET_ARCH=arm64 ;;
        *) echo "无法识别本机架构 $(uname -m)，请显式传入 amd64 或 arm64"; exit 1 ;;
    esac
fi

case "${TARGET_ARCH}" in
    amd64) FNOS_PLATFORM=x86; FNPACK_ARCH=linux-amd64 ;;
    # 官方文档写的是 linux-arm64，但 1.2.3 实际发布的资源名是 linux-arm
    # （linux-arm64 返回 404；下载后核过 ELF e_machine=0xB7，是 AArch64）
    arm64) FNOS_PLATFORM=arm; FNPACK_ARCH=linux-arm ;;
    *) echo "不支持的架构：${TARGET_ARCH}（可用：amd64 / arm64）"; exit 1 ;;
esac

echo "=== 飞牛 fnOS 应用构建 ==="
echo "目标架构: ${TARGET_ARCH}  →  manifest platform=${FNOS_PLATFORM}"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未安装 Node.js"
    exit 1
fi
echo "Node.js 版本: $(node -v)"

# 安装依赖
# 用 npm ci 而不是 npm install：ci 会校验 package-lock.json 与 package.json 是否一致，
# 且不会顺手改锁文件。锁文件要用 npm 10 维护 —— npm 11 跑 install 会把
# @emnapi/core、@emnapi/runtime 两条删掉，之后 npm ci 就会 EUSAGE 失败。
echo "安装项目依赖..."
cd "${APP_DIR}/.."
npm ci

# 先清掉上一次的打包产物，再构建。
# 顺序不能反：Turbopack 的 trace 会把「按模式匹配到的东西」收进 .next/standalone，
# app/server 正好是上一次打包的产物。放在构建之后清，第二轮就会把第一轮的 app/server
# 整个嵌进新包，包一轮比一轮大。
echo "清理上一次的打包产物..."
rm -rf "${SERVER_DIR}"

# 构建 Next.js 项目
echo "构建 Next.js 项目..."
npm run build

# 创建 server 目录
echo "准备应用文件..."
mkdir -p "${SERVER_DIR}"

# 复制 standalone 构建产物（包括隐藏目录如 .next）
cp -r .next/standalone/. "${SERVER_DIR}/"

# 复制 static 资源
mkdir -p "${SERVER_DIR}/.next/static"
cp -r .next/static/. "${SERVER_DIR}/.next/static/"

# 复制 public 资源
cp -r public "${SERVER_DIR}/public"

# 数据目录只作为占位。运行时数据库与备份都在 TRIM_PKGVAR（见 cmd/main），
# 不会写到这里 —— 安装目录在升级时会被整体替换。
#
# 先删再从零建，两点写清楚免得后来人不敢动：
#   - 为什么安全：运行期数据从不落在 ${SERVER_DIR} 下（cmd/main 里 export 的
#     ELEC_DB_PATH / ELEC_BACKUP_DIR 都指向 TRIM_PKGVAR）。这里删的是构建产物里的
#     占位目录，而且此刻服务还没启动过，里面不可能有真实数据。
#   - 为什么要删：Next 16 + Turbopack 会把开发机上的 data/ 也 trace 进 .next/standalone
#     （字面路径那条 outputFileTracingExcludes 够不着，见 next.config.ts 的说明和 task-27），
#     本地开发库不能进包。
rm -rf "${SERVER_DIR}/data"
mkdir -p "${SERVER_DIR}/data"

# 清理不必要的文件（减小包体积）
echo "清理不必要的文件..."
echo "=== 清理前体积 ==="
du -sh "${SERVER_DIR}"

# 1. better-sqlite3: 只删除 C/C++ 源码和构建文件，保留运行时必要文件
for bs3dir in $(find "${SERVER_DIR}" -type d -name "better-sqlite3*" 2>/dev/null); do
    rm -rf "${bs3dir}/deps" 2>/dev/null || true
    rm -rf "${bs3dir}/src" 2>/dev/null || true
    rm -rf "${bs3dir}/build/Release/obj" 2>/dev/null || true
    rm -f "${bs3dir}/binding.gyp" 2>/dev/null || true
done

# 2. 替换 Next.js Turbopack 编译产物中的 serverExternalPackages 哈希模块名
# Turbopack 将 serverExternalPackages 中的模块命名为 <pkg>-<hash>
# 运行时 require('<pkg>-<hash>') 无法解析，需替换为标准名
# 直接从编译产物中 grep 出哈希名，不依赖 .next/node_modules 存在
BS3_HASH_NAME=$(grep -roh 'better-sqlite3-[a-f0-9]\{16,\}' "${SERVER_DIR}/.next/server/" 2>/dev/null | sort -u | head -1)
if [ -n "${BS3_HASH_NAME}" ]; then
    echo "  发现哈希模块名: ${BS3_HASH_NAME}"
    echo "  替换编译产物中的模块名 ${BS3_HASH_NAME} → better-sqlite3"
    find "${SERVER_DIR}/.next/server" -type f \( -name '*.js' -o -name '*.json' \) -exec sed -i "s/${BS3_HASH_NAME}/better-sqlite3/g" {} + 2>/dev/null || true
fi
# 同样处理 @modelcontextprotocol/sdk
MCP_HASH_NAME=$(grep -roh '@modelcontextprotocol/sdk-[a-f0-9]\{16,\}' "${SERVER_DIR}/.next/server/" 2>/dev/null | sort -u | head -1)
if [ -n "${MCP_HASH_NAME}" ]; then
    echo "  发现哈希模块名: ${MCP_HASH_NAME}"
    echo "  替换编译产物中的模块名 ${MCP_HASH_NAME} → @modelcontextprotocol/sdk"
    find "${SERVER_DIR}/.next/server" -type f \( -name '*.js' -o -name '*.json' \) -exec sed -i "s|${MCP_HASH_NAME}|@modelcontextprotocol/sdk|g" {} + 2>/dev/null || true
fi
# 删除 .next/node_modules（规避 fnpack copy_file_range bug）
rm -rf "${SERVER_DIR}/.next/node_modules" 2>/dev/null || true
# 确保 node_modules/better-sqlite3 存在且完整（含 .node 原生二进制）
if [ -d "node_modules/better-sqlite3" ]; then
    echo "  从项目 node_modules 复制完整 better-sqlite3（含原生二进制）"
    rm -rf "${SERVER_DIR}/node_modules/better-sqlite3" 2>/dev/null || true
    cp -r node_modules/better-sqlite3 "${SERVER_DIR}/node_modules/better-sqlite3"
fi

# 复制 @modelcontextprotocol/sdk（serverExternalPackages）。
# standalone 里也有一份，但是 Next 按依赖图裁剪过的子集（实测 83 个文件，
# 项目 node_modules 里是 1155 个）。这里覆盖成完整的项目副本。
if [ -d "node_modules/@modelcontextprotocol" ]; then
    echo "  复制 @modelcontextprotocol/sdk"
    mkdir -p "${SERVER_DIR}/node_modules/@modelcontextprotocol"
    rm -rf "${SERVER_DIR}/node_modules/@modelcontextprotocol/sdk" 2>/dev/null || true
    cp -r node_modules/@modelcontextprotocol/sdk "${SERVER_DIR}/node_modules/@modelcontextprotocol/sdk"
fi

# 3. 只保留目标架构的 sharp 原生库
if [ "${TARGET_ARCH}" = "amd64" ]; then
    SHARP_KEEP="linux-x64"
else
    SHARP_KEEP="linux-arm64"
fi
for sharp_dir in "${SERVER_DIR}/node_modules/@img"/sharp-* "${SERVER_DIR}/node_modules/@img"/sharp-libvips-*; do
    [ -d "${sharp_dir}" ] || continue
    case "$(basename "${sharp_dir}")" in
        *"${SHARP_KEEP}"*) continue ;;
        *) rm -rf "${sharp_dir}" ;;
    esac
done

# 4. 删除 Next.js 运行时不需要的大文件
rm -f "${SERVER_DIR}/node_modules/next/dist/server/capsize-font-metrics.json" 2>/dev/null || true

# 5. 删除所有包中的文档、测试、构建配置、源码映射
find "${SERVER_DIR}" -type f \( \
    -iname "README*" -o -iname "CHANGELOG*" -o -iname "HISTORY*" \
    -o -iname "LICENSE*" -o -iname "LICENCE*" -o -iname "NOTICE*" \
    -o -iname "*.md" -o -iname "*.gyp" -o -iname "*.gypi" \
    -o -iname ".npmignore" -o -iname ".eslintrc*" -o -iname ".prettierrc*" \
    -o -iname "Makefile" -o -iname "*.ts" -o -iname "*.map" \
    -o -iname "*.c" -o -iname "*.cc" -o -iname "*.cpp" -o -iname "*.h" -o -iname "*.hpp" \
    -o -iname "test.js" -o -iname "test-*.js" -o -iname "*.test.js" \
    -o -iname "*.spec.js" -o -iname "binding.gyp" \
\) -delete 2>/dev/null || true

# 6. 删除空目录
find "${SERVER_DIR}" -type d -empty -delete 2>/dev/null || true

echo "=== 清理后体积 ==="
du -sh "${SERVER_DIR}"
echo "--- 各子目录体积 ---"
du -sh "${SERVER_DIR}"/*/ "${SERVER_DIR}"/.* 2>/dev/null | sort -rh | head -20
echo "--- 前 15 大文件 ---"
find "${SERVER_DIR}" -type f -exec du -h {} + 2>/dev/null | sort -rh | head -15

# ── 打包 ──────────────────────────────────────────────────────────────
# manifest 的 platform 必须与包内原生二进制一致（包里有 better-sqlite3 的 .node，
# 不能声明 all）。仓库里那份是 x86 默认值，这里按目标架构改写，打完再还原 ——
# 否则一次构建就会把 manifest 的改动写进版本库。
MANIFEST_BAK="${MANIFEST}.build-bak"
cp "${MANIFEST}" "${MANIFEST_BAK}"
restore_manifest() {
    [ -f "${MANIFEST_BAK}" ] && mv -f "${MANIFEST_BAK}" "${MANIFEST}"
}
trap restore_manifest EXIT

sed "s/^platform=.*/platform=${FNOS_PLATFORM}/" "${MANIFEST}" > "${MANIFEST}.new"
mv "${MANIFEST}.new" "${MANIFEST}"
echo "已写入 manifest: $(grep '^platform=' "${MANIFEST}")"

# 下载 fnpack 工具（如未安装）
FNPACK_VERSION="1.2.3"
if ! command -v fnpack &> /dev/null; then
    echo "下载 fnpack ${FNPACK_VERSION} (${FNPACK_ARCH})..."
    FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VERSION}-${FNPACK_ARCH}"
    curl -fL -o "${APP_DIR}/fnpack" "${FNPACK_URL}"
    chmod +x "${APP_DIR}/fnpack"
    FNPACK_CMD="${APP_DIR}/fnpack"
else
    FNPACK_CMD="fnpack"
fi

# 打包 fpk
echo "打包 fpk 文件..."
cd "${PACKAGE_DIR}"
${FNPACK_CMD} build

echo ""
echo "=== 构建完成 ==="
echo "fpk 文件位置: ${PACKAGE_DIR}/App.Native.ElecMeter.fpk"
echo ""
echo "安装方式:"
echo "  1. 将 .fpk 文件上传到飞牛 fnOS 设备"
echo "  2. 在应用中心手动安装"
