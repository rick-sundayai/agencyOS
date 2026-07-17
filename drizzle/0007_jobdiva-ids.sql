CREATE TABLE "migration_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"watermark" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_checkpoints_org_id_source_unique" UNIQUE("org_id","source")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "jobdiva_id" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "jobdiva_id" text;--> statement-breakpoint
ALTER TABLE "job_orders" ADD COLUMN "jobdiva_id" text;--> statement-breakpoint
ALTER TABLE "migration_checkpoints" ADD CONSTRAINT "migration_checkpoints_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;