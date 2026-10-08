use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub ram_gb: u32,
    pub arch: &'static str,
    pub os: &'static str,
    pub cpu: String,
    pub disk_free_bytes: Option<u64>,
}

/// Free bytes on the volume that holds `path` (longest matching mount point).
pub fn free_space(path: &std::path::Path) -> Option<u64> {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

pub fn system_info() -> SystemInfo {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    let cpu = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();
    SystemInfo {
        ram_gb: (sys.total_memory() as f64 / 1_073_741_824.0).round() as u32,
        arch: std::env::consts::ARCH,
        os: std::env::consts::OS,
        cpu,
        disk_free_bytes: dirs::home_dir().and_then(|h| free_space(&h)),
    }
}
