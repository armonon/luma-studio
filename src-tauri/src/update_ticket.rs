//! A verified download is single-use and short-lived. It is never an install
//! authorization by itself: the frontend must first checkpoint its workspace.
use std::time::{Duration, Instant};

pub struct UpdateTicket<T> {
    next: u64,
    staged: Option<(String, Instant, T)>,
}

impl<T> UpdateTicket<T> {
    pub const fn new() -> Self { Self { next: 0, staged: None } }
    pub fn clear(&mut self) { self.staged = None; }

    pub fn stage(&mut self, value: T) -> String {
        self.next = self.next.checked_add(1).expect("update ticket counter exhausted");
        let token = self.next.to_string();
        self.staged = Some((token.clone(), Instant::now(), value));
        token
    }

    pub fn take(&mut self, token: &str) -> Result<T, String> {
        let Some((expected, created, _)) = self.staged.as_ref() else {
            return Err("No verified update is ready. Check for updates again.".into());
        };
        if created.elapsed() > Duration::from_secs(300) {
            self.staged = None;
            return Err("The verified update expired. Check for updates again.".into());
        }
        if expected != token { return Err("The update ticket changed. Check for updates again.".into()); }
        Ok(self.staged.take().unwrap().2)
    }

    pub fn discard(&mut self, token: &str) {
        if self.staged.as_ref().is_some_and(|entry| entry.0 == token) { self.staged = None; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_tickets_are_single_use_and_cannot_install_another_download() {
        let mut slot = UpdateTicket::new();
        let first = slot.stage("first");
        let second = slot.stage("second");
        assert!(slot.take(&first).is_err());
        slot.discard(&first);
        assert_eq!(slot.take(&second).unwrap(), "second");
        assert!(slot.take(&second).is_err());
    }

    #[test]
    fn cancelled_or_expired_downloads_cannot_be_installed() {
        let mut slot = UpdateTicket::new();
        let cancelled = slot.stage(vec![1, 2, 3]);
        slot.discard(&cancelled);
        assert!(slot.take(&cancelled).is_err());
        let expired = slot.stage(vec![4]);
        slot.staged.as_mut().unwrap().1 = Instant::now() - Duration::from_secs(301);
        assert!(slot.take(&expired).unwrap_err().contains("expired"));
        assert!(slot.staged.is_none());
    }
}
