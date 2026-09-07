CREATE TABLE `room_presence` (
	`room_code` text NOT NULL,
	`player_id` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`room_code`, `player_id`),
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
