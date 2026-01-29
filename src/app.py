import json
import shutil
import html
import tempfile
from pathlib import Path
from urllib.request import urlretrieve
from typing import List, Dict, Any
import io
import sys
import re
import mimetypes
import base64

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS

try:
    import torch  # type: ignore
except ImportError:
    torch = None

try:
    import whisper  # type: ignore
except ImportError:  # Whisper is optional for local/offline use
    whisper = None

# 文本处理库
try:
    import PyPDF2  # type: ignore
except ImportError:
    PyPDF2 = None

try:
    import epub  # type: ignore
except ImportError:
    epub = None

try:
    from ebooklib import epub as ebooklib_epub  # type: ignore
except ImportError:
    ebooklib_epub = None

try:
    import pymorphy2  # type: ignore
except ImportError:
    pymorphy2 = None

# pymorphy2 兼容性补丁（修复 Python 3.11+ 的 getargspec 问题）
if pymorphy2 is not None:
    try:
        import inspect
        if not hasattr(inspect, 'getargspec'):
            def getargspec(func):
                try:
                    spec = inspect.getfullargspec(func)
                    from collections import namedtuple
                    ArgSpec = namedtuple('ArgSpec', 'args varargs keywords defaults')
                    return ArgSpec(spec.args, spec.varargs, spec.varkw, spec.defaults)
                except Exception:
                    from collections import namedtuple
                    ArgSpec = namedtuple('ArgSpec', 'args varargs keywords defaults')
                    return ArgSpec([], None, None, None)
            inspect.getargspec = getargspec
            print("✓ pymorphy2 兼容性补丁已加载")
    except Exception as e:
        print(f"⚠️ pymorphy2 兼容性补丁加载失败: {e}")

app = Flask(
    __name__,
    static_folder=str(Path(__file__).parent.parent / "static"),
    static_url_path="/static"
)
CORS(app)
# 允许上传较大文件（默认无限制，这里设置上限 512MB 以防意外 413）
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024

# --- User/Data/Config Directories -----------------------------------------
USER_DATA_DIR = Path(__file__).parent.parent / "user_data"
CONFIG_DIR = Path(__file__).parent.parent / "config"
MODELS_DIR = Path(__file__).parent.parent / "models"
USER_DATA_DIR.mkdir(exist_ok=True)

def get_user_file_path(filename: str, subdir: str = "") -> Path:
    """获取用户数据文件路径"""
    if subdir:
        target_dir = USER_DATA_DIR / subdir
        target_dir.mkdir(exist_ok=True)
        return target_dir / filename
    return USER_DATA_DIR / filename


# --- Whisper helpers -------------------------------------------------------

_model_cache = None
_ffmpeg_available = None
_device = None
_transcribe_progress = {"status": "", "progress": 0}

def get_device():
    """Get the device to use for inference (GPU or CPU)."""
    global _device
    if _device is not None:
        return _device
    
    if torch is not None and torch.cuda.is_available():
        _device = "cuda"
        print(f"🚀 CUDA GPU available! Using GPU for inference.")
        print(f"   Device: {torch.cuda.get_device_name(0)}")
        print(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB")
    else:
        _device = "cpu"
        if torch is None:
            print("⚠️  PyTorch not installed, using CPU")
        else:
            print("ℹ️  No CUDA GPU available, using CPU")
    
    return _device

def check_ffmpeg():
    """Check if FFmpeg is available in the system."""
    global _ffmpeg_available
    if _ffmpeg_available is not None:
        return _ffmpeg_available
    _ffmpeg_available = shutil.which("ffmpeg") is not None
    if not _ffmpeg_available:
        print("⚠️  WARNING: FFmpeg not found! Audio transcription will fail.")
        print("   Please install FFmpeg: https://ffmpeg.org/download.html")
        print("   Windows: winget install Gyan.FFmpeg")
    return _ffmpeg_available

def get_model():
    """Lazily load Whisper model; return None if unavailable."""
    global _model_cache
    if _model_cache is not None:
        return _model_cache
    if whisper is None:
        return None
    
    device = get_device()
    
    # 优先使用本地模型文件（支持 active_model.txt 指定）
    model_files = sorted(MODELS_DIR.glob("*.pt")) if MODELS_DIR.exists() else []
    
    if model_files:
        # 使用激活的模型（若存在），否则选择第一个
        active_path = CONFIG_DIR / "active_model.txt"
        chosen = None
        if active_path.exists():
            name = active_path.read_text().strip()
            candidate = MODELS_DIR / name
            if candidate.exists():
                chosen = candidate
        model_path = chosen if chosen is not None else model_files[0]
        print(f"Loading local model: {model_path.name}")
        _model_cache = whisper.load_model(str(model_path), device=device)
    else:
        # 回退到自动下载模式
        env_path = CONFIG_DIR / ".env"
        model_name = env_path.read_text().strip() if env_path.exists() else "base"
        print(f"Downloading model: {model_name}")
        _model_cache = whisper.load_model(model_name, device=device)
    
    return _model_cache

# --- Model management APIs -------------------------------------------------

MODEL_URLS = {
    "tiny": "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
    "base": "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
    "small": "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
    "medium": "https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt",
    "large": "https://openaipublic.azureedge.net/main/whisper/models/e4b87e7e0bf463eb8e6956e646f1e277e901512310def2c24bf0e11bd3c28e9a/large.pt",
}

def list_local_models():
    items = []
    if MODELS_DIR.exists():
        for m in MODELS_DIR.glob("*.pt"):
            items.append({
                "filename": m.name,
                "size_mb": round(m.stat().st_size / (1024 * 1024), 1)
            })
    return items

@app.get('/api/models/list')
def api_models_list():
    local = list_local_models()
    current = None
    active_path = CONFIG_DIR / "active_model.txt"
    if active_path.exists():
        current = active_path.read_text().strip()
    elif local:
        current = local[0]["filename"]
    else:
        env_path = CONFIG_DIR / ".env"
        current = env_path.read_text().strip() if env_path.exists() else None
    return {"status": "success", "local": local, "current": current, "canSwitch": len(local) > 1}

@app.post('/api/models/download')
def api_models_download():
    data = request.get_json(silent=True) or {}
    name = str(data.get('name', 'base')).lower()
    if name not in MODEL_URLS:
        return {"status": "error", "message": "unknown model"}, 400
    MODELS_DIR.mkdir(exist_ok=True)
    target = MODELS_DIR / f"{name}.pt"
    try:
        url = MODEL_URLS[name]
        urlretrieve(url, target)
        return {"status": "success", "filename": target.name}
    except Exception as e:
        return {"status": "error", "message": str(e)}, 500

@app.post('/api/models/set_active')
def api_models_set_active():
    data = request.get_json(silent=True) or {}
    filename = data.get('filename')
    if not filename:
        return {"status": "error", "message": "filename required"}, 400
    candidate = MODELS_DIR / filename
    if not candidate.exists():
        return {"status": "error", "message": "file not found"}, 404
    CONFIG_DIR.mkdir(exist_ok=True)
    (CONFIG_DIR / 'active_model.txt').write_text(filename)
    # 清理缓存以便下次加载新模型
    global _model_cache
    _model_cache = None
    return {"status": "success", "active": filename}


def run_whisper_transcribe(tmp_path: Path, language: str | None = None) -> Dict[str, Any]:
    global _transcribe_progress
    model = get_model()
    if model is None:
        return {"text": "", "segments": []}
    if not check_ffmpeg():
        raise RuntimeError(
            "FFmpeg is not installed. Please install FFmpeg to use audio transcription. "
            "See INSTALL_FFMPEG.md for installation instructions."
        )
    
    print(f"🔄 Starting transcription: {tmp_path.name}")
    _transcribe_progress = {"status": "加载中...", "progress": 5}
    
    # 捕获进度输出
    old_stdout = sys.stdout
    progress_capture = io.StringIO()
    
    try:
        sys.stdout = progress_capture
        result = model.transcribe(str(tmp_path), language=language, verbose=False)
    finally:
        sys.stdout = old_stdout
    
    # 解析进度信息
    progress_output = progress_capture.getvalue()
    if "Detected language" in progress_output:
        for line in progress_output.split('\n'):
            if "Detected language" in line:
                _transcribe_progress["detected_lang"] = line.strip()
                print(f"🌍 {line.strip()}")
    
    _transcribe_progress["status"] = f"处理中 ({len(result.get('segments', []))} 个片段)"
    _transcribe_progress["progress"] = 90
    
    print(f"✅ Transcription complete: {len(result.get('segments', []))} segments")
    
    segments = [
        {
            "start": float(seg.get("start", 0)),
            "end": float(seg.get("end", 0)),
            "text": seg.get("text", "").strip(),
        }
        for seg in result.get("segments", [])
    ]
    
    _transcribe_progress["status"] = "完成"
    _transcribe_progress["progress"] = 100
    
    return {"text": result.get("text", ""), "segments": segments}


# --- Document Processing Helpers -------------------------------------------

def extract_text_from_pdf(file_path: str, max_pages: int = 50) -> str:
    """从PDF文件提取文本并以分页HTML形式返回，保持原有排版（逐页展示）
    
    参数:
        file_path: PDF文件路径
        max_pages: 最大提取页数（防止大型PDF内存溢出），0表示无限制
    """
    if PyPDF2 is None:
        raise ImportError("PyPDF2 not installed. Please install it: pip install PyPDF2")
    
    pages_html = []
    try:
        with open(file_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            total_pages = len(pdf_reader.pages)
            
            # 限制处理页数，防止大型PDF导致内存溢出
            if max_pages > 0 and total_pages > max_pages:
                print(f"⚠️ PDF过大 ({total_pages}页)，仅提取前{max_pages}页")
                total_pages = max_pages
            
            for page_num in range(total_pages):
                page = pdf_reader.pages[page_num]
                text = page.extract_text() or ""
                # 使用 <pre> 保留换行与空格，包装页容器方便分页展示
                escaped = html.escape(text)
                page_html = (
                    f'<div class="pdf-page">'
                    f'<div class="page-number">第 {page_num + 1} 页 / {total_pages}</div>'
                    f'<pre>{escaped}</pre>'
                    f'</div>'
                )
                pages_html.append(page_html)
    except Exception as e:
        raise Exception(f"PDF提取错误: {str(e)}")
    
    return '\n'.join(pages_html)


def extract_text_from_epub(file_path: str) -> str:
    """从EPUB文件提取文本和HTML内容"""
    if ebooklib_epub is None:
        raise ImportError("ebooklib not installed. Please install it: pip install ebooklib")
    
    text_content = []
    try:
        book = ebooklib_epub.read_epub(file_path)
        
        # 首先提取并保存所有图片资源
        import hashlib
        import io
        
        # 确保USER_DATA_DIR可见
        global USER_DATA_DIR
        
        print(f"DEBUG: USER_DATA_DIR = {USER_DATA_DIR}")
        epub_hash = hashlib.md5(file_path.encode()).hexdigest()[:8]
        print(f"DEBUG: epub_hash = {epub_hash}")
        
        # 使用绝对路径保存图片到user_data\readings目录
        images_dir = USER_DATA_DIR / "readings" / "reading_images" / epub_hash
        print(f"DEBUG: images_dir = {images_dir}")
        
        try:
            images_dir.mkdir(parents=True, exist_ok=True)
            print(f"DEBUG: 图片目录创建成功: {images_dir}")
        except Exception as e:
            print(f"DEBUG: 图片目录创建失败: {e}")
            raise
        
        image_mapping = {}  # 映射：文件名 -> 新URL
        
        # 收集所有项目用于调试
        all_items = list(book.get_items())
        print(f"✓ EPUB共有 {len(all_items)} 个项目")
        
        # 收集所有图片
        for item in all_items:
            item_type = item.get_type()
            item_name = item.get_name() if hasattr(item, 'get_name') else str(item)
            
            # 检查是否是图片资源
            is_image = False
            
            # 方法1：检查 ITEM_IMAGE 常量
            if hasattr(ebooklib_epub, 'ITEM_IMAGE'):
                is_image = item_type == ebooklib_epub.ITEM_IMAGE
            else:
                # 方法2：检查元组格式或整数值
                if isinstance(item_type, tuple):
                    is_image = item_type[0] == 3  # IMAGE = (3, 'DOCUMENT_IMAGE')
                elif isinstance(item_type, int):
                    is_image = item_type == 3
            
            # 方法3：如果名称包含图片扩展名，也认为是图片
            if not is_image and item_name and any(item_name.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']):
                is_image = True
                print(f"  ✓ 通过扩展名检测到图片: {item_name}")
            
            if is_image:
                try:
                    content = item.get_content()
                    item_name_safe = item.get_name() if item.get_name() else f"image_{len(image_mapping)}"
                    
                    # 提取文件名（不含路径）
                    filename = item_name_safe.split('/')[-1].split('\\\\')[-1]
                    
                    # 保存图片
                    image_path = images_dir / filename
                    with open(image_path, 'wb') as f:
                        f.write(content)
                    
                    # 建立映射：文件名 -> URL
                    new_url = f"/api/reading/image/{epub_hash}/{filename}"
                    image_mapping[filename] = new_url
                    
                    print(f"✓ 提取图片: {filename} -> {new_url}")
                except Exception as e:
                    print(f"✗ 提取图片失败 {item_name_safe}: {str(e)}")
                    pass
        
        # 然后提取文档内容
        for item in all_items:
            item_type = item.get_type()
            is_document = False
            
            if hasattr(ebooklib_epub, 'ITEM_DOCUMENT'):
                is_document = item_type == ebooklib_epub.ITEM_DOCUMENT
            else:
                if isinstance(item_type, tuple):
                    is_document = item_type[0] == 9  # DOCUMENT = (9, 'DOCUMENT')
                elif isinstance(item_type, int):
                    is_document = item_type == 9
                else:
                    try:
                        item.get_content()
                        is_document = True
                    except:
                        is_document = False
            
            if is_document:
                try:
                    content = item.get_content()
                    html_text = content.decode('utf-8', errors='ignore')
                    
                    # 移除不需要的标签
                    html_text = re.sub(r'<head[^>]*>.*?</head>', '', html_text, flags=re.DOTALL | re.IGNORECASE)
                    html_text = re.sub(r'<script[^>]*>.*?</script>', '', html_text, flags=re.DOTALL | re.IGNORECASE)
                    html_text = re.sub(r'<style[^>]*>.*?</style>', '', html_text, flags=re.DOTALL | re.IGNORECASE)
                    html_text = re.sub(r'<meta[^>]*>', '', html_text, flags=re.IGNORECASE)
                    html_text = re.sub(r'<title[^>]*>.*?</title>', '', html_text, flags=re.DOTALL | re.IGNORECASE)
                    
                    # 替换图片路径 - 处理src中的任何引用图片的路径
                    def replace_src(match):
                        src = match.group(1)
                        # 获取文件名
                        img_filename = src.split('/')[-1].split('\\\\')[-1]
                        print(f"  处理图片src: {src} -> 文件名: {img_filename}, 映射表大小: {len(image_mapping)}")
                        # 检查是否在映射中
                        if img_filename in image_mapping:
                            new_url = image_mapping[img_filename]
                            print(f"  ✓ 映射到: {new_url}")
                            return f'src="{new_url}"'
                        else:
                            print(f"  ✗ 未找到映射")
                        return match.group(0)  # 保留原样
                    
                    # 替换所有src属性（多种格式）
                    # 格式1: src="..." 或 src='...'
                    html_text = re.sub(r'src\s*=\s*["\']([^"\']*)["\']', replace_src, html_text, flags=re.IGNORECASE)
                    # 格式2: src=... (没有引号)
                    html_text = re.sub(r'src\s*=\s*([^\s>]+)', replace_src, html_text, flags=re.IGNORECASE)
                    
                    html_text = html_text.strip()
                    if html_text:
                        text_content.append(html_text)
                except Exception as e:
                    print(f"✗ 提取文档内容失败: {str(e)}")
                    pass
    except Exception as e:
        raise Exception(f"EPUB提取错误: {str(e)}")
    
    print(f"✓ EPUB提取完成，找到 {len(image_mapping)} 张图片，{len(text_content)} 个文档")
    return '\n'.join(text_content)


def extract_text_from_txt(file_path: str) -> str:
    """从TXT文件读取文本"""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            return file.read()
    except UnicodeDecodeError:
        # 尝试其他编码
        with open(file_path, 'r', encoding='gbk') as file:
            return file.read()
    except Exception as e:
        raise Exception(f"TXT读取错误: {str(e)}")


def extract_text_from_doc(file_path: str) -> str:
    """从DOC/DOCX提取文本，尽量按页展示：遇到分页符时换页，否则按段落组合"""
    try:
        from docx import Document
        try:
            from docx.enum.text import WD_BREAK
        except Exception:
            WD_BREAK = None
    except ImportError:
        raise ImportError("python-docx not installed. Please install it: pip install python-docx")
    
    try:
        doc = Document(file_path)
        pages: list[list[str]] = [[]]
        for para in doc.paragraphs:
            text = para.text or ""
            # 检测段内是否含分页符
            has_page_break = False
            if WD_BREAK:
                for run in para.runs:
                    if getattr(run, "break_type", None) == WD_BREAK.PAGE:
                        has_page_break = True
                        break
            # 先记录当前段文本
            if text.strip():
                pages[-1].append(text)
            # 如有分页符，开启新页
            if has_page_break:
                pages.append([])
        # 收尾空页清理
        pages = [p for p in pages if any(seg.strip() for seg in p)] or [[]]

        pages_html = []
        total_pages = len(pages)
        for idx, page in enumerate(pages, 1):
            escaped = html.escape('\n'.join(page))
            page_html = (
                f'<div class="doc-page">'
                f'<div class="page-number">第 {idx} 页 / {total_pages}</div>'
                f'<pre>{escaped}</pre>'
                f'</div>'
            )
            pages_html.append(page_html)
        return '\n'.join(pages_html)
    except Exception as e:
        raise Exception(f"Word文档提取错误: {str(e)}")


def paginate_text(text: str, chars_per_page: int = 1500) -> List[str]:
    """将文本分页"""
    pages = []
    current_page = ""
    
    # 按段落分割
    paragraphs = text.split('\n')
    
    for para in paragraphs:
        if len(current_page) + len(para) + 1 > chars_per_page:
            if current_page:
                pages.append(current_page)
            current_page = para
        else:
            if current_page:
                current_page += '\n' + para
            else:
                current_page = para
    
    if current_page:
        pages.append(current_page)
    
    return pages if pages else [""]


def extract_words_from_text(text: str) -> List[str]:
    """从文本中提取单词（俄语）"""
    # 俄语单词模式：字母、数字、连字符、撇号
    pattern = r"[а-яА-ЯёЁ\w'-]+"
    words = re.findall(pattern, text.lower())
    return list(set(words))  # 去重


def count_total_words(text: str) -> int:
    """计算文本中的总词数（所有词汇，包括重复）
    
    规则：
    - 中文：按字符计数（汉字）
    - 俄文和其他：按空格分词
    """
    if not text:
        return 0
    
    # 统计中文字符（CJK）
    cjk_pattern = r"[\u4e00-\u9fff\u3400-\u4dbf]"  # 汉字范围
    cjk_chars = re.findall(cjk_pattern, text)
    cjk_count = len(cjk_chars)
    
    # 去除中文字符后的文本
    text_without_cjk = re.sub(cjk_pattern, " ", text)
    
    # 统计其他语言的词汇（按空格和标点分割）
    other_pattern = r"[а-яА-ЯёЁ\w'-]+"
    other_words = re.findall(other_pattern, text_without_cjk)
    other_count = len(other_words)
    
    return cjk_count + other_count


# --- Scoring helpers -------------------------------------------------------

def sequence_similarity(reference: str, hypothesis: str) -> Dict[str, Any]:
    from difflib import SequenceMatcher

    matcher = SequenceMatcher(None, reference.lower(), hypothesis.lower())
    similarity = round(matcher.ratio() * 100, 2)

    ref_tokens = reference.split()
    hyp_tokens = hypothesis.split()
    token_mismatches: List[Dict[str, Any]] = []
    max_len = max(len(ref_tokens), len(hyp_tokens))
    for i in range(max_len):
        ref_tok = ref_tokens[i] if i < len(ref_tokens) else None
        hyp_tok = hyp_tokens[i] if i < len(hyp_tokens) else None
        if ref_tok != hyp_tok:
            token_mismatches.append({"index": i, "reference": ref_tok, "hypothesis": hyp_tok})

    return {"similarity": similarity, "mismatches": token_mismatches}


# --- Routes ----------------------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "whisper": whisper is not None,
        "ffmpeg": check_ffmpeg(),
        "gpu": get_device() == "cuda",
        "device": get_device()
    })


@app.route("/api/user-data/size", methods=["GET"])
def get_user_data_size():
    """获取用户数据文件夹的详细大小统计"""
    try:
        stats = {
            "media": 0,      # 媒体文件
            "subtitles": 0,  # 字幕文件
            "vocab": 0,      # 生词本数据
            "playlists": 0,  # 播放列表数据
            "settings": 0,   # 设置数据
            "total": 0
        }
        
        print(f"[统计数据] user_data 路径: {USER_DATA_DIR}")
        print(f"[统计数据] user_data 存在: {USER_DATA_DIR.exists()}")
        
        if USER_DATA_DIR.exists():
            for subdir, size_key in [
                ("media", "media"),
                ("subtitles", "subtitles"),
                ("vocab", "vocab"),
                ("playlists", "playlists"),
                ("settings", "settings")
            ]:
                subdir_path = USER_DATA_DIR / subdir
                if subdir_path.exists():
                    for item in subdir_path.rglob("*"):
                        if item.is_file():
                            file_size = item.stat().st_size
                            stats[size_key] += file_size
                            print(f"[统计数据] {subdir}/{item.name}: {file_size} bytes")
            
            # 计算总大小
            stats["total"] = sum(v for k, v in stats.items() if k != "total")
        
        print(f"[统计数据] 最终统计: {stats}")
        
        # 转换为更友好的格式（bytes）
        return jsonify({
            "status": "success",
            "bytes": stats,
            "total_bytes": stats["total"],
            "total_kb": round(stats["total"] / 1024, 2)
        })
    except Exception as e:
        print(f"[统计数据] 错误: {e}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/api/transcribe/progress", methods=["GET"])
def get_transcribe_progress():
    """获取实时转录进度"""
    global _transcribe_progress
    return jsonify(_transcribe_progress)


@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    global _transcribe_progress
    if "audio" not in request.files:
        return jsonify({"error": "audio file missing"}), 400
    language = request.form.get("language")
    audio_file = request.files["audio"]

    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(audio_file.filename).suffix or ".wav") as tmp:
        audio_file.save(tmp.name)
        tmp_path = Path(tmp.name)

    try:
        _transcribe_progress = {"status": "开始转录...", "progress": 0}
        result = run_whisper_transcribe(tmp_path, language)
        _transcribe_progress = {"status": "完成", "progress": 100}
        return jsonify({**result, "status": "success"})
    except Exception as e:
        _transcribe_progress = {"status": "错误", "progress": 0, "error": str(e)}
        return jsonify({"status": "error", "error": str(e)}), 500
    finally:
        tmp_path.unlink(missing_ok=True)


@app.route("/api/score", methods=["POST"])
def score():
    payload = request.get_json(force=True)
    reference = payload.get("reference", "")
    hypothesis = payload.get("hypothesis", "")
    if not reference:
        return jsonify({"error": "reference text required"}), 400
    metrics = sequence_similarity(reference, hypothesis)
    return jsonify(metrics)


@app.route("/api/subtitles/generate", methods=["POST"])
def generate_subtitles():
    global _transcribe_progress
    
    # 支持两种方式：上传文件 或 使用已有的文件名
    audio_file = None
    tmp_path = None
    base_name = None
    
    if "audio" in request.files:
        # 方式1：直接上传音频文件
        audio_file = request.files["audio"]
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(audio_file.filename).suffix or ".wav") as tmp:
            audio_file.save(tmp.name)
            tmp_path = Path(tmp.name)
        base_name = Path(audio_file.filename).stem
    elif "filename" in request.form:
        # 方式2：使用已存在的文件名（从播放列表）
        filename = request.form.get("filename")
        
        # 尝试多个位置查找文件（播放列表中的文件在 user_data/media）
        possible_paths = [
            USER_DATA_DIR / "media" / filename,  # 播放列表中的媒体文件
            USER_DATA_DIR / filename,             # user_data 根目录
            Path("user_data") / "media" / filename,
            Path("user_data") / filename,
            Path("") / filename,  # 当前目录
        ]
        
        tmp_path = None
        for path in possible_paths:
            if path.exists():
                tmp_path = path
                break
        
        if tmp_path is None:
            return jsonify({"error": f"file not found: {filename}", "status": "error"}), 400
        
        base_name = Path(filename).stem
    else:
        return jsonify({"error": "audio file or filename missing", "status": "error"}), 400
    
    language = request.form.get("language")

    try:
        _transcribe_progress = {"status": "开始生成字幕...", "progress": 0}
        result = run_whisper_transcribe(tmp_path, language)
        subtitles = [
            {
                "start": seg.get("start", 0.0),
                "end": seg.get("end", 0.0),
                "en": seg.get("text", ""),
                "zh": "",
                "userEn": "",
                "userZh": "",
                "note": "",
            }
            for seg in result.get("segments", [])
        ]
        
        # 保存生成的字幕到媒体文件所在目录
        media_path = tmp_path.parent
        subtitle_path = media_path / f"{base_name}.json"
        subtitle_path.parent.mkdir(parents=True, exist_ok=True)
        with open(subtitle_path, "w", encoding="utf-8") as f:
            json.dump(subtitles, f, ensure_ascii=False, indent=2)
        print(f"✓ 字幕已保存: {subtitle_path}")
        
        _transcribe_progress = {"status": "完成", "progress": 100}
        return jsonify({"subtitles": subtitles, "raw": result.get("text", ""), "status": "success"})
    except Exception as e:
        _transcribe_progress = {"status": "错误", "progress": 0, "error": str(e)}
        return jsonify({"status": "error", "error": str(e), "subtitles": [], "raw": ""}), 500
    finally:
        # 只删除通过上传创建的临时文件
        if audio_file is not None and tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


@app.route("/api/subtitles/save", methods=["POST"])
def save_subtitles():
    """保存用户编辑的字幕"""
    try:
        payload = request.get_json(force=True)
        media_name = payload.get("mediaName", "untitled")
        subtitles = payload.get("subtitles", [])
        
        base_name = Path(media_name).stem
        
        # 尝试在多个位置查找媒体文件
        possible_paths = [
            USER_DATA_DIR / "media" / media_name,
            USER_DATA_DIR / media_name,
            Path("user_data") / "media" / media_name,
            Path("user_data") / media_name,
        ]
        
        media_path = None
        for path in possible_paths:
            if path.exists():
                media_path = path.parent
                break
        
        # 如果找不到媒体文件，默认保存到 media 目录
        if media_path is None:
            media_path = get_user_file_path("", "media")
        
        subtitle_path = media_path / f"{base_name}.json"
        subtitle_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(subtitle_path, "w", encoding="utf-8") as f:
            json.dump(subtitles, f, ensure_ascii=False, indent=2)
        
        return jsonify({"status": "success", "path": str(subtitle_path)})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/subtitles/scan", methods=["GET"])
def scan_subtitle_files():
    """扫描媒体文件所在目录的字幕文件"""
    try:
        media_name = request.args.get("media", "")
        if not media_name:
            return jsonify({"status": "error", "error": "media parameter required"}), 400
        
        from urllib.parse import unquote
        media_name = unquote(media_name)
        media_base = Path(media_name).stem
        
        # 尝试在多个位置查找媒体文件
        possible_paths = [
            USER_DATA_DIR / "media" / media_name,
            USER_DATA_DIR / media_name,
            Path("user_data") / "media" / media_name,
            Path("user_data") / media_name,
        ]
        
        media_path = None
        for path in possible_paths:
            if path.exists():
                media_path = path.parent
                break
        
        # 如果找不到媒体文件，使用 media 目录
        if media_path is None:
            media_path = get_user_file_path("", "media")
        
        if not media_path.exists():
            return jsonify({"status": "not_found", "files": []})
        
        found_files = []
        
        for item in media_path.iterdir():
            if item.is_file() and item.suffix.lower() in ['.srt', '.vtt', '.ass', '.ssa', '.json']:
                file_base = item.stem
                if file_base == media_base:
                    found_files.append({
                        "filename": item.name,
                        "format": item.suffix.lower()[1:],
                        "size": item.stat().st_size
                    })
        
        print(f"[DEBUG] scan_subtitle_files: media_name={media_name}, media_base={media_base}, media_path={media_path}, found_files={found_files}")
        return jsonify({"status": "success", "files": found_files})
    except Exception as e:
        print(f"[DEBUG] scan_subtitle_files error: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/subtitles/load-file/<path:filename>", methods=["GET"])
def load_subtitle_file(filename):
    """加载并解析媒体文件所在目录的字幕文件"""
    try:
        from urllib.parse import unquote
        filename = unquote(filename)
        
        # 尝试在多个位置查找媒体文件
        possible_paths = [
            USER_DATA_DIR / "media" / filename,
            USER_DATA_DIR / filename,
            Path("user_data") / "media" / filename,
            Path("user_data") / filename,
        ]
        
        subtitle_path = None
        for path in possible_paths:
            if path.exists():
                subtitle_path = path
                break
        
        # 如果找不到，尝试在 subtitles 目录查找（向后兼容）
        if subtitle_path is None or not subtitle_path.exists():
            subtitle_path = get_user_file_path(filename, "subtitles")
        
        if not subtitle_path.exists():
            return jsonify({"status": "not_found", "subtitles": []}), 404
        
        suffix = subtitle_path.suffix.lower()
        
        subtitles = []
        if suffix == '.json':
            with open(subtitle_path, "r", encoding="utf-8") as f:
                subtitles = json.load(f)
        elif suffix == '.srt':
            with open(subtitle_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            subtitles = parse_srt(content)
        elif suffix == '.vtt':
            with open(subtitle_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            subtitles = parse_vtt(content)
        elif suffix in ['.ass', '.ssa']:
            return jsonify({"status": "error", "error": "ASS/SSA format not supported yet"}), 400
        
        return jsonify({"status": "success", "subtitles": subtitles})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/subtitles/load/<path:filename>", methods=["GET"])
def load_subtitles(filename):
    """加载保存的字幕文件"""
    try:
        from urllib.parse import unquote
        filename = unquote(filename)
        base_name = Path(filename).stem
        
        # 尝试在多个位置查找媒体文件和字幕文件
        possible_paths = [
            USER_DATA_DIR / "media" / filename,
            USER_DATA_DIR / filename,
            Path("user_data") / "media" / filename,
            Path("user_data") / filename,
        ]
        
        subtitle_path = None
        for path in possible_paths:
            # 查找同目录下的字幕文件
            subtitle_path = path.parent / f"{base_name}.json"
            if subtitle_path.exists():
                break
        
        # 如果找不到，尝试在 subtitles 目录查找（向后兼容）
        if subtitle_path is None or not subtitle_path.exists():
            subtitle_path = get_user_file_path(f"{base_name}.json", "subtitles")
        
        if subtitle_path.exists():
            with open(subtitle_path, "r", encoding="utf-8") as f:
                subtitles = json.load(f)
            return jsonify({"status": "success", "subtitles": subtitles})
        else:
            return jsonify({"status": "not_found", "subtitles": []}), 404
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


def parse_srt(content: str) -> List[Dict[str, Any]]:
    """解析 SRT 格式字幕"""
    subtitles = []
    pattern = re.compile(r'(\d+)\s*\n(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*\n(.*?)(?=\n\n|\n\d+\s*\n|\Z)', re.DOTALL)
    
    for match in pattern.finditer(content):
        start = int(match.group(2)) * 3600 + int(match.group(3)) * 60 + int(match.group(4)) + int(match.group(5)) / 1000
        end = int(match.group(6)) * 3600 + int(match.group(7)) * 60 + int(match.group(8)) + int(match.group(9)) / 1000
        text = match.group(10).strip().replace('\n', ' ')
        
        subtitles.append({
            "start": start,
            "end": end,
            "text": text
        })
    
    return subtitles


def parse_vtt(content: str) -> List[Dict[str, Any]]:
    """解析 VTT 格式字幕"""
    subtitles = []
    lines = content.split('\n')
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        if '-->' in line:
            time_match = re.match(r'(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})', line)
            if not time_match:
                time_match = re.match(r'(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})', line)
            
            if time_match:
                groups = time_match.groups()
                if len(groups) == 8:
                    start = int(groups[0]) * 3600 + int(groups[1]) * 60 + int(groups[2]) + int(groups[3]) / 1000
                    end = int(groups[4]) * 3600 + int(groups[5]) * 60 + int(groups[6]) + int(groups[7]) / 1000
                else:
                    start = int(groups[0]) * 60 + int(groups[1]) + int(groups[2]) / 1000
                    end = int(groups[3]) * 60 + int(groups[4]) + int(groups[5]) / 1000
                
                i += 1
                text_lines = []
                while i < len(lines) and lines[i].strip() and not '-->' in lines[i]:
                    text_lines.append(lines[i].strip())
                    i += 1
                
                text = ' '.join(text_lines)
                if text:
                    subtitles.append({
                        "start": start,
                        "end": end,
                        "text": text
                    })
            else:
                i += 1
        else:
            i += 1
    
    return subtitles


@app.route("/api/media/upload", methods=["POST"])
def upload_media():
    """上传媒体文件到服务器"""
    try:
        if "media" not in request.files:
            return jsonify({"error": "media file missing", "status": "error"}), 400
        
        media_file = request.files["media"]
        if not media_file.filename:
            return jsonify({"error": "no filename", "status": "error"}), 400
        
        # 获取路径参数
        path = request.form.get("path", "")
        
        # 构建完整的保存路径
        if path:
            # 确保路径以 '/' 结尾
            if not path.endswith('/'):
                path += '/'
            # 保存到 user_data/media/[path] 文件夹
            media_path = get_user_file_path(path + media_file.filename, "media")
        else:
            # 保存到 user_data/media 根文件夹
            media_path = get_user_file_path(media_file.filename, "media")
        
        # 确保目录存在
        media_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 保存文件
        media_file.save(str(media_path))
        
        # 构建返回的文件名（包含路径）
        if path:
            return_filename = path + media_file.filename
        else:
            return_filename = media_file.filename
        
        return jsonify({
            "status": "success",
            "path": str(media_path),
            "filename": return_filename
        })
    except Exception as e:
        # 打印详细错误以便前端提示
        print(f"[upload_media] error: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/media/load/<path:filename>", methods=["GET"])
def load_media(filename):
    """从服务器加载媒体文件"""
    try:
        from urllib.parse import unquote
        filename = unquote(filename)
        media_path = get_user_file_path(filename, "media")
        
        if media_path.exists():
            return send_from_directory(
                media_path.parent,
                media_path.name,
                as_attachment=False
            )
        else:
            return jsonify({"status": "not_found"}), 404
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/media/scan", methods=["GET"])
def scan_media_files():
    """扫描本地媒体文件和文件夹的变化"""
    print("[DEBUG] scan_media_files endpoint called")
    try:
        media_dir = get_user_file_path("", "media")
        print(f"[DEBUG] Media directory: {media_dir}")
        print(f"[DEBUG] Media directory exists: {media_dir.exists()}")
        if not media_dir.exists():
            return jsonify({"status": "success", "files": [], "folders": []})
        
        files = []
        folders = []
        
        # 递归扫描目录
        def scan_directory(path, relative_path=""):
            for item in path.iterdir():
                if item.is_dir():
                    folder_path = relative_path + item.name + "/"
                    folders.append(folder_path)
                    scan_directory(item, folder_path)
                else:
                    file_path = relative_path + item.name
                    files.append({
                        "path": file_path,
                        "size": item.stat().st_size,
                        "mtime": item.stat().st_mtime
                    })
        
        scan_directory(media_dir)
        print(f"[DEBUG] Found {len(files)} files and {len(folders)} folders")
        
        return jsonify({
            "status": "success",
            "files": files,
            "folders": folders
        })
    except Exception as e:
        print(f"[DEBUG] Error in scan_media_files: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/media/clear", methods=["POST"])
def clear_media():
    """清空媒体文件夹"""
    try:
        media_dir = get_user_file_path("", "media")
        
        if not media_dir.exists():
            return jsonify({"status": "success"})
        
        # 递归删除所有内容
        import shutil
        for item in media_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(str(item))
            else:
                item.unlink()
        
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/media/delete", methods=["POST"])
def delete_media():
    """删除指定的媒体文件或文件夹"""
    try:
        payload = request.get_json()
        filename = payload.get("filename")
        
        if not filename:
            return jsonify({"status": "error", "error": "文件名不能为空"}), 400
        
        media_dir = get_user_file_path("", "media")
        file_path = media_dir / filename
        
        if not file_path.exists():
            return jsonify({"status": "error", "error": "文件不存在"}), 404
        
        import shutil
        if file_path.is_dir():
            shutil.rmtree(str(file_path))
        else:
            file_path.unlink()
        
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/vocab/save", methods=["POST"])
def save_vocab():
    """保存生词本数据到文件（旧版API，保留兼容性）"""
    try:
        payload = request.get_json(force=True)
        vocab = payload.get("vocab", [])
        
        vocab_path = get_user_file_path("vocab.json", "vocab")
        
        with open(vocab_path, "w", encoding="utf-8") as f:
            json.dump(vocab, f, ensure_ascii=False, indent=2)
        
        return jsonify({"status": "success", "path": str(vocab_path)})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/vocab/load", methods=["GET"])
def load_vocab():
    """加载保存的生词本数据（旧版API，保留兼容性）"""
    try:
        vocab_path = get_user_file_path("vocab.json", "vocab")
        
        if vocab_path.exists():
            with open(vocab_path, "r", encoding="utf-8") as f:
                vocab = json.load(f)
            return jsonify({"status": "success", "vocab": vocab})
        else:
            return jsonify({"status": "success", "vocab": []})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e), "vocab": []}), 500


@app.route("/api/vocabbooks/save", methods=["POST"])
def save_vocabbooks():
    """保存多个生词本数据到文件"""
    try:
        payload = request.get_json(force=True)
        vocabbooks = payload.get("vocabBooks", [])
        current_id = payload.get("currentVocabBookId", None)
        
        # 保存生词本数据
        vocabbooks_path = get_user_file_path("vocabbooks.json", "vocab")
        with open(vocabbooks_path, "w", encoding="utf-8") as f:
            json.dump({
                "vocabBooks": vocabbooks,
                "currentVocabBookId": current_id
            }, f, ensure_ascii=False, indent=2)
        
        return jsonify({"status": "success", "path": str(vocabbooks_path)})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/vocabbooks/load", methods=["GET"])
def load_vocabbooks():
    """加载保存的多个生词本数据"""
    try:
        vocabbooks_path = get_user_file_path("vocabbooks.json", "vocab")
        
        if vocabbooks_path.exists():
            with open(vocabbooks_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return jsonify({
                "status": "success",
                "vocabBooks": data.get("vocabBooks", []),
                "currentVocabBookId": data.get("currentVocabBookId", None)
            })
        else:
            return jsonify({
                "status": "success",
                "vocabBooks": [],
                "currentVocabBookId": None
            })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e), "vocabBooks": [], "currentVocabBookId": None}), 500





@app.route("/api/settings/save", methods=["POST"])
def save_settings():
    """保存用户设置到文件"""
    try:
        payload = request.get_json(force=True)
        settings = payload.get("settings", {})
        
        settings_path = get_user_file_path("settings.json", "settings")
        with open(settings_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        
        return jsonify({"status": "success", "path": str(settings_path)})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/settings/load", methods=["GET"])
def load_settings():
    """加载保存的用户设置"""
    try:
        settings_path = get_user_file_path("settings.json", "settings")
        
        if settings_path.exists():
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
            return jsonify({"status": "success", "settings": settings})
        else:
            return jsonify({"status": "success", "settings": {}})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e), "settings": {}}), 500


@app.route("/api/playlist/save", methods=["POST"])
def save_playlist():
    """保存播放列表到文件"""
    try:
        payload = request.get_json(force=True)
        playlist = payload.get("playlist", [])
        current_index = payload.get("currentPlaylistIndex", -1)
        
        playlist_data = {
            "playlist": playlist,
            "currentPlaylistIndex": current_index
        }
        
        playlist_path = get_user_file_path("playlist.json", "settings")
        with open(playlist_path, "w", encoding="utf-8") as f:
            json.dump(playlist_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({"status": "success", "path": str(playlist_path)})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/playlist/load", methods=["GET"])
def load_playlist():
    """加载保存的播放列表"""
    try:
        playlist_path = get_user_file_path("playlist.json", "settings")
        
        if playlist_path.exists():
            with open(playlist_path, "r", encoding="utf-8") as f:
                playlist_data = json.load(f)
            return jsonify({
                "status": "success",
                "playlist": playlist_data.get("playlist", []),
                "currentPlaylistIndex": playlist_data.get("currentPlaylistIndex", -1)
            })
        else:
            return jsonify({
                "status": "success",
                "playlist": [],
                "currentPlaylistIndex": -1
            })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e), "playlist": [], "currentPlaylistIndex": -1}), 500


@app.route("/api/playlist/create-folder", methods=["POST"])
def create_playlist_folder():
    """创建播放列表文件夹"""
    try:
        import json
        
        # 直接使用 request.get_json()，Flask 会自动处理编码
        payload = request.get_json()
        folder_name = payload.get("folder_name")
        
        print(f"[create_folder] 收到的文件夹名称: {folder_name}, 类型: {type(folder_name)}")
        print(f"[create_folder] 文件夹名称编码: {folder_name.encode('utf-8') if folder_name else None}")
        
        if not folder_name:
            return jsonify({"status": "error", "error": "文件夹名称不能为空"}), 400
        
        import os
        base_dir = get_user_file_path("", "media")
        folder_path = os.path.join(str(base_dir), folder_name)
        
        print(f"[create_folder] 完整路径: {folder_path}")
        print(f"[create_folder] 路径编码: {folder_path.encode('utf-8')}")
        
        if os.path.exists(folder_path):
            return jsonify({"status": "error", "error": "文件夹已存在"}), 400
        
        os.makedirs(folder_path, exist_ok=True)
        
        print(f"[create_folder] 文件夹创建成功: {folder_name}")
        
        return jsonify({
            "status": "success",
            "folder_path": folder_name
        })
    except Exception as e:
        print(f"[create_folder] 错误: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/playlist/move-item", methods=["POST"])
def move_playlist_item():
    """移动播放列表项到文件夹"""
    try:
        payload = request.get_json(force=True)
        source_name = payload.get("source_name")
        target_folder = payload.get("target_folder")
        
        if not source_name:
            return jsonify({"status": "error", "error": "源文件名不能为空"}), 400
        
        if not target_folder:
            return jsonify({"status": "error", "error": "目标文件夹不能为空"}), 400
        
        base_dir = get_user_file_path("", "media")
        source_path = base_dir / source_name
        target_path = base_dir / target_folder / source_name.split("/")[-1]
        
        if not source_path.exists():
            return jsonify({"status": "error", "error": "源文件不存在"}), 404
        
        if not target_path.parent.exists():
            return jsonify({"status": "error", "error": "目标文件夹不存在"}), 404
        
        # 移动文件或文件夹
        import shutil
        if source_path.is_dir():
            shutil.move(str(source_path), str(target_path))
        else:
            shutil.move(str(source_path), str(target_path))
        
        return jsonify({
            "status": "success",
            "source": source_name,
            "target": f"{target_folder}/{source_name.split('/')[-1]}"
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/playlist/delete-folder", methods=["POST"])
def delete_playlist_folder():
    """删除播放列表文件夹"""
    try:
        payload = request.get_json(force=True)
        folder_name = payload.get("folder_name")
        
        if not folder_name:
            return jsonify({"status": "error", "error": "文件夹名称不能为空"}), 400
        
        base_dir = get_user_file_path("", "media")
        folder_path = base_dir / folder_name
        
        if not folder_path.exists():
            return jsonify({"status": "error", "error": "文件夹不存在"}), 404
        
        # 递归删除文件夹
        import shutil
        shutil.rmtree(str(folder_path))
        
        return jsonify({
            "status": "success",
            "folder_name": folder_name
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/playlist/rename-folder", methods=["POST"])
def rename_playlist_folder():
    """重命名播放列表文件夹"""
    try:
        payload = request.get_json(force=True)
        old_name = payload.get("old_name")
        new_name = payload.get("new_name")
        
        if not old_name:
            return jsonify({"status": "error", "error": "旧文件夹名称不能为空"}), 400
        
        if not new_name:
            return jsonify({"status": "error", "error": "新文件夹名称不能为空"}), 400
        
        base_dir = get_user_file_path("", "media")
        old_path = base_dir / old_name
        new_path = base_dir / new_name
        
        if not old_path.exists():
            return jsonify({"status": "error", "error": "文件夹不存在"}), 404
        
        if new_path.exists():
            return jsonify({"status": "error", "error": "文件夹已存在"}), 400
        
        old_path.rename(new_path)
        
        return jsonify({
            "status": "success",
            "old_name": old_name,
            "new_name": new_name
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/playlist/scan", methods=["GET"])
def scan_playlist():
    """扫描播放列表文件夹结构"""
    try:
        media_dir = get_user_file_path("", "media")
        
        if not media_dir.exists():
            return jsonify({
                "status": "success",
                "playlist": []
            })
        
        playlist = []
        
        # 递归扫描目录
        def scan_directory(path, relative_path=""):
            for item in path.iterdir():
                item_name = item.name
                item_relative_path = relative_path + item_name
                
                if item.is_dir():
                    # 添加文件夹
                    playlist.append({
                        "name": item_relative_path + "/",
                        "type": "folder",
                        "url": None,
                        "serverPath": item_relative_path + "/"
                    })
                    # 递归扫描子文件夹
                    scan_directory(item, item_relative_path + "/")
                else:
                    # 添加文件
                    playlist.append({
                        "name": item_relative_path,
                        "type": "file",
                        "url": None,
                        "serverPath": item_relative_path
                    })
        
        scan_directory(media_dir)
        
        return jsonify({
            "status": "success",
            "playlist": playlist
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e), "playlist": []}), 500


# --- Reading Module Routes --------------------------------------------------


@app.route("/api/reading/test-pdf", methods=["GET"])
def test_pdf_endpoint():
    """测试endpoint - 返回简单响应"""
    print("[test_pdf_endpoint] 被调用")
    return jsonify({"status": "ok", "message": "Test endpoint working"})

@app.route("/api/reading/raw/<path:doc_id>", methods=["GET", "HEAD"])
def serve_raw_document(doc_id):
    """返回原始文件或转换后的PDF，供前端原样展示"""
    try:
        import time
        start_time = time.time()
        from urllib.parse import unquote, quote
        
        # URL解码文件名
        doc_id = unquote(doc_id)
        print(f"[serve_raw_document] 开始处理 doc_id: {doc_id}", flush=True)
        
        doc_index_path = get_user_file_path("documents.json", "readings")
        documents = {}
        if doc_index_path.exists():
            with open(doc_index_path, 'r', encoding='utf-8') as f:
                documents = json.load(f)
        print(f"[serve_raw_document] 已加载documents.json, 共{len(documents)}个文档")

        # 尝试精确匹配
        if doc_id not in documents:
            # 尝试不区分大小写匹配
            doc_id_lower = doc_id.lower()
            for key in documents.keys():
                if key.lower() == doc_id_lower:
                    doc_id = key
                    break
            else:
                print(f"[serve_raw_document] ❌ 文档不存在: {doc_id}")
                return jsonify({"status": "error", "error": f"文档不存在: {doc_id}"}), 404

        meta = documents[doc_id]
        filename = meta.get("filename", doc_id)
        ext = meta.get("ext", "")  
        converted_pdf = meta.get("converted_pdf")
        print(f"[serve_raw_document] 找到文档: filename={filename}, ext={ext}")

        base_dir = get_user_file_path("", "readings")

        # 优先使用转换后的PDF（用于Word保持样式）
        if converted_pdf:
            pdf_path = Path(converted_pdf)
            if pdf_path.exists():
                print(f"[serve_raw_document] 使用转换后的PDF: {pdf_path}")
                response = send_file(
                    pdf_path, 
                    mimetype="application/pdf",
                    as_attachment=False,
                    conditional=True  # 启用条件请求（If-Modified-Since等）
                )
                response.headers["Accept-Ranges"] = "bytes"
                # 移除Content-Disposition以避免触发下载
                response.headers.pop("Content-Disposition", None)
                return response

        # 否则返回原文件
        folder = meta.get("folder", "")
        file_path = base_dir / folder / filename
        if not file_path.exists():
            # 尝试在根目录查找（兼容旧数据）
            file_path = base_dir / filename
            if not file_path.exists():
                print(f"[serve_raw_document] ❌ 文件不存在: {file_path}")
                return jsonify({"status": "error", "error": "文件已丢失"}), 404

        file_size = file_path.stat().st_size
        print(f"[serve_raw_document] 文件路径: {file_path}")
        print(f"[serve_raw_document] 文件大小: {file_size} bytes ({file_size/1024/1024:.2f} MB)")

        guessed_type, _ = mimetypes.guess_type(file_path)
        # 如果无法猜测MIME类型，根据扩展名手动设置
        if not guessed_type:
            ext_lower = Path(file_path).suffix.lower()
            mime_map = {
                '.pdf': 'application/pdf',
                '.epub': 'application/epub+zip',
                '.txt': 'text/plain; charset=utf-8',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.doc': 'application/msword'
            }
            guessed_type = mime_map.get(ext_lower, 'application/octet-stream')
        
        print(f"[serve_raw_document] MIME type: {guessed_type}")
        
        # 对大文件使用流式传输
        if file_size > 1024 * 1024:  # > 1MB
            print(f"[serve_raw_document] 使用流式传输（文件>1MB）")
            
        response = send_file(
            file_path, 
            mimetype=guessed_type, 
            as_attachment=False,
            conditional=True,  # 支持HTTP条件请求
            max_age=0  # 禁用缓存
        )
        response.headers["Accept-Ranges"] = "bytes"
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        # 移除Content-Disposition以避免触发下载
        response.headers.pop("Content-Disposition", None)
        
        elapsed = time.time() - start_time
        print(f"[serve_raw_document] ✅ 完成, 耗时 {elapsed:.2f}s")

        return response
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/upload-document", methods=["POST"])
def upload_document():
    """上传并解析文档（PDF, EPUB, TXT, DOC）"""
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "error": "没有上传文件"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"status": "error", "error": "文件名为空"}), 400
        
        # 获取目标文件夹（如果有）
        folder = request.form.get("folder", "")
        
        # 保存临时文件
        temp_dir = get_user_file_path("", "readings")
        temp_dir.mkdir(exist_ok=True)
        
        file_ext = Path(file.filename).suffix.lower()
        temp_path = temp_dir / f"temp_{os.urandom(8).hex()}{file_ext}"
        file.save(str(temp_path))
        
        print(f"📄 Processing document: {file.filename}")
        
        # 根据文件类型提取文本
        text = ""
        if file_ext == ".pdf":
            text = extract_text_from_pdf(str(temp_path))
        elif file_ext == ".epub":
            text = extract_text_from_epub(str(temp_path))
        elif file_ext in [".txt"]:
            text = extract_text_from_txt(str(temp_path))
        elif file_ext == ".md":
            # Markdown 文件直接读取为文本（前端用 marked.js 解析）
            with open(temp_path, 'r', encoding='utf-8') as f:
                text = f.read()
        elif file_ext in [".doc", ".docx"]:
            text = extract_text_from_doc(str(temp_path))
        else:
            return jsonify({"status": "error", "error": f"不支持的文件格式: {file_ext}"}), 400
        
        # 不再自动分页，保存完整文本
        # 如果需要，前端可以根据滚动位置计算阅读进度
        
        # 生成doc_id
        doc_id = file.filename.replace(' ', '_').replace('.', '_')

        # 保存文档到指定文件夹
        base_dir = get_user_file_path("", "readings")
        target_dir = base_dir / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        
        # 移动文件到目标文件夹
        final_file_path = target_dir / file.filename
        temp_path.rename(final_file_path)

        # 若为 Word，尝试转换为 PDF 以保留样式（需 docx2pdf，可能在无 Office 环境下失败）
        converted_pdf_path = None
        if file_ext in [".doc", ".docx"]:
            try:
                from docx2pdf import convert  # type: ignore
                out_pdf = get_user_file_path(f"{doc_id}.pdf", "readings")
                convert(str(final_file_path), str(out_pdf))
                if out_pdf.exists():
                    converted_pdf_path = out_pdf
                    print(f"✓ Word 转 PDF 成功: {out_pdf}")
            except Exception as conv_err:
                print(f"✗ Word 转 PDF 失败，使用文本提取: {conv_err}")

        # 保存文档元数据
        total_words = count_total_words(text)
        doc_metadata = {
            "filename": file.filename,
            "folder": folder,
            "size": len(text),
            "char_count": len(text),
            "total_words": total_words,
            "upload_time": str(final_file_path.stat().st_mtime),
            "ext": file_ext,
            "converted_pdf": str(converted_pdf_path) if converted_pdf_path else None
        }
        
        # 保存到JSON
        doc_index_path = get_user_file_path("documents.json", "readings")
        documents = {}
        if doc_index_path.exists():
            with open(doc_index_path, 'r', encoding='utf-8') as f:
                documents = json.load(f)
        
        documents[doc_id] = doc_metadata
        
        with open(doc_index_path, 'w', encoding='utf-8') as f:
            json.dump(documents, f, ensure_ascii=False, indent=2)
        
        # 保存完整文本内容（用于检索/统计；展示仍使用原文件或转换后的PDF）
        content_path = get_user_file_path(f"{doc_id}_content.json", "readings")
        with open(content_path, 'w', encoding='utf-8') as f:
            json.dump({"text": text}, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            "status": "success",
            "doc_id": doc_id,
            "filename": file.filename,
            "folder": folder,
            "char_count": len(text),
            "total_words": total_words,
            "size": len(text),
            "sample": text[:500],  # 返回前500字作为预览
            "view_url": f"/api/reading/raw/{doc_id}"
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/load-document/<doc_id>", methods=["GET"])
def load_document(doc_id):
    """加载指定文档的内容"""
    try:
        content_path = get_user_file_path(f"{doc_id}_content.json", "readings")
        doc_index_path = get_user_file_path("documents.json", "readings")
        documents = {}
        if doc_index_path.exists():
            with open(doc_index_path, 'r', encoding='utf-8') as f:
                documents = json.load(f)
        
        if not content_path.exists():
            return jsonify({"status": "error", "error": "文档不存在"}), 404
        
        with open(content_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        text = data.get("text", "")
        
        # 计算总词数
        total_words = count_total_words(text)
        
        return jsonify({
            "status": "success",
            "text": text,
            "char_count": len(text),
            "total_words": total_words,
            "view_url": f"/api/reading/raw/{doc_id}",
            "metadata": documents.get(doc_id, {})
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/image/<epub_hash>/<filename>", methods=["GET"])
def serve_epub_image(epub_hash, filename):
    """提供EPUB提取的图片访问"""
    try:
        print(f"DEBUG: 收到图片请求: epub_hash={epub_hash}, filename={filename}")
        
        # 构建图片路径
        image_path = USER_DATA_DIR / "readings" / "reading_images" / epub_hash / filename
        print(f"DEBUG: 图片路径: {image_path}")
        
        if not image_path.exists():
            print(f"DEBUG: 图片不存在: {image_path}")
            return jsonify({"status": "error", "error": "图片不存在"}), 404
        
        # 猜测MIME类型
        guessed_type, _ = mimetypes.guess_type(str(image_path))
        if not guessed_type:
            guessed_type = "application/octet-stream"
        print(f"DEBUG: MIME类型: {guessed_type}")
        
        return send_file(
            image_path,
            mimetype=guessed_type,
            as_attachment=False
        )
    except Exception as e:
        print(f"DEBUG: 图片服务错误: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/delete-document/<doc_id>", methods=["DELETE"])
def delete_document(doc_id):
    """删除指定文档及其相关文件（内容、笔记、原文件、提取图片、转换后的PDF）"""
    try:
        import hashlib

        doc_index_path = get_user_file_path("documents.json", "readings")
        documents = {}
        if doc_index_path.exists():
            with open(doc_index_path, 'r', encoding='utf-8') as f:
                documents = json.load(f)

        if doc_id not in documents:
            return jsonify({"status": "error", "error": "文档不存在"}), 404

        filename = documents[doc_id].get("filename", doc_id)
        converted_pdf = documents[doc_id].get("converted_pdf")

        # 从索引中移除并保存
        documents.pop(doc_id, None)
        with open(doc_index_path, 'w', encoding='utf-8') as f:
            json.dump(documents, f, ensure_ascii=False, indent=2)

        removed_files = []

        def remove_path(path: Path):
            if path.exists():
                try:
                    if path.is_dir():
                        shutil.rmtree(path, ignore_errors=True)
                    else:
                        path.unlink()
                    removed_files.append(str(path))
                except Exception:
                    pass

        base_dir = get_user_file_path("", "readings")
        folder = documents[doc_id].get("folder", "")
        file_path = base_dir / folder / filename

        # 相关文件路径
        content_path = get_user_file_path(f"{doc_id}_content.json", "readings")
        notes_path = get_user_file_path(f"{doc_id}_notes.json", "readings")
        converted_pdf_path = Path(converted_pdf) if converted_pdf else None

        # EPUB 图片目录（与提取时一致的 hash 规则）
        epub_hash = hashlib.md5(str(file_path).encode()).hexdigest()[:8]
        images_dir = USER_DATA_DIR / "readings" / "reading_images" / epub_hash

        # 删除文件/目录
        for p in [file_path, content_path, notes_path, images_dir, converted_pdf_path]:
            if p:
                remove_path(Path(p))

        return jsonify({
            "status": "success",
            "removed": removed_files
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/documents", methods=["GET"])
def list_documents():
    """列出所有已加载的文档"""
    try:
        doc_index_path = get_user_file_path("documents.json", "readings")
        
        documents = {}
        if doc_index_path.exists():
            with open(doc_index_path, 'r', encoding='utf-8') as f:
                documents = json.load(f)
        
        return jsonify({
            "status": "success",
            "documents": documents
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/create-folder", methods=["POST"])
def create_folder():
    """创建新文件夹"""
    try:
        payload = request.get_json(force=True)
        folder_name = payload.get("folder_name")
        parent_path = payload.get("parent_path", "")
        
        if not folder_name:
            return jsonify({"status": "error", "error": "文件夹名称不能为空"}), 400
        
        base_dir = get_user_file_path("", "readings")
        folder_path = base_dir / parent_path / folder_name
        
        if folder_path.exists():
            return jsonify({"status": "error", "error": "文件夹已存在"}), 400
        
        folder_path.mkdir(parents=True, exist_ok=True)
        
        return jsonify({
            "status": "success",
            "folder_path": str(folder_path.relative_to(base_dir))
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/delete-folder", methods=["POST"])
def delete_folder():
    """删除文件夹"""
    try:
        payload = request.get_json(force=True)
        folder_path = payload.get("folder_path")
        
        if not folder_path:
            return jsonify({"status": "error", "error": "文件夹路径不能为空"}), 400
        
        base_dir = get_user_file_path("", "readings")
        folder_full_path = base_dir / folder_path
        
        if not folder_full_path.exists() or not folder_full_path.is_dir():
            return jsonify({"status": "error", "error": "文件夹不存在"}), 404
        
        import shutil
        shutil.rmtree(folder_full_path)
        
        return jsonify({
            "status": "success",
            "message": "文件夹删除成功"
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/rename-folder", methods=["POST"])
def rename_folder():
    """重命名文件夹"""
    try:
        payload = request.get_json(force=True)
        old_path = payload.get("old_path")
        new_name = payload.get("new_name")
        
        if not old_path or not new_name:
            return jsonify({"status": "error", "error": "参数不能为空"}), 400
        
        base_dir = get_user_file_path("", "readings")
        old_full_path = base_dir / old_path
        new_full_path = old_full_path.parent / new_name
        
        if not old_full_path.exists() or not old_full_path.is_dir():
            return jsonify({"status": "error", "error": "文件夹不存在"}), 404
        
        if new_full_path.exists():
            return jsonify({"status": "error", "error": "新名称已存在"}), 400
        
        old_full_path.rename(new_full_path)
        
        return jsonify({
            "status": "success",
            "new_path": str(new_full_path.relative_to(base_dir))
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/list-folders", methods=["GET"])
def list_folders():
    """列出所有文件夹"""
    try:
        base_dir = get_user_file_path("", "readings")
        
        folders = []
        for root, dirs, files in os.walk(base_dir):
            for dir_name in dirs:
                folder_path = Path(root) / dir_name
                relative_path = str(folder_path.relative_to(base_dir))
                folders.append({
                    "path": relative_path,
                    "name": dir_name
                })
        
        return jsonify({
            "status": "success",
            "folders": folders
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/move-document", methods=["POST"])
def move_document():
    """移动文档到指定文件夹"""
    try:
        payload = request.get_json(force=True)
        doc_id = payload.get("doc_id")
        target_folder = payload.get("target_folder")
        
        if not doc_id or not target_folder:
            return jsonify({"status": "error", "error": "参数不能为空"}), 400
        
        # 加载文档索引
        doc_index_path = get_user_file_path("documents.json", "readings")
        documents = {}
        if doc_index_path.exists():
            with open(doc_index_path, 'r', encoding='utf-8') as f:
                documents = json.load(f)
        
        if doc_id not in documents:
            return jsonify({"status": "error", "error": "文档不存在"}), 404
        
        # 获取文档信息
        doc_info = documents[doc_id]
        filename = doc_info.get("filename")
        
        # 移动文件
        base_dir = get_user_file_path("", "readings")
        old_file_path = base_dir / filename
        new_file_path = base_dir / target_folder / filename
        
        if not old_file_path.exists():
            return jsonify({"status": "error", "error": "文件不存在"}), 404
        
        # 确保目标文件夹存在
        new_file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 移动文件
        old_file_path.rename(new_file_path)
        
        # 更新文档索引中的路径信息
        doc_info["folder"] = target_folder
        
        with open(doc_index_path, 'w', encoding='utf-8') as f:
            json.dump(documents, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            "status": "success",
            "message": "文档移动成功"
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/save-notes/<doc_id>", methods=["POST"])
def save_reading_notes(doc_id):
    """保存阅读笔记"""
    try:
        payload = request.get_json(force=True)
        notes = payload.get("notes", [])
        
        notes_path = get_user_file_path(f"{doc_id}_notes.json", "readings")
        with open(notes_path, 'w', encoding='utf-8') as f:
            json.dump(notes, f, ensure_ascii=False, indent=2)
        
        return jsonify({"status": "success", "path": str(notes_path)})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/load-notes/<doc_id>", methods=["GET"])
def load_reading_notes(doc_id):
    """加载阅读笔记"""
    try:
        notes_path = get_user_file_path(f"{doc_id}_notes.json", "readings")
        
        notes = []
        if notes_path.exists():
            with open(notes_path, 'r', encoding='utf-8') as f:
                notes = json.load(f)
        
        return jsonify({
            "status": "success",
            "notes": notes
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/extract-words/<doc_id>", methods=["GET"])
def extract_document_words(doc_id):
    """从文档中提取词汇并计算统计信息"""
    try:
        content_path = get_user_file_path(f"{doc_id}_content.json", "readings")
        
        if not content_path.exists():
            return jsonify({"status": "error", "error": "文档不存在"}), 404
        
        with open(content_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        text = data.get("text", "")
        words = extract_words_from_text(text)
        
        # 计算词频
        word_count = {}
        for word in words:
            word_count[word] = text.lower().count(word)
        
        # 按频率排序
        sorted_words = sorted(word_count.items(), key=lambda x: x[1], reverse=True)
        
        # 计算总词数
        total_words = count_total_words(text)
        
        return jsonify({
            "status": "success",
            "words": [{"word": w, "count": c} for w, c in sorted_words[:100]],
            "total_unique": len(words),
            "total_words": total_words,
            "text_length": len(text)
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/reading/search/<doc_id>", methods=["POST"])
def search_in_document(doc_id):
    """在文档中搜索文本"""
    try:
        payload = request.get_json(force=True)
        query = payload.get("query", "").lower()
        
        if not query:
            return jsonify({"status": "error", "error": "搜索词为空"}), 400
        
        content_path = get_user_file_path(f"{doc_id}_content.json", "readings")
        
        if not content_path.exists():
            return jsonify({"status": "error", "error": "文档不存在"}), 404
        
        with open(content_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        text = data.get("text", "")
        text_lower = text.lower()
        
        results = []
        pos = 0
        while True:
            idx = text_lower.find(query, pos)
            if idx == -1:
                break
            
            # 获取上下文
            context_start = max(0, idx - 50)
            context_end = min(len(text), idx + len(query) + 50)
            context = text[context_start:context_end]
            
            # 计算字符位置百分比
            char_percent = round((idx / len(text)) * 100) if len(text) > 0 else 0
            
            results.append({
                "position": idx,
                "char_percent": char_percent,
                "context": context
            })
            pos = idx + 1
        
        return jsonify({
            "status": "success",
            "query": query,
            "results": results,
            "count": len(results)
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


# ============================================================================
# PDF缓存API - 保存和加载PDF渲染数据，避免重复渲染
# ============================================================================

PDF_CACHE_DIR = Path(__file__).parent.parent / "user_data" / "pdf_cache"

def get_pdf_cache_path(pdf_filename: str) -> Path:
    """获取PDF缓存文件路径"""
    PDF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # 使用PDF文件名（去除路径）作为缓存文件名
    cache_filename = Path(pdf_filename).stem + ".cache.json"
    return PDF_CACHE_DIR / cache_filename


@app.route("/api/pdf-cache/save", methods=["POST"])
def save_pdf_cache():
    """保存PDF渲染数据到缓存
    
    请求体:
    {
        "pdfFilename": "example.pdf",  # PDF文件名（用于识别缓存）
        "currentPage": 5,               # 当前页码
        "scale": 1.2,                   # 缩放级别（数字或'auto', 'fit-width', 'fit-page'）
        "scrollTop": 1024,              # 滚动位置
        "displayMode": "continuous"     # 显示模式
    }
    """
    try:
        data = request.get_json()
        pdf_filename = data.get("pdfFilename", "")
        
        if not pdf_filename:
            return jsonify({"status": "error", "message": "pdfFilename is required"}), 400
        
        cache_path = get_pdf_cache_path(pdf_filename)
        
        # 准备缓存数据
        cache_data = {
            "pdfFilename": pdf_filename,
            "currentPage": data.get("currentPage", 1),
            "scale": data.get("scale", "auto"),
            "scrollTop": data.get("scrollTop", 0),
            "displayMode": data.get("displayMode", "continuous"),
            "timestamp": int(__import__("time").time() * 1000)  # 毫秒时间戳
        }
        
        # 写入缓存文件
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            "status": "success",
            "message": f"PDF cache saved for {pdf_filename}",
            "cachePath": str(cache_path)
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/pdf-cache/load", methods=["POST"])
def load_pdf_cache():
    """加载PDF渲染缓存
    
    请求体:
    {
        "pdfFilename": "example.pdf"
    }
    
    返回缓存的页面、缩放、滚动位置等信息
    """
    try:
        data = request.get_json()
        pdf_filename = data.get("pdfFilename", "")
        
        if not pdf_filename:
            return jsonify({"status": "error", "message": "pdfFilename is required"}), 400
        
        cache_path = get_pdf_cache_path(pdf_filename)
        
        # 如果缓存存在，读取并返回
        if cache_path.exists():
            with open(cache_path, "r", encoding="utf-8") as f:
                cache_data = json.load(f)
            
            return jsonify({
                "status": "success",
                "found": True,
                "cache": cache_data
            })
        else:
            return jsonify({
                "status": "success",
                "found": False,
                "cache": None,
                "message": "No cache found for this PDF"
            })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/pdf-cache/delete", methods=["POST"])
def delete_pdf_cache():
    """删除PDF渲染缓存
    
    请求体:
    {
        "pdfFilename": "example.pdf"
    }
    """
    try:
        data = request.get_json()
        pdf_filename = data.get("pdfFilename", "")
        
        if not pdf_filename:
            return jsonify({"status": "error", "message": "pdfFilename is required"}), 400
        
        cache_path = get_pdf_cache_path(pdf_filename)
        
        if cache_path.exists():
            cache_path.unlink()
            return jsonify({
                "status": "success",
                "message": f"Cache deleted for {pdf_filename}"
            })
        else:
            return jsonify({
                "status": "success",
                "message": "No cache found to delete"
            })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/pdf-cache/list", methods=["GET"])
def list_pdf_cache():
    """列出所有PDF缓存"""
    try:
        if not PDF_CACHE_DIR.exists():
            return jsonify({
                "status": "success",
                "caches": []
            })
        
        caches = []
        for cache_file in PDF_CACHE_DIR.glob("*.cache.json"):
            with open(cache_file, "r", encoding="utf-8") as f:
                cache_data = json.load(f)
            caches.append(cache_data)
        
        return jsonify({
            "status": "success",
            "caches": caches,
            "count": len(caches)
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


# ============================================================================
# 通用文档阅读进度API - 保存所有文档类型的阅读进度
# ============================================================================

DOC_PROGRESS_DIR = Path(__file__).parent.parent / "user_data" / "doc_progress"

def get_doc_progress_path(doc_id: str) -> Path:
    """获取文档进度文件路径"""
    DOC_PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    # 使用文档ID（去除特殊字符）作为进度文件名
    safe_id = "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in doc_id)
    progress_filename = safe_id + ".progress.json"
    return DOC_PROGRESS_DIR / progress_filename


@app.route("/api/doc-progress/save", methods=["POST"])
def save_doc_progress():
    """保存文档阅读进度
    
    请求体:
    {
        "docId": "document-id",           # 文档唯一ID（必需）
        "docType": "pdf|epub|docx|txt",  # 文档类型
        "scrollPosition": 1024,           # 滚动位置（像素）或字符位置
        "scrollPercent": 45.5,            # 滚动进度百分比（0-100）
        "currentPage": 5,                 # 当前页码
        "displayMode": "continuous",      # 显示模式
        "timestamp": 1234567890000        # 时间戳（毫秒）
    }
    """
    try:
        data = request.get_json()
        doc_id = data.get("docId", "")
        
        if not doc_id:
            return jsonify({"status": "error", "message": "docId is required"}), 400
        
        progress_path = get_doc_progress_path(doc_id)
        
        # 准备进度数据
        progress_data = {
            "docId": doc_id,
            "docType": data.get("docType", "unknown"),
            "scrollPosition": data.get("scrollPosition", 0),
            "scrollPercent": data.get("scrollPercent", 0),
            "currentPage": data.get("currentPage", 1),
            "displayMode": data.get("displayMode", "continuous"),
            "timestamp": int(__import__("time").time() * 1000)
        }
        
        # 写入进度文件
        with open(progress_path, "w", encoding="utf-8") as f:
            json.dump(progress_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            "status": "success",
            "message": f"Progress saved for document {doc_id}",
            "progressPath": str(progress_path)
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/doc-progress/load", methods=["POST"])
def load_doc_progress():
    """加载文档阅读进度
    
    请求体:
    {
        "docId": "document-id"
    }
    """
    try:
        data = request.get_json()
        doc_id = data.get("docId", "")
        
        if not doc_id:
            return jsonify({"status": "error", "message": "docId is required"}), 400
        
        progress_path = get_doc_progress_path(doc_id)
        
        if progress_path.exists():
            with open(progress_path, "r", encoding="utf-8") as f:
                progress_data = json.load(f)
            
            return jsonify({
                "status": "success",
                "found": True,
                "progress": progress_data
            })
        else:
            return jsonify({
                "status": "success",
                "found": False,
                "progress": None,
                "message": "No progress found for this document"
            })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/doc-progress/delete", methods=["POST"])
def delete_doc_progress():
    """删除文档阅读进度"""
    try:
        data = request.get_json()
        doc_id = data.get("docId", "")
        
        if not doc_id:
            return jsonify({"status": "error", "message": "docId is required"}), 400
        
        progress_path = get_doc_progress_path(doc_id)
        
        if progress_path.exists():
            progress_path.unlink()
            return jsonify({
                "status": "success",
                "message": f"Progress deleted for document {doc_id}"
            })
        else:
            return jsonify({
                "status": "success",
                "message": "No progress found to delete"
            })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/doc-progress/list", methods=["GET"])
def list_doc_progress():
    """列出所有文档阅读进度"""
    try:
        if not DOC_PROGRESS_DIR.exists():
            return jsonify({
                "status": "success",
                "progresses": []
            })
        
        progresses = []
        for progress_file in DOC_PROGRESS_DIR.glob("*.progress.json"):
            with open(progress_file, "r", encoding="utf-8") as f:
                progress_data = json.load(f)
            progresses.append(progress_data)
        
        return jsonify({
            "status": "success",
            "progresses": progresses,
            "count": len(progresses)
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/")
def index():
    idx = Path(__file__).parent.parent / "static" / "index.html"
    if idx.exists():
        return send_file(str(idx))
    else:
        return jsonify({"status": "error", "message": "index.html not found", "path": str(idx)}), 500


@app.route("/static/pdf-viewer.html")
def pdf_viewer():
    """PDF查看器路由 - 禁用缓存确保总是使用最新版本"""
    viewer_path = Path(__file__).parent.parent / "static" / "pdf-viewer.html"
    if viewer_path.exists():
        response = send_file(str(viewer_path))
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    else:
        return jsonify({"status": "error", "message": "pdf-viewer.html not found"}), 404


# ============================================================================
# 词典查询API - 支持词库管理和pymorphy2词法分析
# ============================================================================

# 初始化pymorphy2分析器（延迟加载）
_morph_analyzer = None

def get_morph_analyzer():
    """获取pymorphy2分析器实例"""
    global _morph_analyzer
    if _morph_analyzer is None and pymorphy2 is not None:
        try:
            _morph_analyzer = pymorphy2.MorphAnalyzer()
            print("✓ pymorphy2分析器初始化成功")
        except Exception as e:
            print(f"✗ pymorphy2分析器初始化失败: {e}")
            _morph_analyzer = None
    return _morph_analyzer


def normalize_word(word: str) -> List[str]:
    """使用pymorphy2将词汇还原为原形
    
    返回可能的原形列表
    """
    morph = get_morph_analyzer()
    if morph is None:
        return [word.lower()]
    
    try:
        parses = morph.parse(word)
        normal_forms = list(set([p.normal_form for p in parses]))
        return normal_forms if normal_forms else [word.lower()]
    except Exception as e:
        print(f"词法分析失败 {word}: {e}")
        return [word.lower()]


def analyze_word_morphology(word: str) -> Dict[str, Any]:
    """分析词汇的词法信息
    
    返回：
    - normal_form: 原形
    - pos: 词性
    - case: 格
    - gender: 性
    - number: 数
    - tense: 时态
    - person: 人称
    - voice: 语态
    - mood: 式
    - aspect: 体
    - animacy: 有生命性
    - transitivity: 及物性
    - involvement: 参与性
    """
    morph = get_morph_analyzer()
    if morph is None:
        return {"word": word, "normal_forms": [word.lower()], "analyses": []}
    
    try:
        parses = morph.parse(word)
        analyses = []
        
        for p in parses:
            analysis = {
                "normal_form": p.normal_form,
                "pos": str(p.tag.POS) if p.tag.POS else None,
                "case": str(p.tag.case) if hasattr(p.tag, 'case') and p.tag.case else None,
                "gender": str(p.tag.gender) if hasattr(p.tag, 'gender') and p.tag.gender else None,
                "number": str(p.tag.number) if hasattr(p.tag, 'number') and p.tag.number else None,
                "tense": str(p.tag.tense) if hasattr(p.tag, 'tense') and p.tag.tense else None,
                "person": str(p.tag.person) if hasattr(p.tag, 'person') and p.tag.person else None,
                "voice": str(p.tag.voice) if hasattr(p.tag, 'voice') and p.tag.voice else None,
                "mood": str(p.tag.mood) if hasattr(p.tag, 'mood') and p.tag.mood else None,
                "aspect": str(p.tag.aspect) if hasattr(p.tag, 'aspect') and p.tag.aspect else None,
                "animacy": str(p.tag.animacy) if hasattr(p.tag, 'animacy') and p.tag.animacy else None,
                "transitivity": str(p.tag.transitivity) if hasattr(p.tag, 'transitivity') and p.tag.transitivity else None,
                "involvement": str(p.tag.involvement) if hasattr(p.tag, 'involvement') and p.tag.involvement else None,
                "score": float(p.score),
                "tag": str(p.tag)
            }
            analyses.append(analysis)
        
        return {
            "word": word,
            "normal_forms": list(set([p.normal_form for p in parses])),
            "analyses": analyses
        }
    except Exception as e:
        print(f"词法分析失败 {word}: {e}")
        return {"word": word, "normal_forms": [word.lower()], "analyses": [], "error": str(e)}


def generate_word_inflections(word: str) -> Dict[str, Any]:
    """生成词汇的变格形式
    
    返回：
    - word: 原始词汇
    - normal_form: 原形
    - inflections: 变格形式列表，按词性分组
    """
    morph = get_morph_analyzer()
    if morph is None:
        return {"word": word, "normal_form": word.lower(), "inflections": {}}
    
    try:
        parses = morph.parse(word)
        if not parses:
            return {"word": word, "normal_form": word.lower(), "inflections": {}}
        
        # 按词性分组解析结果
        pos_groups = {}
        for p in parses:
            pos = p.tag.POS
            if pos:
                pos_str = str(pos)
                if pos_str not in pos_groups:
                    pos_groups[pos_str] = []
                pos_groups[pos_str].append(p)
        
        # 为每个词性生成变格形式
        inflections = {}
        
        for pos_str, pos_parses in pos_groups.items():
            best_parse = pos_parses[0]
            normal_form = best_parse.normal_form
            
            if pos_str == 'INFN':
                # 尝试获取第一人称单数形式
                verb_parse = best_parse
                try:
                    verb_form = best_parse.inflect({'1per', 'sing'})
                    if verb_form:
                        # 重新解析动词形式
                        verb_parses = morph.parse(verb_form.word)
                        if verb_parses:
                            verb_parse = verb_parses[0]
                            pos = verb_parse.tag.POS
                            pos_str = str(pos) if pos else None
                except:
                    pass
                
                # 如果还是 INFN，使用通用方法
                if pos_str == 'INFN':
                    pos_inflections = generate_generic_inflections(best_parse)
                else:
                    pos_inflections = generate_verb_inflections(verb_parse)
            elif pos_str == 'NOUN':
                pos_inflections = generate_noun_inflections(best_parse)
            elif pos_str == 'VERB':
                pos_inflections = generate_verb_inflections(best_parse)
            elif pos_str == 'ADJF':
                pos_inflections = generate_adjective_inflections(best_parse)
            elif pos_str == 'ADJS':
                pos_inflections = generate_adjective_inflections(best_parse)
            elif pos_str == 'NUMR':
                pos_inflections = generate_numeral_inflections(best_parse)
            elif pos_str == 'NPRO':
                pos_inflections = generate_pronoun_inflections(best_parse)
            else:
                pos_inflections = generate_generic_inflections(best_parse)
            
            inflections[pos_str] = {
                "normal_form": normal_form,
                "inflections": pos_inflections
            }
        
        return {
            "word": word,
            "normal_form": parses[0].normal_form,
            "inflections": inflections
        }
    except Exception as e:
        print(f"变格形式生成失败 {word}: {e}")
        return {"word": word, "normal_form": word.lower(), "inflections": {}, "error": str(e)}


def generate_noun_inflections(parse) -> Dict[str, Any]:
    """生成名词的变格形式"""
    morph = get_morph_analyzer()
    if morph is None:
        return {}
    
    cases = ['nomn', 'gent', 'datv', 'accs', 'ablt', 'loct']
    case_names = {
        'nomn': '主格',
        'gent': '属格',
        'datv': '与格',
        'accs': '宾格',
        'ablt': '工具格',
        'loct': '前置格'
    }
    
    numbers = ['sing', 'plur']
    number_names = {
        'sing': '单数',
        'plur': '复数'
    }
    
    inflections = {}
    
    for num in numbers:
        num_key = number_names.get(num, num)
        inflections[num_key] = {}
        
        for case in cases:
            try:
                if num == 'sing':
                    inflected = parse.inflect({case})
                else:
                    inflected = parse.inflect({case, num})
                
                if inflected:
                    case_key = case_names.get(case, case)
                    inflections[num_key][case_key] = inflected.word
            except:
                pass
    
    return inflections


def generate_verb_inflections(parse) -> Dict[str, Any]:
    """生成动词的变格形式"""
    morph = get_morph_analyzer()
    if morph is None:
        return {}
    
    inflections = {}
    
    # 不定式
    infinitive = parse.normal_form
    
    # 主动语态
    active_voice = {}
    
    # 现在/将来时
    present_future = {}
    tenses = ['pres', 'futr']
    persons = ['1per', '2per', '3per']
    person_names = {
        '1per': '一',
        '2per': '二',
        '3per': '三'
    }
    numbers = ['sing', 'plur']
    number_names = {
        'sing': '单数',
        'plur': '复数'
    }
    
    for tense in tenses:
        tense_key = '现在时' if tense == 'pres' else '将来时'
        present_future[tense_key] = {}
        
        for num in numbers:
            num_key = number_names.get(num, num)
            present_future[tense_key][num_key] = {}
            
            for person in persons:
                try:
                    inflected = parse.inflect({tense, person, num})
                    if inflected:
                        person_key = person_names.get(person, person)
                        present_future[tense_key][num_key][person_key] = inflected.word
                except:
                    pass
    
    active_voice['现在/将来时'] = present_future
    
    # 过去时
    past_tense = {}
    genders = ['masc', 'femn', 'neut']
    gender_names = {
        'masc': '阳性',
        'femn': '阴性',
        'neut': '中性'
    }
    
    for gender in genders:
        gender_key = gender_names.get(gender, gender)
        try:
            inflected = parse.inflect({'past', gender})
            if inflected:
                past_tense[gender_key] = inflected.word
        except:
            pass
    
    # 复数过去时
    try:
        inflected = parse.inflect({'past', 'plur'})
        if inflected:
            past_tense['复数'] = inflected.word
    except:
        pass
    
    active_voice['过去时'] = past_tense
    
    # 副动词
    adverbial_participle = []
    try:
        inflected = parse.inflect({'GRND', 'past'})
        if inflected:
            adverbial_participle.append(inflected.word)
    except:
        pass
    
    try:
        inflected = parse.inflect({'GRND', 'pres'})
        if inflected:
            adverbial_participle.append(inflected.word)
    except:
        pass
    
    if adverbial_participle:
        active_voice['副动词'] = ' // '.join(adverbial_participle)
    
    # 命令式
    imperative = {}
    for num in numbers:
        num_key = number_names.get(num, num)
        try:
            inflected = parse.inflect({'impr', num})
            if inflected:
                imperative[num_key] = inflected.word
        except:
            pass
    
    active_voice['命令式'] = imperative
    
    # 过去时主动形动词
    past_active_participle = {}
    cases = ['nomn', 'gent', 'datv', 'accs', 'ablt', 'loct']
    case_names = {
        'nomn': '一格',
        'gent': '二格',
        'datv': '三格',
        'accs': '四格',
        'ablt': '五格',
        'loct': '六格'
    }
    
    for case in cases:
        case_key = case_names.get(case, case)
        past_active_participle[case_key] = {}
        
        for gender in genders:
            gender_key = gender_names.get(gender, gender)
            try:
                inflected = parse.inflect({'PRTF', 'past', 'actv', case, gender})
                if inflected:
                    past_active_participle[case_key][gender_key] = inflected.word
            except:
                pass
        
        # 复数
        try:
            inflected = parse.inflect({'PRTF', 'past', 'actv', case, 'plur'})
            if inflected:
                past_active_participle[case_key]['复数'] = inflected.word
        except:
            pass
    
    active_voice['过去时主动形动词'] = past_active_participle
    
    inflections['主动语态'] = active_voice
    
    # 被动语态
    passive_voice = {}
    
    # 过去时被动形动词
    past_passive_participle = {}
    
    for case in cases:
        case_key = case_names.get(case, case)
        past_passive_participle[case_key] = {}
        
        for gender in genders:
            gender_key = gender_names.get(gender, gender)
            try:
                inflected = parse.inflect({'PRTF', 'past', 'pssv', case, gender})
                if inflected:
                    past_passive_participle[case_key][gender_key] = inflected.word
            except:
                pass
        
        # 复数
        try:
            inflected = parse.inflect({'PRTF', 'past', 'pssv', case, 'plur'})
            if inflected:
                past_passive_participle[case_key]['复数'] = inflected.word
        except:
            pass
    
    passive_voice['过去时被动形动词'] = past_passive_participle
    
    # 简略形式
    short_form = {}
    for gender in genders:
        gender_key = gender_names.get(gender, gender)
        try:
            inflected = parse.inflect({'PRTF', 'past', 'pssv', 'shrt', gender})
            if inflected:
                short_form[gender_key] = inflected.word
        except:
            pass
    
    # 复数简略形式
    try:
        inflected = parse.inflect({'PRTF', 'past', 'pssv', 'shrt', 'plur'})
        if inflected:
            short_form['复数'] = inflected.word
    except:
        pass
    
    if short_form:
        passive_voice['简略形式'] = short_form
    
    if passive_voice:
        inflections['被动语态'] = passive_voice
    
    # 添加不定式
    inflections['不定式'] = infinitive
    
    return inflections


def generate_adjective_inflections(parse) -> Dict[str, Any]:
    """生成形容词的变格形式"""
    morph = get_morph_analyzer()
    if morph is None:
        return {}
    
    cases = ['nomn', 'gent', 'datv', 'accs', 'ablt', 'loct']
    case_names = {
        'nomn': '主格',
        'gent': '属格',
        'datv': '与格',
        'accs': '宾格',
        'ablt': '工具格',
        'loct': '前置格'
    }
    
    genders = ['masc', 'femn', 'neut']
    gender_names = {
        'masc': '阳性',
        'femn': '阴性',
        'neut': '中性'
    }
    
    numbers = ['sing', 'plur']
    number_names = {
        'sing': '单数',
        'plur': '复数'
    }
    
    inflections = {}
    
    for num in numbers:
        num_key = number_names.get(num, num)
        inflections[num_key] = {}
        
        if num == 'sing':
            for gender in genders:
                gender_key = gender_names.get(gender, gender)
                inflections[num_key][gender_key] = {}
                
                for case in cases:
                    try:
                        inflected = parse.inflect({case, gender, num})
                        if inflected:
                            case_key = case_names.get(case, case)
                            inflections[num_key][gender_key][case_key] = inflected.word
                    except:
                        pass
        else:
            for case in cases:
                try:
                    inflected = parse.inflect({case, num})
                    if inflected:
                        case_key = case_names.get(case, case)
                        inflections[num_key][case_key] = inflected.word
                except:
                        pass
    
    # 短尾形式
    short_forms = {}
    for gender in genders:
        gender_key = gender_names.get(gender, gender)
        try:
            inflected = parse.inflect({'ADJS', gender, 'sing'})
            if inflected:
                short_forms[gender_key] = inflected.word
        except:
            pass
    
    try:
        inflected = parse.inflect({'ADJS', 'plur'})
        if inflected:
            short_forms['复数'] = inflected.word
    except:
        pass
    
    if short_forms:
        inflections['短尾形式'] = short_forms
    
    # 比较级
    comparative_forms = []
    
    # 尝试从原始词获取比较级
    try:
        # 解析原始词
        base_word = parse.normal_form
        parses = morph.parse(base_word)
        
        # 查找包含比较级标签的解析
        for p in parses:
            tag_str = str(p.tag)
            if 'COMP' in tag_str or 'compar' in tag_str.lower():
                comparative_forms.append(p.word)
                break
    except:
        pass
    
    # 如果还是没有结果，尝试直接使用inflect
    if not comparative_forms:
        try:
            inflected = parse.inflect({'COMP'})
            if inflected:
                comparative_forms.append(inflected.word)
        except:
            pass
    
    if comparative_forms:
        inflections['比较级'] = ' // '.join(comparative_forms)
    
    return inflections


def generate_numeral_inflections(parse) -> Dict[str, Any]:
    """生成数词的变格形式"""
    morph = get_morph_analyzer()
    if morph is None:
        return {}
    
    cases = ['nomn', 'gent', 'datv', 'accs', 'ablt', 'loct']
    case_names = {
        'nomn': '主格',
        'gent': '属格',
        'datv': '与格',
        'accs': '宾格',
        'ablt': '工具格',
        'loct': '前置格'
    }
    
    numbers = ['sing', 'plur']
    number_names = {
        'sing': '单数',
        'plur': '复数'
    }
    
    inflections = {}
    
    for num in numbers:
        num_key = number_names.get(num, num)
        inflections[num_key] = {}
        
        for case in cases:
            try:
                inflected = parse.inflect({case, num})
                if inflected:
                    case_key = case_names.get(case, case)
                    inflections[num_key][case_key] = inflected.word
            except:
                pass
    
    return inflections


def generate_pronoun_inflections(parse) -> Dict[str, Any]:
    """生成代词的变格形式"""
    morph = get_morph_analyzer()
    if morph is None:
        return {}
    
    cases = ['nomn', 'gent', 'datv', 'accs', 'ablt', 'loct']
    case_names = {
        'nomn': '主格',
        'gent': '属格',
        'datv': '与格',
        'accs': '宾格',
        'ablt': '工具格',
        'loct': '前置格'
    }
    
    numbers = ['sing', 'plur']
    number_names = {
        'sing': '单数',
        'plur': '复数'
    }
    
    inflections = {}
    
    for num in numbers:
        num_key = number_names.get(num, num)
        inflections[num_key] = {}
        
        for case in cases:
            try:
                inflected = parse.inflect({case, num})
                if inflected:
                    case_key = case_names.get(case, case)
                    inflections[num_key][case_key] = inflected.word
            except:
                pass
    
    return inflections


def generate_generic_inflections(parse) -> Dict[str, Any]:
    """生成通用词汇的变格形式"""
    morph = get_morph_analyzer()
    if morph is None:
        return {}
    
    inflections = {}
    
    try:
        if parse.tag.case:
            cases = ['nomn', 'gent', 'datv', 'accs', 'ablt', 'loct']
            case_names = {
                'nomn': '主格',
                'gent': '属格',
                'datv': '与格',
                'accs': '宾格',
                'ablt': '工具格',
                'loct': '前置格'
            }
            
            for case in cases:
                try:
                    inflected = parse.inflect({case})
                    if inflected:
                        case_key = case_names.get(case, case)
                        inflections[case_key] = inflected.word
                except:
                    pass
    except:
        pass
    
    return inflections


def load_dictionary_files() -> List[Dict[str, Any]]:
    """加载所有词库文件"""
    # 加载项目内置词典（data/dictionary）
    builtin_dict_dir = Path(__file__).parent.parent / "data" / "dictionary"
    builtin_dict_dir.mkdir(exist_ok=True, parents=True)
    
    # 加载用户词典（user_data/dictionary）
    user_dict_dir = get_user_file_path("", "dictionary")
    user_dict_dir.mkdir(exist_ok=True)
    
    dictionaries = []
    
    # 先加载内置词典
    for file_path in builtin_dict_dir.glob("*"):
        if file_path.is_file() and file_path.suffix.lower() in ['.json', '.csv', '.tsv', '.txt']:
            try:
                dict_data = {
                    "filename": file_path.name,
                    "path": str(file_path),
                    "size": file_path.stat().st_size,
                    "entries": [],
                    "type": "builtin"  # 标记为内置词典
                }
                
                # 根据文件类型加载
                if file_path.suffix.lower() == '.json':
                    with open(file_path, 'r', encoding='utf-8') as f:
                        dict_data["entries"] = json.load(f)
                elif file_path.suffix.lower() in ['.csv', '.tsv']:
                    import csv
                    delimiter = '\t' if file_path.suffix.lower() == '.tsv' else ','
                    with open(file_path, 'r', encoding='utf-8') as f:
                        reader = csv.DictReader(f, delimiter=delimiter)
                        dict_data["entries"] = list(reader)
                
                dictionaries.append(dict_data)
            except Exception as e:
                print(f"加载内置词库失败 {file_path.name}: {e}")
    
    # 再加载用户词典
    for file_path in user_dict_dir.glob("*"):
        if file_path.is_file() and file_path.suffix.lower() in ['.json', '.csv', '.tsv', '.txt']:
            try:
                dict_data = {
                    "filename": file_path.name,
                    "path": str(file_path),
                    "size": file_path.stat().st_size,
                    "entries": [],
                    "type": "user"  # 标记为用户词典
                }
                
                # 根据文件类型加载
                if file_path.suffix.lower() == '.json':
                    with open(file_path, 'r', encoding='utf-8') as f:
                        dict_data["entries"] = json.load(f)
                elif file_path.suffix.lower() in ['.csv', '.tsv']:
                    import csv
                    delimiter = '\t' if file_path.suffix.lower() == '.tsv' else ','
                    with open(file_path, 'r', encoding='utf-8') as f:
                        reader = csv.DictReader(f, delimiter=delimiter)
                        dict_data["entries"] = list(reader)
                
                dictionaries.append(dict_data)
            except Exception as e:
                print(f"加载用户词库失败 {file_path.name}: {e}")
    
    return dictionaries


def search_in_dictionaries(word: str) -> List[Dict[str, Any]]:
    """在所有词库中搜索词汇"""
    # 获取词汇的原形
    normal_forms = normalize_word(word)
    
    # 加载所有词库
    dictionaries = load_dictionary_files()
    
    results = []
    
    for dict_data in dictionaries:
        for entry in dict_data["entries"]:
            # 检查entry是否匹配（原形或变形）
            entry_word = entry.get("word", "").lower()
            
            if entry_word == word.lower() or entry_word in normal_forms:
                result = {
                    "source": dict_data["filename"],
                    "word": entry.get("word", ""),
                    "translation": entry.get("translation", ""),
                    "pos": entry.get("pos", ""),
                    "examples": entry.get("examples", []),
                    "notes": entry.get("notes", "")
                }
                results.append(result)
    
    return results


@app.route("/api/dictionary/lookup", methods=["POST"])
def dictionary_lookup():
    """查词API
    
    请求体:
    {
        "word": "привет",
        "analyze": true  # 是否进行词法分析
    }
    
    返回:
    {
        "status": "success",
        "word": "привет",
        "morphology": {...},  # 词法分析结果
        "dictionary": [...],  # 词典查询结果
        "vocab": {...}        # 生词本中的记录
    }
    """
    try:
        data = request.get_json()
        word = data.get("word", "").strip()
        analyze = data.get("analyze", True)
        
        if not word:
            return jsonify({"status": "error", "error": "词汇不能为空"}), 400
        
        result = {
            "status": "success",
            "word": word,
            "morphology": None,
            "dictionary": [],
            "vocab": None
        }
        
        # 词法分析
        if analyze and pymorphy2 is not None:
            result["morphology"] = analyze_word_morphology(word)
            # 生成变格形式
            result["inflections"] = generate_word_inflections(word)
        
        # 词典查询
        result["dictionary"] = search_in_dictionaries(word)
        
        # 查询生词本（从所有生词本中查找）
        vocabbooks_path = get_user_file_path("vocabbooks.json", "vocab")
        if vocabbooks_path.exists():
            with open(vocabbooks_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                vocabBooks = data.get("vocabBooks", [])
                
                for book in vocabBooks:
                    for vocab_word in book.get("words", []):
                        if vocab_word.get("word", "").lower() == word.lower():
                            result["vocab"] = vocab_word
                            break
                    if result["vocab"]:
                        break
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/dictionary/upload", methods=["POST"])
def upload_dictionary():
    """上传词库文件
    
    支持JSON, CSV, TSV格式
    """
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "error": "没有上传文件"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"status": "error", "error": "文件名为空"}), 400
        
        # 检查文件格式
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in ['.json', '.csv', '.tsv', '.txt']:
            return jsonify({"status": "error", "error": "不支持的文件格式"}), 400
        
        # 保存到dictionary文件夹
        dict_dir = get_user_file_path("", "dictionary")
        dict_dir.mkdir(exist_ok=True)
        
        file_path = dict_dir / file.filename
        file.save(str(file_path))
        
        # 验证文件内容
        entry_count = 0
        try:
            if file_ext == '.json':
                with open(file_path, 'r', encoding='utf-8') as f:
                    entries = json.load(f)
                    entry_count = len(entries) if isinstance(entries, list) else 0
            elif file_ext in ['.csv', '.tsv']:
                import csv
                delimiter = '\t' if file_ext == '.tsv' else ','
                with open(file_path, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f, delimiter=delimiter)
                    entry_count = sum(1 for _ in reader)
        except Exception as e:
            file_path.unlink()  # 删除无效文件
            return jsonify({"status": "error", "error": f"文件格式错误: {str(e)}"}), 400
        
        return jsonify({
            "status": "success",
            "filename": file.filename,
            "entries": entry_count,
            "message": f"成功导入 {entry_count} 个词条"
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/dictionary/list", methods=["GET"])
def list_dictionaries():
    """列出所有已导入的词库"""
    try:
        # 列出内置词典
        builtin_dict_dir = Path(__file__).parent.parent / "data" / "dictionary"
        builtin_dict_dir.mkdir(exist_ok=True, parents=True)
        
        # 列出用户词典
        user_dict_dir = get_user_file_path("", "dictionary")
        user_dict_dir.mkdir(exist_ok=True)
        
        dictionaries = []
        
        # 添加内置词典
        for file_path in builtin_dict_dir.glob("*"):
            if file_path.is_file() and file_path.suffix.lower() in ['.json', '.csv', '.tsv', '.txt']:
                entry_count = 0
                try:
                    if file_path.suffix.lower() == '.json':
                        with open(file_path, 'r', encoding='utf-8') as f:
                            entries = json.load(f)
                            entry_count = len(entries) if isinstance(entries, list) else 0
                    elif file_path.suffix.lower() in ['.csv', '.tsv']:
                        import csv
                        delimiter = '\t' if file_path.suffix.lower() == '.tsv' else ','
                        with open(file_path, 'r', encoding='utf-8') as f:
                            reader = csv.DictReader(f, delimiter=delimiter)
                            entry_count = sum(1 for _ in reader)
                except:
                    entry_count = 0
                
                dictionaries.append({
                    "filename": file_path.name,
                    "size": file_path.stat().st_size,
                    "entries": entry_count,
                    "upload_time": file_path.stat().st_mtime,
                    "type": "builtin",
                    "editable": False  # 内置词典不可编辑
                })
        
        # 添加用户词典
        for file_path in user_dict_dir.glob("*"):
            if file_path.is_file() and file_path.suffix.lower() in ['.json', '.csv', '.tsv', '.txt']:
                entry_count = 0
                try:
                    if file_path.suffix.lower() == '.json':
                        with open(file_path, 'r', encoding='utf-8') as f:
                            entries = json.load(f)
                            entry_count = len(entries) if isinstance(entries, list) else 0
                    elif file_path.suffix.lower() in ['.csv', '.tsv']:
                        import csv
                        delimiter = '\t' if file_path.suffix.lower() == '.tsv' else ','
                        with open(file_path, 'r', encoding='utf-8') as f:
                            reader = csv.DictReader(f, delimiter=delimiter)
                            entry_count = sum(1 for _ in reader)
                except:
                    entry_count = 0
                
                dictionaries.append({
                    "filename": file_path.name,
                    "size": file_path.stat().st_size,
                    "entries": entry_count,
                    "upload_time": file_path.stat().st_mtime,
                    "type": "user",
                    "editable": True  # 用户词典可编辑
                })
        
        return jsonify({
            "status": "success",
            "dictionaries": dictionaries,
            "count": len(dictionaries)
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/dictionary/delete/<filename>", methods=["DELETE"])
def delete_dictionary(filename):
    """删除词库文件"""
    try:
        # 只允许删除用户词典，不允许删除内置词典
        dict_dir = get_user_file_path("", "dictionary")
        file_path = dict_dir / filename
        
        if not file_path.exists():
            # 检查是否是内置词典
            builtin_dict_dir = Path(__file__).parent.parent / "data" / "dictionary"
            builtin_file_path = builtin_dict_dir / filename
            if builtin_file_path.exists():
                return jsonify({"status": "error", "error": "内置词典不可删除"}), 403
            return jsonify({"status": "error", "error": "词库不存在"}), 404
        
        file_path.unlink()
        
        return jsonify({
            "status": "success",
            "message": f"已删除词库: {filename}"
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/dictionary/analyze/<word>", methods=["GET"])
def analyze_word(word):
    """分析单个词汇的词法信息"""
    try:
        if not word:
            return jsonify({"status": "error", "error": "词汇不能为空"}), 400
        
        result = analyze_word_morphology(word)
        result["status"] = "success"
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
