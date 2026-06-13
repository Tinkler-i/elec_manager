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

# 复制 standalone 构建产物
cp -r .next/standalone/* "${SERVER_DIR}/"

# 复制 static 资源
mkdir -p "${SERVER_DIR}/.next/static"
cp -r .next/static/* "${SERVER_DIR}/.next/static/"

# 复制 public 资源
cp -r public "${SERVER_DIR}/public"

# 创建数据目录
mkdir -p "${SERVER_DIR}/data"

# 清理不必要的文件（减小包体积）
echo "清理不必要的文件..."

# 删除 better-sqlite3 的 C/C++ 源码（运行时只需 .node 二进制）
find "${SERVER_DIR}" -path "*/better-sqlite3*/deps" -type d -exec rm -rf {} + 2>/dev/null || true
find "${SERVER_DIR}" -path "*/better-sqlite3*/src" -type d -exec rm -rf {} + 2>/dev/null || true
find "${SERVER_DIR}" -path "*/better-sqlite3*/build" -type d ! -path "*/Release/*" -exec rm -rf {} + 2>/dev/null || true

# 删除所有包中的文档、测试、配置文件
find "${SERVER_DIR}" -type f \( \
    -iname "README*" -o -iname "CHANGELOG*" -o -iname "HISTORY*" \
    -o -iname "LICENSE*" -o -iname "LICENCE*" \
    -o -iname "*.md" -o -iname "*.gyp" -o -iname "*.gypi" \
    -o -iname ".npmignore" -o -iname ".eslintrc*" \
    -o -iname "Makefile" -o -iname "*.ts" -o -iname "*.map" \
    -o -iname "test.js" -o -iname "test-*.js" \
\) -delete 2>/dev/null || true

# 删除 sharp 中非当前平台的原生库
find "${SERVER_DIR}" -path "*/@img/sharp-win32*" -type d -exec rm -rf {} + 2>/dev/null || true
find "${SERVER_DIR}" -path "*/@img/sharp-darwin*" -type d -exec rm -rf {} + 2>/dev/null || true

# 删除空目录
find "${SERVER_DIR}" -type d -empty -delete 2>/dev/null || true

echo "=== 包体积分析 ==="
du -sh "${SERVER_DIR}"
echo "--- 前 10 大文件 ---"
find "${SERVER_DIR}" -type f -exec du -h {} + 2>/dev/null | sort -rh | head -10

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
