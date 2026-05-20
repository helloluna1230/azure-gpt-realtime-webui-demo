# Azure GPT Realtime WebRTC Demo

这个 demo 基于 2026-05 的 Microsoft Foundry / OpenAI Realtime 介绍，演示三个实时音频模型在浏览器里的典型用法：

- **GPT-realtime-2**：标准 Realtime 语音 Agent，支持 speech-in/speech-out、`reasoning.effort`、可选输入转写。
- **GPT-realtime-translate**：使用 transcription session 管道，持续把麦克风音频翻译成文本。
- **GPT-realtime-whisper**：transcription session，输出低延迟实时 transcript delta。

前端使用浏览器 WebRTC；后端用 Node/Express 负责创建短期 client secret 并代理 SDP 交换，所以 Azure 主密钥不会暴露到浏览器。

## 架构

```text
Browser microphone
  └─ WebRTC offer + data channel
       └─ Express /api/webrtc/connect
            ├─ POST /openai/v1/realtime/client_secrets
        └─ POST /openai/v1/realtime/calls
```

三种模式的区别：

| 模式 | Azure Realtime session | 模型/部署 | 主要事件 |
| --- | --- | --- | --- |
| 语音 Agent | `type: "realtime"` | `gpt-realtime-2` | `response.*`, `conversation.item.*` |
| 实时翻译 | `type: "transcription"` | `audio.input.transcription.model = gpt-realtime-translate` | `conversation.item.input_audio_transcription.delta/completed` |
| 实时转写 | `type: "transcription"` | `gpt-realtime-whisper` | `conversation.item.input_audio_transcription.delta/completed` |

## 准备 Azure 资源

1. 在 Microsoft Foundry / Azure OpenAI 中创建支持 Realtime 的资源与部署。官方文档提到 Realtime global deployment 需要支持区域，例如 East US 2 或 Sweden Central；新模型以你租户实际可见区域为准。
2. 部署三个模型，并记录**部署名**：
   - `gpt-realtime-2`
   - `gpt-realtime-translate`
   - `gpt-realtime-whisper`
3. 认证二选一：
   - 使用 `AZURE_OPENAI_API_KEY`。
   - 或使用 Microsoft Entra ID：本机 `az login`，并给身份分配 `Cognitive Services OpenAI User` 或相应资源访问角色。

## 配置

复制并编辑 `.env`：

```text
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_OPENAI_AUTH_MODE=
AZURE_OPENAI_API_KEY=<optional-api-key>
AZURE_OPENAI_REALTIME2_DEPLOYMENT=<your-gpt-realtime-2-deployment>
AZURE_OPENAI_TRANSLATE_DEPLOYMENT=<your-gpt-realtime-translate-deployment>
AZURE_OPENAI_WHISPER_DEPLOYMENT=<your-gpt-realtime-whisper-deployment>

# Optional: override only Translate to a resource/region that supports gpt-realtime-translate.
AZURE_OPENAI_TRANSLATE_ENDPOINT=
AZURE_OPENAI_TRANSLATE_API_KEY=
```

`AZURE_OPENAI_ENDPOINT` 推荐填写资源根地址，不要带 `/openai/v1`。如果误填为 `https://<resource>.openai.azure.com/openai/v1`，后端也会自动规范化为资源根地址。

如果你不用 API Key，保持 `AZURE_OPENAI_API_KEY` 为空即可，后端会使用 `DefaultAzureCredential`。如果 `.env` 里临时保留了 API Key 但想强制使用 Azure CLI / Managed Identity 登录态，设置 `AZURE_OPENAI_AUTH_MODE=entra`。

Agent 默认使用 `gpt-realtime-2`。请确保 `AZURE_OPENAI_REALTIME2_DEPLOYMENT` 填写的是你在 Azure OpenAI / Microsoft Foundry 中创建的 GPT-realtime-2 **部署名**；后端会在该部署上发送 `reasoning.effort`。

如果 Translate 需要单独使用另一个资源，可以只覆盖 Translate endpoint/key。按 `useful.md` 的测试结果，France Central 可创建 `gpt-realtime-translate` transcription session：

```text
AZURE_OPENAI_TRANSLATE_ENDPOINT=https://<your-france-central-resource>.openai.azure.com
AZURE_OPENAI_TRANSLATE_API_KEY=<that-resource-api-key>
AZURE_OPENAI_TRANSLATE_DEPLOYMENT=gpt-realtime-translate
```

Agent 和 Whisper 仍会继续使用默认 `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY`。Translate tab 始终直接使用原生 `gpt-realtime-translate`，不做 `realtime-agent` fallback，这样可以真实验证三个 Azure API/模型本身是否可用。

## 运行

```bash
npm install
npm start
```

然后打开：

```text
http://localhost:3000
```

> `getUserMedia()` 在 `localhost` 可以直接使用；如果部署到远端域名，需要 HTTPS。

## Demo 操作建议

### GPT-realtime-2

1. 选择 `reasoning.effort`。建议从 `low` 开始；复杂多步骤任务可试 `medium/high`。
2. 点击“开始 WebRTC 会话”。
3. 直接说话，或在文本框输入一句话后点击“发送文本”。
4. 观察输出音频与 transcript 事件。

### GPT-realtime-translate / Translate tab

1. 设置源语言和目标语言。
2. 点击开始后持续说话。
3. 页面会使用原生 `gpt-realtime-translate` transcription session，并严格采用 `useful.md` 验证过的最小 payload：`session.type = "transcription"`，且只把部署名放在 `session.audio.input.transcription.model`。
4. 服务端返回的译文会显示在“实时翻译结果”卡片中。
5. 如果事件日志出现 `conversation.item.input_audio_transcription.failed` / `OperationNotSupported`，说明原生 Translate API 已连接但真实 audio item 处理失败；这就是该 API 当前的测试结果。

### GPT-realtime-whisper

1. 设置源语言提示。
2. 点击开始后讲话，观察实时转写 delta。
3. 如果你的区域/部署要求手动提交音频边界，可点击“提交当前音频缓冲区”。

## 排错

- **401 / 403**：检查 API Key 或 Entra ID 角色；如果用 Entra ID，请确认已登录且资源角色已生效。
- **404**：确认使用的是 GA endpoint；本 demo 使用 `/openai/v1/...`，不带 `api-version`。
- **Model not found**：Azure `model` 字段应填部署名，且大小写敏感。
- **Translate `OperationNotSupported`**：这是 Azure 在原生 `gpt-realtime-translate` 处理某个真实音频 item 时返回的服务端事件。当前 France Central 资源可以创建 `realtime.transcription_session`，但真实 audio item 仍可能失败；这表示 token/session 层可用、WebRTC 音频链路可用，但 Translate 数据面处理失败。
- **麦克风无法打开**：确认浏览器授权，远端部署必须用 HTTPS。
- **Data channel 没有事件**：查看页面“事件日志”和服务器终端日志；`AZURE_OPENAI_WEBRTC_FILTER=on` 会过滤标准 Agent 模式里部分敏感/冗余事件。

## 备注

Azure 文档与 OpenAI Realtime GA 文档在 2026 年仍在快速迭代。这个 demo 把模型部署名、推理强度、语言、VAD、输入转写等都留成可配置项，便于你根据租户实际可用模型版本微调。
