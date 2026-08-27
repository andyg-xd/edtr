//! Where a window should sit when its sidebar opens or closes.
//!
//! Pure arithmetic — no Tauri calls, no I/O — so every branch is unit-testable.
//! Applying the result is `window.rs`'s job.
//!
//! All values are PHYSICAL pixels. The caller converts the sidebar's logical
//! width using the scale factor of the window's CURRENT monitor, read at the
//! moment of the operation.
//!
//! **That last point is measured, not stylistic** (6c-iv-b Task 0 spike,
//! 2026-08-27). The owner's external display reports scale 1.0 — not the 2.0 a
//! Mac invites you to assume — while the built-in Retina panel reports 2.0.
//! Dragging a window between them mid-run switched the delta from 200 to 400
//! physical px and every cycle still landed exactly. Caching the scale factor
//! at startup, which is the obvious implementation, would have broken at
//! precisely that moment.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect { pub x: i32, pub y: i32, pub w: u32, pub h: u32 }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrowStrategy {
    /// Moved left and widened: the document pane does not shift on screen.
    GrewLeft,
    /// No room left, so widened to the right. The pane DOES shift, but the
    /// window stays on screen, which matters more.
    GrewRight,
    /// Grew as far as the work area allowed; the rest has to come out of the
    /// pane. Carries how much was actually gained.
    Partial(u32),
    /// Nothing was gained — maximized (D3), or no free space either side.
    Compressed,
}

/// What a sidebar OPEN should do to the window.
///
/// All values PHYSICAL pixels. `delta` is the sidebar width already converted
/// via the CURRENT monitor's scale factor — which the spike proved is not
/// assumable: the owner's external display reports 1.0 while the built-in
/// Retina panel will report 2.0, so scale is per-monitor and must be read at
/// the moment of the operation, never cached.
pub fn plan_open(win: Rect, work: Rect, delta: i32, maximized: bool) -> (Rect, GrowStrategy) {
    if maximized || delta <= 0 {
        return (win, GrowStrategy::Compressed); // D3: never fight the OS
    }

    // Clamped at zero: a window straddling two displays, or dragged partly
    // off-screen, yields a NEGATIVE room on one side. Left unclamped that
    // would read as "space available" via a sign error and move the window
    // further off-screen.
    let room_left = (win.x - work.x).max(0);
    let room_right = ((work.x + work.w as i32) - (win.x + win.w as i32)).max(0);

    if room_left >= delta {
        (Rect { x: win.x - delta, w: win.w + delta as u32, ..win }, GrowStrategy::GrewLeft)
    } else if room_right >= delta {
        (Rect { w: win.w + delta as u32, ..win }, GrowStrategy::GrewRight)
    } else {
        // Take whatever is going, left first (it keeps the pane stillest), and
        // let the pane absorb the shortfall.
        let gain = (room_left + room_right).min(delta);
        if gain <= 0 {
            (win, GrowStrategy::Compressed)
        } else {
            let take_left = room_left.min(gain);
            (
                Rect { x: win.x - take_left, w: win.w + gain as u32, ..win },
                GrowStrategy::Partial(gain as u32),
            )
        }
    }
}

/// What a sidebar CLOSE should do (D1: symmetric).
///
/// Deliberately takes the RECORDED open, not a recomputation. Recomputing
/// would pick a strategy from the window's CURRENT position, which is not
/// necessarily where it was opened — so a window moved while the sidebar was
/// open would close to the wrong place. Reversing exactly what was applied
/// cannot drift.
pub fn plan_close(win: Rect, applied_dx: i32, applied_dw: u32) -> Rect {
    Rect { x: win.x - applied_dx, w: win.w.saturating_sub(applied_dw), ..win }
}

#[cfg(test)]
mod tests {
    use super::*;
    const WORK: Rect = Rect { x: 0, y: 31, w: 2560, h: 1351 }; // measured, spike 2026-08-26

    fn win(x: i32, w: u32) -> Rect { Rect { x, y: 100, w, h: 600 } }

    #[test] fn grows_left_when_there_is_room() {
        let (r, s) = plan_open(win(880, 800), WORK, 200, false);
        assert_eq!(s, GrowStrategy::GrewLeft);
        assert_eq!((r.x, r.w), (680, 1000)); // exactly what the spike measured
    }

    #[test] fn grows_right_when_pinned_to_the_left_edge() {
        let (r, s) = plan_open(win(0, 800), WORK, 200, false);
        assert_eq!(s, GrowStrategy::GrewRight);
        assert_eq!((r.x, r.w), (0, 1000));
    }

    #[test] fn compresses_when_maximized_even_with_room() {
        let (r, s) = plan_open(win(880, 800), WORK, 200, true);
        assert_eq!(s, GrowStrategy::Compressed);
        assert_eq!(r, win(880, 800));
    }

    #[test] fn compresses_when_the_window_fills_the_work_area() {
        let (r, s) = plan_open(win(0, 2560), WORK, 200, false);
        assert_eq!(s, GrowStrategy::Compressed);
        assert_eq!(r, win(0, 2560));
    }

    #[test] fn takes_a_partial_gain_when_neither_side_alone_suffices() {
        // 60 left + 60 right = 120 of the 200 asked for.
        let (r, s) = plan_open(win(60, 2440), WORK, 200, false);
        assert_eq!(s, GrowStrategy::Partial(120));
        assert_eq!((r.x, r.w), (0, 2560));
    }

    #[test] fn a_window_wider_than_the_work_area_never_grows() {
        let (r, s) = plan_open(win(-100, 2800), WORK, 200, false);
        assert_eq!(s, GrowStrategy::Compressed);
        assert_eq!(r, win(-100, 2800));
    }

    #[test] fn a_straddling_window_still_grows_on_the_side_that_has_room() {
        // Left edge off-screen. NOTE: this does NOT exercise the clamping —
        // a negative room_left fails `>= delta` exactly as a clamped 0 does,
        // so both reach this same branch. Kept because the behaviour is worth
        // pinning; the clamping is covered by the test below, which was added
        // after a probe showed THIS test could not see it.
        let (r, s) = plan_open(win(-300, 500), WORK, 200, false);
        assert_eq!(s, GrowStrategy::GrewRight);
        assert_eq!(r.x, -300);
    }

    #[test] fn negative_room_is_clamped_where_it_actually_matters() {
        // The Partial branch is the ONLY place clamping changes an answer: it
        // SUMS the two rooms, so a negative left both shrinks the gain and —
        // via `x - take_left` with take_left negative — moves the window the
        // WRONG WAY, further off-screen.
        //
        // Left edge 100px off-screen, right edge 160px short of the work area,
        // so neither side alone covers the 200 delta.
        //   clamped:   gain = (0 + 160) = 160, take_left = 0     -> x stays -100
        //   unclamped: gain = (-100 + 160) = 60, take_left = -100 -> x becomes 0
        let (r, st) = plan_open(win(-100, 2500), WORK, 200, false);
        assert_eq!(st, GrowStrategy::Partial(160));
        assert_eq!(r.x, -100, "a clamped left room must not move the window");
        assert_eq!(r.w, 2660);
    }

    #[test] fn close_exactly_reverses_the_recorded_open() {
        let start = win(880, 800);
        let (opened, _) = plan_open(start, WORK, 200, false);
        let closed = plan_close(opened, opened.x - start.x, opened.w - start.w);
        assert_eq!(closed, start);
    }

    #[test] fn close_reverses_what_was_applied_even_if_the_window_moved() {
        let (opened, _) = plan_open(win(880, 800), WORK, 200, false);
        let moved = Rect { x: opened.x + 300, ..opened }; // user dragged it
        let closed = plan_close(moved, 200, 200);
        assert_eq!((closed.x, closed.w), (780, 800)); // delta reversed, drag kept
    }
}
