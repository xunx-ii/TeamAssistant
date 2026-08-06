/**
 * 扫码绑定模块
 *
 * 通过 @tencent-connect/qqbot-connector 在控制台打印二维码，
 * 用户用手机 QQ 扫码后自动获取机器人 AppID 与 AppSecret，写入 credentials.json。
 *
 * 用法：npm run bind
 */
import { qrConnect } from "@tencent-connect/qqbot-connector";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";

export async function bind() {
  if (config.hasCredentials()) {
    console.log("检测到已有凭据（credentials.json 或环境变量），无需重新绑定。");
    console.log(`  如需重新绑定，请删除 ${config.credentialsPath} 或清除 QQ_APP_ID/QQ_APP_SECRET 环境变量后重试。`);
    return;
  }

  console.log("正在生成绑定二维码，请使用手机 QQ 扫码…（Ctrl+C 取消）\n");

  try {
    const credentials = await qrConnect();
    const [{ appId, appSecret }] = credentials;

    writeFileSync(
      config.credentialsPath,
      JSON.stringify({ appId, appSecret }, null, 2) + "\n",
      { mode: 0o600 },
    );

    console.log("\n✅ 绑定成功！");
    console.log(`  AppID:    ${appId}`);
    console.log(`  AppSecret: ${appSecret}`);
    console.log(`  凭据已保存到 ${config.credentialsPath}`);
    console.log("\n现在可以运行 npm start 启动机器人（建议先在 .env 中配置 QQ_ENV=sandbox 进行沙箱测试）。");
  } catch (err) {
    console.error("\n❌ 绑定失败:", err.message ?? err);
    process.exitCode = 1;
  }
}

// 直接运行时执行
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  bind();
}
