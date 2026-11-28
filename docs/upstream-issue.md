# Upstream issue for Flagsmith/ci — Filed at [#12](https://github.com/Flagsmith/ci/issues/12)

**Title:** Code references: `getValue("…")` / `useFlags([…])` calls are not detected, and an empty scan never clears old references

**Version:** `Flagsmith/ci` `main` at `a6af20b` (tag `v1.0.0`), Flagsmith API 2.295.2 (self-hosted).

## 1. Common SDK calls are not matched

`scan_code_references.py` only counts a line when this pattern matches the current and previous line:

```
(?i:(?:feature|flag)\w*\(\s*(["'])<feature_name>\1)
```

So the call has to start with `feature…(` or `flag…(` followed directly by the quoted name. Common calls from Flagsmith's own SDKs don't match:

| Line | Detected |
|---|---|
| `flagsmith.hasFeature("enable_express_checkout")` | yes |
| `flagsmith.getFlag("checkout_cta_variant")` | yes |
| `flagsmith.getValue("checkout_cta_variant")` (JS SDK) | **no** |
| `useFlags(["checkout_cta_variant"])` (React SDK) | **no**: `[` comes between `(` and the quote |

**Repro**
1. Commit a file containing `flagsmith.getValue("my_flag")` and `const flags = useFlags(["my_flag"])`.
2. Run the `collect-code-references` workflow with `my_flag` in the project.
3. Expected: 2 references to `my_flag`. Actual: 0.

**Possible fix:** add `value` to the prefix alternatives and allow an optional `[` before the quote, e.g. `(?:feature|flag|value)\w*\(\s*\[?\s*(["'])…\1`. Or match any quoted string equal to a known feature name, since the scanner already gets the exact list of names from the API.

## 2. Removing the last reference never clears it in Flagsmith

`upload_code_references.py` returns early when the scan finds nothing:

```python
if not code_references:
    return 0
```

The API treats the latest scan per repository as the source of truth. I checked on 2.295.2: posting a scan without a flag drops that flag's `code_references_counts` to 0, and posting `"code_references": []` clears every count for that repository. But the action never sends the empty scan, so after the last flag reference is deleted from a repo, the dashboard keeps showing the old references.

**Repro**
1. Have a repo with one reference to `my_flag`. Run the workflow: the dashboard shows 1 reference.
2. Delete that line, push to `main`, and let the workflow run again. It logs "No code references to upload."
3. Expected: `my_flag` shows 0 references. Actual: it still shows 1, pointing at a line that no longer exists.

**Possible fix:** always POST, including when `code_references` is empty.
