//! A save is committed only by same-directory rename. Fault tests exercise this
//! exact implementation; no fault switches are exposed through the native API.
use std::{fs::{self, File, OpenOptions}, io::{self, Write}, path::Path,
    sync::atomic::{AtomicU64, Ordering}};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage { Written, Synced, Renamed }

pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    write_using(path, data, |file, bytes| file.write_all(bytes), |_| Ok(()))
}

fn write_using(
    path: &Path, data: &[u8],
    write: impl FnOnce(&mut File, &[u8]) -> io::Result<()>,
    mut checkpoint: impl FnMut(Stage) -> io::Result<()>,
) -> Result<(), String> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("Untitled.luma");
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(".{name}.luma-tmp-{}-{sequence}", std::process::id()));
    let mut owned = false;
    let result = (|| {
        let mut file = OpenOptions::new().create_new(true).write(true).open(&temp)
            .map_err(|e| format!("Unable to create temporary save: {e}"))?;
        owned = true;
        if let Ok(metadata) = fs::metadata(path) {
            file.set_permissions(metadata.permissions())
                .map_err(|e| format!("Unable to preserve save permissions: {e}"))?;
        }
        write(&mut file, data).map_err(|e| format!("Unable to write temporary save: {e}"))?;
        checkpoint(Stage::Written).and_then(|_| file.sync_all())
            .map_err(|e| format!("Unable to sync temporary save: {e}"))?;
        checkpoint(Stage::Synced).map_err(|e| format!("Save interrupted before replacement: {e}"))?;
        drop(file);
        fs::rename(&temp, path).map_err(|e| format!("Unable to replace save atomically: {e}"))?;
        // After rename a complete new file exists, but a durability error must
        // not be reported as a fully acknowledged save or clear dirty state.
        checkpoint(Stage::Renamed).and_then(|_| File::open(parent)?.sync_all())
            .map_err(|e| format!("Save was replaced, but directory durability could not be confirmed: {e}. Keep this document open and retry saving."))?;
        Ok(())
    })();
    // Never remove a pre-existing temp file if create_new failed.
    if result.is_err() && owned { let _ = fs::remove_file(&temp); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, process::Command};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("luma-write-fault-{}-{}", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn target(&self) -> PathBuf { self.0.join("project.luma") }
        fn seed(&self) { fs::write(self.target(), b"previous complete project").unwrap(); }
        fn unchanged(&self) { assert_eq!(fs::read(self.target()).unwrap(), b"previous complete project"); }
        fn no_temps(&self) { assert_eq!(fs::read_dir(&self.0).unwrap().count(), 1); }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Only files inside this uniquely created test directory.
            for item in fs::read_dir(&self.0).unwrap() { fs::remove_file(item.unwrap().path()).unwrap(); }
            fs::remove_dir(&self.0).unwrap();
        }
    }

    #[test]
    fn partial_disk_full_write_preserves_original_and_retry_succeeds() {
        let f = Fixture::new(); f.seed();
        let error = write_using(&f.target(), b"replacement", |file, bytes| {
            file.write_all(&bytes[..3])?;
            Err(io::Error::from_raw_os_error(28)) // ENOSPC on supported macOS/Linux.
        }, |_| Ok(())).unwrap_err();
        assert!(error.contains("Unable to write")); f.unchanged(); f.no_temps();
        atomic_write(&f.target(), b"complete retry").unwrap();
        assert_eq!(fs::read(f.target()).unwrap(), b"complete retry"); f.no_temps();
    }

    #[test]
    fn sync_and_pre_rename_failures_preserve_original() {
        for stage in [Stage::Written, Stage::Synced] {
            let f = Fixture::new(); f.seed();
            assert!(write_using(&f.target(), b"replacement", |f, b| f.write_all(b), |s| {
                if s == stage { Err(io::Error::other("injected I/O failure")) } else { Ok(()) }
            }).is_err());
            f.unchanged(); f.no_temps();
        }
    }

    #[test]
    fn failed_new_file_write_does_not_create_a_partial_project() {
        let f = Fixture::new();
        assert!(write_using(&f.target(), b"replacement", |file, b| {
            file.write_all(&b[..2])?; Err(io::Error::other("interrupted write"))
        }, |_| Ok(())).is_err());
        assert!(!f.target().exists()); assert_eq!(fs::read_dir(&f.0).unwrap().count(), 0);
    }

    #[test]
    fn rename_failure_cleans_only_the_owned_temp() {
        let f = Fixture::new();
        fs::create_dir(f.target()).unwrap();
        assert!(atomic_write(&f.target(), b"replacement").unwrap_err().contains("atomically"));
        assert!(f.target().is_dir()); f.no_temps();
        fs::remove_dir(f.target()).unwrap();
    }

    #[test]
    fn post_rename_durability_failure_reports_complete_but_unacknowledged_save() {
        let f = Fixture::new(); f.seed();
        let error = write_using(&f.target(), b"complete replacement", |f, b| f.write_all(b), |s| {
            if s == Stage::Renamed { Err(io::Error::other("sync failed")) } else { Ok(()) }
        }).unwrap_err();
        assert!(error.contains("durability could not be confirmed"));
        assert_eq!(fs::read(f.target()).unwrap(), b"complete replacement"); f.no_temps();
    }

    #[test]
    fn abrupt_child_writer() {
        let Some(target) = std::env::var_os("LUMA_ATOMIC_TEST_TARGET") else { return; };
        let stage = std::env::var("LUMA_ATOMIC_TEST_STOP").unwrap();
        let _ = write_using(Path::new(&target), b"complete replacement", |file, b| {
            if stage == "partial" { file.write_all(&b[..4])?; std::process::exit(73); }
            file.write_all(b)
        }, |s| {
            if (stage == "synced" && s == Stage::Synced) || (stage == "renamed" && s == Stage::Renamed) {
                std::process::exit(73); // No stack unwinding or temp cleanup.
            }
            Ok(())
        });
        panic!("child did not stop at requested boundary");
    }

    #[test]
    fn abrupt_process_exit_never_exposes_partial_destination() {
        for stage in ["partial", "synced", "renamed"] {
            let f = Fixture::new(); f.seed();
            let status = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "atomic_save::tests::abrupt_child_writer", "--nocapture"])
                .env("LUMA_ATOMIC_TEST_TARGET", f.target()).env("LUMA_ATOMIC_TEST_STOP", stage)
                .status().unwrap();
            assert_eq!(status.code(), Some(73));
            if stage == "renamed" { assert_eq!(fs::read(f.target()).unwrap(), b"complete replacement"); }
            else { f.unchanged(); }
            atomic_write(&f.target(), b"complete retry").unwrap();
            assert_eq!(fs::read(f.target()).unwrap(), b"complete retry");
        }
    }
}
