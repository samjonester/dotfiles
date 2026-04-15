# Google Workspace

Access Google Sheets, Drive, Calendar, Gmail, and other Google APIs from Quick sites via OAuth. All API calls go through `quick.http` so tokens stay server-side.

## Authenticate

```javascript
const token = await quick.auth.getToken([
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
]);
```

## Sheets

```javascript
const token = await quick.auth.getToken([
  "https://www.googleapis.com/auth/spreadsheets.readonly",
]);
const headers = { Authorization: `Bearer ${token.access_token}` };

// Read a range
const response = await quick.http.get(
  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:D10`,
  { headers }
);
const { values } = await response.json();
// => [[row1col1, row1col2], [row2col1, ...]]

// Get spreadsheet metadata (sheet names, etc.)
const meta = await quick.http.get(
  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
  { headers }
);
const { sheets } = await meta.json();
```

Scopes: `spreadsheets.readonly` or `spreadsheets` (read/write)

## Drive

```javascript
const token = await quick.auth.getToken([
  "https://www.googleapis.com/auth/drive.readonly",
]);
const headers = { Authorization: `Bearer ${token.access_token}` };

// Search files
const response = await quick.http.get(
  `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name contains 'report'")}&pageSize=50&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime desc`,
  { headers }
);
const { files } = await response.json();

// Export a Google Doc as text
const exported = await quick.http.get(
  `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
  { headers }
);
const text = await exported.text();
```

Scopes: `drive.readonly` or `drive` (full access)

## Calendar

```javascript
const token = await quick.auth.getToken([
  "https://www.googleapis.com/auth/calendar.readonly",
]);
const headers = { Authorization: `Bearer ${token.access_token}` };

// List upcoming events
const params = new URLSearchParams({
  timeMin: new Date().toISOString(),
  maxResults: "10",
  singleEvents: "true",
  orderBy: "startTime",
});
const response = await quick.http.get(
  `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
  { headers }
);
const { items: events } = await response.json();

// List calendars
const cals = await quick.http.get(
  "https://www.googleapis.com/calendar/v3/users/me/calendarList",
  { headers }
);
const { items: calendars } = await cals.json();
```

Scopes: `calendar.readonly`, `calendar.events`, or `calendar.events.freebusy`

## Gmail

```javascript
const token = await quick.auth.getToken([
  "https://www.googleapis.com/auth/gmail.readonly",
]);
const headers = { Authorization: `Bearer ${token.access_token}` };

// List recent messages
const response = await quick.http.get(
  "https://www.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=10",
  { headers }
);
const { messages } = await response.json();

// Get a specific message
const msg = await quick.http.get(
  `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
  { headers }
);
const message = await msg.json();
```

Scopes: `gmail.readonly`, `gmail.modify`, or `gmail.send`

## Helper Pattern

Wrap authenticated calls to avoid repeating headers:

```javascript
let token;

async function google(url) {
  if (!token) {
    token = await quick.auth.getToken([
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  }
  const response = await quick.http.get(url, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  return response.json();
}

// Usage
const { values } = await google(
  `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:D10`
);
const { files } = await google(
  "https://www.googleapis.com/drive/v3/files?pageSize=10"
);
```

## Common Scopes

| Service | Read-only | Full access |
|---|---|---|
| Sheets | `spreadsheets.readonly` | `spreadsheets` |
| Drive | `drive.readonly` | `drive` |
| Calendar | `calendar.readonly` | `calendar.events` |
| Gmail | `gmail.readonly` | `gmail.modify` |
| Docs | `documents.readonly` | `documents` |
| Slides | `presentations.readonly` | `presentations` |

All scopes are prefixed with `https://www.googleapis.com/auth/`.

## API Reference

| Service | Base URL | Docs |
|---|---|---|
| Sheets | `https://sheets.googleapis.com/v4` | [REST Reference](https://developers.google.com/sheets/api/reference/rest) |
| Drive | `https://www.googleapis.com/drive/v3` | [REST Reference](https://developers.google.com/drive/api/reference/rest/v3) |
| Calendar | `https://www.googleapis.com/calendar/v3` | [REST Reference](https://developers.google.com/calendar/api/v3/reference) |
| Gmail | `https://www.googleapis.com/gmail/v1` | [REST Reference](https://developers.google.com/gmail/api/reference/rest) |

## Revoke

```javascript
await quick.auth.revoke();
```
