# Cookie Keeper 🍪

Chrome 浏览器插件，定期在后台访问配置的网站，自动刷新并导出最新 Cookie，
供 yt-dlp 等工具使用。

## 功能

- 配置多个网站 + 刷新间隔（分钟 / 小时 / 天）
- 后台静默打开标签页，自动捕获最新 Cookie
- 支持手动立即运行
- 一键导出 Netscape HTTP Cookie File（yt-dlp 标准格式）
- 支持单站点导出 / 全站点合并导出

## 安装（开发者模式）

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本目录（`vibe-260304-001-Init/`）
4. 工具栏出现 🍪 图标，点击即可打开配置界面

## 使用

1. 点击 **＋ 添加网站**，填写 URL 与刷新间隔
2. 确保你已在 Chrome 中登录该网站（Cookie 来自当前浏览器 Profile）
3. 插件将按间隔在后台自动刷新；也可点击 **▶ 运行** 立即执行
4. 运行后点击 **⬇ 导出** 下载 `.txt` 文件

## yt-dlp 示例

```bash
yt-dlp --cookies youtube_com_cookies.txt "https://www.youtube.com/watch?v=..."
```

## Cookie 格式

导出文件为标准 **Netscape HTTP Cookie File**，`httpOnly` Cookie 使用
`#HttpOnly_` 前缀，与 yt-dlp、curl、wget 等工具完全兼容。

## 注意事项

- Chrome 闹钟 API 最短间隔为 **1 分钟**
- Cookie 需要你已在当前 Chrome Profile 登录对应网站
- 部分网站 Cookie 有效期短，建议设置较短的刷新间隔
