# Controller UI guidelines

- Layout occupies the full landscape viewport (`100vw x 100vh`) with safe-area padding derived from CSS variables.
- Typography is normalized to the `Inter`/system stack with a 12/14/16/18/24 px scale reused via `--font-*` tokens.
- Buttons share consistent letter-spacing, border-radius (`var(--radius-lg)` for primaries, `var(--radius-pill)` for pills), and a single soft shadow.
- Color palette: dark background surfaces, blue accent for the wheel, green for Turbo, orange/pink for Shoot, and muted grays for secondary text.
- Glows and shadows are unified through `--shadow-*` tokens and applied to the wheel rim and throttle slider.
- Vertical panels use flexible sizing and gaps to avoid overlap at small breakpoints; responsive tweaks live in the media queries at the end of `controller.css`.
