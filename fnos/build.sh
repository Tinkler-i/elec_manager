#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="${APP_DIR}/App.Native.ElecMeter"
SERVER_DIR="${PACKAGE_DIR}/app/server"

echo "=== 飞牛 fnOS 应用构建 ==="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未安装 Node.js"
    exit 1
fi
echo "Node.js 版本: $(node -v)"

# 安装依赖
echo "安装项目依赖..."
cd "${APP_DIR}/.."
npm install

# 构建 Next.js 项目
echo "构建 Next.js 项目..."
npm run build

# 清理并创建 server 目录
echo "准备应用文件..."
rm -rf "${SERVER_DIR}"
mkdir -p "${SERVER_DIR}"

# 复制 standalone 构建产物（包括隐藏目录如 .next）
cp -r .next/standalone/. "${SERVER_DIR}/"

# 复制 static 资源
mkdir -p "${SERVER_DIR}/.next/static"
cp -r .next/static/. "${SERVER_DIR}/.next/static/"

# 复制 public 资源
cp -r public "${SERVER_DIR}/public"

# 创建数据目录
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

# 复制 @modelcontextprotocol/sdk（serverExternalPackages，standalone 不包含）
if [ -d "node_modules/@modelcontextprotocol" ]; then
    echo "  复制 @modelcontextprotocol/sdk"
    mkdir -p "${SERVER_DIR}/node_modules/@modelcontextprotocol"
    rm -rf "${SERVER_DIR}/node_modules/@modelcontextprotocol/sdk" 2>/dev/null || true
    cp -r node_modules/@modelcontextprotocol/sdk "${SERVER_DIR}/node_modules/@modelcontextprotocol/sdk"
fi

# 3. 删除非当前平台的 sharp 原生库
find "${SERVER_DIR}" -type d -name "sharp-win32*" -exec rm -rf {} + 2>/dev/null || true
find "${SERVER_DIR}" -type d -name "sharp-darwin*" -exec rm -rf {} + 2>/dev/null || true
find "${SERVER_DIR}" -type d -name "sharp-libvips-linuxmusl*" -exec rm -rf {} + 2>/dev/null || true
find "${SERVER_DIR}" -type d -name "sharp-linuxmusl*" -exec rm -rf {} + 2>/dev/null || true

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

# 下载 fnpack 工具（如未安装）
if ! command -v fnpack &> /dev/null; then
    echo "下载 fnpack 工具..."
    FNPACK_VERSION="1.2.1"
    FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VERSION}-windows-amd64"
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VERSION}-linux-amd64"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VERSION}-darwin-amd64"
    fi
    curl -o "${APP_DIR}/fnpack" "${FNPACK_URL}"
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
