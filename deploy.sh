#!/bin/bash
# 电表管理系统部署脚本（PM2 方式）
#
# 安装目录与端口不再写死，可用环境变量覆盖：
#   ELEC_INSTALL_DIR=/vol2/1000/Docker/Elec_manger ELEC_PORT=16543 ./deploy.sh
# 容器化部署见 docker-compose.yml。

INSTALL_DIR="${ELEC_INSTALL_DIR:-/vol2/1000/Docker/Elec_manger}"
PORT="${ELEC_PORT:-16543}"

echo "=== 电表管理系统部署 ==="
echo "安装目录: ${INSTALL_DIR}"
echo "端口: ${PORT}"

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未安装Node.js"
    exit 1
fi

echo "Node.js版本: $(node -v)"

# 进入项目目录
if [ ! -d "$INSTALL_DIR" ]; then
    echo "错误: 安装目录不存在: $INSTALL_DIR"
    echo "用 ELEC_INSTALL_DIR 指定项目所在目录，例如 ELEC_INSTALL_DIR=/opt/elec ./deploy.sh"
    exit 1
fi
cd "$INSTALL_DIR" || exit 1

# 安装依赖
echo "安装依赖..."
npm install

# 安装PM2
echo "安装PM2..."
npm install -g pm2

# 构建
echo "构建项目..."
npm run build

# 创建PM2配置
cat > ecosystem.config.cjs << EOF
module.exports = {
  apps: [{
    name: 'elec-meter',
    script: '.next/standalone/server.js',
    env: {
      NODE_ENV: 'production',
      PORT: ${PORT}
    },
    max_memory_restart: '200M',
    autorestart: true,
    watch: false
  }]
};
EOF

# 停止旧进程
pm2 delete elec-meter 2>/dev/null || true

# 启动服务
pm2 start ecosystem.config.cjs

# 保存并设置开机自启
pm2 save
pm2 startup 2>/dev/null || true

echo ""
echo "=== 部署完成 ==="
echo ""
echo "常用命令:"
echo "  pm2 status        查看状态"
echo "  pm2 logs elec-meter  查看日志"
echo "  pm2 restart elec-meter  重启"
echo "  pm2 stop elec-meter    停止"
echo "  pm2 delete elec-meter  删除"
echo ""
echo "访问地址: http://$(hostname -I | awk '{print $1}'):$PORT"
echo "默认密码: admin"
