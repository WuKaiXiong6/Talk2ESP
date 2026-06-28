<!--
文件路径：README.md
文件作用：Talk2ESP 项目说明（使用/运行/部署）
最后更新时间：2026-06-28-1045
-->

# Talk2ESP

> 用自然语言对话，全自动完成 ESP32 单片机开发（编码 → 编译 → 烧录 → 验证）的桌面工具。

## 项目简介

Talk2ESP 让创客/爱好者只需「接好开发板与外设 + 用自然语言描述需求」，AI 即可完成从代码生成到烧录验证的全流程。基于 esptool + arduino-cli 的轻量化工具链，环境简单、开箱即用。

- **形态**：Tauri 2.x 桌面应用（Rust 后端 + Web 前端）
- **框架**：Arduino（arduino-cli 内置）
- **AI**：云端 LLM，多供应商可切换（已验证火山方舟 glm-5.2）
- **型号**：v1 支持 ESP32-S3、ESP32-C3，架构预留扩展
- **安全**：引脚黑名单 + 危险代码告警 + 烧录前确认 + 敏感数据加密

详见 [`docs/PRD.md`](docs/PRD.md) 与 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 当前状态

| 阶段 | 状态 |
|---|---|
| S0 需求确认 | ✅ 完成 |
| S1 架构设计 | ✅ 完成 |
| S2 实现计划 | ✅ 完成 |
| S3 核心实现 (M0-M9) | ✅ 完成 |
| S4 闭环验证 | ✅ 通过（COM4+COM8 双板） |
| S5 打包发布 | 🟡 进行中 |

阶段详情见 [`docs/process.md`](docs/process.md)。

## 目录结构

```
Talk2ESP/
├── AGENTS.md                       # 项目级 AI Agent 工作规则
├── README.md                       # 本文件
├── .gitignore
├── docs/
│   ├── PRD.md                      # 产品需求文档
│   ├── ARCHITECTURE.md             # 技术架构文档
│   ├── process.md                  # 阶段计划/状态/验证记录/重大决策
│   └── superpowers/plans/          # 实现计划（里程碑总览+M0详细计划）
├── examples/                       # 内置示例库（LED/按键/I2C/SPI/PWM/串口）
├── src/                            # 前端（React + TS + Vite）
├── src-tauri/                      # Rust 后端
│   ├── src/
│   │   ├── device/                 # 设备/串口层
│   │   ├── toolchain/              # 工具链层（arduino-cli/esptool）
│   │   ├── ai/                     # AI 适配层（LlmProvider trait）
│   │   ├── chips/                  # 型号描述表（引脚黑名单）
│   │   ├── safety/                 # 安全层（引脚校验+危险扫描）
│   │   ├── project/                # 项目/存储层
│   │   └── orchestrator/           # 流水线编排器（状态机）
│   ├── chips/                      # 芯片 TOML 配置（esp32s3/esp32c3）
│   └── tests/                      # 端到端测试
└── esptool_esp32_research_pack/    # 只读资料库（已 gitignore）
```

## 快速开始

### 环境要求
- Rust 1.95+、Node.js 20+、Python 3.10+
- Windows 10+（v1 优先，架构预留 macOS/Linux）

### 开发模式运行
```bash
# 1. 配置 LLM（创建 .env.local，已 gitignore）
#    TALK2ESP_LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
#    TALK2ESP_LLM_API_KEY=<your_key>
#    TALK2ESP_LLM_MODEL=glm-5.2

# 2. 安装依赖并启动
npm install
npm run tauri dev
```

### 使用流程
1. 用 USB 连接 ESP32 开发板，接好外设；
2. 启动 Talk2ESP，自动扫描识别设备；
3. 在「开发」视图输入需求（如「GPIO2 每 500ms 闪烁」）；
4. 点击「🚀 一键全自动开发」，AI 自动完成编码→编译→烧录→验证。

## 技术栈

- **桌面**：Tauri 2.x（Rust + React + TypeScript + Vite）
- **编译**：arduino-cli（内置，自动管理 arduino-esp32 核心包）
- **烧录**：esptool v5（底层经 arduino-cli upload 调用）
- **AI**：云端 LLM（OpenAI 兼容协议，已验证火山方舟 glm-5.2）
- **串口**：serialport 4.x（枚举含 VID/PID + 实时读写监控）

## 开发须知

- 所有开发流程遵循 [`AGENTS.md`](AGENTS.md)。
- `esptool_esp32_research_pack/` 为只读资料库，供开发参考，**不修改、不入产品依赖**。
- `tools/` 为开发自测工具（arduino-cli 等），已 gitignore，不入仓库。
- `.env.local` 含 LLM API Key，已 gitignore，**不入仓库**。

## 测试

```bash
cd src-tauri
cargo test --lib          # 单元测试（含串口/编译/烧录/安全/存储）
cargo test --test m6_e2e_pipeline  # 端到端全自动闭环（需硬件+LLM Key）
cargo test --test m8_e2e_com8      # 双板自测（COM8）
```

已验证：24+ 自动化测试通过，含真实 LLM + 真实硬件端到端闭环。
