#!/bin/bash
# 电表管理系统管理脚本（PM2 方式）
#
# 安装目录可用 ELEC_INSTALL_DIR 覆盖（默认沿用 NAS 上的旧路径）：
#   ELEC_INSTALL_DIR=/path/to/elec ./manage.sh status

INSTALL_DIR="${ELEC_INSTALL_DIR:-/vol2/1000/Docker/Elec_manger}"

if [ ! -d "$INSTALL_DIR" ]; then
    echo "错误: 安装目录不存在: $INSTALL_DIR"
    echo "用 ELEC_INSTALL_DIR 指定项目所在目录，例如 ELEC_INSTALL_DIR=/opt/elec ./manage.sh status"
    exit 1
fi
cd "$INSTALL_DIR" || exit 1

case "$1" in
    start)
        pm2 start ecosystem.config.cjs
        echo "服务已启动"
        ;;
    stop)
        pm2 stop elec-meter
        echo "服务已停止"
        ;;
    restart)
        pm2 restart elec-meter
        echo "服务已重启"
        ;;
    status)
        pm2 status elec-meter
        ;;
    logs)
        pm2 logs elec-meter --lines 50
        ;;
    update)
        git pull
        npm run build
        pm2 restart elec-meter
        echo "已更新并重启"
        ;;
    *)
        echo "用法: ./manage.sh {start|stop|restart|status|logs|update}"
        ;;
esac
