<!--
文件路径：README.md
文件作用：Talk2ESP 项目说明（使用/运行/部署）
最后更新时间：2026-06-28-0306
-->

# Talk2ESP

> 用自然语言对话，全自动完成 ESP32 单片机开发（编码 → 编译 → 烧录 → 验证）的桌面工具。

## 项目简介

Talk2ESP 让创客/爱好者只需「接好开发板与外设 + 用自然语言描述需求」，AI 即可完成从代码生成到烧录验证的全流程。基于 esptool + arduino-cli 的轻量化工具链，环境简单、开箱即用。

- **形态**：Tauri 桌面应用（Rust 后端 + Web 前端）
- **框架**：Arduino（arduino-cli 内置）
- **AI**：云端 LLM，多供应商可切换（OpenAI / Claude / 国产模型）
- **型号**：v1 支持 ESP32-S3、ESP32-C3，架构预留扩展

详见 [`docs/PRD.md`](docs/PRD.md)。

## 当前状态

| 阶段 | 状态 |
|---|---|
| S0 需求确认 | 🟡 进行中（PRD 待评审） |
| S1 架构设计 | ⏳ 未开始 |
| S2 实现计划 | ⏳ 未开始 |
| S3 核心实现 | ⏳ 未开始 |

阶段详情见 [`docs/process.md`](docs/process.md)。

## 目录结构

```
Talk2ESP/
├── AGENTS.md                       # 项目级 AI Agent 工作规则
├── README.md                       # 本文件
├── .gitignore
├── docs/
│   ├── PRD.md                      # 产品需求文档
│   └── process.md                  # 阶段计划/状态/验证记录/重大决策
└── esptool_esp32_research_pack/    # 只读参考资料库（已 gitignore）
```

## 开发须知

- 所有开发流程遵循 [`AGENTS.md`](AGENTS.md)。
- `esptool_esp32_research_pack/` 为只读资料库，供开发参考，**不修改、不入产品依赖**。

## 快速开始

> ⚠️ 项目处于需求确认阶段，尚无可运行的代码。以下为规划中的使用方式。

1. 安装 Talk2ESP 桌面应用（规划中）；
2. 用 USB 连接 ESP32 开发板，接好外设；
3. 在对话框输入需求，与 AI 确认；
4. 自动完成编码 → 编译 → 烧录 → 验证。

## 技术栈

- **桌面**：Tauri（Rust + Web 前端）
- **编译**：arduino-cli（内置）
- **烧录**：esptool
- **AI**：云端 LLM（多供应商适配器）
