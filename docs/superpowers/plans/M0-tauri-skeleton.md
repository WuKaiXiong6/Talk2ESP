# M0: Tauri 骨架 + 前后端通信打通 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Tauri 2.x 应用骨架，前端 React+TS+Vite，后端 Rust，打通 invoke 命令（返回串口列表）与 Channel 流式通信，应用可在 Windows 启动。

**Architecture:** create-tauri-app 脚手架生成 Tauri 2.x 项目；后端 Rust 添加 serialport crate 实现串口枚举命令；前端用 @tauri-apps/api/core 的 invoke 调用并展示。验证 IPC 双向通信（invoke + Channel）。

**Tech Stack:** Tauri 2.x、Rust、serialport 4.x、React 18、TypeScript、Vite

---

## 文件结构（M0 范围）

- Create: `src-tauri/Cargo.toml`（依赖 tauri + tauri-plugin-shell + serialport）
- Create: `src-tauri/src/lib.rs`（应用入口 + 命令注册 + scan_ports 命令）
- Create: `src-tauri/src/main.rs`（桌面壳）
- Create: `src-tauri/tauri.conf.json`（核心配置）
- Create: `src-tauri/capabilities/default.json`（权限）
- Create: `src/App.tsx`（前端：展示串口列表 + 测试 Channel）
- Create: `src/main.tsx`
- Create: `package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`

---

### Task 1: 初始化 Tauri 项目骨架

**Files:**
- Create: 整个 `src-tauri/`、`src/`、`package.json` 等脚手架产物

- [ ] **Step 1: 用 create-tauri-app 生成项目（React + TS）**

在项目根目录执行（注意：在已有 docs/ 目录的仓库内初始化，选择当前目录）：

```bash
cd "E:/_2026/idea/Talk2ESP"
npm create tauri-app@latest -- --template react-ts --manager npm --name Talk2ESP --identifier com.talk2esp.app
```

若交互式提示，选择：框架 React、语言 TypeScript、包管理 npm。生成后项目结构应包含 `src/`、`src-tauri/`、`package.json`、`index.html`。

- [ ] **Step 2: 验证脚手架可构建**

```bash
cd "E:/_2026/idea/Talk2ESP"
npm install
```

预期：依赖安装成功，生成 `node_modules/`。

- [ ] **Step 3: 安装 Rust 依赖并验证编译**

编辑 `src-tauri/Cargo.toml`，在 `[dependencies]` 添加：
```toml
serialport = "4.9"
tauri-plugin-shell = "2"
```

```bash
cd "E:/_2026/idea/Talk2ESP/src-tauri"
cargo build
```

预期：编译成功（首次下载依赖较慢）。

- [ ] **Step 4: 提交骨架**

```bash
cd "E:/_2026/idea/Talk2ESP"
# 确认 .gitignore 已含 node_modules/ target/ dist/
git add -A
git status
git commit -m "新增: 初始化Tauri 2.x项目骨架(React+TS)"
```

---

### Task 2: 后端实现串口枚举命令

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: 编写 scan_ports 命令**

替换 `src-tauri/src/lib.rs` 内容为：
```rust
// 文件路径：src-tauri/src/lib.rs
// 文件作用：Talk2ESP 应用入口，注册 Tauri 命令与插件
// 最后更新时间：2026-06-28-0328

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, Clone)]
pub struct PortInfo {
    pub name: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub product: Option<String>,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
}

#[tauri::command]
fn scan_ports() -> Vec<PortInfo> {
    let ports = serialport::available_ports().unwrap_or_default();
    ports
        .into_iter()
        .filter_map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(usb) => Some(PortInfo {
                name: p.port_name,
                vid: Some(usb.vid),
                pid: Some(usb.pid),
                product: usb.product,
                manufacturer: usb.manufacturer,
                serial_number: usb.serial_number,
            }),
            _ => None,
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![scan_ports])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: 注册 shell 插件权限**

编辑 `src-tauri/capabilities/default.json`，确保 permissions 数组含 `"shell:allow-spawn"` 与 `"core:default"`：
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "默认权限",
  "windows": ["main"],
  "permissions": ["core:default", "shell:allow-spawn"]
}
```

- [ ] **Step 3: 验证编译**

```bash
cd "E:/_2026/idea/Talk2ESP/src-tauri"
cargo build 2>&1 | tail -5
```

预期：编译成功，无 error。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "新增: scan_ports串口枚举命令(serialport枚举含VID/PID)"
```

---

### Task 3: 前端展示串口列表

**Files:**
- Modify: `src/App.tsx`
- Create: `src/types/port.ts`

- [ ] **Step 1: 定义 TS 类型对齐 Rust 结构**

创建 `src/types/port.ts`：
```typescript
// 文件路径：src/types/port.ts
// 文件作用：串口信息前端类型定义，与 Rust PortInfo 对齐

export interface PortInfo {
  name: string;
  vid: number | null;
  pid: number | null;
  product: string | null;
  manufacturer: string | null;
  serial_number: string | null;
}
```

- [ ] **Step 2: 实现串口列表展示页面**

替换 `src/App.tsx`：
```tsx
// 文件路径：src/App.tsx
// 文件作用：应用主组件，展示串口列表验证前后端通信
// 最后更新时间：2026-06-28-0328

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PortInfo } from './types/port';

function App() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const list = await invoke<PortInfo[]>('scan_ports');
      setPorts(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>Talk2ESP — M0 骨架验证</h1>
      <button onClick={refresh}>刷新串口</button>
      {error && <p style={{ color: 'red' }}>错误：{error}</p>}
      <h2>检测到的串口（{ports.length}）</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr><th>端口</th><th>VID</th><th>PID</th><th>产品</th><th>厂商</th><th>序列号</th></tr>
        </thead>
        <tbody>
          {ports.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>{p.vid ? `0x${p.vid.toString(16).toUpperCase()}` : '-'}</td>
              <td>{p.pid ? `0x${p.pid.toString(16).toUpperCase()}` : '-'}</td>
              <td>{p.product ?? '-'}</td>
              <td>{p.manufacturer ?? '-'}</td>
              <td>{p.serial_number ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
```

- [ ] **Step 3: 启动开发服务器验证**

```bash
cd "E:/_2026/idea/Talk2ESP"
npm run tauri dev
```

预期：应用窗口弹出，表格显示 COM4、COM8 两块 ESP32-S3（VID 0x1A86 PID 0x55D3）。手动确认后关闭。

- [ ] **Step 4: 提交**

```bash
git add src/App.tsx src/types/port.ts
git commit -m "新增: 前端串口列表展示页(验证invoke通信)"
```

---

### Task 4: 验证 Channel 流式通信

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/App.tsx`

- [ ] **Step 1: 添加流式测试命令（用 Channel 推送计数）**

在 `lib.rs` 的 `run()` 之前添加命令：
```rust
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum TickEvent {
    Tick { count: u32 },
    Done,
}

#[tauri::command]
fn start_tick(on_event: Channel<TickEvent>) {
    std::thread::spawn(move || {
        for i in 1..=5 {
            let _ = on_event.send(TickEvent::Tick { count: i });
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        let _ = on_event.send(TickEvent::Done);
    });
}
```

在 `run()` 的 `invoke_handler` 中注册：
```rust
.invoke_handler(tauri::generate_handler![scan_ports, start_tick])
```

- [ ] **Step 2: 前端接收 Channel 数据**

在 `App.tsx` 添加按钮与显示区：
```tsx
import { Channel } from '@tauri-apps/api/core';
// ...在组件内：
const [ticks, setTicks] = useState<number[]>([]);
const [tickDone, setTickDone] = useState(false);

const startTick = async () => {
  setTicks([]);
  setTickDone(false);
  const ch = new Channel<{ event: string; data: { count?: number } }>();
  ch.onmessage = (msg) => {
    if (msg.event === 'Tick' && msg.data.count) setTicks((t) => [...t, msg.data.count!]);
    if (msg.event === 'Done') setTickDone(true);
  };
  await invoke('start_tick', { onEvent: ch });
};
```

在 JSX 中添加：
```tsx
<hr />
<h2>Channel 流式测试</h2>
<button onClick={startTick}>开始 Tick</button>
<p>收到：{ticks.join(', ')}</p>
<p>{tickDone ? '完成' : '运行中…'}</p>
```

- [ ] **Step 3: 启动验证**

```bash
npm run tauri dev
```

预期：点「开始 Tick」，每 0.5s 显示一个数字 1→5，最后显示「完成」。验证 Channel 流式 IPC 可用。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/lib.rs src/App.tsx
git commit -m "新增: Channel流式通信验证(start_tick命令)"
```

---

### Task 5: 合并到 main 前的验证与文档同步

**Files:**
- Modify: `docs/process.md`

- [ ] **Step 1: 完整启动验证**

```bash
npm run tauri dev
```

验证清单：
- [ ] 应用窗口正常弹出
- [ ] 串口列表显示 COM4、COM8（VID 0x1A86 PID 0x55D3）
- [ ] Channel Tick 测试：1→5 依次显示并「完成」
- [ ] 无控制台报错

- [ ] **Step 2: 记录验证到 process.md**

在 `docs/process.md` 第 3 节追加 M0 验证记录（按 AGENTS.md 验证模板）。

- [ ] **Step 3: 更新里程碑状态**

编辑 `docs/process.md` 总计划表，新增 M0 行并标记完成。

- [ ] **Step 4: 提交并合并 main**

```bash
git add docs/process.md
git commit -m "文档: 记录M0骨架验证通过"
# 合并到 main（需确认）
git checkout main
git merge --no-ff m0-tauri-skeleton -m "合并: M0 Tauri骨架与前后端通信"
git checkout -b m1-device-serial
```

---

## M0 验证标准（合并门禁）
1. 应用可在 Windows 启动，无报错；
2. `scan_ports` 命令返回 COM4、COM8（VID 0x1A86 PID 0x55D3）；
3. Channel 流式通信验证通过（Tick 1→5）；
4. 代码审查无 blocking 问题；
5. 验证记录写入 `docs/process.md`。
