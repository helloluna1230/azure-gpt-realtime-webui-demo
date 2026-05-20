Azure OpenAI Realtime API — 测试报告
日期: 2026-05-11 | 资源: aoai-eastus2 (East US 2), gpt-fc (France Central)
1. 测试概览
模型
gpt-realtime
gpt-realtime-whisper
gpt-realtime-translate
部署资源
aoai-eastus2
gpt-fc
区域
East US 2
WebSocket
WebRTC
�
France Central
gpt-fc
France Central
�
�
结论: 三个模型的 client_secrets 端点均支持 API key 认证，不需要 Entra ID token。
2. WebRTC 认证流程
Step 1: 服务端用 API key 获取 ephemeral token (~60秒有效)
POST https://{resource}.openai.azure.com/openai/v1/realtime/client_secrets
Header: api-key: {your-api-key}
Content-Type: application/json
Step 2: 浏览器用 ephemeral token 建立 WebRTC 连接
POST https://{resource}.openai.azure.com/openai/v1/realtime/calls
Header: Authorization: Bearer {ephemeral_token}
Content-Type: application/sdp
不需要 api-version 参数，这是 GA endpoint。
3. 各模型的 Session Config
3.1 gpt-realtime (标准语音对话) — model 放在 session 顶层
{ "session": {
    "type": "realtime",
    "model": "gpt-realtime",
    "instructions": "You are a helpful assistant.",
    "audio": { "output": { "voice": "alloy" } }
  }
}
3.2 gpt-realtime-whisper (实时转写) — model 放在 audio.input.transcription 下
{ "session": {
    "type": "transcription",
    "audio": { "input": {
        "transcription": { "model": "gpt-realtime-whisper" }
    } }
  }
}
model 必须放在 session.audio.input.transcription.model，放在 session.model 会返回 500。
3.3 gpt-realtime-translate (实时翻译) — 格式与 whisper 相同
{ "session": {
    "type": "transcription",
    "audio": { "input": {
        "transcription": { "model": "gpt-realtime-translate" }
    } }
  }
}
� API key
� API key
� API key
translate 也用 type: "transcription"，不是 "translation"。两者共用 transcription 管道。
返回示例 (whisper):
{ "value": "ek_6a01889558ec819197f38b4c052d31e2",
  "expires_at": 1778492597,
  "session": {
    "type": "transcription",
    "object": "realtime.transcription_session",
    "id": "sess_DeFaHiasIkks9jqRb00I8",
    "audio": { "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": { "model": "gpt-realtime-whisper", "language": null },
        "turn_detection": { "type": "server_vad", "threshold": 0.5,
          "prefix_padding_ms": 300, "silence_duration_ms": 200 }
    } }
  }
}
4. 测试脚本
4.1 Bash
#!/bin/bash
# Usage: ./get-token.sh &lt;endpoint&gt; &lt;api-key&gt; realtime|whisper|translate
ENDPOINT="$1"; API_KEY="$2"; TYPE="$3"
case "$TYPE" in
  realtime) BODY='{"session":{"type":"realtime","model":"gpt-realtime",
    "audio":{"output":{"voice":"alloy"}}}}';;
  whisper) BODY='{"session":{"type":"transcription","audio":{"input":
    {"transcription":{"model":"gpt-realtime-whisper"}}}}}';;
  translate) BODY='{"session":{"type":"transcription","audio":{"input":
    {"transcription":{"model":"gpt-realtime-translate"}}}}}';;
esac
curl -s "${ENDPOINT}/openai/v1/realtime/client_secrets" \
  -H "api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "$BODY" | python3 -m json.tool
4.2 Python
import requests
def get_ephemeral_token(endpoint, api_key, model_type):
    url = f"{endpoint}/openai/v1/realtime/client_secrets"
    headers = {"api-key": api_key, "Content-Type": "application/json"}
    if model_type == "realtime":
        body = {"session": {"type": "realtime", "model": "gpt-realtime",
                "audio": {"output": {"voice": "alloy"}}}}
    else:  # whisper or translate
        body = {"session": {"type": "transcription",
                "audio": {"input": {"transcription":
                    {"model": f"gpt-realtime-{model_type}"}}}}}
    resp = requests.post(url, headers=headers, json=body)
    resp.raise_for_status()
    return resp.json()  # .value = ephemeral token
4.3 JavaScript — WebRTC SDP Exchange
async function exchangeSdp(endpoint, apiKey, model, offerSdp) {
  const isTx = ["gpt-realtime-whisper","gpt-realtime-translate"].includes(model);
  const cfg = isTx
    ? {session:{type:"transcription",audio:{input:{transcription:{model}}}}}
    : {session:{type:"realtime",model,audio:{output:{voice:"alloy"}}}};
  // Step 1: ephemeral token
  const r1 = await fetch(`${endpoint}/openai/v1/realtime/client_secrets`,
    {method:"POST", headers:{"api-key":apiKey,"Content-Type":"application/json"},
     body:JSON.stringify(cfg)});
  const {value: ek} = await r1.json();
  // Step 2: SDP exchange
  const r2 = await fetch(`${endpoint}/openai/v1/realtime/calls`,
    {method:"POST", headers:{Authorization:`Bearer ${ek}`,
     "Content-Type":"application/sdp"}, body:offerSdp});
  return await r2.text();  // answer SDP
}
5. 模型能力对比
模型
gpt-realtime
gpt-realtime-whisper
gpt-realtime-translate
Capability
realtime
realtimeTranscription
Session Type
realtime.session
功能
语音对话 (speech in/out)
realtime.transcription_session
realtimeTranslation
6. 常见错误及解决
realtime.transcription_session
实时语音转文字
实时语音翻译
错误
OpperationNotSupported
HTTP 500
原因
对 whisper/translate 用 type:"realtime"
model 放在 session.model
解决
改用 type:"transcription"
移到 audio.input.transcription.model
InvalidSessionType
401 Unauthorized
用了 type:"translation"
API key 不匹配资源
7. 可用区域 (截至 2026-05-11)
改用 type:"transcription"
确认 key 对应正确 Azure 资源
模型
gpt-realtime
gpt-realtime-mini
gpt-realtime-2
gpt-realtime-whisper
版本
2025-08-28
2025-10-06 / 12-15
2026-02-23
可用区域
East US 2, Sweden Central, France Central 等
多区域
SKU
GlobalStandard
GlobalStandard
East US 2, France Central 等
2026-05-06
gpt-realtime-translate
2026-05-06
France Central (新发布)
France Central (新发布)
GlobalStandard
GlobalStandard
GlobalStandar