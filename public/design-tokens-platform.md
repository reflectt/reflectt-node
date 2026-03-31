# Design Tokens — Platform Mapping

Source of truth: `/public/design-tokens.css`

## iOS (Swift)

```swift
// Colors.swift — auto-generate from design-tokens.css
import SwiftUI

extension Color {
    static let brandPrimary = Color(hex: "#7C3AED")
    static let brandPrimaryLight = Color(hex: "#A78BFA")
    static let brandPrimaryDark = Color(hex: "#5B21B6")

    // Canvas states
    static let stateFloor = Color(hex: "#1F2937")
    static let stateListening = Color(hex: "#7C3AED")
    static let stateThinking = Color(hex: "#6366F1")
    static let stateRendering = Color(hex: "#8B5CF6")
    static let stateAmbient = Color(hex: "#374151")
    static let stateDecision = Color(hex: "#F59E0B")
    static let stateUrgent = Color(hex: "#EF4444")
    static let stateHandoff = Color(hex: "#10B981")

    // Trust
    static let trustActive = Color(hex: "#F87171")  // Red 400 — visible without alarming
}

// Dimensions.swift
enum Dimension {
    static let tapTargetMin: CGFloat = 44
    static let tapTargetUrgent: CGFloat = 52
    static let orbSizeIdle: CGFloat = 64
    static let orbSizeTranscript: CGFloat = 44
    static let trustIndicatorSize: CGFloat = 10
    static let overrideBarHeight: CGFloat = 52
    static let presenceDotSize: CGFloat = 8
}

// Animation.swift
enum Timing {
    static let fast: Double = 0.15
    static let base: Double = 0.25
    static let slow: Double = 0.35
    static let canvas: Double = 0.5
    static let orbGlow: Double = 1.8
}
```

## Android (Kotlin)

```xml
<!-- colors.xml -->
<color name="brand_primary">#FF7C3AED</color>
<color name="brand_primary_light">#FFA78BFA</color>
<color name="brand_primary_dark">#FF5B21B6</color>

<color name="state_floor">#FF1F2937</color>
<color name="state_listening">#FF7C3AED</color>
<color name="state_thinking">#FF6366F1</color>
<color name="state_rendering">#FF8B5CF6</color>
<color name="state_ambient">#FF374151</color>
<color name="state_decision">#FFF59E0B</color>
<color name="state_urgent">#FFEF4444</color>
<color name="state_handoff">#FF10B981</color>

<color name="trust_active">#FFF87171</color> <!-- Red 400 -->

<!-- dimens.xml -->
<dimen name="tap_target_min">44dp</dimen>
<dimen name="tap_target_urgent">52dp</dimen>
<dimen name="orb_size_idle">64dp</dimen>
<dimen name="orb_size_transcript">44dp</dimen>
<dimen name="trust_indicator_size">10dp</dimen>
<dimen name="override_bar_height">52dp</dimen>
<dimen name="presence_dot_size">8dp</dimen>
```

```kotlin
// Timing.kt
object Timing {
    const val FAST = 150L
    const val BASE = 250L
    const val SLOW = 350L
    const val CANVAS = 500L
    const val ORB_GLOW = 1800L
}
```

## Important Notes

**Canvas state colors are tint references, not solid fills.** The spec uses these as radial gradient tints. Platform implementations should apply them as gradient bases, not flat backgrounds. For v0 surfaces using solid fills, these values are acceptable approximations.

**Trust indicator uses red-400 (#F87171)** — deliberately lighter than error red. Present and visible without being alarming. Both-sensors escalates to red-500 (#EF4444).

## Token Categories

| Category | Count | Notes |
|----------|-------|-------|
| Brand colors | 4 | Purple family |
| Semantic colors | 8 | Success/warning/error/info + backgrounds |
| Canvas states | 8 | Maps to state machine spec |
| Trust | 4 | Mic/camera indicators |
| Surface/bg | 6 | Light + dark mode |
| Text | 6 | Primary through inverse |
| Borders | 4 | Default/hover/focus/error |
| Typography | 14 | Font family, size, weight, line-height |
| Spacing | 12 | 0–64px scale |
| Radius | 6 | 4px–full |
| Shadows | 6 | sm through glow |
| Transitions | 9 | Duration + easing |
| Z-index | 8 | Layering scale |
| Interactive | 3 | Tap targets + focus ring |
| Canvas/orb | 5 | Orb dimensions + glow |
| Override bar | 3 | Height/bg/blur |
| Presence | 3 | Dot states |
| **Total** | **~105** | |
