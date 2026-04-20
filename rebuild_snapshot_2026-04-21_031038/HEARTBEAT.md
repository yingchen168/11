# Heartbeat Rules

- During heartbeat polls, check the current session for unfinished user-requested work.
- If there is a clear next step, continue autonomously instead of waiting for a new user message.
- Send a user-facing update only when there is material progress, a blocker, or completion.
- Do not ask the user to repeat a request that is already present in the current session context.
- Do not resurrect stale tasks from unrelated or older chats.
- If nothing needs attention, reply exactly HEARTBEAT_OK.
