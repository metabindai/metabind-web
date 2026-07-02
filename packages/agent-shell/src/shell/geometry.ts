// Dock geometry. The shell morphs a single panel between a centered modal, a
// docked right rail, and a floating bottom-right pill; these compute the target
// rectangle for each mode against the current viewport.

import type { DockMode } from "@metabindai/agent-ui/protocol";

export type Geom = {
    left: number;
    top: number;
    width: number;
    height: number;
    radius: number;
};

export const SIDEBAR_WIDTH = 420;
const SIDEBAR_TOP = 128; // clear a sticky header + toolbar
const SIDEBAR_MARGIN = 20;
/** How far a host should shift its content left when the sidebar is open. */
export const SIDEBAR_PUSH = SIDEBAR_WIDTH + SIDEBAR_MARGIN * 2;

export function modalGeom(): Geom {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(1180, vw * 0.96);
    const height = vh * 0.94;
    return { left: (vw - width) / 2, top: (vh - height) / 2, width, height, radius: 32 };
}

export function sidebarGeom(): Geom {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
        left: vw - SIDEBAR_MARGIN - SIDEBAR_WIDTH,
        top: SIDEBAR_TOP,
        width: SIDEBAR_WIDTH,
        height: vh - SIDEBAR_TOP - SIDEBAR_MARGIN,
        radius: 24,
    };
}

/** Resting position of the minimized "Continue chat" pill (bottom-right). */
export function dockPillGeom(): Geom {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = 210;
    const height = 56;
    const m = 24;
    return { left: vw - m - width, top: vh - m - height, width, height, radius: 28 };
}

/** A launch origin from an element's rect (a pill-shaped collapsed state). */
export function rectToGeom(rect: DOMRect): Geom {
    return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        radius: rect.height / 2,
    };
}

export function geomForMode(mode: DockMode): Geom {
    return mode === "modal"
        ? modalGeom()
        : mode === "sidebar"
          ? sidebarGeom()
          : dockPillGeom();
}
