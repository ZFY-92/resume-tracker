# 简历投递记录

一个本地运行的 PWA 应用，用于记录和管理求职过程中的简历投递情况。支持安装到手机桌面，像 APP 一样使用。数据保存在浏览器本地。

## 功能

- 记录投递信息：公司、岗位、平台、日期、状态、薪资、备注等
- 按状态筛选、关键词搜索
- 统计面板：各状态数量一目了然
- **日历视图**：按月查看投递与面试安排
- **面试提醒**：设置提醒时间，浏览器通知 + 近期面试面板
- **PWA 支持**：可安装到手机桌面，离线访问
- 数据导出 / 导入（JSON 备份）
- 深色 / 浅色主题切换

## 在手机上安装（PWA）

PWA 安装需要 **HTTPS** 或 **localhost** 环境，直接双击 `index.html`（`file://`）无法完整启用 PWA 功能。

### 推荐：部署到免费静态托管（一次配置，手机随时用）

将项目文件夹上传到以下任一平台（免费 HTTPS）：

- [GitHub Pages](https://pages.github.com/)
- [Cloudflare Pages](https://pages.cloudflare.com/)
- [Vercel](https://vercel.com/)

部署后，用手机浏览器打开网址即可安装。

### 安装步骤

**Android（Chrome / Edge）**

1. 用手机浏览器打开应用网址
2. 点击顶部「安装到手机」按钮，或浏览器菜单 →「添加到主屏幕」/「安装应用」
3. 确认后，桌面会出现「投递记录」图标

**iPhone（Safari）**

1. 用 Safari 打开应用网址（微信内置浏览器不支持，需用 Safari）
2. 点击底部分享按钮 →「添加到主屏幕」
3. 点击「添加」

安装后打开，会以全屏 APP 模式运行，无浏览器地址栏。

### 本地测试（电脑）

在项目目录启动本地服务器后访问 http://localhost:8080：

```powershell
# 若已安装 Python
cd "D:\桌面\工作预备役\简历投递"
python -m http.server 8080
```

或在 Cursor / VS Code 中安装 Live Server 扩展，右键 `index.html` → Open with Live Server。

## 部署到 GitHub Pages（手机访问）

详细步骤见 **[DEPLOY.md](./DEPLOY.md)**。

快速流程：

1. 在 GitHub 创建空仓库（如 `resume-tracker`）
2. 在项目目录运行：

```powershell
cd "D:\桌面\工作预备役\简历投递"
.\deploy.ps1 -GitHubUsername "你的GitHub用户名"
```

3. 仓库 Settings → Pages → Source 选 **GitHub Actions**
4. 访问 `https://你的用户名.github.io/resume-tracker/`

## 使用方法

### 方式一：直接打开（电脑快速使用）

双击 `index.html` 即可在浏览器中使用基础功能（PWA 安装不可用）。

### 方式二：本地服务器

见上方「本地测试」说明。

## 数据存储

所有数据保存在浏览器的 `localStorage` 中，键名为 `resume-applications-v1`。

- 清除浏览器数据会导致记录丢失，建议定期使用「导出数据」功能备份
- 换电脑或换浏览器时，可通过「导入数据」恢复
- 安装 PWA 后数据仍保存在该浏览器 / 该主屏幕图标对应的存储中

## 项目结构

```
简历投递/
├── index.html              # 主页面
├── manifest.webmanifest    # PWA 清单
├── service-worker.js       # 离线缓存
├── css/
│   └── style.css           # 样式
├── js/
│   ├── app.js              # 应用逻辑
│   └── pwa.js              # PWA 安装与注册
├── icons/
│   ├── icon-192.png        # 应用图标
│   └── icon-512.png
├── .github/workflows/
│   └── deploy.yml          # GitHub Pages 自动部署
├── deploy.ps1              # 一键部署脚本
├── DEPLOY.md               # 部署详细说明
├── resume-tracker.code-workspace
└── README.md
```

## 后续扩展方向

- 部署到云端，手机通过 HTTPS 安装使用
- 接入后端数据库，实现多设备同步
- 打包为微信小程序
- 对接招聘平台 API（如有）
