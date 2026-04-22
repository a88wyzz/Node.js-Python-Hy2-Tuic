# 1.Hysteria2在Nodejs/Python一键脚本极简部署（Pterodactyl 翼龙面板）

* 更新自适应端口，无需再手动设置

* Hysteria2

```bash
curl -Ls https://raw.githubusercontent.com/a88wyzz/Node.js-Python-Hy2-Tuic/main/hy2.sh | sed 's/\r$//' | bash
```

# 2.TUIC在Nodejs/Python一键脚本极简部署（Pterodactyl 翼龙面板）

* 自适应端口，无需再手动设置

* TUIC

```bash
curl -Ls https://raw.githubusercontent.com/a88wyzz/Node.js-Python-Hy2-Tuic/main/tuic.sh | sed 's/\r$//' | bash
```


# 3.TUIC在Nodejs/Python文件复制部署（适用无法执行bash命令的场景）上传文件在tuic-copy文件夹内

* 自适应端口，无需手动编辑文件
* 新增每天北京时间0点自动重启，规避停机问题（无需重新部署，节点有效）
* 1.将index.js和package.json文件下载后，拖入翼龙面板的File
  2.启动命令通常需要改为：node index.js
  3.开机、完成部署、复制节点链接
* 由于原版定时重启后密码会变动，现更改为固定密码，自己编辑index.js修改uuid和密码。
