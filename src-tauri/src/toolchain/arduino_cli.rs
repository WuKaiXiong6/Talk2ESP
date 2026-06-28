// 文件路径：src-tauri/src/toolchain/arduino_cli.rs
// 文件作用：封装 arduino-cli 编译与上传，流式捕获输出经回调推送
// 最后更新时间：2026-06-28-0951

use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

/// 工具链事件（流式推送给前端）
#[derive(Serialize, Clone)]
#[serde(tag = "kind", content = "data")]
pub enum ToolEvent {
    /// 一行 stdout
    Stdout(String),
    /// 一行 stderr
    Stderr(String),
    /// 进程退出，data 为退出码（None 表示被信号终止）
    Finished(Option<i32>),
}

/// 工具执行结果
#[derive(Serialize, Clone, Debug)]
pub struct ToolResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    /// 合并的 stdout+stderr 全文（供 AI 诊断）
    pub output: String,
}

/// 解析 arduino-cli 可执行文件路径
/// 优先级：环境变量 TALK2ESP_ARDUINO_CLI > 项目内 tools/arduino-cli/ > 系统 PATH
pub fn resolve_arduino_cli() -> Result<PathBuf, String> {
    // 1. 环境变量
    if let Ok(p) = std::env::var("TALK2ESP_ARDUINO_CLI") {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
    }
    // 2. 项目内 tools/（开发自测环境）
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // src-tauri -> 项目根
        .unwrap_or(Path::new("."))
        .join("tools/arduino-cli/arduino-cli.exe");
    if dev_path.exists() {
        return Ok(dev_path);
    }
    // 3. 系统 PATH
    Ok(PathBuf::from("arduino-cli"))
}

/// 运行命令并流式推送输出，等待完成返回结果
/// on_event 回调逐行/逐事件接收（仅在主线程调用，避免跨线程闭包）；stderr 由独立线程收集后合并
fn run_streaming<F>(program: &Path, args: &[&str], mut on_event: F) -> Result<ToolResult, String>
where
    F: FnMut(ToolEvent),
{
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Windows 下隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 {} 失败: {e}", program.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 stderr".to_string())?;

    // stderr 收集线程：仅收集文本到共享缓冲（不调 on_event，避免跨线程闭包）
    let stderr_output: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr_out_clone = stderr_output.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let mut buf = stderr_out_clone.lock().unwrap();
            buf.push_str(&line);
            buf.push('\n');
        }
    });

    // 主线程读取 stdout，逐行推送 on_event
    let mut output = String::new();
    let stdout_reader = BufReader::new(stdout);
    for line in stdout_reader.lines().flatten() {
        output.push_str(&line);
        output.push('\n');
        on_event(ToolEvent::Stdout(line));
    }

    // 合并 stderr
    stderr_handle.join().ok();
    let stderr_text = stderr_output.lock().unwrap().clone();
    // stderr 也推送（合并到 output 供诊断，并逐行推送事件）
    for line in stderr_text.lines() {
        on_event(ToolEvent::Stderr(line.to_string()));
    }
    output.push_str(&stderr_text);

    let status = child
        .wait()
        .map_err(|e| format!("等待进程退出失败: {e}"))?;
    let exit_code = status.code();
    on_event(ToolEvent::Finished(exit_code));

    Ok(ToolResult {
        success: status.success(),
        exit_code,
        output,
    })
}

/// 编译 Arduino 项目
/// - sketch_path: .ino 所在目录
/// - fqbn: 如 esp32:esp32:esp32s3
/// - on_event: 流式输出回调
pub fn compile_project<F>(sketch_path: &Path, fqbn: &str, on_event: F) -> Result<ToolResult, String>
where
    F: FnMut(ToolEvent),
{
    let cli = resolve_arduino_cli()?;
    let path_str = sketch_path
        .to_str()
        .ok_or_else(|| "sketch 路径含非法字符".to_string())?;
    let args = vec![
        "compile",
        "--fqbn",
        fqbn,
        path_str,
        "--warnings",
        "none",
    ];
    run_streaming(&cli, &args, on_event)
}

/// 烧录：使用 arduino-cli upload（底层调用 esptool）
/// - sketch_path: .ino 所在目录
/// - fqbn: 板型
/// - port: 串口如 COM4
pub fn flash_project<F>(
    sketch_path: &Path,
    fqbn: &str,
    port: &str,
    mut on_event: F,
) -> Result<ToolResult, String>
where
    F: FnMut(ToolEvent),
{
    let cli = resolve_arduino_cli()?;
    let path_str = sketch_path
        .to_str()
        .ok_or_else(|| "sketch 路径含非法字符".to_string())?;
    let args = vec!["upload", "-p", port, "--fqbn", fqbn, path_str];
    run_streaming(&cli, &args, |ev| on_event(ev))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// 验证编译 Blink 程序到 ESP32-S3 成功
    /// 依赖：tools/arduino-cli 可用 + arduino-esp32 核心包已安装
    #[test]
    fn compile_blink_s3_success() {
        // 临时构建 Blink 草图
        let tmp = std::env::temp_dir().join("talk2esp_test_blink");
        std::fs::create_dir_all(&tmp).unwrap();
        let ino = tmp.join("talk2esp_test_blink.ino");
        let code = concat!(
            "void setup(){Serial.begin(115200);pinMode(2,OUTPUT);}\n",
            "void loop(){digitalWrite(2,HIGH);Serial.println(\"TEST:PASS\");",
            "delay(500);digitalWrite(2,LOW);delay(500);}",
        );
        std::fs::write(&ino, code).unwrap();

        let events = Arc::new(Mutex::new(Vec::<ToolEvent>::new()));
        let events_clone = events.clone();
        let result = compile_project(&tmp, "esp32:esp32:esp32s3", move |ev| {
            events_clone.lock().unwrap().push(ev);
        })
        .expect("编译失败");

        assert!(result.success, "编译应成功，输出: {}", result.output);
        assert!(result.exit_code == Some(0));
        // 应有流式事件推送
        assert!(!events.lock().unwrap().is_empty(), "应有流式事件");
        // 应有 Finished 事件
        let has_finished = events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, ToolEvent::Finished(_)));
        assert!(has_finished, "应有 Finished 事件");

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// 验证烧录：先编译再 upload 到 COM8（ESP32-S3）
    /// 依赖：tools/arduino-cli + arduino-esp32 核心包 + COM8 设备
    #[test]
    fn flash_blink_to_com8_success() {
        // 先确认 COM8 设备存在
        if serialport::new("COM8", 115200).open().is_err() {
            eprintln!("跳过：COM8 不可用");
            return;
        }

        let tmp = std::env::temp_dir().join("talk2esp_test_flash");
        std::fs::create_dir_all(&tmp).unwrap();
        let ino = tmp.join("talk2esp_test_flash.ino");
        let code = concat!(
            "void setup(){Serial.begin(115200);pinMode(2,OUTPUT);}\n",
            "void loop(){digitalWrite(2,HIGH);delay(500);digitalWrite(2,LOW);delay(500);}",
        );
        std::fs::write(&ino, code).unwrap();

        // 先编译产出
        let compile_result = compile_project(&tmp, "esp32:esp32:esp32s3", |_| {}).expect("编译失败");
        assert!(compile_result.success, "编译应成功");

        // 再烧录
        let events = Arc::new(Mutex::new(Vec::<ToolEvent>::new()));
        let events_clone = events.clone();
        let result = flash_project(&tmp, "esp32:esp32:esp32s3", "COM8", move |ev| {
            events_clone.lock().unwrap().push(ev);
        })
        .expect("烧录失败");

        assert!(result.success, "烧录应成功，输出: {}", result.output);
        let has_finished = events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, ToolEvent::Finished(_)));
        assert!(has_finished, "应有 Finished 事件");

        std::fs::remove_dir_all(&tmp).ok();
    }
}
