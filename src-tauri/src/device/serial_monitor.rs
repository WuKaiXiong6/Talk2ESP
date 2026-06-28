// 文件路径：src-tauri/src/device/serial_monitor.rs
// 文件作用：串口监控，实时读取推 Channel + 手动发送数据，多设备并行管理
// 最后更新时间：2026-06-28-0339

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;

/// 一行串口输出（推送给前端）
#[derive(Serialize, Clone)]
pub struct SerialLine {
    pub port: String,
    /// 已解码的文本行（解码失败时为 hex 占位）
    pub text: String,
    /// 是否为无法解码的原始字节
    pub raw: bool,
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
        self.start_with_callback(port, baud, move |line| {
            let _ = on_line.send(line);
        })
    }

    /// 启动串口监控的核心实现：读线程阻塞读取，每行经回调推送，写半部存入 map
    /// 抽出此方法便于单元测试注入回调（Tauri Channel 无法在纯测试中创建）
    pub fn start_with_callback<F>(&self, port: &str, baud: u32, on_line: F) -> Result<(), String>
    where
        F: FnMut(SerialLine) + Send + 'static,
    {
        // 已存在则先停止
        if self.handles.lock().unwrap().contains_key(port) {
            self.stop(port)?;
        }

        let serial = serialport::new(port, baud)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| format!("打开串口 {port} 失败: {e}"))?;

        // 克隆出写半部
        let writer = serial
            .try_clone()
            .map_err(|e| format!("克隆串口写半部失败: {e}"))?;

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_reader = stop_flag.clone();
        let port_name = port.to_string();

        // 读线程：用原句柄阻塞读，按行缓冲回调推送
        let mut on_line = on_line;
        thread::spawn(move || {
            let mut reader = serial;
            let mut buf = [0u8; 256];
            let mut line_buf: Vec<u8> = Vec::new();
            while !stop_flag_reader.load(Ordering::Relaxed) {
                match reader.read(&mut buf) {
                    Ok(0) => break,
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
                    Err(_) => break,
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
        let mut handles = self.handles.lock().unwrap();
        let handle = handles
            .get_mut(port)
            .ok_or_else(|| format!("端口 {port} 未打开监控"))?;
        let mut payload = data.as_bytes().to_vec();
        if !data.ends_with('\n') {
            payload.push(b'\n');
        }
        handle
            .writer
            .write_all(&payload)
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
            .start_with_callback(port, 115200, move |line| {
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
