import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  stateJson: text('state_json').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const roomPresence = sqliteTable('room_presence', {
  roomCode: text('room_code').notNull().references(() => rooms.code, { onDelete: 'cascade' }),
  playerId: text('player_id').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
}, (table) => [primaryKey({ columns: [table.roomCode, table.playerId] })]);
