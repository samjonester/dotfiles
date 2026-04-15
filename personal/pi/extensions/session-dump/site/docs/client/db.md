# Database (quick.db)

Firebase-like JSON database with real-time updates. Each site gets its own isolated database. Collections are created automatically on first use. All objects get auto-generated `id`, `created_at`, and `updated_at` fields.

Note: Each object in a collection has a maximum size of 1MB. For larger data, use [File Storage (quick.fs)](fs.md) to upload files and store the URL in the database.

## Include

```html
<script src="/client/quick.js"></script>
```

## Collection Reference

```javascript
const posts = quick.db.collection("posts");
```

## Create

```javascript
// Single
const post = await posts.create({ title: "Hello", status: "draft" });
// => { id: "uuid", title: "Hello", status: "draft", created_at: "...", updated_at: "..." }

// Bulk (transactional - all or nothing)
const result = await posts.create([
  { title: "First" },
  { title: "Second" },
]);
// => { created: 2, objects: [{ id, created_at, updated_at }, ...] }
```

## Read

```javascript
// All
const all = await posts.find();

// By ID (returns null if not found)
const one = await posts.findById("some-id");
```

## Query

Fluent, chainable interface. Each method returns a new query (immutable).

```javascript
const results = await posts
  .where({ status: "published", author: "alex" })
  .select(["title", "created_at"])
  .orderBy("created_at", "desc")
  .limit(10)
  .offset(20)
  .find();
```

### Where Operators

```javascript
.where({ views: { $gt: 100 } })      // greater than
.where({ views: { $gte: 100 } })     // greater than or equal
.where({ views: { $lt: 50 } })       // less than
.where({ views: { $lte: 50 } })      // less than or equal
.where({ status: { $ne: "draft" } }) // not equal
.where({ tag: { $in: ["a", "b"] } }) // in list
.where({ tag: { $nin: ["x"] } })     // not in list
.where({ title: { $like: "%hello%" } })   // pattern match
.where({ title: { $ilike: "%hello%" } })  // case-insensitive pattern
```

### Nested Fields

```javascript
.where({ "metadata.views": { $gt: 100 } })
.select(["title", "metadata.views"])
.orderBy("user.name", "asc")
```

### Array Queries

```javascript
.arrayContains({ tags: "javascript" })          // array includes value
.arrayAny({ tags: ["react", "vue"] })           // array includes any of these
.arrayLength({ tags: 3 })                       // exact length
.arrayLength({ tags: { $gte: 2 } })             // length with operator
```

## Update

```javascript
// Single (merge by default - only updates specified fields)
await posts.update("id", { status: "published" });

// Single with full overwrite
await posts.update("id", { title: "New" }, { overwrite: true });

// Bulk by ID
await posts.update([
  { id: "id-1", status: "published" },
  { id: "id-2", status: "archived" },
]);

// Bulk by filter
await posts.where({ status: "draft" }).update({ status: "published" });
```

## Delete

```javascript
// Single
await posts.delete("id");

// Bulk by ID
await posts.delete([{ id: "id-1" }, { id: "id-2" }]);

// Bulk by filter
await posts.where({ status: "archived" }).delete();
```

## Real-time Subscriptions

```javascript
const unsubscribe = posts.subscribe({
  onCreate: (doc) => console.log("created", doc),
  onUpdate: (doc) => console.log("updated", doc),
  onDelete: (id) => console.log("deleted", id),
  onConnect: (info) => console.log("connected", info),
  onError: (err) => console.error(err),
});

// Stop listening
unsubscribe();
```

## Reactive Queries

Auto-refreshes when data changes. Useful for keeping UI in sync.

```javascript
const query = posts.where({ status: "published" }).limit(10).reactive();

const unsubscribe = query.subscribe((results, error) => {
  if (error) return console.error(error);
  renderPosts(results);
});
```

## Collection Utilities

```javascript
// List all collections
const collections = await quick.db.getCollections();

// Collection stats
const stats = await posts.getStats();
// => { count, size, ... }

// Unique values from an array field
const allTags = await posts.getArrayValues("tags");
// => ["javascript", "react", "vue", ...]
```

## Quick Reference

| Method | Description |
|---|---|
| `collection(name)` | Get collection reference |
| `.create(data)` | Create one or many (array) |
| `.find()` | Execute query, return results |
| `.findById(id)` | Get one by ID |
| `.update(id, data)` | Update by ID (merge) |
| `.update(id, data, {overwrite: true})` | Update by ID (replace) |
| `.update([{id, ...}])` | Bulk update by ID |
| `.where({...}).update(data)` | Bulk update by filter |
| `.delete(id)` | Delete by ID |
| `.delete([{id}])` | Bulk delete by ID |
| `.where({...}).delete()` | Bulk delete by filter |
| `.where(conditions)` | Filter |
| `.arrayContains(cond)` | Array includes value |
| `.arrayAny(cond)` | Array includes any value |
| `.arrayLength(cond)` | Filter by array length |
| `.select(fields)` | Pick fields |
| `.orderBy(field, dir)` | Sort (asc/desc) |
| `.limit(n)` | Limit results |
| `.offset(n)` | Skip results |
| `.subscribe(handlers)` | Real-time events |
| `.reactive()` | Auto-refreshing query |
| `.getStats()` | Collection stats |
| `.getArrayValues(field)` | Unique array values |
| `getCollections()` | List all collections |
