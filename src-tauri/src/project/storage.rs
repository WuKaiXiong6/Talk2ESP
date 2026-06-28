// 文件路径：src-tauri/src/project/storage.rs
// 文件作用：项目文件夹持久化，按 PRD 3.4 结构读写代码/对话/日志/元数据
// 最后更新时间：2026-06-29-0057

use crate::project::model::{
    ConversationMessage, PinBlacklistSnapshot, Project, ProjectState, StageLog,
};
use crate::project::{model::AutoMode, model::RetryCounts};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 项目存储：每个项目一个独立文件夹
pub struct ProjectStorage {
    /// 项目根目录（含所有项目），如 ~/.talk2esp/projects
    root: PathBuf,
}

impl ProjectStorage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// 默认存储根目录：用户目录下 .talk2esp/projects
    pub fn default_root() -> PathBuf {
        let home = dirs_or_home();
        home.join(".talk2esp").join("projects")
    }

    pub fn from_default() -> Self {
        Self::new(Self::default_root())
    }

    /// 单个项目目录
    pub fn project_dir(&self, project_id: &str) -> PathBuf {
        self.root.join(project_id)
    }

    /// 创建新项目：初始化文件夹结构 + 写入 project.json
    pub fn create_project(
        &self,
        name: &str,
        chip: &str,
        pin_blacklist: PinBlacklistSnapshot,
        llm_provider: Option<String>,
    ) -> Result<Project, String> {
        let id = format!("{}-{}", sanitize(name), timestamp_id());
        let dir = self.project_dir(&id);
        fs::create_dir_all(dir.join("src")).map_err(|e| e.to_string())?;
        fs::create_dir_all(dir.join("build")).map_err(|e| e.to_string())?;
        fs::create_dir_all(dir.join("logs")).map_err(|e| e.to_string())?;
        fs::create_dir_all(dir.join("archive")).map_err(|e| e.to_string())?;

        let now = now_iso();
        let project = Project {
            id: id.clone(),
            name: name.to_string(),
            chip: chip.to_string(),
            port: None,
            created_at: now.clone(),
            updated_at: now,
            state: ProjectState::Drafting,
            auto_mode: AutoMode::Full,
            pin_blacklist_snapshot: pin_blacklist,
            llm_provider,
            retry_counts: RetryCounts::default(),
        };
        self.save_project(&project)?;
        // 初始化空对话文件
        fs::File::create(dir.join("conversation.jsonl")).map_err(|e| e.to_string())?;
        Ok(project)
    }

    /// 保存项目元数据
    pub fn save_project(&self, project: &Project) -> Result<(), String> {
        let path = self.project_dir(&project.id).join("project.json");
        let json = serde_json::to_string_pretty(project).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| e.to_string())
    }

    /// 读取项目元数据
    pub fn load_project(&self, project_id: &str) -> Result<Project, String> {
        let path = self.project_dir(project_id).join("project.json");
        let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&json).map_err(|e| e.to_string())
    }

    /// 追加一条对话消息（conversation.jsonl）
    pub fn append_message(&self, project_id: &str, msg: &ConversationMessage) -> Result<(), String> {
        let path = self.project_dir(project_id).join("conversation.jsonl");
        let line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        writeln!(file, "{line}").map_err(|e| e.to_string())
    }

    /// 读取全部对话消息
    pub fn load_messages(&self, project_id: &str) -> Result<Vec<ConversationMessage>, String> {
        let path = self.project_dir(project_id).join("conversation.jsonl");
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        content
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str(l).map_err(|e| e.to_string()))
            .collect()
    }

    /// 写入主程序代码（src/main.ino）
    pub fn write_main_code(&self, project_id: &str, code: &str) -> Result<(), String> {
        let path = self.project_dir(project_id).join("src").join("main.ino");
        fs::write(&path, code).map_err(|e| e.to_string())
    }

    /// 写入测试桩代码（src/test_harness.ino）
    pub fn write_test_harness(&self, project_id: &str, code: &str) -> Result<(), String> {
        let path = self.project_dir(project_id).join("src").join("test_harness.ino");
        fs::write(&path, code).map_err(|e| e.to_string())
    }

    /// 读取主程序代码
    pub fn read_main_code(&self, project_id: &str) -> Result<String, String> {
        let path = self.project_dir(project_id).join("src").join("main.ino");
        fs::read_to_string(&path).map_err(|e| e.to_string())
    }

    /// 写入阶段日志（logs/<stage>_<attempt>.log）
    pub fn write_stage_log(&self, project_id: &str, log: &StageLog) -> Result<PathBuf, String> {
        let filename = format!("{}_{}.log", sanitize(&log.stage), log.attempt);
        let path = self.project_dir(project_id).join("logs").join(filename);
        let content = serde_json::to_string_pretty(log).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())?;
        Ok(path)
    }

    /// 列出所有项目（按更新时间倒序）
    pub fn list_projects(&self) -> Result<Vec<Project>, String> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }
        let mut projects = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let id = entry.file_name().to_string_lossy().to_string();
            if let Ok(p) = self.load_project(&id) {
                projects.push(p);
            }
        }
        projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(projects)
    }

    /// 删除项目
    pub fn delete_project(&self, project_id: &str) -> Result<(), String> {
        let dir = self.project_dir(project_id);
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// #54 重命名项目（仅更新 name 字段，不改变 id 与目录）
    pub fn rename_project(&self, project_id: &str, new_name: &str) -> Result<Project, String> {
        let mut project = self.load_project(project_id)?;
        project.name = new_name.to_string();
        project.updated_at = now_iso();
        self.save_project(&project)?;
        Ok(project)
    }

    /// #71 按保留策略清理旧数据：删除超期日志，统计项目数提示清理
    /// 返回 (删除的日志文件数, 当前项目数)
    pub fn cleanup_old_data(&self, log_retention_days: u32) -> Result<(usize, usize), String> {
        use std::time::{Duration, SystemTime};
        let mut deleted_logs = 0;
        let projects_dir = &self.root;
        if !projects_dir.exists() {
            return Ok((0, 0));
        }
        let project_count = fs::read_dir(projects_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .count();

        if log_retention_days > 0 {
            let now = SystemTime::now();
            let threshold = Duration::from_secs(log_retention_days as u64 * 86400);
            for entry in fs::read_dir(projects_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let logs_dir = entry.path().join("logs");
                if logs_dir.exists() {
                    for log_entry in fs::read_dir(&logs_dir).map_err(|e| e.to_string())? {
                        let log_file = log_entry.map_err(|e| e.to_string())?.path();
                        if let Ok(meta) = fs::metadata(&log_file) {
                            if let Ok(modified) = meta.modified() {
                                if now.duration_since(modified).map(|d| d > threshold).unwrap_or(false) {
                                    if fs::remove_file(&log_file).is_ok() {
                                        deleted_logs += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok((deleted_logs, project_count))
    }

    pub fn duplicate_project(&self, project_id: &str, new_name: &str) -> Result<Project, String> {
        let src_dir = self.project_dir(project_id);
        if !src_dir.exists() {
            return Err(format!("源项目 {project_id} 不存在"));
        }
        let new_id = format!("{project_id}-copy-{}", timestamp_id());
        let new_dir = self.project_dir(&new_id);
        // 递归复制目录
        copy_dir_recursive(&src_dir, &new_dir)?;
        // 加载副本并更新 id/name/时间戳
        let mut project = self.load_project(&new_id)?;
        project.id = new_id.clone();
        project.name = new_name.to_string();
        project.state = crate::project::model::ProjectState::Drafting;
        project.created_at = now_iso();
        project.updated_at = now_iso();
        project.retry_counts = crate::project::model::RetryCounts::default();
        self.save_project(&project)?;
        Ok(project)
    }

    /// #56 导出项目为 zip 字节流（包含 project.json/conversation.jsonl/src/logs）
    pub fn export_project(&self, project_id: &str) -> Result<Vec<u8>, String> {
        let dir = self.project_dir(project_id);
        if !dir.exists() {
            return Err(format!("项目 {project_id} 不存在"));
        }
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let options =
                zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            Self::add_dir_to_zip(&mut zip, &dir, Path::new(project_id), &options)?;
            zip.finish().map_err(|e| e.to_string())?;
        }
        Ok(buf.into_inner())
    }

    /// 递归将目录加入 zip
    fn add_dir_to_zip<W: std::io::Write + std::io::Seek>(
        zip: &mut zip::ZipWriter<W>,
        dir: &Path,
        prefix: &Path,
        options: &zip::write::SimpleFileOptions,
    ) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = prefix.join(entry.file_name());
            if path.is_dir() {
                zip.add_directory(name.to_string_lossy(), *options).map_err(|e| e.to_string())?;
                Self::add_dir_to_zip(zip, &path, &name, options)?;
            } else {
                zip.start_file(name.to_string_lossy(), *options).map_err(|e| e.to_string())?;
                let bytes = fs::read(&path).map_err(|e| e.to_string())?;
                zip.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// #56 从 zip 字节流导入项目（解压到新 id 目录）
    pub fn import_project(&self, zip_bytes: &[u8]) -> Result<Project, String> {
        let reader = std::io::Cursor::new(zip_bytes);
        let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
        // 从 zip 内首层目录名派生新 id（避免与既有冲突，加 import- 前缀与时间戳）
        let first_name = archive
            .file_names()
            .next()
            .and_then(|n| n.split('/').next())
            .unwrap_or("imported")
            .to_string();
        let new_id = format!("import-{}-{}", sanitize(&first_name), timestamp_id());
        let new_dir = self.project_dir(&new_id);
        fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match file.enclosed_name() {
                Some(p) => p,
                None => continue,
            };
            // 去掉 zip 内首层目录前缀，映射到 new_dir 下
            let rel = outpath.iter().skip(1).collect::<PathBuf>();
            if rel.as_os_str().is_empty() {
                continue;
            }
            let target = new_dir.join(&rel);
            if file.is_dir() {
                fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
            }
        }
        // 加载导入后的 project.json，更新 id/时间戳
        let mut project = self.load_project(&new_id)?;
        project.id = new_id.clone();
        project.updated_at = now_iso();
        self.save_project(&project)?;
        Ok(project)
    }
}

/// 获取项目草图目录（供 arduino-cli 编译，.ino 文件名需与目录名一致）
pub fn sketch_dir(project_dir: &Path, _project_name: &str) -> PathBuf {
    // arduino-cli 要求 .ino 文件名与目录名一致，这里返回 src 目录，
    // 调用方需确保 main.ino 重命名为 <project_name>.ino 或编译时指定
    project_dir.join("src")
}

fn sanitize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .to_lowercase()
}

fn timestamp_id() -> String {
    // 用毫秒时间戳保证唯一
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() % 100000)
        .unwrap_or(0);
    format!("{ms:05}")
}

/// #57 递归复制目录
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let target = dst.join(&name);
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn now_iso() -> String {
    // 简化 ISO 时间戳（精确到秒，本地时区）
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 转为北京时间 UTC+8
    let beijing_secs = secs + 8 * 3600;
    let days = beijing_secs / 86400;
    let remainder = beijing_secs % 86400;
    let hour = remainder / 3600;
    let min = (remainder % 3600) / 60;
    let sec = remainder % 60;
    // 简化日期计算（从 1970-01-01 起）
    let (y, m, d) = days_to_ymd(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}+08:00")
}

/// Unix 天数转年月日（算法，1970 起）
fn days_to_ymd(days: i64) -> (i64, u32, u32) {
    let mut y = 1970i64;
    let mut d = days;
    loop {
        let yd = if is_leap(y) { 366 } else { 365 };
        if d < yd {
            break;
        }
        d -= yd;
        y += 1;
    }
    let months = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0u32;
    let mut dd = d as u32;
    while m < 12 {
        let md = if m == 1 && is_leap(y) { 29 } else { months[m as usize] };
        if dd < md {
            break;
        }
        dd -= md;
        m += 1;
    }
    (y, m + 1, dd + 1)
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

fn dirs_or_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_load_update_project() {
        let tmp = std::env::temp_dir().join("talk2esp_storage_test");
        let _ = fs::remove_dir_all(&tmp);
        let storage = ProjectStorage::new(&tmp);

        let project = storage
            .create_project(
                "LED Blink 测试",
                "esp32s3",
                PinBlacklistSnapshot {
                    error: vec![45],
                    warn: vec![0],
                },
                Some("openai_compat".into()),
            )
            .expect("创建项目失败");

        assert_eq!(project.chip, "esp32s3");
        assert_eq!(project.state, ProjectState::Drafting);
        // 目录结构应存在
        let dir = storage.project_dir(&project.id);
        assert!(dir.join("project.json").exists());
        assert!(dir.join("src").is_dir());
        assert!(dir.join("logs").is_dir());
        assert!(dir.join("conversation.jsonl").exists());

        // 更新状态后保存再加载
        let mut p = storage.load_project(&project.id).unwrap();
        p.state = ProjectState::Archived;
        storage.save_project(&p).unwrap();
        let p2 = storage.load_project(&project.id).unwrap();
        assert_eq!(p2.state, ProjectState::Archived);

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn append_load_messages() {
        let tmp = std::env::temp_dir().join("talk2esp_msg_test");
        let _ = fs::remove_dir_all(&tmp);
        let storage = ProjectStorage::new(&tmp);
        let project = storage
            .create_project("msg", "esp32s3", PinBlacklistSnapshot::default(), None)
            .unwrap();

        let msg1 = ConversationMessage {
            role: "user".into(),
            content: "hello".into(),
            timestamp: "2026-06-28T10:00:00+08:00".into(),
        };
        let msg2 = ConversationMessage {
            role: "assistant".into(),
            content: "hi".into(),
            timestamp: "2026-06-28T10:00:01+08:00".into(),
        };
        storage.append_message(&project.id, &msg1).unwrap();
        storage.append_message(&project.id, &msg2).unwrap();

        let msgs = storage.load_messages(&project.id).unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].content, "hello");
        assert_eq!(msgs[1].role, "assistant");

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn write_read_code_and_log() {
        let tmp = std::env::temp_dir().join("talk2esp_code_test");
        let _ = fs::remove_dir_all(&tmp);
        let storage = ProjectStorage::new(&tmp);
        let project = storage
            .create_project("code", "esp32c3", PinBlacklistSnapshot::default(), None)
            .unwrap();

        storage.write_main_code(&project.id, "void setup(){}").unwrap();
        storage.write_test_harness(&project.id, "void setup(){}").unwrap();
        assert_eq!(storage.read_main_code(&project.id).unwrap(), "void setup(){}");

        let log = StageLog {
            stage: "compile".into(),
            started_at: "t1".into(),
            finished_at: Some("t2".into()),
            success: true,
            attempt: 1,
            output: "ok".into(),
            error: None,
        };
        let path = storage.write_stage_log(&project.id, &log).unwrap();
        assert!(path.exists());

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn list_and_delete_projects() {
        let tmp = std::env::temp_dir().join("talk2esp_list_test");
        let _ = fs::remove_dir_all(&tmp);
        let storage = ProjectStorage::new(&tmp);
        storage.create_project("a", "esp32s3", PinBlacklistSnapshot::default(), None).unwrap();
        storage.create_project("b", "esp32c3", PinBlacklistSnapshot::default(), None).unwrap();
        let list = storage.list_projects().unwrap();
        assert_eq!(list.len(), 2);

        let id = &list[0].id;
        storage.delete_project(id).unwrap();
        assert_eq!(storage.list_projects().unwrap().len(), 1);

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn now_iso_returns_valid_format() {
        let s = now_iso();
        assert!(s.starts_with("20"));
        assert!(s.contains("T"));
        assert!(s.contains("+08:00"));
    }
}
