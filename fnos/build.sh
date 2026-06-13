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

# 构建 Next.js 项目
echo "构建 Next.js 项目..."
cd "${APP_DIR}/.."
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
