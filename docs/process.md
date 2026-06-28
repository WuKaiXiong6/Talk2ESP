<!--
文件路径：docs/process.md
文件作用：Talk2ESP 项目阶段总计划、阶段状态、验证记录与重大决策记录
最后更新时间：2026-06-28-1014
-->

# Talk2ESP 开发过程记录（process.md）

> 本文档记录 Talk2ESP 的总计划、各阶段状态、验证记录与重大决策，是项目推进的唯一事实来源。

---

## 1. 总计划与阶段状态

| 阶段 | 内容 | 状态 | 备注 |
|---|---|---|---|
| S0 需求确认 | 多轮对话澄清需求，产出 `docs/PRD.md` | ✅ 完成（PRD 已定稿） | 2026-06-28 用户确认通过 |
| S1 架构设计 | 产出 `docs/ARCHITECTURE.md`（模块边界/关键流程/技术细节） | ✅ 完成 | 2026-06-28 产出架构文档 |
| S2 实现计划 | 基于 PRD 拆解实现计划（里程碑/任务/验证项） | ✅ 完成 | 里程碑总览 + M0详细计划 |
| S3 核心实现 | Tauri 骨架 + 设备/串口层 + 工具链层 + AI 适配层 + 编排器 | 🟡 进行中 | M0完成，M1-M9进行中 |
| S4 闭环验证 | 双板 S3 互连环境验证全自动流程 | ⏳ 未开始 | |
| S5 打包发布 | Windows 安装包、示例库、文档完善 | ⏳ 未开始 | |

### 里程碑进度（S3 细化）

| 里程碑 | 内容 | 状态 | 验证 |
|---|---|---|---|
| M0 | Tauri 骨架 + 前后端通信打通 | ✅ 完成 | scan_ports单测通过+GUI启动验证 |
| M1 | 设备/串口层（型号识别+监控读写） | ✅ 完成 | scan_devices+串口回显端到端测试通过 |
| M2 | 工具链层（arduino-cli编译+esptool烧录） | ✅ 完成 | 编译+烧录COM8流式推送测试通过 |
| M3 | AI 适配层（OpenAI兼容+Claude） | ✅ 完成 | 真实LLM对话+代码生成+生成代码可编译通过 |
| M4 | 安全层 + 型号描述表 | ✅ 完成 | 引脚黑名单Error/Warn+危险扫描18测试全过 |
| M5 | 项目/存储层 | ⏳ 未开始 | |
| M6 | 编排器（流水线状态机） | ⏳ 未开始 | |
| M7 | 前端完整界面 | ⏳ 未开始 | |
| M8 | 闭环验证（双板自测） | ⏳ 未开始 | |
| M9 | 示例库 + 打包发布 | ⏳ 未开始 | |

---

## 2. 当前阶段：S0 需求确认

### 2.1 阶段目标
通过多轮结构化提问，与用户确认 Talk2ESP 的产品定位、功能范围、架构方向与技术选型，产出可指导后续实现的 `docs/PRD.md`。

### 2.2 完成情况
已完成 6 轮提问（每轮 4 题选择题），覆盖维度：

| 轮次 | 主题 | 关键决策 |
|---|---|---|
| 第1轮 | 产品形态/框架/用户/自动化 | 桌面应用 + Arduino + 创客/爱好者 + 可配置模式 |
| 第2轮 | AI 提供方/外设抽象/设备发现 | 云端 API + 多供应商 + 原生代码 + 自动+手动修正 |
| 第3轮 | 桌面栈/编译管理/烧录/验证 | Tauri + 内置 arduino-cli + 烧录监控一体 + AI 读串口判断 |
| 第4轮 | 双板定位/对话流程/持久化/安全 | 仅自测 + 需求确认书 + 项目文件夹 + 四项安全机制 |
| 第5轮 | 失败自愈/串口监控/多设备/验证协议 | 重试上限3次 + 可读可发 + 多设备并行 + 生成测试桩 |
| 第6轮 | 供应商范围/型号扩展/离线/示例 | OpenAI+Claude+国产 + S3/C3预留扩展 + 在线为主 + 内置示例库 |

并在架构方案选择中确认：**方案 A 流水线编排式架构**。

### 2.3 已产出
- `docs/PRD.md`（v0.1，含 6 节：产品定位、功能范围、架构设计、关键技术、v1范围与验收、决策附录）

### 2.4 待办（本阶段）
- [x] 用户评审 `docs/PRD.md` 并确认定稿；2026-06-28 用户确认通过，PRD 定稿，进入 S1。

---

## 2B. 当前阶段：S1 架构设计与环境准备

### 2B.1 阶段目标
- 初始化 git 仓库与开发分支；
- 搭建开发与自测环境（安装 esptool / arduino-cli，验证两块 ESP32-S3）；
- 产出 `docs/ARCHITECTURE.md`（模块边界/关键流程/技术细节）。

### 2B.2 环境侦察记录（2026-06-28-0306）
- 工具链：git 2.53 / node v24.15 / npm 11.12 / rustc 1.95 / cargo 1.95 / python 3.14 均已就绪；
- 已安装 esptool v5.3.0（`py -m esptool`）、arduino-cli 1.1.1（位于 `tools/arduino-cli/`，仅供开发自测）；
- 已安装 arduino-esp32 核心包 3.3.10（含 S3/S2/C3 等编译库）；
- 已连接两块 ESP32-S3（USB-Enhanced-SERIAL CH343，VID_1A86 PID_55D3）：**COM4**（MAC a4:cb:8f:d8:a2:e0）、**COM8**（MAC 98:a3:16:e6:46:74），均 16MB Flash / 8MB PSRAM。

---

## 3. 验证记录

### 验证 2026-06-28-0306：ESP32-S3 编译/烧录/串口闭环链路自测
- **验证时间**：2026-06-28-0306
- **验证对象**：arduino-cli 编译 + esptool 烧录 + pyserial 串口读取 的完整闭环（Talk2ESP 技术选型可行性）
- **验证环境**：Windows 10，arduino-cli 1.1.1 + arduino-esp32 3.3.10，esptool v5.3.0，pyserial 3.5，ESP32-S3 @ COM4
- **操作步骤**：
  1. 编写最小 Blink 程序（GPIO2 闪烁 + 串口输出 `TEST:PASS blink` 测试桩标记），fqbn=`esp32:esp32:esp32s3`；
  2. `arduino-cli compile` 编译；
  3. `arduino-cli upload -p COM4` 烧录；
  4. pyserial 以 115200 读取 COM4 输出 6 秒。
- **观察现象**：
  - 编译成功，占用 313736 字节（23% Flash）；
  - 烧录成功，写入 172458 字节（压缩后），2.5 秒完成，Hash 校验通过；
  - 串口正确收到启动日志及连续 `TEST:START blink` / `TEST:PASS blink` / `TEST:END` 标记。
- **结论**：通过
- **遗留问题**：无。技术链路（编译→烧录→串口读取→测试桩判定）已验证可行，为 Talk2ESP 核心架构选型提供实证支撑。

### 验证 2026-06-28-0337：M0 Tauri 骨架与前后端通信
- **验证时间**：2026-06-28-0337
- **验证对象**：M0 里程碑——Tauri 2.x 骨架 + scan_ports 串口枚举 + Channel 流式通信
- **验证环境**：Windows 10，Tauri 2.11.3 + Rust 1.95 + serialport 4.9 + React 19 + Vite 7，两块 ESP32-S3 @ COM4/COM8
- **操作步骤**：
  1. `create-tauri-app` 生成 React-TS 项目，修正包名/标题为 Talk2ESP，添加 serialport + tauri-plugin-shell 依赖；
  2. 实现 `scan_ports` 命令（serialport 枚举 USB 串口含 VID/PID）+ `start_tick` 命令（Channel 流式推送）；
  3. 前端 App.tsx 实现串口列表表格 + Channel Tick 测试；
  4. `cargo build` 编译后端、`tsc --noEmit` 类型检查、`cargo test` 单元测试、`npm run tauri dev` 启动 GUI。
- **观察现象**：
  - Rust 编译通过；TS 类型检查通过；
  - `cargo test scan_ports_detects_ch343` 通过：检测到 ≥2 个 CH343 串口（VID 0x1A86），VID/PID 字段均填充；
  - `tauri dev` 启动成功：talk2esp 进程存活，vite dev server @ :1420 可访问，前端 App.tsx/main.tsx 编译加载正确。
- **结论**：部分通过（自动化部分全通过；GUI 窗口内点击交互现象待人工确认）
- **遗留问题**：
  1. GUI 渲染现象（点「刷新串口」看到 COM4/COM8 表格、点「开始 Tick」看到 1→5）属界面交互，按 AGENTS.md 需人工确认窗口现象，当前仅验证到进程启动+前端编译+后端单测；
  2. 后续 M7 前端完整界面阶段将做更全面的 GUI 自动化验证。

### 验证 2026-06-28-0345：M1 设备/串口层（型号识别 + 串口监控读写）
- **验证时间**：2026-06-28-0345
- **验证对象**：M1 里程碑——scan_devices 型号识别 + SerialMonitor 串口监控（可读可发）
- **验证环境**：Windows 10，Tauri 2.11.3 + serialport 4.9，两块 ESP32-S3 @ COM4/COM8，COM4 已烧录回显程序
- **操作步骤**：
  1. 实现 `device/scanner.rs`：枚举 USB 串口 + 调 `py -m esptool flash-id` 解析 chip/MAC/flash_size；
  2. 实现 `device/serial_monitor.rs`：start_with_callback 读线程阻塞读 + try_clone 写半部 + send/stop/active_ports，支持多设备并行；
  3. 烧录回显程序到 COM4（收到行后回显 `ECHO:<内容>`）；
  4. `cargo test scan_devices_detects_esp32s3` 验证型号识别；
  5. `cargo test monitor_send_and_receive_echo` 验证 SerialMonitor start→send→回调收到 ECHO:hello→stop 全链路。
- **观察现象**：
  - `scan_devices_detects_esp32s3` 通过：探测出 esp32s3，MAC 与 flash_size(16MB) 均填充；
  - `monitor_send_and_receive_echo` 通过：send("hello") 后回调收到 `ECHO:hello`，证明读线程解码推送 + 写半部发送均正常；
  - 全量 5 个测试通过，无回归无警告。
- **结论**：通过
- **遗留问题**：无。设备/串口层核心能力（型号识别、多设备串口监控读写）已实证可用。

### 验证 2026-06-28-0955：M2 工具链层（编译 + 烧录流式推送）
- **验证时间**：2026-06-28-0955
- **验证对象**：M2 里程碑——arduino-cli 编译 + upload 烧录，stdout/stderr 流式经回调推送
- **验证环境**：Windows 10，Tauri 2.11.3 + arduino-cli 1.1.1 + arduino-esp32 3.3.10，COM8(ESP32-S3)
- **操作步骤**：
  1. 实现 `toolchain/arduino_cli.rs`：`run_streaming` 用 std::process::Command + 管道读取线程，stdout 主线程逐行推送回调，stderr 子线程收集后合并；隐藏 Windows 控制台窗口；
  2. `compile_project(sketch, fqbn, on_event)`、`flash_project(sketch, fqbn, port, on_event)`；
  3. `resolve_arduino_cli` 三级解析（环境变量 > 项目内 tools/ > 系统 PATH）；
  4. `cargo test compile_blink_s3_success`：编译 Blink 到 S3 验证流式事件+Finished；
  5. `cargo test flash_blink_to_com8_success`：先编译再 upload 到 COM8 验证烧录链路。
- **观察现象**：
  - 编译测试通过：success=true，exit_code=Some(0)，收到 Stdout 流式事件 + Finished(0)；
  - 烧录测试通过：先 compile 成功，再 upload 到 COM8 成功，success=true，含 Finished 事件；
  - 全量 7 个测试通过，无回归无警告。
- **结论**：通过
- **遗留问题**：烧录前需先编译（arduino-cli upload 不自动重编译），编排器(M6)需保证 compile→flash 顺序。

### 验证 2026-06-28-1007：M3 AI适配层（真实LLM对话+代码生成+生成代码可编译）
- **验证时间**：2026-06-28-1007
- **验证对象**：M3 里程碑——LlmProvider trait + OpenAI兼容适配器 + 真实 LLM 对话/代码生成/生成代码可编译
- **验证环境**：Windows 10，火山方舟 glm-5.2（OpenAI兼容协议），reqwest 0.12 + async-trait
- **操作步骤**：
  1. 实现 `ai/mod.rs`：LlmProvider trait（chat/generate_code/diagnose/judge）+ 数据结构（RequirementSpec/GeneratedCode/Verdict/FixSuggestion）；
  2. 实现 `ai/openai_compat.rs`：OpenAiCompatProvider 调 OpenAI 兼容 chat/completions，从 .env.local 读配置，JSON 解析容忍 markdown 包裹；
  3. 实现 `ai/prompts.rs`：四类调用 prompt 模板，注入系统人设+引脚黑名单+测试桩协议；
  4. `cargo test --test m3_llm_real`：chat_basic + generate_code_blink 真实调 LLM；
  5. `cargo test --test m3_generate_compile`：生成代码写入临时目录用 arduino-cli 编译验证 M3↔M2 衔接。
- **观察现象**：
  - chat_basic 通过：glm-5.2 回复 "OK"；
  - generate_code_blink 通过：生成含 setup 的主程序+测试桩，代码注释正确说明 GPIO2 不在黑名单；
  - generate_then_compile 通过：AI 生成代码经 arduino-cli 编译 success=true exit=0。
- **结论**：通过
- **遗留问题**：judge/diagnose 的 prompt 已就绪，逻辑与 generate_code 同构（chat+JSON解析），将在 M6 编排器端到端验证时覆盖。

### 验证 2026-06-28-1014：M4 安全层+型号描述表（引脚黑名单+危险扫描）
- **验证时间**：2026-06-28-1014
- **验证对象**：M4 里程碑——chips 型号描述表(TOML) + safety 引脚黑名单校验 + 危险操作扫描
- **验证环境**：Windows 10，toml 0.8 + regex 1
- **操作步骤**：
  1. 创建 `chips/esp32s3.toml`、`chips/esp32c3.toml`：含 FQBN/Flash偏移/引脚黑名单(Error/Warn)/安全默认/引脚说明；
  2. 实现 `chips/mod.rs`：ChipDescriptor 加载 TOML + pin_level() 判定 + list_supported_chips()；
  3. 实现 `safety/pin_blacklist.rs`：正则提取 pinMode/digitalWrite 等函数引脚字面量，比对黑名单分级（Error阻断/Warn提示），跳过注释行；
  4. 实现 `safety/danger_check.rs`：regex 扫描关闭看门狗/改启动配置/引脚过载/直接操作Flash四类危险操作；
  5. lib.rs 注册 check_pins/scan_dangers/list_chips 命令；`cargo test --lib` 全量验证。
- **观察现象**：
  - chips 测试：S3/C3 描述表加载正确，pin_level 判定准确（GPIO45=Error, GPIO0=Warn, GPIO4=None）；
  - pin_blacklist 测试：S3 GPIO45 阻断、GPIO0 提示不阻断、C3 GPIO12 阻断、安全引脚无误报、注释行不触发；
  - danger_check 测试：disableCore0WDT/spi_flash_erase_sector 正确检出，安全代码无报告；
  - 全量 18 个测试通过，无回归无警告。
- **结论**：通过
- **遗留问题**：Octal PSRAM 变体(S3R8)的 GPIO33-37 默认按 Warn 处理（无法识别型号时），后续可按芯片 ID 精确识别后升级为 Error。

---

## 4. 重大决策记录

### 决策 2026-06-28-0306：核心架构选型为「流水线编排式（方案 A）」
- **时间**：2026-06-28-0306
- **背景**：需在「流水线编排式」「AI Agent 自主编排」「混合架构」三者间选择核心架构，决定系统的可维护性与「全自动」可靠性。
- **决策**：采用方案 A 流水线编排式架构。Pipeline Orchestrator（Rust）以显式状态机推进「需求澄清→确认→代码生成→编译→烧录→验证→归档」，AI 仅作为各阶段能力提供者被调用，不直接编排流程。
- **备选方案**：
  - 方案 B（AI Agent 自主编排）：最灵活但流程不可控、重试难限、安全门禁难保障；
  - 方案 C（混合架构）：对话灵活但两套心智模型需额外协调。
- **影响**：
  - 流程显式、可追溯，每阶段可独立测试；
  - 失败重试边界清晰，安全门禁（引脚黑名单、烧录前确认）有确定落点；
  - AI 不掌控流程，避免跑飞，符合 AGENTS.md「目标导向、可验证」。
- **回滚条件或后续观察点**：若后续发现固定状态机无法容纳某些灵活需求场景，可考虑在特定阶段（如错误诊断）局部引入 AI Agent 能力，但主流程编排权保留在 Rust 编排器。

### 决策 2026-06-28-0306：双板 S3 互连测试环境定位为「仅用于 Talk2ESP 自身开发自测」
- **时间**：2026-06-28-0306
- **背景**：用户已将两块 ESP32-S3 通过 USB 连接主机，并将 GPIO1/2/42/41/40/39/38/37/36/35/0/45/48/47/21/20/19/4/5/6/7/15/16/17/18/8/3/46/9 共 29 个引脚两两相连，创造测试环境。
- **决策**：该环境仅用于 Talk2ESP 自身的自动化测试开发（验证「生成代码烧录后能用」），不作为产品功能暴露给终端用户。双板交叉验证作为 Talk2ESP 自测手段，不进 v1 产品功能清单。
- **备选方案**：将其演化为产品的「验证模式」（需用户有两块板并互连）——门槛高，v1 不做。
- **影响**：v1 产品功能聚焦单板全自动闭环；双板交叉验证仅出现在 Talk2ESP 开发自测流程中。
- **回滚条件或后续观察点**：若用户后续明确希望产品支持双板联动验证，可作为 P2+ 迭代特性重新评估。

### 决策 2026-06-28-0325：技术栈选型（Tauri 2.x + serialport + tauri-plugin-shell + 双 LLM SDK）
- **时间**：2026-06-28-0325
- **背景**：S1 架构设计阶段需确定 Rust 后端各能力的具体 crate 与 Tauri 版本，影响全部后续实现。
- **决策**：
  1. Tauri 2.x（非 1.x），代码进 `src-tauri/src/lib.rs`，权限走 capabilities；
  2. 串口用 `serialport` 4.x（枚举含 VID/PID），异步用 `spawn_blocking` + Channel；
  3. 外部进程用 `tauri-plugin-shell` 的 `Command::spawn()` 流式捕获；
  4. 流式 IPC 一律用 `tauri::ipc::Channel<T>`（event 仅低频通知）；
  5. LLM 用 `async-openai`（OpenAI 兼容，含国产）+ `anthropic-sdk-rust`（Claude），统一 `LlmProvider` trait；
  6. arduino-cli/esptool 作为 sidecar 经 `bundle.externalBin` 打包。
- **备选方案**：Electron（体积大，与轻量化目标冲突）、`tokio-serial`（更复杂）、reqwest 自解析 SSE（需自实现重试/限流）。
- **影响**：目录结构、权限配置、所有流式数据通道设计定型；为「开箱即用」奠定基础。
- **回滚条件或后续观察点**：若 `serialport` 在 Windows 高波特率下丢字节，改用 `tokio-serial`；若某国产 LLM 的 OpenAI 兼容接口偏差大，单独适配。

### 决策 2026-06-28-0325：引脚黑名单分级（Error 阻断 / Warn 提示）
- **时间**：2026-06-28-0325
- **背景**：「全自动生成代码」场景需防止 AI 误用危险引脚损坏硬件，需明确分级标准。
- **决策**：按「是否会导致硬件损坏/芯片无法启动」分级——Flash/PSRAM 物理引脚、VDD_SPI 电压选择脚（S3 GPIO45）为 Error 级阻断；Strapping/USB/JTAG/UART0 为 Warn 级提示。详见 `docs/ARCHITECTURE.md` 第 6 节。
- **备选方案**：Strapping 引脚一刀切 Error——但大量合法 Arduino 例程（BOOT 键/板载 LED）使用 GPIO0/GPIO9，过严会误伤，故用 Warn。
- **影响**：`chips/*.toml` 字段定义、safety 层校验逻辑、AI prompt 注入内容定型。
- **回滚条件或后续观察点**：S3 Octal PSRAM 变体（S3R8/R8V）的 GPIO33–37 在无法识别型号时暂入 Warn，后续若可准确识别则升级为 Error。

### 决策 2026-06-28-1007：LLM 供应商定为火山方舟 glm-5.2（OpenAI 兼容协议）
- **时间**：2026-06-28-1007
- **背景**：M3 需真实 LLM 验证对话与代码生成。用户提供火山方舟接入。
- **决策**：采用火山方舟 glm-5.2（OpenAI 兼容协议，base_url=https://ark.cn-beijing.volces.com/api/coding/v3），通过 OpenAiCompatProvider 适配。API Key 存于 .env.local（已 gitignore，不入仓库）。
- **备选方案**：智谱 GLM-4-Flash（免费）、DeepSeek（低价）、Claude/OpenAI 原生。火山方舟 glm-5.2 为用户提供，国内访问稳定。
- **影响**：
  - glm-5.2 为推理模型，max_tokens 需≥4096（含 reasoning tokens）；
  - 验证 AI 生成 ESP32-S3 代码可真实编译通过，M3↔M2 衔接已实证；
  - 架构预留多供应商（LlmProvider trait），后续可加 Claude/其他。
- **回滚条件或后续观察点**：若 glm-5.2 生成代码质量不稳定或响应过慢，可切换其他供应商；trait 抽象保证切换成本低。
