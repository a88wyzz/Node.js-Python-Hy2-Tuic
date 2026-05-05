#!/usr/bin/env node
/**
 * =========================================
 * Hysteria 2 (hy2) 自动部署脚本（Node.js 版）
 * 定时重启：每天北京时间 00:00（24:00）
 * =========================================
 */
import { execSync, spawn } from "child_process";
import fs from "fs";
import https from "https";
import crypto from "crypto";

// ================== 【手动设置 UUID 和 固定密码】==================
const UUID = "87a3c01d-fdf4-7d55-5827-57e0b30f5b4a";  // 保持不变
const FIXED_PASSWORD = "qA5uhfrv";  // 保持不变

// 格式校验
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(UUID)) {
  console.error("\nUUID 格式错误！");
  process.exit(1);
}
console.log(`使用配置: UUID=${UUID}, Password=${FIXED_PASSWORD}`);

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
  console.log(`[Timer] 下次重启：${target.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

  setTimeout(() => {
    callback();
    scheduleBeijingTimeMidnight(callback);
  }, delay);
}

// ================== 基本配置 ==================
const MASQ_DOMAINS = ["www.bing.com"];
const CONFIG_YAML = "config.yaml"; // Hy2 通常使用 yaml
const CERT_PEM = "hy2-cert.pem";
const KEY_PEM = "hy2-key.pem";
const LINK_TXT = "hy2_link.txt";
const HY2_BIN = "./hysteria-server";

// ================== 工具函数 ==================
const randomPort = () => Math.floor(Math.random() * 40000) + 20000;
const randomSNI = () => MASQ_DOMAINS[Math.floor(Math.random() * MASQ_DOMAINS.length)];
function fileExists(p) { return fs.existsSync(p); }
function execSafe(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim(); }
  catch { return ""; }
}

// ================== 准确获取公网 IP ==================
async function getPublicIP() {
  const sources = ["https://api.ipify.org", "https://ifconfig.me", "https://icanhazip.com"];
  for (const url of sources) {
    try {
      const ip = await new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 3000 }, (res) => {
          let data = "";
          res.on("data", chunk => data += chunk);
          res.on("end", () => resolve(data.trim()));
        });
        req.on("error", reject);
      });
      if (ip) return ip;
    } catch (e) {}
  }
  return "127.0.0.1";
}

// ================== 下载文件 ==================
async function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("重定向次数过多"));
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        return resolve(downloadFile(res.headers.location, dest, redirectCount + 1));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

// ================== 生成证书 ==================
function generateCert(domain) {
  if (fileExists(CERT_PEM) && fileExists(KEY_PEM)) return;
  console.log(`Generating cert for ${domain}...`);
  execSafe(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${KEY_PEM} -out ${CERT_PEM} -subj "/CN=${domain}" -days 365 -nodes`);
}

// ================== 下载 Hysteria2 Server ==================
async function checkHy2Server() {
  if (fileExists(HY2_BIN)) return;
  console.log("Downloading Hysteria v2...");
  // 下载最新的 v2 版本（此处以 x86_64 为例）
  const url = "https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-amd64";
  await downloadFile(url, HY2_BIN);
  fs.chmodSync(HY2_BIN, 0o755);
}

// ================== 生成 Hysteria2 配置 (YAML) ==================
function generateConfig(password, port) {
  const yaml = `
listen: :${port}

auth:
  type: password
  password: ${password}

tls:
  cert: ${CERT_PEM}
  key: ${KEY_PEM}

quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520
  maxIdleTimeout: 30s
  maxIncomingStreams: 1024

ignoreClientBandwidth: false
disableUDP: false
`;
  fs.writeFileSync(CONFIG_YAML, yaml.trim() + "\n");
}

// ================== 生成 Hysteria2 链接 ==================
function generateLink(password, ip, port, domain) {
  // Hysteria2 标准格式: hy2://password@ip:port?insecure=1&sni=domain#name
  const link = `hy2://${password}@${ip}:${port}?insecure=1&sni=${domain}#Hy2-${ip}`;
  fs.writeFileSync(LINK_TXT, link);
  console.log("\nHysteria 2 Link:");
  console.log(link);
}

// ================== 守护运行 ==================
function runLoop() {
  const loop = () => {
    // Hy2 使用 server -c 启动
    const proc = spawn(HY2_BIN, ["server", "-c", CONFIG_YAML], { stdio: "ignore" });
    proc.on("exit", () => setTimeout(loop, 5000));
  };
  loop();
}

// ================== 主流程 ==================
async function main() {
  console.log("Hysteria 2 自动部署开始");

  scheduleBeijingTimeMidnight(() => process.exit(0));

  const port = process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : randomPort();
  const domain = randomSNI();

  generateCert(domain);
  await checkHy2Server();
  generateConfig(FIXED_PASSWORD, port);
  const ip = await getPublicIP();
  generateLink(FIXED_PASSWORD, ip, port, domain);
  
  console.log(`服务已启动，UDP 端口: ${port}`);
  runLoop();
}

main().catch(console.error);
