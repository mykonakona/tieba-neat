# Tieba Neat · 贴吧清爽宽屏

用于新版百度贴吧的油猴脚本，改善桌面宽屏阅读，减少广告、推荐栏目和推广入口的干扰。

## 功能

- 首页、吧页、帖子详情页和个人主页的宽屏适配，四类页面共用同一正文列宽。
- 可设置页面、正文以及图片和视频的最大宽度，窗口变窄时正文统一收缩，侧栏放不下时移到正文下方。
- 屏蔽“最有料”、相关推荐、广告、App 下载引导和游戏等推广图标，保留消息入口。
- 各类侧栏和推广模块可独立开关，支持按栏目标题或自定义 CSS 选择器屏蔽，也可直接点选元素。

## 安装与使用

1. 在浏览器的油猴脚本管理器中新建脚本，粘贴根目录 `tieba-neat.user.js` 的完整内容并保存。
2. 打开或刷新 `tieba.baidu.com` 页面。
3. 从脚本管理器菜单打开“设置”“点选屏蔽元素”或“显示 / 隐藏被屏蔽的元素”。

默认页面最大宽度为 `2560px`，正文列为 `1200px`，媒体为 `820px`。设置中可填写 `px`、`vw` 或 `%`，保存后生效。更新脚本后刷新页面。

## 目录

```text
tieba-neat/
├── tieba-neat.user.js       # 可直接安装的主脚本
├── AGENTS.md               # AI 协作约定与隐私处理要求
├── README.md
├── tools/
│   └── sanitize_snapshots.py
├── tests/
│   ├── test_sanitize.py     # 合成敏感数据过滤测试
│   └── check_layout.mjs     # 脱敏页面的离线浏览器检查
├── snapshots/
│   ├── raw/                # 原始快照，仅保存在本地
│   └── sanitized/          # 本地生成的脱敏页面
└── artifacts/              # 本地测试日志、截图等产物
```

主脚本不需要构建。开发工具使用 Python 和 Node.js 标准库，无需安装第三方依赖；浏览器检查使用本地 Edge 和支持全局 `fetch`、`WebSocket` 的 Node.js（本项目已在 Node.js 26 下验证）。

## 补充页面与隐私流程

**先本地脱敏，再让 AI 读取、预览或分析页面，并开展适配编码。**

将保存的 HTML 放入 `snapshots/raw/`，然后在项目根目录执行：

```powershell
python tools/sanitize_snapshots.py
```

工具会保留原始文件，向 `snapshots/sanitized/` 写入以页面编号和类型命名的副本，移除个人内容、媒体地址、链接参数、页面脚本及嵌入状态等数据。程序成功完成检查后，才使用生成的副本分析布局。工具也兼容直接放在根目录的 HTML，便于临时添加页面。

原始快照、脱敏副本和测试产物已加入 `.gitignore`，分享代码时仅分享代码及文档。忽略规则不会阻止手动复制或上传文件；完整的 AI 工作约定见 [AGENTS.md](AGENTS.md)。

## 验证

在项目根目录执行：

```powershell
# 隐私过滤测试（仅使用合成数据）
python -B tests/test_sanitize.py

# 主脚本语法检查
node --check tieba-neat.user.js

# 先生成脱敏副本，再检查四类页面的布局和设置行为
python tools/sanitize_snapshots.py
node tests/check_layout.mjs
```

浏览器检查覆盖 `2560`、`1920`、`1366`、`1006`、`768` 像素窗口及设置恢复等行为，阻止测试页面的 HTTP/HTTPS 请求。这些检查基于脱敏静态快照，实际站点的登录态和交互还需在浏览器中确认。

默认使用 Windows 的 Edge 安装路径；位置不同时可指定：

```powershell
$env:EDGE_PATH = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
node tests/check_layout.mjs > artifacts/layout-check.log
```
