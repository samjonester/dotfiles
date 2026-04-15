# File Storage (quick.fs)

Upload and manage files with progress tracking. Files are stored per-site and accessible via URL.

## Include

```html
<script src="/client/quick.js"></script>
```

## Read & Write

Store and retrieve data as files by name. Use for large payloads that don't belong in the database.

```javascript
// Write JSON -- objects are serialized automatically
await quick.fs.write("data.json", { users: [...], count: 42 });

// Write text
await quick.fs.write("notes.txt", "Hello world");

// Write binary
await quick.fs.write("photo.png", imageBlob);

// Read -- auto-parses based on content type
const data = await quick.fs.read("data.json");   // => parsed object
const text = await quick.fs.read("notes.txt");    // => string
const resp = await quick.fs.read("photo.png");    // => Response
```

Content type is detected from the data. Pass `{ contentType }` to override. Filenames are literal -- no renaming or prefixing. Paths with `/` are supported for organizing files into directories (e.g. `"exports/report.json"`). Calling `write` with an existing filename overwrites it.

Written files are served at `/files/{filename}`:

```html
<img src="/files/thumbnail.png">
```

## Upload

```javascript
// Single file
const file = document.querySelector("input[type=file]").files[0];
const result = await quick.fs.uploadFile(file, {
  onProgress: ({ percentage }) => console.log(`${percentage}%`),
});
// => { url, fullUrl, size, mimeType }

// Multiple files
const results = await quick.fs.upload(fileList);
// => { files: [{ url, fullUrl, size, mimeType }, ...] }
```

## Naming Strategies

Control how uploaded filenames are generated:

```javascript
await quick.fs.upload(files, { strategy: "hybrid" });     // default: timestamp + original name
await quick.fs.upload(files, { strategy: "original" });   // keep original filename
await quick.fs.upload(files, { strategy: "uuid" });       // random UUID
await quick.fs.upload(files, { strategy: "timestamp" });  // timestamp only
```

## Drag & Drop

```javascript
// From a drop event
const result = await quick.fs.uploadFromDrop(dropEvent);

// Or set up a drop zone
quick.fs.setupDropZone(element, {
  onDrop: (event) => quick.fs.uploadFromDrop(event),
  onDragOver: (event) => element.classList.add("dragover"),
  onDragLeave: (event) => element.classList.remove("dragover"),
  allowedTypes: ["image/png", "image/jpeg"],
});
```

## File URLs

```javascript
quick.fs.getUrl("photo.jpg");      // => "/files/photo.jpg"
quick.fs.getFullUrl("photo.jpg");  // => "https://my-site.quick.shopify.io/files/photo.jpg"
```

## File Management

```javascript
// Get file info
const info = await quick.fs.getInfo("photo.jpg");

// Delete
await quick.fs.delete("photo.jpg");
```

## Validation

```javascript
quick.fs.validateFile(file, {
  maxSize: 5 * 1024 * 1024,  // 5MB
  allowedTypes: ["image/png", "image/jpeg"],
});
```

## Quick Reference

| Method | Description |
|---|---|
| `write(filename, data, options)` | Write data to a file |
| `read(filename)` | Read a file (auto-parses JSON and text) |
| `upload(files, options)` | Upload one or more files |
| `uploadFile(file, options)` | Upload single file (returns single result) |
| `uploadFromDrop(event, options)` | Upload from drag & drop event |
| `setupDropZone(element, options)` | Configure drop zone element |
| `getUrl(filename)` | Get relative file URL |
| `getFullUrl(filename)` | Get absolute file URL |
| `getInfo(filename)` | Get file metadata |
| `delete(filename)` | Delete a file |
| `validateFile(file, constraints)` | Validate file before upload |

### Upload Options

| Option | Default | Description |
|---|---|---|
| `strategy` | `"hybrid"` | Naming: `original`, `uuid`, `timestamp`, `hybrid` |
| `overwrite` | `false` | Overwrite existing files |
| `onProgress` | `null` | Callback: `({ loaded, total, percentage }) => void` |
