# 部署到 GitHub Pages

按以下步骤操作，约 5 分钟完成。部署后你会得到一个 `https://你的用户名.github.io/resume-tracker/` 网址，手机可直接访问并安装 PWA。

## 第一步：安装 Git（若尚未安装）

1. 下载 Git：https://git-scm.com/download/win
2. 安装时保持默认选项即可
3. 安装完成后**重新打开** Cursor 或 PowerShell

## 第二步：创建 GitHub 仓库

1. 登录 https://github.com
2. 点击右上角 **+** → **New repository**
3. 填写：
   - **Repository name**：`resume-tracker`（或你喜欢的名字）
   - **Public**
   - **不要**勾选 "Add a README file"
4. 点击 **Create repository**

## 第三步：上传项目

在 PowerShell 中执行（把路径和用户名替换成你的）：

```powershell
cd "D:\桌面\工作预备役\简历投递"

git init
git add .
git commit -m "Initial commit: 简历投递记录 PWA"
git branch -M main
git remote add origin https://github.com/你的GitHub用户名/resume-tracker.git
git push -u origin main
```

首次 push 时，浏览器会弹出 GitHub 登录窗口，按提示完成授权即可。

## 第四步：开启 GitHub Pages

1. 打开仓库页面 → **Settings** → 左侧 **Pages**
2. **Build and deployment** 中：
   - **Source** 选择 **GitHub Actions**
3. 保存后，GitHub 会自动运行 `.github/workflows/deploy.yml`
4. 进入 **Actions** 标签，等待绿色 ✓（约 1–2 分钟）

## 第五步：访问与安装

部署成功后，访问：

```
https://你的GitHub用户名.github.io/resume-tracker/
```

> 若仓库名不是 `resume-tracker`，把 URL 中的 `resume-tracker` 换成你的仓库名。

**Android**：Chrome 打开 →「安装到手机」或「添加到主屏幕」

**iPhone**：Safari 打开 → 分享 →「添加到主屏幕」

---

## 更新应用

修改代码后，在项目目录执行：

```powershell
git add .
git commit -m "更新说明"
git push
```

推送后 GitHub Actions 会自动重新部署，1–2 分钟后手机端刷新即可。

---

## 常见问题

**Q：push 时要求输入用户名密码？**  
A：GitHub 已不支持密码登录，请使用 [Personal Access Token](https://github.com/settings/tokens) 作为密码，或安装 [GitHub CLI](https://cli.github.com/) 用 `gh auth login` 登录。

**Q：Pages 显示 404？**  
A：确认 Actions 部署成功，且访问 URL 包含正确的仓库名，末尾可加 `/index.html` 试试。

**Q：PWA 安装按钮不出现？**  
A：必须用 HTTPS 网址访问（GitHub Pages 默认支持），不要用 `file://` 打开本地文件。

**Q：数据会丢失吗？**  
A：数据存在浏览器本地，与网址绑定。换手机或清除浏览器数据会丢失，请定期用「导出」功能备份。
