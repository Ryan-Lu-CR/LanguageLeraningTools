# Whisper 模型文件夹

将手动下载的 Whisper 模型文件（.pt）放在此目录。

## 下载模型

推荐使用 **base** 或 **small** 模型：

### Tiny 模型 (75 MB) - 最快但精度较低

```text
https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt
```

### Base 模型 (142 MB) - 推荐用于开发测试

```text
https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt
```

### Small 模型 (466 MB) - 推荐用于生产环境

```text
https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt
```

### Medium 模型 (1.5 GB) - 高精度

```text
https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt
```

### Large 模型 (2.9 GB) - 最高精度

```text
https://openaipublic.azureedge.net/main/whisper/models/e4b87e7e0bf463eb8e6956e646f1e277e901512310def2c24bf0e11bd3c28e9a/large.pt
```

## 使用方法

1. 点击上面的链接下载模型文件
2. 将下载的 `.pt` 文件保存到此目录
3. 重启应用，程序会自动检测并使用本地模型
4. 可以同时放置多个模型，程序会使用第一个找到的模型

## 示例

下载 base.pt 后的目录结构：

```text
models/
└── base.pt
```

## 注意事项

- 模型文件较大，请确保有足够的磁盘空间
- 首次加载模型会需要几秒钟时间
- 如果没有本地模型，程序会尝试自动下载（需要网络连接）
