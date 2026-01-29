#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统一启动脚本 - 一键配置检查和启动应用
融合了 setup.py 和原 start.py 的功能
"""
import os
import sys
import shutil
import subprocess
import webbrowser
import threading
import time
from pathlib import Path
from urllib.request import urlretrieve

# 强制 UTF-8 编码（解决 Windows 编码问题）
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 设置环境变量以支持 UTF-8
os.environ['PYTHONIOENCODING'] = 'utf-8'

# ============================================================================
# 颜色定义
# ============================================================================

class C:
    """终端颜色简写"""
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


# ============================================================================
# 打印函数
# ============================================================================

def header(text):
    """打印大标题"""
    print(f"\n{C.BOLD}{C.BLUE}{'=' * 60}{C.RESET}")
    print(f"{C.BOLD}{C.BLUE}{text.center(60)}{C.RESET}")
    print(f"{C.BOLD}{C.BLUE}{'=' * 60}{C.RESET}\n")


def success(text):
    print(f"{C.GREEN}✓{C.RESET} {text}")


def warning(text):
    print(f"{C.YELLOW}⚠{C.RESET} {text}")


def error(text):
    print(f"{C.RED}✗{C.RESET} {text}")


def info(text):
    print(f"{C.CYAN}ℹ{C.RESET} {text}")


# ============================================================================
# 检查函数
# ============================================================================

def check_ffmpeg():
    """检查 FFmpeg"""
    if shutil.which("ffmpeg"):
        try:
            result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
            version = result.stdout.split('\n')[0] if result.stdout else "已安装"
            success(f"FFmpeg: {version}")
            return True
        except Exception:
            error("FFmpeg 已找到但无法执行")
            return False
    else:
        error("FFmpeg 未安装")
        if sys.platform == "win32":
            info("Windows 快速安装: winget install Gyan.FFmpeg")
            if input("是否尝试自动安装? (y/n): ").strip().lower() == 'y':
                try:
                    subprocess.run(["winget", "install", "Gyan.FFmpeg", "-e", "-h"], check=True)
                    success("FFmpeg 安装成功！请重启终端后重试。")
                    return False
                except:
                    error("自动安装失败，请手动安装")
                    return False
        return False


def check_packages():
    """检查 Python 依赖"""
    packages = {
        'flask': 'Flask',
        'flask_cors': 'Flask-Cors',
        'whisper': 'openai-whisper',
    }
    
    missing = []
    for module, name in packages.items():
        try:
            __import__(module)
            success(f"{name} 已安装")
        except ImportError:
            error(f"{name} 未安装")
            missing.append(name)
    
    if missing:
        if input(f"\n是否安装 {len(missing)} 个缺失的包? (y/n): ").strip().lower() == 'y':
            try:
                subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt"], check=True)
                success("所有包安装成功！")
                return True
            except:
                error("包安装失败")
                return False
        return False
    
    return True


def check_gpu():
    """检查 GPU"""
    try:
        import torch
        if torch.cuda.is_available():
            device = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            success(f"GPU: {device} ({vram:.1f} GB)")
            return True
        else:
            warning("CPU 模式（GPU 不可用）")
            return False
    except ImportError:
        warning("PyTorch 未安装，无 GPU 支持")
        return False
    except:
        return False


def check_models():
    """检查模型"""
    model_dir = Path("models")
    models = list(model_dir.glob("*.pt")) if model_dir.exists() else []
    
    if models:
        for m in models:
            size = m.stat().st_size / (1024 * 1024)
            success(f"模型: {m.name} ({size:.1f} MB)")
        return True
    else:
        warning("未找到本地模型")
        if input("是否下载 base.pt (142 MB)? (y/n): ").strip().lower() == 'y':
            return download_model()
        return False


def download_model():
    """下载 base 模型"""
    model_dir = Path("models")
    model_dir.mkdir(exist_ok=True)
    model_path = model_dir / "base.pt"
    
    # 官方下载链接
    url = "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt"
    
    info("开始下载模型...")
    try:
        def hook(block_num, block_size, total_size):
            if total_size > 0:
                mb = block_num * block_size / (1024**2)
                total_mb = total_size / (1024**2)
                percent = min(100, block_num * block_size * 100 / total_size)
                filled = int(percent / 2.5)
                bar = '█' * filled + '-' * (40 - filled)
                print(f'\r  [{bar}] {percent:.0f}% ({mb:.1f}/{total_mb:.1f} MB)', end='', flush=True)
        
        urlretrieve(url, model_path, reporthook=hook)
        print()
        success(f"模型下载完成: {model_path}")
        return True
    except Exception as e:
        error(f"模型下载失败: {e}")
        return False


def check_env():
    """检查配置文件"""
    config_dir = Path("config")
    config_dir.mkdir(exist_ok=True)
    env_file = config_dir / ".env"
    if env_file.exists():
        model = env_file.read_text().strip()
        success(f"config/.env 已存在 (模型: {model})")
        return True
    else:
        if input("是否创建 config/.env 文件 (默认模型: base)? (y/n): ").strip().lower() == 'y':
            env_file.write_text("base")
            success("config/.env 已创建")
            return True
        return False


# ============================================================================
# 主函数
# ============================================================================

def main():
    """主函数"""
    header("🎓 俄语学习应用")
    
    # 快速检查
    print("正在检查环境...\n")
    
    ffmpeg_ok = check_ffmpeg()
    packages_ok = check_packages()
    gpu_ok = check_gpu()
    models_ok = check_models()
    env_ok = check_env()
    
    # 总结
    header("配置检查结果")
    
    status = [
        ("FFmpeg", ffmpeg_ok),
        ("Python 包", packages_ok),
        ("GPU 支持", gpu_ok),
        ("Whisper 模型", models_ok),
        (".env 配置", env_ok),
    ]
    
    for name, ok in status:
        (success if ok else warning)(f"{name}: {'✓' if ok else '⚠'}")
    
    # 启动或提示
    critical_ok = ffmpeg_ok and packages_ok and (models_ok or env_ok)
    
    print()
    if critical_ok:
        success("所有关键配置已就绪！")
        if gpu_ok:
            success("🚀 GPU 已启用，性能最优！")
        
        # 启动应用
        print(f"\n正在启动应用... (Ctrl+C 停止)")
        print(f"{C.CYAN}访问地址: http://127.0.0.1:5000{C.RESET}\n")
        
        # 在后台线程中打开浏览器
        def open_browser():
            time.sleep(2)  # 等待 2 秒让服务器启动
            try:
                webbrowser.open("http://127.0.0.1:5000")
                info("已在浏览器中打开应用")
            except Exception as e:
                info(f"无法自动打开浏览器: {e}")
        
        browser_thread = threading.Thread(target=open_browser, daemon=True)
        browser_thread.start()
        
        # 直接从 src/app.py 加载模块，避免静态路径导入问题
        try:
            # 添加 src 目录到 Python 路径
            import sys
            sys.path.insert(0, str(Path(__file__).parent / "src"))
            
            # 导入 app 模块
            import app
            print(f"[DEBUG] App module imported successfully: {app}")
            print(f"[DEBUG] App object: {app.app}")
            print(f"[DEBUG] App routes: {list(app.app.url_map.iter_rules())}")
            
            # 启动应用
            app.app.run(host="127.0.0.1", port=5000, debug=True)
        except KeyboardInterrupt:
            print(f"\n\n{C.GREEN}👋 应用已停止{C.RESET}")
            return 0
        except Exception as e:
            error(f"启动失败: {e}")
            return 1
    else:
        error("关键配置缺失，无法启动")
        if not ffmpeg_ok:
            info("需要: FFmpeg")
        if not packages_ok:
            info("需要: Python 依赖包")
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(f"\n{C.YELLOW}用户取消{C.RESET}")
        sys.exit(1)
