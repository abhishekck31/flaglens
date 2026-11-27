# Open the demo file

`apps/demo-store/src/components/FlagsmithProvider.tsx` reads two flags with the official SDK.
One key has a deliberate typo, `checkout_cta_varient`:

- it's underlined with **Did you mean "checkout_cta_variant"?** (`Ctrl+.` to fix);
- hover any flag name for its state and value in every environment;
- click the CodeLens above a flag to toggle it (Production asks first).
