use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub ram_gb: u32,
    pub arch: &'static str,
    pub os: &'static str,
    pub cpu: String,
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
    }
}
