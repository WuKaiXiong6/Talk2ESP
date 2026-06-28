// 文件路径：src-tauri/src/device/serial_monitor.rs
// 文件作用：串口监控，实时读取推 Channel + 手动发送数据，多设备并行管理；#41 断开自动重连
// 最后更新时间：2026-06-29-0130

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use serialport::SerialPort as _;

/// 一行串口输出（推送给前端）
#[derive(Serialize, Clone)]
pub struct SerialLine {
    pub port: String,
    /// 已解码的文本行（解码失败时为 hex 占位）
    pub text: String,
    /// 是否为无法解码的原始字节
    pub raw: bool,
}

/// #40 完整串口参数（数据位/校验位/停止位）
/// 缺省时由调用方使用 serialport 默认值（8N1），保持既有行为兼容
#[derive(Clone, Debug)]
pub struct SerialParams {
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: String,
}

/// 将校验位字符串转为 serialport::Parity
fn parse_parity(s: &str) -> Result<serialport::Parity, String> {
    match s.to_lowercase().as_str() {
        "none" => Ok(serialport::Parity::None),
        "even" => Ok(serialport::Parity::Even),
        "odd" => Ok(serialport::Parity::Odd),
        _ => Err(format!("不支持的校验位: {s}")),
    }
}

/// 将停止位字符串转为 serialport::StopBits
fn parse_stop_bits(s: &str) -> Result<serialport::StopBits, String> {
    match s {
        "1" => Ok(serialport::StopBits::One),
        "1.5" => Ok(serialport::StopBits::Two), // serialport 4.x 不支持 1.5，退化为 2 并提示
        "2" => Ok(serialport::StopBits::Two),
        _ => Err(format!("不支持的停止位: {s}")),
    }
}

/// 将数据位转为 serialport::DataBits
fn parse_data_bits(b: u8) -> Result<serialport::DataBits, String> {
    match b {
        5 => Ok(serialport::DataBits::Five),
        6 => Ok(serialport::DataBits::Six),
        7 => Ok(serialport::DataBits::Seven),
        8 => Ok(serialport::DataBits::Eight),
        _ => Err(format!("不支持的数据位: {b}")),
    }
}

/// 单个串口的监控句柄：写半部 + 停止标志
struct MonitorHandle {
    writer: Box<dyn SerialPortWrite + Send>,
    stop_flag: Arc<AtomicBool>,
}

/// 写半部抽象（便于测试 mock）
trait SerialPortWrite: Write {
    #[allow(dead_code)]
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// serialport 的写半部实现
struct SerialWriter(Box<dyn serialport::SerialPort>);

impl Write for SerialWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

impl SerialPortWrite for SerialWriter {}

/// 多设备串口监控注册表（Tauri State）
pub struct SerialMonitor {
    /// port -> handle
    handles: Mutex<HashMap<String, MonitorHandle>>,
}

impl SerialMonitor {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
        }
    }

    /// 启动某端口的串口监控：读线程阻塞读取并经 Channel 推送，写半部存入 map
    pub fn start(&self, port: &str, baud: u32, on_line: Channel<SerialLine>) -> Result<(), String> {
        // Channel 实现了 Send + 'static，转成闭包供内部方法复用
        self.start_with_callback(port, baud, None, move |line| {
            let _ = on_line.send(line);
        })
    }

    /// #40 带完整串口参数启动监控（params 为 None 时沿用 8N1 默认）
    pub fn start_with_params(
        &self,
        port: &str,
        baud: u32,
        params: Option<SerialParams>,
        on_line: Channel<SerialLine>,
    ) -> Result<(), String> {
        self.start_with_callback(port, baud, params, move |line| {
            let _ = on_line.send(line);
        })
    }

    /// 启动串口监控的核心实现：读线程阻塞读取，每行经回调推送，写半部存入 map
    /// 抽出此方法便于单元测试注入回调（Tauri Channel 无法在纯测试中创建）
    pub fn start_with_callback<F>(
        &self,
        port: &str,
        baud: u32,
        params: Option<SerialParams>,
        on_line: F,
    ) -> Result<(), String>
    where
        F: FnMut(SerialLine) + Send + 'static,
    {
        // 已存在则先停止
        if self.handles.lock().unwrap().contains_key(port) {
            self.stop(port)?;
        }

        // 构造串口打开器，按需应用完整参数
        // 先克隆 params 供读线程重连使用（避免被下方 if let 移动）
        let params_clone = params.clone();
        let mut builder = serialport::new(port, baud).timeout(Duration::from_millis(100));
        if let Some(ref p) = params {
            builder = builder.data_bits(parse_data_bits(p.data_bits)?);
            builder = builder.parity(parse_parity(&p.parity)?);
            builder = builder.stop_bits(parse_stop_bits(&p.stop_bits)?);
        }
        let serial = builder
            .open()
            .map_err(|e| format!("打开串口 {port} 失败: {e}"))?;

        // 克隆出写半部
        let writer = serial
            .try_clone()
            .map_err(|e| format!("克隆串口写半部失败: {e}"))?;

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_reader = stop_flag.clone();
        let port_name = port.to_string();

        // 读线程：用原句柄阻塞读，按行缓冲回调推送；#41 断开后自动重连
        let mut on_line = on_line;
        let baud_val = baud;
        thread::spawn(move || {
            let mut reader = serial;
            let mut buf = [0u8; 256];
            let mut line_buf: Vec<u8> = Vec::new();
            let mut reconnect_attempts = 0u32;
            while !stop_flag_reader.load(Ordering::Relaxed) {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF：设备可能断开，进入重连
                        reconnect_attempts += 1;
                        if !try_reconnect(
                            &mut reader,
                            &port_name,
                            baud_val,
                            &params_clone,
                            reconnect_attempts,
                            &stop_flag_reader,
                            &mut on_line,
                        ) {
                            break;
                        }
                    }
                    Ok(n) => {
                        for &b in &buf[..n] {
                            line_buf.push(b);
                            if b == b'\n' {
                                let text = String::from_utf8_lossy(&line_buf)
                                    .trim_end_matches(['\r', '\n'])
                                    .to_string();
                                let raw = line_buf.iter().any(|&c| c == 0 || c > 127 && c < 0x20 && c != 0x1b);
                                on_line(SerialLine {
                                    port: port_name.clone(),
                                    text,
                                    raw,
                                });
                                line_buf.clear();
                            }
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        // 超时正常，继续
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => {
                        // 读取错误：设备可能断开，尝试重连
                        reconnect_attempts += 1;
                        if !try_reconnect(
                            &mut reader,
                            &port_name,
                            baud_val,
                            &params_clone,
                            reconnect_attempts,
                            &stop_flag_reader,
                            &mut on_line,
                        ) {
                            break;
                        }
                    }
                }
            }
        });

        let handle = MonitorHandle {
            writer: Box::new(SerialWriter(writer)),
            stop_flag,
        };
        self.handles.lock().unwrap().insert(port.to_string(), handle);
        Ok(())
    }

    /// 向某端口发送一行数据（自动补换行）
    pub fn send(&self, port: &str, data: &str) -> Result<(), String> {
        let mut payload = data.as_bytes().to_vec();
        if !data.ends_with('\n') {
            payload.push(b'\n');
        }
        self.send_raw(port, &payload)
    }

    /// #36 发送原始字节：由调用方决定换行符/hex 解码，后端不再追加换行
    /// 既保持 send() 既有行为（自动加 \n），又支持换行选择与十六进制发送
    pub fn send_raw(&self, port: &str, payload: &[u8]) -> Result<(), String> {
        let mut handles = self.handles.lock().unwrap();
        let handle = handles
            .get_mut(port)
            .ok_or_else(|| format!("端口 {port} 未打开监控"))?;
        handle
            .writer
            .write_all(payload)
            .map_err(|e| format!("写入 {port} 失败: {e}"))?;
        handle.writer.flush().map_err(|e| format!("flush {port} 失败: {e}"))?;
        Ok(())
    }

    /// 停止某端口的监控
    pub fn stop(&self, port: &str) -> Result<(), String> {
        let handle = self
            .handles
            .lock()
            .unwrap()
            .remove(port)
            .ok_or_else(|| format!("端口 {port} 未打开监控"))?;
        handle.stop_flag.store(true, Ordering::Relaxed);
        // 读线程会在下次循环退出（join 留给系统回收，避免阻塞调用方）
        Ok(())
    }

    /// 列出当前监控中的端口
    pub fn active_ports(&self) -> Vec<String> {
        self.handles.lock().unwrap().keys().cloned().collect()
    }
}

impl Default for SerialMonitor {
    fn default() -> Self {
        Self::new()
    }
}

/// #41 尝试重连串口：指数退避（1s/2s/4s/...，上限 10s），最多 10 次。
/// 重连成功时通知前端并替换 reader；失败到上限或检测到停止标志则返回 false。
/// 通知通过 on_line 回调以特殊文本行发送（前端可据此提示用户）。
fn try_reconnect<F>(
    reader: &mut Box<dyn serialport::SerialPort>,
    port: &str,
    baud: u32,
    params: &Option<SerialParams>,
    attempt: u32,
    stop_flag: &AtomicBool,
    on_line: &mut F,
) -> bool
where
    F: FnMut(SerialLine),
{
    const MAX_ATTEMPTS: u32 = 10;
    if attempt > MAX_ATTEMPTS || stop_flag.load(Ordering::Relaxed) {
        on_line(SerialLine {
            port: port.to_string(),
            text: format!("[Talk2ESP] 串口 {port} 重连失败，已停止监控（尝试 {attempt} 次）"),
            raw: false,
        });
        return false;
    }
    // 首次断开时通知
    if attempt == 1 {
        on_line(SerialLine {
            port: port.to_string(),
            text: format!("[Talk2ESP] 串口 {port} 已断开，尝试自动重连…"),
            raw: false,
        });
    }
    // 指数退避：1, 2, 4, 8, 10(上限)
    let delay = Duration::from_secs((1u64 << (attempt.min(4) - 1)).min(10));
    thread::sleep(delay);
    if stop_flag.load(Ordering::Relaxed) {
        return false;
    }
    // 尝试重新打开
    let mut builder = serialport::new(port, baud).timeout(Duration::from_millis(100));
    if let Some(p) = params {
        if let Ok(db) = parse_data_bits(p.data_bits) { builder = builder.data_bits(db); }
        if let Ok(pa) = parse_parity(&p.parity) { builder = builder.parity(pa); }
        if let Ok(sb) = parse_stop_bits(&p.stop_bits) { builder = builder.stop_bits(sb); }
    }
    match builder.open() {
        Ok(new_serial) => {
            *reader = new_serial;
            on_line(SerialLine {
                port: port.to_string(),
                text: format!("[Talk2ESP] 串口 {port} 已重连成功（第 {attempt} 次尝试）"),
                raw: false,
            });
            true
        }
        Err(_) => {
            // 继续下一次尝试（由调用方循环驱动）
            on_line(SerialLine {
                port: port.to_string(),
                text: format!("[Talk2ESP] 串口 {port} 重连第 {attempt} 次失败，继续重试…"),
                raw: false,
            });
            // 递归下一次（attempt+1）
            try_reconnect(reader, port, baud, params, attempt + 1, stop_flag, on_line)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    /// 端到端验证：start_with_callback 启动 COM4 监控 → send 发送 → 回调收到 ECHO 响应
    /// 依赖：COM4 已烧录回显程序（收到行后原样回显 ECHO:<内容>）
    /// 注意：此测试依赖特定固件，M6/M8 端到端测试会改写 COM4 固件导致本测试失败，
    /// 故标记 ignore，需手动单独运行（先烧录回显固件）：cargo test monitor_send_and_receive_echo -- --ignored
    #[test]
    #[ignore]
    fn monitor_send_and_receive_echo() {
        let port = "COM4";
        // 先确认 COM4 可用（避免无硬件环境误失败）
        if serialport::new(port, 115200).open().is_err() {
            eprintln!("跳过：{port} 不可用");
            return;
        }

        let monitor = SerialMonitor::new();
        let (tx, rx) = mpsc::channel::<SerialLine>();
        let tx = std::sync::Mutex::new(tx);

        monitor
            .start_with_callback(port, 115200, None, move |line| {
                let _ = tx.lock().unwrap().send(line);
            })
            .expect("启动监控失败");

        // 等待设备启动输出（复位后会有 TEST 标记）
        std::thread::sleep(Duration::from_millis(2500));

        // 清空启动期缓冲
        while rx.try_recv().is_ok() {}

        // 发送测试数据
        monitor
            .send(port, "hello")
            .expect("发送失败");

        // 等待 ECHO:hello 响应（最多 3 秒）
        let start = Instant::now();
        let mut got_echo = false;
        while start.elapsed() < Duration::from_secs(3) {
            if let Ok(line) = rx.recv_timeout(Duration::from_millis(200)) {
                eprintln!("收到: {}", line.text);
                if line.text.contains("ECHO:hello") {
                    got_echo = true;
                    break;
                }
            }
        }

        let _ = monitor.stop(port);
        assert!(got_echo, "应收到 ECHO:hello 响应");
    }
}
