// =====BEGIN HOMELAB PULL TO REFRESH=====
// Pull-to-refresh for the iOS standalone PWA only.
//
// When you launch Jellyfin from the iOS home screen (after Share
// → Add to Home Screen), Safari runs the page in "standalone"
// mode, which strips Safari's chrome — and along with it, the
// native pull-to-refresh gesture. This module re-adds the
// gesture by listening for vertical pulls at the top of the
// document, drawing a small indicator, and calling
// `location.reload()` when the user releases past a threshold.
//
// Scope is deliberately narrow:
//   - iOS only (browser.iOS is true).
//   - Standalone PWA only (navigator.standalone === true).
//   - The trigger is purely vertical (|dY| > |dX|), so a
//     horizontal swipe on a `.scrollX` row doesn't accidentally
//     fire it.
//   - The trigger requires you to actually be at the top of the
//     page (scrollY === 0) when the pull starts; if you reach
//     the top mid-gesture, that's when pull tracking begins.
//
// Mounted from src/index.jsx → loadPlatformFeatures().
// Idempotent — calling init() twice is a no-op.

import browser from 'scripts/browser';

const PULL_THRESHOLD = 70; // px of (damped) pull required to trigger reload
const PULL_DAMPING = 0.5; // multiplier on raw deltaY for "rubbery" feel
const MAX_INDICATOR_OFFSET = 90; // hard cap on how far indicator can travel
const RELOAD_DELAY_MS = 250; // brief pause after threshold so user sees the commit state

let isInitialized = false;
let indicator: HTMLDivElement | null = null;
let isRefreshing = false;

// Start of the pull, in viewport coords. Only set once the user
// is at scrollY === 0 during the current gesture.
let pullStartY: number | null = null;
let pullStartX: number | null = null;
let currentPull = 0;

interface NavigatorWithStandalone extends Navigator {
    standalone?: boolean;
}

function isIOSStandalone(): boolean {
    if (!browser.iOS) return false;
    return (window.navigator as NavigatorWithStandalone).standalone === true;
}

function createIndicator(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'homelab-ptr-indicator';
    el.setAttribute('aria-hidden', 'true');
    // Inline styles intentionally — keeps this feature in a
    // single file and out of the SCSS build graph. The icon is a
    // unicode refresh glyph (U+21BB ↻) so we don't depend on a
    // specific icon font being loaded.
    Object.assign(el.style, {
        position: 'fixed',
        top: '0',
        left: '50%',
        zIndex: '99999',
        width: '36px',
        height: '36px',
        marginLeft: '-18px',
        borderRadius: '50%',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '22px',
        lineHeight: '1',
        pointerEvents: 'none',
        opacity: '0',
        transform: 'translateY(-100%)',
        transition: 'opacity 150ms ease, transform 200ms ease',
        // Honor iOS safe area (notch / status bar) so the icon
        // doesn't appear under the dynamic island.
        paddingTop: 'env(safe-area-inset-top, 0)'
    } as Partial<CSSStyleDeclaration>);
    el.textContent = '\u21BB';
    document.body.appendChild(el);
    return el;
}

function setIndicatorForPull(pullPx: number, committed: boolean) {
    if (!indicator) return;
    const offset = Math.min(pullPx, MAX_INDICATOR_OFFSET);
    const opacity = Math.min(offset / PULL_THRESHOLD, 1);
    // No CSS transition while the finger is moving — we want the
    // indicator to track the pull 1:1. Re-enable transition only
    // when we snap back or commit.
    indicator.style.transition = 'none';
    indicator.style.opacity = String(opacity);
    indicator.style.transform = `translateY(${offset}px) scale(${committed ? 1.1 : 1})`;
}

function setIndicatorCommitted() {
    if (!indicator) return;
    indicator.style.transition = 'transform 200ms ease';
    indicator.style.opacity = '1';
    indicator.style.transform = `translateY(${PULL_THRESHOLD}px) scale(1.2)`;
}

function resetIndicator() {
    if (!indicator) return;
    indicator.style.transition = 'opacity 200ms ease, transform 200ms ease';
    indicator.style.transform = 'translateY(-100%)';
    indicator.style.opacity = '0';
}

function abandonPull() {
    pullStartY = null;
    pullStartX = null;
    currentPull = 0;
    resetIndicator();
}

function onTouchStart(e: TouchEvent) {
    if (isRefreshing) return;
    if (e.touches.length !== 1) return;
    // Only arm if currently at the top. If user is mid-page when
    // they touch, we'll arm later (in touchmove) if they reach
    // the top during the gesture.
    if (window.scrollY === 0) {
        pullStartY = e.touches[0].clientY;
        pullStartX = e.touches[0].clientX;
    } else {
        pullStartY = null;
        pullStartX = null;
    }
    currentPull = 0;
}

function onTouchMove(e: TouchEvent) {
    if (isRefreshing) return;
    if (e.touches.length !== 1) return;

    // Arm pull tracking the moment the user reaches the top of
    // the page mid-gesture (e.g. they were scrolled down 200px
    // and rapidly swiped up to here).
    if (window.scrollY === 0 && pullStartY === null) {
        pullStartY = e.touches[0].clientY;
        pullStartX = e.touches[0].clientX;
        return;
    }

    // Scrolled away from the top — definitively not a pull.
    if (window.scrollY > 0) {
        if (currentPull > 0) abandonPull();
        return;
    }

    if (pullStartY === null || pullStartX === null) return;

    const deltaY = e.touches[0].clientY - pullStartY;
    const deltaX = e.touches[0].clientX - pullStartX;

    // Pulling up or mostly horizontal → not a refresh gesture.
    // The |dX| > |dY| guard is what keeps horizontal row swipes
    // from accidentally activating pull-to-refresh.
    if (deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY)) {
        if (currentPull > 0) {
            currentPull = 0;
            resetIndicator();
        }
        return;
    }

    if (!indicator) indicator = createIndicator();

    // We're now committed to consuming this gesture as a pull.
    // preventDefault stops the iOS scroll-bounce so our indicator
    // is the only visible response. Requires the listener to be
    // non-passive (see init()).
    if (e.cancelable) e.preventDefault();

    currentPull = deltaY * PULL_DAMPING;
    setIndicatorForPull(currentPull, currentPull >= PULL_THRESHOLD);
}

function onTouchEnd() {
    if (isRefreshing) return;
    if (pullStartY === null) return;

    const triggered = currentPull >= PULL_THRESHOLD;
    pullStartY = null;
    pullStartX = null;

    if (triggered) {
        isRefreshing = true;
        setIndicatorCommitted();
        // Brief delay so the commit-state indicator is visible
        // before the page tears down.
        setTimeout(() => {
            window.location.reload();
        }, RELOAD_DELAY_MS);
    } else {
        currentPull = 0;
        resetIndicator();
    }
}

function onTouchCancel() {
    if (isRefreshing) return;
    abandonPull();
}

export function init() {
    if (isInitialized) return;
    if (!isIOSStandalone()) return;
    isInitialized = true;

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    // Non-passive so preventDefault() can suppress iOS scroll-bounce.
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });
}
// =====END HOMELAB PULL TO REFRESH=====
