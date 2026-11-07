# DESIGN.md - Tutur

Design direction for the judge-facing playground and the demo dashboard.

## Identity

Tutur is a chat concierge for Balinese warungs and homestays. The surface should
feel like a well-kept warung: warm paper, clay roof tiles, plain speech. Not a
SaaS dashboard, not a startup landing page.

## Design Read

Reading this as: a judge-facing product demo for a Balinese UMKM tool, in a warm
editorial warung language, dial ENERGY 2 / RHYTHM 2 / MOTION 1.

- **ENERGY 2:** the page states what it does and gets out of the way. One clear
  headline, one working demo, one trace panel.
- **RHYTHM 2:** intro, demo, trace, and footnote have different compositions.
  The chat panel and trace panel are deliberately asymmetric because they carry
  different jobs.
- **MOTION 1:** hover and focus states only. No entrance animations, no loops.
  Judges should watch the product, not the page.

## Palette

| Token | Value | Job |
|---|---|---|
| Ink | `#221c17` | Body text and the primary button. Warm near-black, not pure black |
| Ivory | `#f4efe5` | Page ground. Evokes paper and clay, not a generic cream template |
| Paper | `#fffdf8` | Panel surface |
| Clay | `#a94b25` | Single accent: brand mark, active persona, outbound chat. Terracotta from Balinese roof tiles |
| Green / amber / slate | status only | Auto, draft, and ignore states. These carry meaning, so they are allowed a small dose |

Three neutrals plus one accent. Status colors are functional, not decorative.

## Typography

- **Fraunces** for display: a warm serif that reads like a warung sign, not a
  tech landing page.
- **Plus Jakarta Sans** for UI text: an Indonesian typeface, chosen for the
  product's audience and for its open, friendly letterforms. Inter would be the
  default pick, and that is exactly why it is not used.
- **JetBrains Mono** only for model names, latency, and source IDs, where fixed
  width helps scanning.

## Layout reasons

- Two columns on desktop because the demo has two simultaneous jobs: talk to the
  agent, and inspect why it answered. Stacking them would hide the trace below
  the fold.
- Personas are rectangular chips, not pills, because they are selectable
  options, not status badges.
- Trace rows use a light divider grid instead of separate cards. The trace is
  one object, not four floating widgets.
- Numbered steps are wayfinding, not decoration: the page has three real actions
  (choose a role, send a message, read the trace), and a first-time judge should
  not have to guess the order.
- The impact strip sits beside the intro, not in a four-card KPI row. It answers
  "does this save the owner time" before the judge starts typing.
- The trace panel sticks on desktop so a long chat never pushes the explanation
  out of view.

## Copy rules

- Plain Indonesian, short sentences.
- No em dashes.
- No "AI powered", "seamless", "next generation", or other marketing filler.
- Numbers on screen are labeled as simulation plus live session data.

## Accessibility

- WCAG AA contrast verified for every text pair.
- Visible `:focus-visible` ring on every control.
- All controls are native buttons, links, inputs, or selects.
- Tap targets at least 44px.
- Reduced motion respected.
