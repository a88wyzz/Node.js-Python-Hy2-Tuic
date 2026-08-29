#!/usr/bin/env node
/**
 * =========================================
 * Hy2 自动部署脚本（Node.js 版）
 * 定时重启：每天北京时间 00:00（24:00）
 * =========================================
 */
import { execSync, spawn } from "child_process";
import fs from "fs";
import https from "https";
import crypto from "crypto";

// ================== 【固定密码】==================
const PASSWORD = "VNqW5LeUJAG2XTmG";  // 固定密码

// ================== 内置定时器（北京时间 00:00 重启）==================
function scheduleBeijingTimeMidnight(callback) {
  const now = new Date();
  const beijingNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  
  let target = new Date(beijingNow);
  target.setHours(0, 0, 0, 0);

  if (beijingNow.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  const delay = target.getTime() - beijingNow.getTime();
  console.log(`[Timer] 下次重启：${target.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (北京时间 00:00)`);

  setTimeout(() => {
    console.log(`[Timer] 北京时间 00:00 重启触发于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    callback();
    scheduleBeijingTimeMidnight(callback);
  }, delay);
}

// ================== 基本配置 ==================
const MASQ_DOMAINS = ["www.bing.com"];
const SERVER_YAML = "server.yaml";
const CERT_PEM = "hy2-cert.pem";
const KEY_PEM = "hy2-key.pem";
const LINK_TXT = "hy2_link.txt";
const hy2_BIN = "./hy2-server";

// ================== 工具函数 ==================
const randomPort = () => Math.floor(Math.random() * 40000) + 20000;
const randomSNI = () => MASQ_DOMAINS[Math.floor(Math.random() * MASQ_DOMAINS.length)];
const randomHex = (len = 16) => crypto.randomBytes(len).toString("hex");
function fileExists(p) { return fs.existsSync(p); }
function execSafe(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim(); }
  catch { return ""; }
}

// ================== 准确获取公网 IP ==================
async function getPublicIP() {
  const sources = [
    "https://api.ipify.org",
    "https://ifconfig.me",
    "https://icanhazip.com",
    "https://ipinfo.io/ip"
  ];
  for (const url of sources) {
    try {
      const ip = await new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 3000 }, (res) => {
          let data = "";
          res.on("data", chunk => data += chunk);
          res.on("end", () => resolve(data.trim()));
        });
        req.on("error", reject);
        req.setTimeout(3000, () => req.destroy());
      });
      if (ip && !/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|169\.254\.)/.test(ip)) {
        console.log(`公网 IP: ${ip}`);
        return ip;
      }
    } catch (e) {}
  }
  console.log("警告：无法获取公网 IP，使用 127.0.0.1");
  return "127.0.0.1";
}

// ================== 下载文件 ==================
async function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("重定向次数过多"));
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const newUrl = res.headers.location;
        console.log(`Redirecting to: ${newUrl}`);
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return resolve(downloadFile(newUrl, dest, redirectCount + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`下载失败: ${res.statusCode}`));
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

// ================== 读取端口（仅随机或环境变量）=================
function readPort() {
  if (process.env.SERVER_PORT && !isNaN(process.env.SERVER_PORT)) {
    console.log(`Using env port: ${process.env.SERVER_PORT}`);
    return Number(process.env.SERVER_PORT);
  }
  const port = randomPort();
  console.log(`Random port: ${port}`);
  return port;
}

// ================== 生成证书 ==================
function generateCert(domain) {
  if (fileExists(CERT_PEM) && fileExists(KEY_PEM)) {
    console.log("Certificate exists");
    return;
  }
  console.log(`Generating cert for ${domain}...`);
  execSafe(
    `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 ` +
    `-keyout ${KEY_PEM} -out ${CERT_PEM} -subj "/CN=${domain}" -days 365 -nodes`
  );
  fs.chmodSync(KEY_PEM, 0o600);
  fs.chmodSync(CERT_PEM, 0o644);
}

// ================== 下载 hy2-server ==================
async function checkhy2Server() {
  if (fileExists(hy2_BIN)) {
    console.log("hy2-server exists");
    return;
  }
  console.log("Downloading hy2-server ...");
  const url = "https://download.hysteria.network/app/latest/hysteria-linux-amd64";
  await downloadFile(url, hy2_BIN);
  fs.chmodSync(hy2_BIN, 0o755);
  console.log("hy2-server downloaded");
}

// ================== 生成配置 ==================
function generateConfig(password, port, domain) {
  const yaml = `
listen: :${port}
resolver:
  type: tls
  tls:
    addr: 1.1.1.1:853
    timeout: 5s
tls:
  cert: ${CERT_PEM}
  key: ${KEY_PEM}
  sniGuard: disable
  alpn:
    - h3
auth:
  type: password
  password: ${password}
masquerade:
  type: proxy
  proxy:
    url: https://www.bing.com
    rewriteHost: true
`;
  fs.writeFileSync(SERVER_YAML, yaml.trim() + "\n");
  console.log("Config generated:", SERVER_YAML);
}

// ================== 生成链接 ==================
function generateLink(password, ip, port, domain) {
  const link = `hy2://${password}@${ip}:${port}?alpn=h3&insecure=1&sni=${domain}#hy2-${ip}`;
  fs.writeFileSync(LINK_TXT, link);
  console.log("📱 节点链接，跳过证书验证：");
  console.log(link);
}

// ================== 守护运行 ==================
function runLoop() {
  console.log("🚀    Hysteria2 服务正在运行... (日志已静默)");
  const loop = () => {
    const proc = spawn(hy2_BIN, ["server", "-c", SERVER_YAML], { stdio: "ignore" });
    proc.on("exit", (code) => {
      console.log(`hy2 exited (${code}), restarting in 5s...`);
      setTimeout(loop, 5000);
    });
  };
  loop();
}

// ================== 主流程 ==================
async function main() {
  console.log("hy2 自动部署开始");

  // 1. 启动定时重启
  scheduleBeijingTimeMidnight(() => {
    process.exit(0);
  });

  // 2. 部署逻辑
  const port = readPort();
  const domain = randomSNI();

  generateCert(domain);
  await checkhy2Server();
  generateConfig(PASSWORD, port, domain);
  const ip = await getPublicIP();
  generateLink(PASSWORD, ip, port, domain);
  runLoop();
}

main().catch((err) => console.error("Error:", err));
