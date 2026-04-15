# WebSocket (quick.socket)

Real-time multiplayer via Socket.IO. Provides room-based presence, per-user state synchronization, and custom ephemeral events. Rooms are automatically isolated by subdomain.

## Include

```html
<script src="/client/quick.js"></script>
```

## Join a Room

```javascript
const room = quick.socket.room("lobby");

// Set up handlers BEFORE joining
room.on("user:join", (user) => console.log("joined:", user.name));
room.on("user:leave", (user) => console.log("left:", user.name));
room.on("user:state", (prev, next, user) => {
  console.log(user.name, "state changed:", prev, "->", next);
});

await room.join();
```

## Users & Presence

```javascript
// All users in room (Map<socketId, User>)
room.users;

// Current user
room.user;
// => { socketId, name, email, state, slackHandle?, slackId?, slackImageUrl?, title? }

// Connection status
room.connected; // true when socket connected AND snapshot received
```

## User State

Each user has a `state` object that stays in sync across all clients.

```javascript
// Update your state (partial merge)
room.updateUserState({ cursor: { x: 100, y: 200 } });
room.updateUserState({ color: "blue" }); // cursor is preserved

// Read any user's state
room.user.state; // own state
[...room.users.values()].forEach((u) => console.log(u.name, u.state));
```

## Custom Events

Ephemeral messages (not persisted, not part of state).

```javascript
// Send
room.emit("ping", { timestamp: Date.now() });

// Listen
room.on("ping", (data, sender) => {
  console.log(sender.name, "pinged at", data.timestamp);
});
```

## Connection Lifecycle

```javascript
room.on("connect", () => console.log("connected"));
room.on("disconnect", (reason) => console.log("disconnected:", reason));
// Auto-reconnect and re-join is handled automatically
```

## Leave

```javascript
room.leave();
```

## Remove Handlers

```javascript
room.off("user:join", myHandler);
room.off("ping", myPingHandler);
```

## Quick Reference

| Method | Description |
|---|---|
| `quick.socket.room(name)` | Create room instance |
| `room.join()` | Connect and join room |
| `room.leave()` | Disconnect from room |
| `room.on(event, handler)` | Listen to events |
| `room.off(event, handler)` | Remove handler |
| `room.emit(event, data)` | Send custom event |
| `room.updateUserState(obj)` | Update own state (partial merge) |
| `room.users` | Map of all users |
| `room.user` | Current user object |
| `room.connected` | Connection status boolean |

### Events

| Event | Callback Signature |
|---|---|
| `user:join` | `(user) => void` |
| `user:leave` | `(user) => void` |
| `user:state` | `(prevState, nextState, user) => void` |
| `connect` | `() => void` |
| `disconnect` | `(reason) => void` |
| Custom events | `(data, sender) => void` |
