---
name: Aether Doc AI
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#434655'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#00569c'
  on-tertiary: '#ffffff'
  tertiary-container: '#196fc0'
  on-tertiary-container: '#ebf1ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#d4e3ff'
  tertiary-fixed-dim: '#a4c9ff'
  on-tertiary-fixed: '#001c39'
  on-tertiary-fixed-variant: '#004883'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.5rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.875rem
  space-lg: 1.25rem
  space-xl: 1.75rem
  space-2xl: 2.5rem
---

## Brand & Style

This design system crafts an ethereal, intelligent, and reassuring mobile assistant experience tailored for cognitive clarity. Designed primarily for mobile knowledge workers, researchers, and students parsing complex documents, the interface balances clinical precision with inviting softness.

The aesthetic blends **Modern iOS Human Interface Guidelines** with **Subtle Frosted Minimalism**:
- **Purity & Lightness:** Dominant clean whites and airy cerulean tints create zero visual clutter.
- **Micro-Gradients & Soft Ambient Volumes:** Soft radial light spheres drift gently in the canvas background to evoke intelligence, lightness, and modern AI capability without distracting from dense document data.
- **Tactile Soft Surfaces:** Card containers feature gentle corner radii, delicate single-pixel hairline borders, and subtle luminous drop shadows that communicate elevated, interactive focus.

## Colors

The color palette is calibrated around luminous cobalt and electric azure tones over pristine, multi-tiered white layers.

- **Primary (`#2563EB`):** Used for key calls-to-action, active stepper nodes, interactive focus states, and primary assistant messaging anchors.
- **Secondary (`#3B82F6`):** Drives secondary highlights, soft gradients, and interactive tags.
- **Tertiary (`#60A5FA`):** Applied to active glow states, file attachment icons, and decorative AI sparkle badges.
- **Neutral Surface Palette:**
  - `Canvas / Background`: `#FFFFFF` with atmospheric ambient blurs using `#EFF6FF` (Ice Blue Tint).
  - `Surface Card Fill`: `#FFFFFF` with translucent border overlays (`rgba(37, 99, 235, 0.08)` or `#E2E8F0`).
  - `Text Primary`: `#0F172A` (Slate 900) for high-contrast legibility.
  - `Text Secondary / Muted`: `#64748B` (Slate 500) for metadata, labels, and file size annotations.
  - `Subtle Neutral Container`: `#F8FAFC` to `#F1F5F9` for dropzone canvases and file preview rows.

## Typography

**Plus Jakarta Sans** is the unified typeface across headline, body, and label tiers. Its modern geometric structure, open apertures, and subtle contemporary warmth pair naturally with native mobile conventions and dense AI-generated documentation.

- **Headlines & Steppers:** Clean, centered, balanced, with tight letter spacing for clarity.
- **Reading Hierarchy:** Body sizes prioritize effortless reading during multi-paragraph document summaries. Numbers and dates benefit from tabular figures where appropriate.

## Layout & Spacing

The layout is built around mobile-first ergonomic convenience with fluid single-column hierarchy:

- **Vertical Rhythm:** 4px and 8px based spatial rhythm. Vertical spacing between sequential workflow steps relies strictly on `space-lg` (20px) to `space-xl` (28px) to prevent cognitive overload.
- **Horizontal Framing:** Safe margin padding is locked to `1.25rem` (20px) on standard viewports, allowing floating action buttons and upload cards to maintain consistent breathing room from glass bezel edges.
- **Viewport Fluidity:** On larger tablet viewports, forms and upload containers constrain to a centered maximum width of `560px` while background fluid gradient orbs scale responsively.

## Elevation & Depth

Visual depth is achieved through layered lucidity rather than heavy, murky shadows:

- **Level 0 (Canvas Base):** Pure white `#FFFFFF` underlaid with floating radial gradient blobs in `#EFF6FF` and `#DBEAFE` with a blur radius of 60px to 80px.
- **Level 1 (Card & File Containers):** Pure `#FFFFFF` surfaces paired with a crisp `1px solid rgba(226, 232, 240, 0.8)` border and an ambient shadow: `0 4px 16px -2px rgba(37, 99, 235, 0.04), 0 2px 6px -1px rgba(15, 23, 42, 0.03)`.
- **Level 2 (Modals, Overlays & Sticky Actions):** Soft floating elements with an elevation shadow of `0 12px 32px -4px rgba(37, 99, 235, 0.12)` accompanied by high-blur backdrops (`backdrop-filter: blur(16px)`).
- **Dashed Upload Dropzone:** Elevated through a recessive inset surface background of `#F8FAFC` surrounded by a `1.5px dashed #BFDBFE` perimeter.

## Shapes

The design system adopts a pill-shaped and deeply rounded contour language (`roundedness: 3`):

- **Primary Interactive Controls:** Bottom actions, upload triggers, and OAuth buttons feature pill shapes (`rounded-full` or `9999px`) to maintain native iOS touch ergonomics.
- **Cards & Dropzones:** Encased with smooth `1.5rem` to `1.75rem` (24px–28px) corner radii.
- **File Attachment Nodes & Stepper Icons:** Sized with micro-curvatures (`0.75rem` / 12px) for structured, tactile distinction.

## Components

### Buttons
- **Primary Action Button:** Full-width pill-shaped button. Background is a vibrant gradient from `#3B82F6` to `#2563EB`, text is crisp `#FFFFFF` with medium weight, accompanied by a subtle interactive bottom shadow.
- **Secondary / Social Auth Button:** Pill button with white fill, `1px solid #E2E8F0` hairline outline, slate text (`#0F172A`), accompanied by official third-party iconography.
- **Destructive / Icon Button:** Circular touch-target with muted hover state (`#F1F5F9`) and soft slate icon glyphs.

### Step Indicator (Progress Stepper)
- Horizontal step tracker displaying circular badge nodes (`32px × 32px`).
- **Active Node:** Solid `#2563EB` fill with white numeral, flanked by crisp title in primary blue.
- **Inactive / Future Node:** `#F1F5F9` surface with `#94A3B8` typography and delicate connecting line (`#E2E8F0`).

### Upload Dropzone
- Elevated card container with recessed background `#F8FAFC` and dashed border in `#BFDBFE`.
- Centered 3D-styled or two-tone layered document icon accented with blue sparkle/plus emblem.
- Subtitle instructions formatted in `body-sm` slate text with file weight limits clearly articulated.

### Document Preview List Item
- Row card container wrapped in `rounded-2xl` with white fill and delicate border (`#EFF6FF`).
- Left-aligned file type badge (e.g., coral-red rounded square for PDF, cobalt for DOCX).
- Two-line stack: Document title in bold slate alongside secondary file size/page count metadata.
- Right-aligned dismissive touch target (`×`) with low-contrast slate styling.

### AI Assistant Chat & Source Chips
- **AI Bubble:** White card surface framed in soft border, paired with an intelligent blue accent icon.
- **Citation / Source Tag:** Pill-shaped badge styled in `#EFF6FF` background with `#2563EB` typography (e.g., `[p. 14 • Financial Table]`), providing one-tap navigation to source document coordinates.