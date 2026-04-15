# GitHub API

Access GitHub's API from Quick sites. Authenticate via OAuth to get a token, then make API calls through `quick.http`.

## Authenticate

```javascript
// Get token (opens popup if user hasn't authorized yet)
const token = await quick.auth.github.getToken(["repo", "user"]);
// => { access_token: "...", scopes: ["repo", "user"], token_type: "bearer" }
```

Common scopes: `repo` (repository access), `user` (profile info), `read:org` (org membership), `gist` (gists).

## Check Status (Without Popup)

```javascript
const status = await quick.auth.github.checkStatus(["repo", "user"]);
if (status.hasRequiredScopes) {
  // Already authorized
}
```

## Make API Calls

Use the token in the `Authorization` header with `quick.http`:

```javascript
const token = await quick.auth.github.getToken(["repo"]);
const headers = {
  Authorization: `Bearer ${token.access_token}`,
  Accept: "application/vnd.github.v3+json",
};

// List repos
const repos = await quick.http
  .get("https://api.github.com/user/repos?per_page=10", { headers })
  .then((r) => r.json());

// Get issues for a repo
const issues = await quick.http
  .get(
    "https://api.github.com/repos/Shopify/some-repo/issues?state=open&per_page=10",
    { headers }
  )
  .then((r) => r.json());

// Create an issue
const created = await quick.http
  .post("https://api.github.com/repos/Shopify/some-repo/issues", {
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Bug report", body: "Details here" }),
  })
  .then((r) => r.json());
```

## Helper Pattern

Wrap authenticated calls to avoid repeating headers:

```javascript
let token;

async function github(endpoint, options = {}) {
  if (!token) {
    token = await quick.auth.github.getToken(["repo", "user"]);
  }
  const url = endpoint.startsWith("http")
    ? endpoint
    : `https://api.github.com${endpoint}`;
  return quick.http
    .get(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/vnd.github.v3+json",
        ...options.headers,
      },
    })
    .then((r) => r.json());
}

// Usage
const repos = await github("/user/repos?per_page=10");
const prs = await github("/repos/Shopify/some-repo/pulls?state=open");
```

## Revoke

```javascript
await quick.auth.github.revoke();
```
