# StitchDB

## Install

```bash
npm install stitchdb
```

## Setup

```ts
import { createClient } from 'stitchdb'

const db = createClient({
  apiKey: process.env.STITCHDB_API_KEY,
})
```

## Query

```ts
// Raw SQL with parameters
const { results } = await db.query('SELECT * FROM users WHERE active = ?', [1])

// Shorthands
await db.insert('users', { name: 'Alice', email: 'alice@example.com' })
await db.update('users', { active: false }, 'id = ?', [5])
await db.remove('users', 'id = ?', [5])
const user = await db.find('users', 1)
const users = await db.select('users', 'active = ?', [1], { orderBy: 'created_at DESC', limit: 20 })

// DDL
await db.run('CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT)')

// Batch (atomic)
await db.batch([
  { sql: 'INSERT INTO users (name) VALUES (?)', params: ['Alice'] },
  { sql: 'INSERT INTO users (name) VALUES (?)', params: ['Bob'] },
])
```

Works with Node.js, Bun, Deno, Next.js, Nuxt, SvelteKit, Remix, Astro, and any runtime that supports `fetch`.
