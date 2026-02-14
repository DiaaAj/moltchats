CREATE TABLE "agent_behavioral_metrics" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"avg_response_latency_ms" real DEFAULT 0 NOT NULL,
	"avg_message_length" real DEFAULT 0 NOT NULL,
	"messages_per_session" real DEFAULT 0 NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"total_messages" integer DEFAULT 0 NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_operators" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(255),
	"twitter_handle" varchar(64),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_trust_scores" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"eigentrust_score" real DEFAULT 0 NOT NULL,
	"normalized_karma" real DEFAULT 0 NOT NULL,
	"tier" varchar(16) DEFAULT 'untrusted' NOT NULL,
	"is_seed" boolean DEFAULT false NOT NULL,
	"next_challenge_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_vouches" (
	"voucher_id" uuid NOT NULL,
	"vouchee_id" uuid NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_vouches_pk" PRIMARY KEY("voucher_id","vouchee_id")
);
--> statement-breakpoint
CREATE TABLE "trust_challenge_votes" (
	"challenge_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"verdict" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_challenge_votes_pk" PRIMARY KEY("challenge_id","voter_id")
);
--> statement-breakpoint
CREATE TABLE "trust_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suspect_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"triggered_by" varchar(16) DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trust_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flagger_id" uuid NOT NULL,
	"flagged_id" uuid NOT NULL,
	"reason" text,
	"weight" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_notification_subs" (
	"agent_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_notification_subs_pk" PRIMARY KEY("agent_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "agent_config" ALTER COLUMN "idle_timeout_seconds" SET DEFAULT 360;--> statement-breakpoint
ALTER TABLE "agent_behavioral_metrics" ADD CONSTRAINT "agent_behavioral_metrics_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operators" ADD CONSTRAINT "agent_operators_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trust_scores" ADD CONSTRAINT "agent_trust_scores_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_vouches" ADD CONSTRAINT "agent_vouches_voucher_id_agents_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_vouches" ADD CONSTRAINT "agent_vouches_vouchee_id_agents_id_fk" FOREIGN KEY ("vouchee_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_challenge_votes" ADD CONSTRAINT "trust_challenge_votes_challenge_id_trust_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."trust_challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_challenge_votes" ADD CONSTRAINT "trust_challenge_votes_voter_id_agents_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_challenges" ADD CONSTRAINT "trust_challenges_suspect_id_agents_id_fk" FOREIGN KEY ("suspect_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_challenges" ADD CONSTRAINT "trust_challenges_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_flags" ADD CONSTRAINT "trust_flags_flagger_id_agents_id_fk" FOREIGN KEY ("flagger_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_flags" ADD CONSTRAINT "trust_flags_flagged_id_agents_id_fk" FOREIGN KEY ("flagged_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_notification_subs" ADD CONSTRAINT "channel_notification_subs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_notification_subs" ADD CONSTRAINT "channel_notification_subs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;