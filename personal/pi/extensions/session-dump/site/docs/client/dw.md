# Data Warehouse (quick.dw)

Query BigQuery using the current user's permissions. Requires OAuth authorization for BigQuery scopes.

## Include

```html
<script src="/client/quick.js"></script>
```

## Authorization

BigQuery requires user consent via OAuth. Request scopes before querying:

```javascript
const status = await quick.auth.requestScopes([
  "https://www.googleapis.com/auth/bigquery",
]);
// Shows auth bar if needed. Once authorized, queries will work.
```

## Synchronous Query

Best for quick queries that return fast.

```javascript
const { results, rowCount } = await quick.dw.querySync(
  "SELECT * FROM dataset.table LIMIT 10"
);

// With parameters
const { results } = await quick.dw.querySync(
  "SELECT * FROM dataset.users WHERE name = @name AND age > @age",
  { name: "alex", age: 21 }
);

// With options
const { results } = await quick.dw.querySync(sql, params, {
  timeoutMs: 60000,
  maxResults: 1000,
});
```

## Async Query (Jobs)

For long-running queries. Returns a job you can poll or wait on.

```javascript
// Submit and wait
const result = await quick.dw.queryAndWait("SELECT ...");
// => { status: "completed", results: [...], rowCount, metadata }

// Or manage the job manually
const job = await quick.dw.query("SELECT ...");
const result = await job.wait();

// Poll with callbacks
job.stream({
  onUpdate: (status) => console.log(status.status),
  onComplete: (result) => renderTable(result.results),
  onFailed: (status) => console.error(status.error),
});

// Cancel
await job.cancel();
```

## Job Management

```javascript
// List jobs
const jobs = await quick.dw.listJobs({ status: "running", limit: 10 });

// Get existing job
const job = quick.dw.getJob("job-id");
const status = await job.getStatus();

// Wait for multiple jobs
const results = await quick.dw.waitForAll([job1, job2], {
  timeout: 300000,
  failFast: true,
});
```

## Quick Reference

| Method | Description |
|---|---|
| `querySync(sql, params?, options?)` | Synchronous query |
| `query(sql, params?, options?)` | Async query, returns job |
| `queryAndWait(sql, params?, options?)` | Async query, waits for result |
| `getJob(jobId)` | Get existing job by ID |
| `listJobs(filters?)` | List query jobs |
| `waitForAll(jobs, options?)` | Wait for multiple jobs |

### Job Methods

| Method | Description |
|---|---|
| `job.wait()` | Wait for completion |
| `job.getStatus()` | Poll current status |
| `job.cancel()` | Cancel the job |
| `job.stream(callbacks)` | Poll with lifecycle callbacks |
