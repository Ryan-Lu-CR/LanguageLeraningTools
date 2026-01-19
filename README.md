# 🎓 语言学习实验室

**离线优先的浏览器端语言学习工具**  
集成精听训练、跟读录音、双语字幕编辑、文档阅读和本地 Whisper 语音识别。

> 🌟 **核心特色**：完全离线运行 · 数据本地存储 · 隐私安全 · 支持GPU加速

---

## ✨ 核心功能

### 🎧 精听训练模块

**媒体播放**
- 本地音视频播放，支持跳转、倍速、波形图可视化
- 拖拽导入媒体文件和字幕
- 多播放列表管理、拖拽排序

**字幕功能**
- 双语字幕展示、点击跳转、单句循环
- 在线编辑（外语、翻译、备注），自动保存
- 支持 JSON 和 SRT 格式导入/导出
- Whisper 自动生成字幕（支持多语言）
- 波形图辅助的时间轴精确调整
- 生词本集成：划词高亮、悬浮释义、一键添加

**跟读练习**
- 录音功能，Whisper 本地转写
- 与原句对比评分
- 错误词汇高亮显示

### 📖 阅读学习模块

**支持格式**
- PDF（保留原始排版，独立查看器）
- EPUB 电子书（支持图片）
- TXT 纯文本
- DOC/DOCX Word文档

**核心功能**
- 📄 **PDF增强查看器** - 连续滚动、缩放、生词高亮、波浪线标记
- 📍 **智能进度管理** - 自动保存阅读位置、页码进度、支持断点续读
- 📊 **多语言统计** - 中文字符计数、俄文/英文词数统计
- 📝 **笔记系统** - 文本选中、划词标注、笔记管理
- 🔍 **全文搜索** - 快速定位关键词
- 📚 **生词本集成** - 划词添加、即时高亮、悬浮释义

**PDF专属特性**
- ✨ 生词波浪线高亮（有批注：黄色高亮+橙色波浪线；无批注：蓝色波浪线）
- ✨ 悬浮词汇浮窗（荧光笔效果）
- ✨ 基于页码的精准进度恢复
- ✨ 优化加载策略（首屏3页快速显示，后台异步加载）

### 📚 统一生词本系统

- 🗂️ **多生词本支持** - 按主题、级别、来源分类管理
- ⚡ **即时更新** - 新增词汇立即在PDF/文本/字幕中高亮
- 📤 **导入导出** - JSON格式，支持批量管理
- 📈 **词频统计** - 智能统计使用频率

### 💾 数据管理
- 🔒 所有数据本地存储，隐私安全
- 🔄 自动数据迁移（无缝升级）
- 💿 一键备份（复制 `user_data/` 文件夹）

---

## 🚀 快速开始

### 一键启动

```bash
# Windows
python start.py
# 或双击 start.bat

# macOS/Linux
python start.py
```

脚本会自动：
- ✓ 检查并安装 FFmpeg
- ✓ 检查并安装 Python 依赖
- ✓ 检测 GPU 加速支持
- ✓ 下载 Whisper 模型（如需要，详见 [models/README.md](models/README.md)）
- ✓ 启动应用并打开浏览器

---

## 📦 安装配置

### 前置要求

#### 必需
- **Python 3.8+**
- **FFmpeg** - Whisper 需要用它处理音频

**Windows 快速安装 FFmpeg：**
```powershell
winget install Gyan.FFmpeg
```

**macOS：**
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian)：**
```bash
sudo apt install ffmpeg
```

#### 可选：GPU 加速
如果有 **NVIDIA GPU**，可以启用 GPU 加速，转写速度提升 **10-50 倍**！

**要求：**
- NVIDIA GPU（计算能力 ≥ 3.5）
- CUDA Toolkit ≥ 11.8
- cuDNN ≥ 8.0

**Windows 安装步骤：**
1. 下载 [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)
2. 下载 [cuDNN](https://developer.nvidia.com/cudnn)（需注册）
3. 解压 cuDNN 到 CUDA 安装目录

**验证：**
```bash
python -c "import torch; print(torch.cuda.is_available())"
```

### 手动安装

```bash
# 1. 创建虚拟环境（推荐）
python -m venv .venv

# 2. 激活虚拟环境
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# 3. 安装依赖（所有依赖已本地化，支持离线部署）
pip install -r config/requirements.txt

# 4. 运行应用
python start.py
```

浏览器打开 <http://127.0.0.1:5000>

---

### ✅ 离线部署支持

本项目所有前端库都已本地化到 `static/lib/` 目录，**无需从 CDN 加载**。

**包含的库：**
- PDF.js - PDF 查看和处理
- WaveSurfer.js - 音频波形显示
- Marked.js - Markdown 解析
- Mammoth.js - Word 文档处理
- EPUB.js - EPUB 电子书支持

**完全离线安装流程：**

```bash
# 1. 克隆项目（或下载压缩包）
git clone <repo-url>

# 2. 安装 Python 依赖
pip install -r config/requirements.txt

# 3. 启动应用（所有资源已包含）
python start.py
```

**详见** → [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 📂 用户数据

所有用户数据保存在 `user_data/` 文件夹：

```
user_data/
├── media/          # 上传的音频/视频
├── subtitles/      # 字幕文件（JSON/SRT）
├── vocab/          # 生词本（vocabbooks.json）
├── playlists/      # 播放列表（playlists.json）
└── settings/       # 用户设置（settings.json）
```

**数据备份：** 复制整个 `user_data/` 文件夹即可

**自动迁移：** 从旧版本升级时自动迁移数据，无需手动操作

---

## 🎯 使用指南

### 导入媒体
1. **拖拽导入**：直接拖拽音频/视频到页面
2. **点击导入**：点击"📁 导入媒体"按钮

### 字幕管理
- **自动生成**：点击"✨ Whisper 自动生成字幕"
- **导入字幕**：拖拽 `.json` 或 `.srt` 文件
- **编辑字幕**：点击右侧字幕行直接编辑
- **调整时间**：点击"✂️ 分句"，拖动波形图边界
- **导出字幕**：点击"📥 导出" → 选择 JSON 或 SRT

### 精听练习
1. 点击字幕行跳转播放
2. 启用"🔁 单句循环"重复听
3. 启用"⏸️ 自动暂停"逐句学习

### 跟读评分
1. 选择一句字幕
2. 点击"🎤 开始录音"
3. 跟读后点击"⏹️ 停止"
4. 查看转写结果和相似度评分

### 生词本
- **添加生词**：双击页面选中文字，自动填充表单
- **切换生词本**：点击生词本下拉菜单
- **创建生词本**：点击"➕"按钮
- **导出生词**：点击"📤 导出"

---

## 🔧 API 接口

### 媒体管理
```
POST /api/media/upload        # 上传媒体文件
GET  /api/media/load/<name>   # 加载媒体
```

### 字幕管理
```
POST /api/subtitles/generate  # Whisper 生成字幕
POST /api/subtitles/save      # 保存字幕
GET  /api/subtitles/load/<name> # 加载字幕
GET  /api/transcribe/progress # 转录进度
```

### 生词本
```
POST /api/vocabbooks/save     # 保存生词本
GET  /api/vocabbooks/load     # 加载生词本
```

### 播放列表
```
POST /api/playlists/save      # 保存播放列表
GET  /api/playlists/load      # 加载播放列表
```

### 跟读评分
```
POST /api/score               # 评分：{reference, hypothesis}
```

---

## 📊 项目统计

| 指标 | 数值 |
|------|------|
| 前端代码 | ~3,174 行 (app.js) |
| 后端代码 | ~532 行 (app.py) |
| HTML | ~366 行 |
| CSS | ~1,893 行 |
| 支持语言 | Whisper 支持的所有语言 |

---

## 💡 使用技巧

### 生词本分类建议
- **按级别**：A1生词本、A2生词本、B1生词本
- **按场景**：日常对话、商务用语、旅游用语
- **按来源**：《教材名》第X册、某系列视频

### 快捷键
- **Ctrl+Z** - 撤销字幕编辑
- **Ctrl+Y** - 重做字幕编辑
- **Space** - 播放/暂停

### 波形图技巧
1. 使用"+"/"−"缩放波形
2. 拖动区域边界精确调整时间
3. 点击"对齐当前句"重置

---

## ❓ 常见问题

**Q: Whisper 转录很慢？**  
A: 
- 首次加载模型较慢（30秒-2分钟）
- 建议启用 GPU 加速（速度提升10-50倍）
- 可选择更小的模型（base > small > tiny）

**Q: 找不到 FFmpeg？**  
A: 
```bash
# 检查安装
ffmpeg -version

# Windows 重新安装
winget install Gyan.FFmpeg

# 安装后重启终端
```

**Q: GPU 加速不生效？**  
A:
```bash
# 检查 CUDA
python -c "import torch; print(torch.cuda.is_available())"

# 应该输出 True
```

**Q: 如何备份数据？**  
A: 复制整个 `user_data/` 文件夹即可

**Q: 支持哪些语言？**  
A: Whisper 支持 99 种语言，包括英语、俄语、中文、日语、韩语、法语、德语、西班牙语等

**Q: 可以离线使用吗？**  
A: 完全可以！所有功能都是本地运行，无需网络

---

## 🛠️ 技术栈

### 后端
- **Flask** - Web 框架
- **Whisper** - OpenAI 语音识别模型
- **FFmpeg** - 音频处理
- **PyTorch** - 深度学习框架

### 前端
- **Vanilla JavaScript** - 无框架依赖
- **WaveSurfer.js** - 波形图可视化
- **HTML5 Audio/Video** - 媒体播放

---

## 🗂️ 文件结构

```
RussianLeraning/
├── start.py            # 启动脚本
├── README.md           # 项目文档
├── .gitignore          # Git 忽略规则
├── src/                # 源代码
│   └── app.py          # Flask 后端
├── config/             # 配置文件
│   ├── .env            # 环境配置
│   └── requirements.txt # Python 依赖
├── models/             # Whisper 模型
│   └── README.md
├── static/             # 前端文件
│   ├── index.html
│   ├── app.js
│   ├── split.js
│   └── styles.css
└── user_data/          # 用户数据（不上传）
    ├── media/
    ├── subtitles/
    ├── vocab/
    ├── playlists/
    └── settings/
```

---

## � 阅读学习功能详解

### 支持的文档格式
- **PDF** - 完整保留原始排版，独立PDF查看器支持划词
- **EPUB** - 电子书格式，自动提取图片
- **TXT** - 纯文本文件
- **DOC/DOCX** - Word文档

### 使用步骤

1. **切换到阅读模块**
   - 点击页面顶部的"📖 阅读学习"按钮

2. **导入文档**
   - 点击"📁 选择文件"或拖拽文档到页面
   - 等待文件上传和处理

3. **阅读和标注**
   - 使用页码导航浏览文档
   - 选中文字后弹出查词气泡
   - 点击"📝 添加"将词汇加入生词本
   - 在右侧添加笔记和批注

4. **全文搜索**
   - 在搜索框输入关键词
   - 查看搜索结果和上下文
   - 点击结果跳转到对应位置

5. **词汇分析**
   - 查看文档词频统计
   - 导出生词列表

### PDF独立查看器特性
- 连续滚动浏览所有页面
- 缩放控制（50%-300%）
- 适应宽度/适应页面模式
- 文本层支持选择和复制
- 划词即查，添加到生词本
- 支持释义和批注编辑
- **📖 自动保存阅读进度** - 再次打开时自动恢复页码、缩放级别和滚动位置

### 数据存储
阅读相关数据保存在：
```
user_data/
├── readings/
│   ├── documents.json              # 文档索引
│   ├── {doc_id}_content.json       # 文档内容
│   ├── {doc_id}_notes.json         # 笔记数据
│   └── [原始文档文件]
└── pdf_cache/                      # PDF阅读进度缓存
    ├── example.cache.json
    └── ...
```

### 📖 PDF 阅读进度缓存（v1.0新增）
- **自动保存阅读进度** - 滚动、缩放、页码位置自动保存
- **智能恢复** - 重新打开 PDF 时自动恢复上次阅读位置
- **防抖机制** - 滚动时智能防抖，避免频繁保存
- **零配置** - 完全自动，无需手动操作
- 详见 [PDF_CACHE_FEATURE.md](PDF_CACHE_FEATURE.md)


---

## 🔧 开发者文档

### 架构设计

**后端 (Flask)**
- 文档处理服务 - PyPDF2, ebooklib, python-docx
- 文档管理 - 上传、分页、元数据
- 数据服务 - 笔记存储、词汇提取、全文搜索
- API端点 - RESTful风格

**前端 (原生JavaScript)**
- 模块化设计 - 听力模块、阅读模块分离
- 状态管理 - readingState, playlistState等
- 事件驱动 - 用户交互响应
- 无框架依赖 - 轻量高效

### 阅读模块API

```javascript
// 上传文档
POST /api/reading/upload-document
Content-Type: multipart/form-data
Body: { file: File }

// 加载文档
GET /api/reading/load-document/<doc_id>
Response: { status, text, pages, filename, ext }

// 文档列表
GET /api/reading/documents
Response: { status, documents: {...} }

// 保存笔记
POST /api/reading/save-notes/<doc_id>
Body: { notes: [...] }

// 加载笔记
GET /api/reading/load-notes/<doc_id>
Response: { status, notes: [...] }

// 提取词汇
GET /api/reading/extract-words/<doc_id>
Response: { status, words: [{word, count}], total_unique }

// 全文搜索
POST /api/reading/search/<doc_id>
Body: { query: string }
Response: { status, query, results: [...], count }

// 删除文档
DELETE /api/reading/delete-document/<doc_id>
Response: { status, removed: [...] }
```

### PDF缓存API（v1.0新增）

```javascript
// 保存PDF阅读进度
POST /api/pdf-cache/save
Body: { pdfFilename, currentPage, scale, scrollTop, displayMode }
Response: { status, message, cachePath }

// 加载PDF阅读进度
POST /api/pdf-cache/load
Body: { pdfFilename }
Response: { status, found, cache: {pdfFilename, currentPage, scale, scrollTop, displayMode, timestamp} }

// 删除PDF缓存
POST /api/pdf-cache/delete
Body: { pdfFilename }
Response: { status, message }

// 列出所有缓存
GET /api/pdf-cache/list
Response: { status, caches: [...], count }
```
详见 [PDF_CACHE_FEATURE.md](PDF_CACHE_FEATURE.md)

### 文档进度管理API（v2.0新增）

```javascript
// 保存文档阅读进度（所有文档类型）
POST /api/doc-progress/save
Body: { docId, docType, scrollPosition, scrollPercent, currentPage, displayMode }
Response: { status, message, progressPath }

// 加载文档阅读进度
POST /api/doc-progress/load
Body: { docId }
Response: { status, found, progress: {docId, scrollPosition, scrollPercent, timestamp} }

// 删除文档进度
POST /api/doc-progress/delete
Body: { docId }
Response: { status, message }

// 列出所有文档进度
GET /api/doc-progress/list
Response: { status, progresses: [...], count }
```
详见 [READING_PROGRESS_FEATURE.md](READING_PROGRESS_FEATURE.md)

### 扩展开发

**添加新文档格式支持：**
1. 在 `app.py` 添加提取函数
2. 更新 `upload_reading_document` 路由
3. 前端添加文件类型支持

**自定义样式：**
- 修改 `static/styles.css` 中的CSS变量
- 颜色主题定义在 `:root` 选择器

---

## 🔄 更新日志

### v2.1 (2026-01-18)
- ✨ **智能阅读进度保存**
  - 通用文档进度 API（所有文档类型支持）
  - 自动保存/恢复滚动位置和阅读进度
  - 防抖机制优化 I/O 性能
- ✨ **文本分析增强**
  - 新增总词数统计功能
  - 支持中文、俄文等多语言词汇计算
  - 文档列表显示阅读进度条
- 🎨 UI 优化：文档列表显示词数、字数、进度信息
- 📚 文档完善：新增 READING_PROGRESS_FEATURE.md
- 🔧 后端增强：count_total_words() 多语言词数统计函数

### v2.0 (2026-01-18)
- ✨ **新增阅读学习模块**
  - PDF/EPUB/TXT/DOC文档支持
  - 独立PDF查看器（PDF.js）
  - 划词查询和生词本集成
  - 笔记与标注系统
  - 全文搜索功能
  - 词汇统计分析
  - PDF 阅读进度缓存
- ✨ 多生词本支持（按主题/级别/来源分类）
- ✨ 生词本在精听和阅读模块间共享
- 📁 项目结构重组（src/、config/、tests/）
- ✨ 播放列表管理优化
- ✨ 自动数据迁移机制
- ✨ 离线部署支持（本地化所有 CDN 库）
- 🎨 UI/UX全面升级
- 🐛 修复多个已知问题

### v1.0
- 🎉 精听训练模块
- ✨ 媒体播放和字幕同步
- ✨ Whisper语音识别
- ✨ 跟读练习和评分
- ✨ WaveSurfer波形图
- ✨ 字幕编辑和时间轴调整

---

## 📄 许可证

本项目仅供个人学习使用。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**Happy Learning! 🎓**

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT License

---

## 🙏 致谢

- [OpenAI Whisper](https://github.com/openai/whisper) - 强大的语音识别模型
- [WaveSurfer.js](https://wavesurfer-js.org/) - 优秀的音频可视化库
- [Flask](https://flask.palletsprojects.com/) - 简洁的 Web 框架
