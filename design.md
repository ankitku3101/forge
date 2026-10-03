# Design — Autonomous AI Worker

A locked design system for the desktop app. Every UI change reads this file first.
Extend or amend it when the system needs to grow; don't override it per component.
Tokens live in `src/renderer/src/index.css` (`:root`, `.dark`, `@theme inline`).

## Genre
modern-minimal, cool dev-tool register: an instrument panel for watching an AI work.
Function carries every screen; there is no marketing surface and no decorative imagery.

## Macrostructure
One app shell (Workbench): header · Sandbox (left) · Workspace (center) · Activity (right) · Chat (under Workspace).
Panels share one header component (`PanelHeader`, 44 px) and one card shell.

## Theme
| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | oklch(98.5% 0.004 255) | oklch(16.5% 0.01 260) | canvas, list wells |
| `--card` | oklch(100% 0 0) | oklch(20% 0.012 260) | panels, cards |
| `--foreground` | oklch(22% 0.015 260) | oklch(94% 0.005 260) | text |
| `--muted-foreground` | oklch(47% 0.016 260) | oklch(71% 0.012 260) | meta text (≥ 4.5:1) |
| `--border` | oklch(91.5% 0.006 260) | oklch(29% 0.012 260) | hairlines |
| `--primary` | oklch(52% 0.19 262) | oklch(70% 0.14 262) | cobalt: primary action, focus, selection |
| `--accent` | oklch(95.5% 0.022 262) | oklch(27% 0.045 262) | hover / selected rows |
| `--success` | oklch(48% 0.12 155) | oklch(74% 0.13 155) | verified, paid |
| `--warning` | oklch(50% 0.12 62) | oklch(81% 0.12 75) | needs you, unpaid |
| `--destructive` | oklch(52% 0.2 27) | oklch(70% 0.17 25) | failed, overdue, injection |

Accent discipline: cobalt appears only on the primary button, focus rings, the selected-row rule and
"following" indicators. Status colours are text-on-tint (`bg-x/10 text-x`), never solid fills.

## Typography
- UI and display: **Geist Variable** (bundled via `@fontsource-variable/geist`), 400 body, 600 titles.
- Data: **Geist Mono Variable**, only for tool names, IDs, amounts, dates, paths, model names. Tabular numerals.
- No third family. No italics in UI chrome.
- Scale (five sizes, Tailwind names): `text-2xs` 11 px caps labels · `text-xs` 12 px meta · `text-sm` 14 px body/UI ·
  `text-base` 16 px titles · `text-xl` 20 px document headings. No arbitrary `text-[Npx]`.
- Labels: `.label-caps` (11 px, semibold, 0.08em tracking, uppercase, muted). One style everywhere.

## Spacing
Tailwind's 4 pt scale, whole steps only (1, 2, 3, 4, 6, 8). Panel headers and toolbars `h-11`, app header `h-12`,
list rows `px-4 py-2`, cards `px-3` with `py-2` lines, document views `px-8 py-6`. Half steps are reserved for optical icon nudges.

## Radius
Controls 6 px (`rounded-md`), cards 8 px (`rounded-lg`), status chips 4 px (`rounded-sm`). No pills.

## Motion
- Easing `--ease-out` cubic-bezier(0.16, 1, 0.3, 1). Colour and transform transitions only.
- The ledger change-flash (2.4 s) and the "following" pulse are the only ambient motion; both collapse under `prefers-reduced-motion`.

## Microinteractions
- Silent success: verification and summaries report results; no celebratory toasts.
- Focus rings appear instantly (2 px `--ring`, 2 px offset). Never animated.
- Destructive or financial actions are confirmed by the approval card, not by modal dialogs.

## CTA voice
- Primary: filled cobalt, 6 px radius, sentence-case verb ("Approve", "Sign in", "Start").
- Secondary: outline, same shape ("Reject", "Edit"). Tertiary: ghost text buttons in toolbars.

## What every screen must share
Geist + Geist Mono, the token palette, `PanelHeader`, `.label-caps`, `StatusBadge`, and the card shell.

## Exports

### tokens.css
See `src/renderer/src/index.css`. It is the single source; this file documents it.
