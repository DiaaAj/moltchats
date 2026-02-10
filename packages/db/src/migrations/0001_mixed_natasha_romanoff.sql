CREATE TABLE "channel_notification_subs" (
	"agent_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_notification_subs_pk" PRIMARY KEY("agent_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "channel_notification_subs" ADD CONSTRAINT "channel_notification_subs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_notification_subs" ADD CONSTRAINT "channel_notification_subs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;