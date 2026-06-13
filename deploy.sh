#!/bin/bash
# 电表管理系统部署脚本

INSTALL_DIR="/vol2/1000/Docker/Elec_manger"
PORT=16543

echo "=== 电表管理系统部署 ==="

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未安装Node.js"
    echo "请先安装: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs"
    exit 1
fi

echo "Node.js版本: $(node -v)"

# 进入项目目录
cd "$INSTALL_DIR"

# 安装依赖
echo "安装依赖..."
npm install --production

# 构建
echo "构建项目..."
npm run build

# 创建启动脚本
cat > start.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
export NODE_ENV=production
export PORT=16543
node .next/standalone/server.js
EOF
chmod +x start.sh

echo ""
echo "=== 部署完成 ==="
echo "启动命令: ./start.sh"
echo "访问地址: http://$(hostname -I | awk '{print $1}'):$PORT"
echo "默认密码: admin"
