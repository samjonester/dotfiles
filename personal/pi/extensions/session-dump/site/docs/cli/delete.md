# quick delete

Delete a deployed Quick site and all its files.

## Usage

```bash
quick delete <sitename>
```

## Arguments

| Argument | Required | Description |
|---|---|---|
| `sitename` | Yes | Subdomain of the site to delete |

## Example

```bash
quick delete my-old-site
```

## Behavior

1. Validates the site name
2. Checks gcloud authentication
3. Verifies the site exists (exits with error if not)
4. Shows a warning that this cannot be undone
5. Requires typing the exact site name to confirm
6. Deletes all files from `gs://skai-train-quick/sites/<sitename>`

## Safety

- Cannot be bypassed or automated -- requires interactive confirmation
- Must type the exact site name (not just y/n)
- DNS propagation may take a few minutes after deletion
