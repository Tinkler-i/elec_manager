#!/bin/bash
# 电表管理系统管理脚本

cd /vol2/1000/Docker/Elec_manger

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
