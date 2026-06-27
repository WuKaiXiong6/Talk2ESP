<!--
文件路径：docs/ARCHITECTURE.md
文件作用：Talk2ESP 技术架构文档，定义技术栈、模块边界、关键流程、数据结构与扩展点
最后更新时间：2026-06-28-0325
-->

# Talk2ESP 技术架构文档（ARCHITECTURE.md）

> 版本：v0.1
> 日期：2026-06-28
> 关联：`docs/PRD.md`（产品需求）、`docs/process.md`（阶段记录）
> 本文与 PRD 第 3、4 节互为补充：PRD 定义「做什么」，本文定义「怎么做」。

---

## 1. 技术栈总览

| 层 | 技术 | 版本/说明 |
|---|---|---|
| 桌面框架 | **Tauri 2.x** | Rust 后端 + Web 前端，跨平台 |
| 前端 | React + TypeScript + Vite | 轻量、生态成熟 |
| 后端语言 | Rust | 编排器与各能力层核心 |
| 串口 | `serialport` 4.x | 枚举含 USB VID/PID，阻塞读 + spawn_blocking |
| 外部进程 | `tauri-plugin-shell` 的 `Command::spawn()` | 流式捕获 arduino-cli/esptool 的 stdout/stderr |
| IPC（流式） | `tauri::ipc::Channel<T>` | 串口输出/编译日志/LLM token 流 |
| IPC（请求） | `#[tauri::command]` + `invoke` | 枚举端口/开/关/发指令等一次性操作 |
| LLM（OpenAI 兼容） | `async-openai` | 自定义 base_url + SSE 流，覆盖 OpenAI/DeepSeek/智谱/通义 |
| LLM（Claude） | `anthropic-sdk-rust` 或 `anthropic-ai-sdk` | Claude 原生 Messages API + 流式 |
| 编译工具链 | arduino-cli 1.x（sidecar 打包） | arduino-esp32 核心包 3.3.10 |
| 烧录工具链 | esptool v5.3（sidecar 打包，`py -m esptool`） | 自动识别 chip |
| 敏感数据 | 系统密钥库（Windows Credential Manager） | API Key 加密存储 |
| 平台 | v1 优先 Windows（MSVC） | 架构预留 macOS/Linux |

### 1.1 关键技术决策与依据

- **Tauri 2.x 而非 1.x**：2.x 用 capabilities 权限系统取代 1.x allowlist，`tauri::api::process::Command` 已移除，改用 `tauri-plugin-shell`。代码进 `src-tauri/src/lib.rs`，`main.rs` 仅作壳。
- **串口异步方案**：`serialport` 仅阻塞 I/O。采用 `spawn_blocking` 跑读循环 + Channel 推送前端（比 `tokio-serial` 更简单，且 Windows 下稳定性足够）。
- **流式 IPC 用 Channel 而非 event**：Tauri 官方明确——event 在高频/async 监听下可能乱序，Channel 有序、类型安全、高吞吐，适合串口字节流与编译日志逐行输出。
- **LLM 双 SDK**：OpenAI 与 Claude 的 SSE 事件结构差异大（鉴权头、system prompt 位置、流式事件类型均不同），不能用同一解析器，故分用各自 SDK，统一抽象层适配。
- **arduino-cli/esptool 作为 sidecar**：通过 `bundle.externalBin` 打包进安装包，文件名带平台后缀（如 `arduino-cli-x86_64-pc-windows-msvc.exe`），实现「开箱即用、无需用户安装」。

---

## 2. 项目目录结构（Tauri 2.x 约定）

```
Talk2ESP/
├── docs/                          # 文档（PRD/ARCHITECTURE/process）
├── esptool_esp32_research_pack/   # 只读资料库（gitignore）
├── tools/                          # 开发自测工具（gitignore，arduino-cli 等）
├── examples/                       # 内置示例库（LED/按键/I2C/SPI/PWM/串口）
│   ├── led_blink/
│   ├── button_input/
│   ├── i2c_sensor/
│   ├── spi_device/
│   ├── pwm_fade/
│   └── serial_echo/
├── src-tauri/                      # Rust 后端项目根
│   ├── Cargo.toml
│ ├── build.rs
│   ├── tauri.conf.json             # 核心配置（identifier/windows/bundle/externalBin）
│   ├── capabilities/
│   │   └── default.json            # 权限声明（core:default / shell:allow-spawn + scope）
│   ├── sidecars/                   # 打包的外部二进制（构建时填充）
│   │   ├── arduino-cli-x86_64-pc-windows-msvc.exe
│   │   └── esptool-*.py（或 py 运行）
│   └── src/
│       ├── main.rs                 # 桌面入口（仅调 app_lib::run()）
│       ├── lib.rs                  # 应用入口 + 命令注册
│       ├── orchestrator/           # 流水线编排器（状态机）
│       │   ├── mod.rs
│       │   ├── state.rs            # 状态定义与转移
│       │   └── pipeline.rs         # 阶段执行
│       ├── ai/                     # AI 适配层
│       │   ├── mod.rs              # 统一 trait LlmProvider
│       │   ├── openai.rs           # OpenAI 兼容适配
│       │   ├── claude.rs           # Claude 适配
│       │   └── prompts.rs          # Prompt 模板
│       ├── toolchain/              # 工具链层
│       │   ├── mod.rs
│       │   ├── arduino_cli.rs      # arduino-cli 封装
│       │   └── esptool.rs          # esptool 封装
│       ├── device/                 # 设备/串口层
│       │   ├── mod.rs
│       │   ├── scanner.rs          # 串口扫描 + 型号识别
│       │   └── serial_monitor.rs   # 串口监控（读+发）
│       ├── project/                # 项目/存储层
│       │   ├── mod.rs
│       │   ├── model.rs            # 项目元数据/需求确认书/对话记录结构
│       │   └── storage.rs          # 文件夹读写
│       ├── safety/                 # 安全层
│       │   ├── mod.rs
│       │   ├── pin_blacklist.rs    # 引脚黑名单校验
│       │   └── danger_check.rs     # 危险代码扫描
│       └── chips/                  # 型号描述表
│           ├── mod.rs
│           ├── esp32s3.toml        # S3 引脚表/Flash偏移/特殊引脚
│           └── esp32c3.toml
├── src/                            # 前端（React + TS + Vite）
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/                 # 对话框/设备列表/串口监控/项目列表/设置
│   ├── hooks/                      # useTauriChannel 等
│   ├── stores/                     # 状态管理
│   └── types/                      # TS 类型定义（与 Rust 结构对齐）
├── package.json
└── vite.config.ts
```

---

## 3. 模块边界与职责

### 3.1 Pipeline Orchestrator（流水线编排器）—— 核心控制
- **职责**：维护项目状态机，按状态推进调用各层，记录每阶段日志，实现失败重试与转人工。
- **不拥有**：不直接做串口 I/O、不直接调 LLM HTTP、不直接拼 arduino-cli 命令——一律委托对应层。
- **接口**：`Pipeline::advance(project_id) -> StageResult`，内部按当前状态分发。
- **状态**：`Drafting → Confirmed → Coding → Compiling → FlashingConfirm → Flashing → Verifying → Archived / Failed`（详见 PRD 3.3）。

### 3.2 AI 适配层（ai/）
- **统一 trait**：
  ```rust
  pub trait LlmProvider: Send + Sync {
      async fn chat(&self, messages: Vec<ChatMessage>, on_token: Channel<TokenEvent>) -> Result<String>;
      async fn generate_code(&self, spec: &RequirementSpec) -> Result<GeneratedCode>;  // .ino + 测试桩
      async fn diagnose(&self, error: &str, context: &ProjectContext) -> Result<FixSuggestion>;
      async fn judge(&self, serial_output: &str, expectation: &Expectation) -> Result<Verdict>;
  }
  ```
- **适配器**：`OpenAiProvider`（async-openai，可配 base_url 适配国产）、`ClaudeProvider`。
- **Prompt 模板**：按阶段维护，注入型号引脚表、黑名单、示例库引用；结构化输出用 JSON schema 约束。
- **边界**：AI 只产出数据（代码文本/判定结果），不触发任何工具链动作。

### 3.3 工具链层（toolchain/）
- **arduino_cli.rs**：封装 `core install`、`compile --fqbn`、`upload -p`；流式捕获输出经 Channel 推前端；产出 .bin 路径与编译日志。
- **esptool.rs**：封装 `flash-id`（型号探测）、`erase-flash`、`write-flash`；进程 stderr 完整捕获供诊断；波特率失败自动降速重试。
- **边界**：只负责「执行命令+捕获输出」，不做语义判断；调用前由编排器确认参数（chip/port/offset）。

### 3.4 设备/串口层（device/）
- **scanner.rs**：`serialport::available_ports()` 枚举；匹配 `UsbPortInfo{vid,pid}` + 调 `esptool flash-id` 探测 chip；返回 `Vec<DeviceInfo>`。
- **serial_monitor.rs**：`spawn_blocking` 跑阻塞读循环，行缓冲后经 Channel 推前端；提供 `send_line(port, data)` 命令；串口占用锁防止多任务冲突。
- **多设备**：`DeviceRegistry` 管理多板状态，每板独立监控通道。

### 3.5 项目/存储层（project/）
- **model.rs**：`Project`（元数据）、`RequirementSpec`（需求确认书 JSON）、`ConversationRecord`（jsonl）、`StageLog`。
- **storage.rs**：按 PRD 3.4 文件夹结构读写；导入导出为 zip。
- **边界**：所有持久化集中于此，其他层不直接写文件。

### 3.6 安全层（safety/）
- **pin_blacklist.rs**：按型号描述表校验代码中引用的引脚；Error 级阻断、Warn 级提示。
- **danger_check.rs**：正则/轻量 AST 扫描危险操作（关看门狗、过载配置、改启动配置等）。
- **校验时机**：代码生成后 + 烧录前各一次。

### 3.7 型号描述表（chips/）
- 每芯片一份 TOML：`chip` 参数、`fqbn`、Flash 偏移、引脚总数、`pin_blacklist_error`、`pin_blacklist_warn`、`pin_safe_default`。
- v1 内置 S3、C3；新增型号只需加文件 + 注册。

### 3.8 前端（src/）
- 纯展示与交互，不持有业务逻辑；通过 `invoke` 调命令、`Channel` 收流式数据。
- 主要视图：对话、设备列表、串口监控、项目列表、设置。

---

## 4. 关键流程

### 4.1 全自动流程时序

```
前端 invoke(start_pipeline, {project_id, mode})
  ↓
Orchestrator.advance()
  ├─[Confirmed→Coding] ai.generate_code(spec) → 校验 pin_blacklist/danger
  │     └─ Channel<LogEvent> 推「生成中…」
  ├─[Coding→Compiling] toolchain.arduino_cli.compile()
  │     └─ Channel<CommandEvent> 流式推编译输出
  │     └─ 失败：ai.diagnose() → 修复代码 → 重编译（≤3次）
  ├─[Compiling→FlashingConfirm] 前端弹窗（全自动模式按配置跳过/保留）
  ├─[FlashingConfirm→Flashing] toolchain.esptool.write_flash()
  │     └─ 失败：降波特率重试 / ai.diagnose()（≤3次）
  ├─[Flashing→Verifying] device.serial_monitor.start() → 收集测试桩输出
  │     └─ ai.judge(serial_output, expectation) → Verdict
  │     └─ 失败：ai.diagnose() → 修代码 → 回 Coding（≤3次）
  └─[Verifying→Archived/Failed] project.storage.archive()
```

### 4.2 流式数据通道一览

| 数据流 | Rust 来源 | IPC 机制 | 前端消费 |
|---|---|---|---|
| LLM 对话 token | LlmProvider stream | `Channel<TokenEvent>` | 对话框逐字渲染 |
| 编译日志 | arduino-cli spawn | `Channel<CommandEvent>` | 编译面板实时滚动 |
| 烧录进度 | esptool spawn | `Channel<CommandEvent>` | 烧录面板进度条 |
| 串口输出 | serialport 读循环 | `Channel<SerialLine>` | 串口监控面板 |
| 阶段状态变更 | Orchestrator | `Channel<StageEvent>` | 流水线状态指示器 |

### 4.3 失败重试与转人工
- 每阶段独立 `retry_count`，上限 3。
- 编译/烧录失败：AI 诊断 → 修代码/调参数 → 重入该阶段。
- 验证失败：AI 诊断 → 修代码 → 回到 Coding 重新编译烧录验证（整链重试，仍计该阶段次数）。
- 超限：状态转 `Failed`，保留最后一次错误与全量日志，前端提示用户接管。

### 4.4 设备识别流程
```
scanner.scan()
  → serialport::available_ports()
  → 过滤 UsbPort，取 vid/pid/product
  → 对每个候选端口 esptool flash-id（短超时）→ chip 型号
  → 匹配 chips/ 描述表 → DeviceInfo{port, chip, mac, flash_size, ...}
  → 前端列表展示，用户可修正 chip/port
```

---

## 5. 数据结构

### 5.1 需求确认书（requirement.json）
```json
{
  "project_name": "gpio-flicker-echo",
  "chip": "esp32s3",
  "peripherals": [
    {"type": "GPIO_OUT", "pin": 1, "behavior": "输出1kHz方波"},
    {"type": "GPIO_IN",  "pin": 2, "behavior": "读取电平回显串口"}
  ],
  "expected_behavior": "GPIO1输出方波；GPIO2电平变化时串口打印当前电平",
  "test_harness_expectation": {
    "cases": [
      {"name": "gpio1_toggle", "expect": "TEST:PASS gpio1_toggle"}
    ]
  }
}
```

### 5.2 测试桩协议
代码运行时串口输出约定：
```
TEST:START <case_name>
TEST:PASS <case_name>            # 或 TEST:FAIL <case_name> <reason>
TEST:END
```
编排器按行扫描提取，交给 `ai.judge()` 与 `expected_behavior` 比对。

### 5.3 验证判定（verify_*.json）
```json
{
  "verdict": "pass" | "fail",
  "matched_cases": ["gpio1_toggle"],
  "failed_cases": [],
  "reason": "",
  "ai_analysis": "..."
}
```

### 5.4 项目元数据（project.json）
```json
{
  "id": "uuid",
  "name": "gpio-flicker-echo",
  "chip": "esp32s3",
  "port": "COM4",
  "created_at": "2026-06-28T03:25:00+08:00",
  "state": "Archived",
  "auto_mode": "full" | "step",
  "pin_blacklist_snapshot": {"error": [...], "warn": [...]},
  "llm_provider": "openai" | "claude" | "deepseek" | ...
}
```

---

## 6. 型号描述表与引脚黑名单

### 6.1 ESP32-S3（chips/esp32s3.toml）
```toml
chip = "esp32s3"
fqbn = "esp32:esp32:esp32s3"
flash_offset_app = "0x10000"
pin_count = 49
# Error 级（阻断）：Flash/PSRAM 物理引脚 + VDD_SPI 电压选择
pin_blacklist_error = [26, 27, 28, 29, 30, 31, 32, 45]
# Octal PSRAM 变体（S3R8/R8V）额外阻断
pin_blacklist_error_octal = [33, 34, 35, 36, 37]
# Warn 级（提示）：Strapping/USB/JTAG/UART0
pin_blacklist_warn = [0, 3, 46, 19, 20, 39, 40, 41, 42, 43, 44]
# 安全默认
pin_safe_default = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 47, 48]
```

### 6.2 ESP32-C3（chips/esp32c3.toml）
```toml
chip = "esp32c3"
fqbn = "esp32:esp32:esp32c3"
flash_offset_app = "0x10000"
pin_count = 22
pin_blacklist_error = [12, 13, 14, 15, 16, 17]   # Flash 物理引脚
pin_blacklist_warn = [2, 8, 9, 18, 19, 20, 21]   # Strapping + USB + UART0
pin_safe_default = [6, 7, 10, 11]
```

### 6.3 黑名单处理规则
- **Error 级**：代码引用即阻断，必须修改后才能进入编译；GPIO45（VDD_SPI）无论场景都阻断。
- **Warn 级**：可生成但前端高亮提示风险，用户确认后继续；Strapping 引脚（S3:0/3/46；C3:2/8/9）提示「复位瞬间电平敏感」。
- **Octal 变体**：无法识别具体型号时，GPIO33–37 一并放入 Warn（提示需确认芯片型号）。
- **校验实现**：正则提取代码中 `pinMode/digitalWrite/analogRead/...` 的引脚字面量 + 轻量 AST 复核，与黑名单比对。

---

## 7. 安全与权限

### 7.1 Tauri capabilities（src-tauri/capabilities/default.json）
- `core:default`：基础窗口/事件权限。
- `shell:allow-spawn` + scoped commands：仅允许 `arduino-cli`、`esptool`/`py`（限定二进制路径与参数校验）。
- 自定义 `#[tauri::command]`：逐个授权（枚举端口/打开监控/发送数据/启动流水线等）。
- 不开放 `fs:allow-*` 通用文件读写——文件操作只在后端 project 层完成。

### 7.2 敏感数据
- API Key 通过 `keyring` crate 存入 Windows Credential Manager（macOS Keychain / Linux Secret Service）。
- 配置文件不存明文 Key；仅存供应商选择、base_url、模型名等非敏感项。
- 烧录前确认默认开启；全自动模式关闭该确认需用户在设置中显式同意。

### 7.3 数据流向
- 仅「需求文本 + 生成代码上下文」经云端 LLM；串口数据、本地项目文件不外传。

---

## 8. 扩展点

| 扩展点 | 机制 | v1 状态 |
|---|---|---|
| 芯片型号 | 新增 `chips/<chip>.toml` + 注册 | S3/C3 |
| LLM 供应商 | 实现 `LlmProvider` trait | OpenAI兼容/Claude |
| 编译框架 | toolchain 层新增 Provider（当前仅 arduino-cli） | 单实现 |
| 自动化模式 | Orchestrator 配置项（full/step） | 两种 |
| 示例库 | `examples/` 目录追加 + prompt 引用 | 6 类基础示例 |

---

## 9. 已验证的关键链路（2026-06-28-0306 自测）

| 环节 | 验证方式 | 结果 |
|---|---|---|
| arduino-cli 编译 S3 | `compile --fqbn esp32:esp32:esp32s3` Blink | ✅ 313KB/23% |
| esptool 烧录 S3 | `upload -p COM4` | ✅ 2.5s, Hash 校验通过 |
| 串口读取测试桩 | pyserial 115200 读 COM4 | ✅ 收到 `TEST:PASS blink` |
| 双板识别 | esptool flash-id COM4/COM8 | ✅ 两块 S3, 16MB Flash |
| 核心包 | arduino-esp32 3.3.10 | ✅ 含 S3/S2/C3 库 |

> 链路验证记录详见 `docs/process.md` 第 3 节。架构选型已有实证支撑。
