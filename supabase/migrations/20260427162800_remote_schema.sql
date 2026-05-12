drop extension if exists "pg_net";

create type "public"."activity_type" as enum ('SURF', 'MTB', 'SKATEBOARDING', 'RUNNING_ROAD', 'RUNNING_TRAIL', 'CYCLING_ROAD', 'CYCLING_GRAVEL', 'BMX', 'TRIATHLON', 'OPEN_WATER_SWIMMING', 'SKI_ALPINE', 'SNOWBOARD', 'SKI_CROSS_COUNTRY', 'CLIMBING_BOULDER', 'HIKING', 'OTHER');

drop trigger if exists "events_set_updated_at" on "public"."events";

drop trigger if exists "trg_set_profile_slug" on "public"."profiles";

drop policy "Users can view their claimed tokens" on "public"."download_tokens";

drop policy "events_owner_all" on "public"."events";

drop policy "events_public_select" on "public"."events";

drop policy "photos_owner_all" on "public"."photos";

drop policy "photos_public_select" on "public"."photos";

drop policy "photographer_profiles_public_select" on "public"."profiles";

revoke delete on table "public"."download_tokens" from "anon";

revoke insert on table "public"."download_tokens" from "anon";

revoke references on table "public"."download_tokens" from "anon";

revoke select on table "public"."download_tokens" from "anon";

revoke trigger on table "public"."download_tokens" from "anon";

revoke truncate on table "public"."download_tokens" from "anon";

revoke update on table "public"."download_tokens" from "anon";

revoke delete on table "public"."download_tokens" from "authenticated";

revoke insert on table "public"."download_tokens" from "authenticated";

revoke references on table "public"."download_tokens" from "authenticated";

revoke select on table "public"."download_tokens" from "authenticated";

revoke trigger on table "public"."download_tokens" from "authenticated";

revoke truncate on table "public"."download_tokens" from "authenticated";

revoke update on table "public"."download_tokens" from "authenticated";

revoke delete on table "public"."download_tokens" from "service_role";

revoke insert on table "public"."download_tokens" from "service_role";

revoke references on table "public"."download_tokens" from "service_role";

revoke select on table "public"."download_tokens" from "service_role";

revoke trigger on table "public"."download_tokens" from "service_role";

revoke truncate on table "public"."download_tokens" from "service_role";

revoke update on table "public"."download_tokens" from "service_role";

revoke delete on table "public"."guest_order_items" from "anon";

revoke insert on table "public"."guest_order_items" from "anon";

revoke references on table "public"."guest_order_items" from "anon";

revoke select on table "public"."guest_order_items" from "anon";

revoke trigger on table "public"."guest_order_items" from "anon";

revoke truncate on table "public"."guest_order_items" from "anon";

revoke update on table "public"."guest_order_items" from "anon";

revoke delete on table "public"."guest_order_items" from "authenticated";

revoke insert on table "public"."guest_order_items" from "authenticated";

revoke references on table "public"."guest_order_items" from "authenticated";

revoke select on table "public"."guest_order_items" from "authenticated";

revoke trigger on table "public"."guest_order_items" from "authenticated";

revoke truncate on table "public"."guest_order_items" from "authenticated";

revoke update on table "public"."guest_order_items" from "authenticated";

revoke delete on table "public"."guest_order_items" from "service_role";

revoke insert on table "public"."guest_order_items" from "service_role";

revoke references on table "public"."guest_order_items" from "service_role";

revoke select on table "public"."guest_order_items" from "service_role";

revoke trigger on table "public"."guest_order_items" from "service_role";

revoke truncate on table "public"."guest_order_items" from "service_role";

revoke update on table "public"."guest_order_items" from "service_role";

revoke delete on table "public"."guest_orders" from "anon";

revoke insert on table "public"."guest_orders" from "anon";

revoke references on table "public"."guest_orders" from "anon";

revoke select on table "public"."guest_orders" from "anon";

revoke trigger on table "public"."guest_orders" from "anon";

revoke truncate on table "public"."guest_orders" from "anon";

revoke update on table "public"."guest_orders" from "anon";

revoke delete on table "public"."guest_orders" from "authenticated";

revoke insert on table "public"."guest_orders" from "authenticated";

revoke references on table "public"."guest_orders" from "authenticated";

revoke select on table "public"."guest_orders" from "authenticated";

revoke trigger on table "public"."guest_orders" from "authenticated";

revoke truncate on table "public"."guest_orders" from "authenticated";

revoke update on table "public"."guest_orders" from "authenticated";

revoke delete on table "public"."guest_orders" from "service_role";

revoke insert on table "public"."guest_orders" from "service_role";

revoke references on table "public"."guest_orders" from "service_role";

revoke select on table "public"."guest_orders" from "service_role";

revoke trigger on table "public"."guest_orders" from "service_role";

revoke truncate on table "public"."guest_orders" from "service_role";

revoke update on table "public"."guest_orders" from "service_role";

revoke delete on table "public"."pending_guest_checkouts" from "anon";

revoke insert on table "public"."pending_guest_checkouts" from "anon";

revoke references on table "public"."pending_guest_checkouts" from "anon";

revoke select on table "public"."pending_guest_checkouts" from "anon";

revoke trigger on table "public"."pending_guest_checkouts" from "anon";

revoke truncate on table "public"."pending_guest_checkouts" from "anon";

revoke update on table "public"."pending_guest_checkouts" from "anon";

revoke delete on table "public"."pending_guest_checkouts" from "authenticated";

revoke insert on table "public"."pending_guest_checkouts" from "authenticated";

revoke references on table "public"."pending_guest_checkouts" from "authenticated";

revoke select on table "public"."pending_guest_checkouts" from "authenticated";

revoke trigger on table "public"."pending_guest_checkouts" from "authenticated";

revoke truncate on table "public"."pending_guest_checkouts" from "authenticated";

revoke update on table "public"."pending_guest_checkouts" from "authenticated";

revoke delete on table "public"."pending_guest_checkouts" from "service_role";

revoke insert on table "public"."pending_guest_checkouts" from "service_role";

revoke references on table "public"."pending_guest_checkouts" from "service_role";

revoke select on table "public"."pending_guest_checkouts" from "service_role";

revoke trigger on table "public"."pending_guest_checkouts" from "service_role";

revoke truncate on table "public"."pending_guest_checkouts" from "service_role";

revoke update on table "public"."pending_guest_checkouts" from "service_role";

alter table "public"."download_tokens" drop constraint "download_tokens_claimed_by_user_id_fkey";

alter table "public"."download_tokens" drop constraint "download_tokens_guest_order_id_fkey";

alter table "public"."download_tokens" drop constraint "download_tokens_order_id_fkey";

alter table "public"."download_tokens" drop constraint "download_tokens_token_key";

alter table "public"."download_tokens" drop constraint "exactly_one_order";

alter table "public"."guest_order_items" drop constraint "guest_order_items_guest_order_id_fkey";

alter table "public"."guest_order_items" drop constraint "guest_order_items_photo_id_fkey";

alter table "public"."guest_order_items" drop constraint "guest_order_items_photographer_id_fkey";

alter table "public"."guest_order_items" drop constraint "guest_order_items_total_price_cents_check";

alter table "public"."guest_order_items" drop constraint "guest_order_items_unit_price_cents_check";

alter table "public"."guest_orders" drop constraint "guest_orders_status_check";

alter table "public"."guest_orders" drop constraint "guest_orders_stripe_checkout_session_id_key";

alter table "public"."guest_orders" drop constraint "guest_orders_stripe_payment_intent_id_key";

alter table "public"."guest_orders" drop constraint "guest_orders_total_amount_cents_check";

alter table "public"."pending_guest_checkouts" drop constraint "pending_guest_checkouts_stripe_session_id_key";

alter table "public"."subscriptions" drop constraint "subscriptions_plan_id_check";

alter table "public"."subscriptions" drop constraint "subscriptions_status_check";

alter table "public"."subscriptions" drop constraint "subscriptions_user_id_key";

alter table "public"."user_roles" drop constraint "user_roles_user_id_fkey";

drop function if exists "public"."set_events_updated_at"();

drop function if exists "public"."set_profile_slug_on_insert"();

drop function if exists "public"."sync_profile_avatar_url"();

alter table "public"."download_tokens" drop constraint "download_tokens_pkey";

alter table "public"."guest_order_items" drop constraint "guest_order_items_pkey";

alter table "public"."guest_orders" drop constraint "guest_orders_pkey";

alter table "public"."pending_guest_checkouts" drop constraint "pending_guest_checkouts_pkey";

alter table "public"."photo_embeddings" drop constraint "photo_embeddings_pkey";

drop index if exists "public"."download_tokens_claimed_by_user_id_idx";

drop index if exists "public"."download_tokens_guest_order_id_idx";

drop index if exists "public"."download_tokens_order_id_idx";

drop index if exists "public"."download_tokens_pkey";

drop index if exists "public"."download_tokens_token_idx";

drop index if exists "public"."download_tokens_token_key";

drop index if exists "public"."guest_order_items_guest_order_id_idx";

drop index if exists "public"."guest_order_items_photo_id_idx";

drop index if exists "public"."guest_order_items_photographer_id_idx";

drop index if exists "public"."guest_order_items_pkey";

drop index if exists "public"."guest_orders_guest_email_idx";

drop index if exists "public"."guest_orders_pkey";

drop index if exists "public"."guest_orders_stripe_checkout_session_id_idx";

drop index if exists "public"."guest_orders_stripe_checkout_session_id_key";

drop index if exists "public"."guest_orders_stripe_payment_intent_id_key";

drop index if exists "public"."pending_guest_checkouts_pkey";

drop index if exists "public"."pending_guest_checkouts_stripe_session_id_idx";

drop index if exists "public"."pending_guest_checkouts_stripe_session_id_key";

drop index if exists "public"."photo_embeddings_embedding_idx";

drop index if exists "public"."photos_event_id_idx";

drop index if exists "public"."photos_user_id_idx";

drop index if exists "public"."profiles_slug_idx";

drop index if exists "public"."subscriptions_user_id_key";

drop index if exists "public"."photo_embeddings_pkey";

drop table "public"."download_tokens";

drop table "public"."guest_order_items";

drop table "public"."guest_orders";

drop table "public"."pending_guest_checkouts";


  create table "public"."time_sync_tokens" (
    "id" uuid not null default gen_random_uuid(),
    "event_id" uuid not null,
    "server_time" timestamp with time zone not null,
    "expires_at" timestamp with time zone not null,
    "used" boolean not null default false,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."time_sync_tokens" enable row level security;


  create table "public"."upload_batches" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "status" text not null default 'PENDING'::text,
    "suggested_creation_date" date,
    "suggested_start_date" timestamp with time zone,
    "suggested_end_date" timestamp with time zone,
    "suggested_city" text,
    "suggested_country" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."upload_batches" enable row level security;


  create table "public"."upload_objects" (
    "id" uuid not null default gen_random_uuid(),
    "batch_id" uuid not null,
    "storage_path" text not null,
    "size_bytes" bigint not null,
    "content_type" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."upload_objects" enable row level security;

alter table "public"."ai_search_profiles" add column "selfie_url" text;

alter table "public"."ai_search_profiles" alter column "selfie_embedding" set data type public.vector(768) using "selfie_embedding"::public.vector(768);

alter table "public"."events" add column "end_date" timestamp with time zone;

alter table "public"."events" add column "start_date" timestamp with time zone;

alter table "public"."events" add column "time_offset" bigint;

alter table "public"."events" add column "time_sync_enabled" boolean not null default false;

alter table "public"."events" alter column "activity" set default 'OTHER'::public.activity_type;

alter table "public"."events" alter column "activity" set data type public.activity_type using "activity"::public.activity_type;

alter table "public"."events" alter column "city" drop not null;

alter table "public"."events" alter column "country" drop not null;

alter table "public"."events" alter column "created_at" set default now();

alter table "public"."events" alter column "updated_at" set default now();

alter table "public"."payment_accounts" drop column "country_code";

alter table "public"."photo_embeddings" drop column "id";

alter table "public"."photo_embeddings" alter column "embedding" set data type public.vector(768) using "embedding"::public.vector(768);

alter table "public"."photos" add column "color_signature" double precision[];

alter table "public"."photos" add column "corrected_taken_at" timestamp with time zone;

alter table "public"."photos" add column "exif_raw" jsonb;

alter table "public"."photos" add column "gps_lat" double precision;

alter table "public"."photos" add column "gps_lon" double precision;

alter table "public"."photos" add column "photo_hash" text;

alter table "public"."photos" add column "thumbnail_url" text;

alter table "public"."photos" add column "updated_at" timestamp with time zone not null default now();

alter table "public"."photos" add column "upload_object_id" uuid;

alter table "public"."photos" alter column "created_at" set default now();

alter table "public"."photos" alter column "original_url" set not null;

alter table "public"."profiles" drop column "avatar_url";

alter table "public"."profiles" drop column "slug";

alter table "public"."profiles" add column "default_city" text;

alter table "public"."profiles" add column "default_country" text;

alter table "public"."profiles" add column "default_province" text;

alter table "public"."profiles" add column "stripe_customer_id" text;

alter table "public"."profiles" alter column "created_at" set default now();

alter table "public"."profiles" alter column "updated_at" set default now();

alter table "public"."subscriptions" alter column "created_at" set default now();

alter table "public"."subscriptions" alter column "created_at" drop not null;

alter table "public"."subscriptions" alter column "updated_at" set default now();

alter table "public"."subscriptions" alter column "updated_at" drop not null;

alter table "public"."subscriptions" enable row level security;

CREATE INDEX events_user_date_idx ON public.events USING btree (user_id, date);

CREATE INDEX idx_photos_corrected_taken_at ON public.photos USING btree (corrected_taken_at);

CREATE INDEX idx_time_sync_tokens_event_id ON public.time_sync_tokens USING btree (event_id);

CREATE INDEX photos_event_idx ON public.photos USING btree (event_id);

CREATE INDEX photos_photo_hash_idx ON public.photos USING btree (photo_hash);

CREATE INDEX photos_taken_idx ON public.photos USING btree (taken_at);

CREATE UNIQUE INDEX photos_upload_object_id_key ON public.photos USING btree (upload_object_id);

CREATE UNIQUE INDEX time_sync_tokens_pkey ON public.time_sync_tokens USING btree (id);

CREATE UNIQUE INDEX upload_batches_pkey ON public.upload_batches USING btree (id);

CREATE INDEX upload_objects_batch_idx ON public.upload_objects USING btree (batch_id);

CREATE UNIQUE INDEX upload_objects_pkey ON public.upload_objects USING btree (id);

CREATE UNIQUE INDEX upload_objects_storage_path_key ON public.upload_objects USING btree (storage_path);

CREATE UNIQUE INDEX user_roles_user_id_key ON public.user_roles USING btree (user_id);

CREATE UNIQUE INDEX photo_embeddings_pkey ON public.photo_embeddings USING btree (photo_id);

alter table "public"."time_sync_tokens" add constraint "time_sync_tokens_pkey" PRIMARY KEY using index "time_sync_tokens_pkey";

alter table "public"."upload_batches" add constraint "upload_batches_pkey" PRIMARY KEY using index "upload_batches_pkey";

alter table "public"."upload_objects" add constraint "upload_objects_pkey" PRIMARY KEY using index "upload_objects_pkey";

alter table "public"."photo_embeddings" add constraint "photo_embeddings_pkey" PRIMARY KEY using index "photo_embeddings_pkey";

alter table "public"."events" add constraint "events_city_not_empty" CHECK ((city <> ''::text)) not valid;

alter table "public"."events" validate constraint "events_city_not_empty";

alter table "public"."photos" add constraint "photos_upload_object_id_key" UNIQUE using index "photos_upload_object_id_key";

alter table "public"."time_sync_tokens" add constraint "time_sync_tokens_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."time_sync_tokens" validate constraint "time_sync_tokens_event_id_fkey";

alter table "public"."upload_batches" add constraint "upload_batches_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."upload_batches" validate constraint "upload_batches_user_id_fkey";

alter table "public"."upload_objects" add constraint "upload_objects_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES public.upload_batches(id) ON DELETE CASCADE not valid;

alter table "public"."upload_objects" validate constraint "upload_objects_batch_id_fkey";

alter table "public"."upload_objects" add constraint "upload_objects_storage_path_key" UNIQUE using index "upload_objects_storage_path_key";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.search_photos_by_similarity(p_embedding public.vector, p_match_threshold double precision, p_match_count integer, p_activity_type text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS TABLE(photo_id uuid, similarity double precision, original_url text, event_id uuid, event_name text, event_date date, event_city text, event_country text, photographer_id uuid, photographer_username text, photographer_display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  return query
  select
    p.id as photo_id,
    1 - (pe.embedding <=> p_embedding) as similarity,
    p.original_url,
    p.event_id,
    e.name as event_name,
    e.date as event_date,
    e.city as event_city,
    e.country as event_country,
    p.user_id as photographer_id,
    prof.username as photographer_username,
    prof.display_name as photographer_display_name
  from public.photo_embeddings pe
  join public.photos p on p.id = pe.photo_id
  join public.events e on e.id = p.event_id
  left join public.profiles prof on prof.id = p.user_id
  where 1 - (pe.embedding <=> p_embedding) > p_match_threshold
    and (p_activity_type is null or e.activity = p_activity_type)
    and (p_country is null or e.country = p_country)
    and (p_region is null or e.state = p_region)
    and (p_date_from is null or e.date >= p_date_from)
    and (p_date_to is null or e.date <= p_date_to)
  order by pe.embedding <=> p_embedding
  limit p_match_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.search_photos_by_similarity(p_embedding public.vector, p_match_threshold double precision DEFAULT 0.5, p_match_count integer DEFAULT 50, p_activity_type text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(photo_id uuid, similarity double precision, original_url text, event_id uuid, event_name text, event_date date, event_city text, event_country text, photographer_id uuid, photographer_username text, photographer_display_name text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS photo_id,
    1 - (pe.embedding <=> p_embedding) AS similarity,
    p.original_url,
    e.id AS event_id,
    e.name AS event_name,
    e.date AS event_date,
    e.city AS event_city,
    e.country AS event_country,
    p.user_id AS photographer_id,
    u.username AS photographer_username,
    u.display_name AS photographer_display_name
  FROM public.photo_embeddings pe
  INNER JOIN public.photos p ON pe.photo_id = p.id
  INNER JOIN public.events e ON p.event_id = e.id
  LEFT JOIN public.user_profiles u ON p.user_id = u.user_id
  WHERE
    -- Similarity threshold
    1 - (pe.embedding <=> p_embedding) >= p_match_threshold
    -- Activity type filter
    AND (p_activity_type IS NULL OR e.activity_type = p_activity_type)
    -- Country filter
    AND (p_country IS NULL OR e.country = p_country)
    -- Region filter
    AND (p_region IS NULL OR e.region = p_region)
    -- Date range filter
    AND (p_date_from IS NULL OR e.date >= p_date_from::date)
    AND (p_date_to IS NULL OR e.date <= p_date_to::date)
  ORDER BY pe.embedding <=> p_embedding
  LIMIT p_match_count;
END;
$function$
;

grant delete on table "public"."time_sync_tokens" to "anon";

grant insert on table "public"."time_sync_tokens" to "anon";

grant references on table "public"."time_sync_tokens" to "anon";

grant select on table "public"."time_sync_tokens" to "anon";

grant trigger on table "public"."time_sync_tokens" to "anon";

grant truncate on table "public"."time_sync_tokens" to "anon";

grant update on table "public"."time_sync_tokens" to "anon";

grant delete on table "public"."time_sync_tokens" to "authenticated";

grant insert on table "public"."time_sync_tokens" to "authenticated";

grant references on table "public"."time_sync_tokens" to "authenticated";

grant select on table "public"."time_sync_tokens" to "authenticated";

grant trigger on table "public"."time_sync_tokens" to "authenticated";

grant truncate on table "public"."time_sync_tokens" to "authenticated";

grant update on table "public"."time_sync_tokens" to "authenticated";

grant delete on table "public"."time_sync_tokens" to "service_role";

grant insert on table "public"."time_sync_tokens" to "service_role";

grant references on table "public"."time_sync_tokens" to "service_role";

grant select on table "public"."time_sync_tokens" to "service_role";

grant trigger on table "public"."time_sync_tokens" to "service_role";

grant truncate on table "public"."time_sync_tokens" to "service_role";

grant update on table "public"."time_sync_tokens" to "service_role";

grant delete on table "public"."upload_batches" to "anon";

grant insert on table "public"."upload_batches" to "anon";

grant references on table "public"."upload_batches" to "anon";

grant select on table "public"."upload_batches" to "anon";

grant trigger on table "public"."upload_batches" to "anon";

grant truncate on table "public"."upload_batches" to "anon";

grant update on table "public"."upload_batches" to "anon";

grant delete on table "public"."upload_batches" to "authenticated";

grant insert on table "public"."upload_batches" to "authenticated";

grant references on table "public"."upload_batches" to "authenticated";

grant select on table "public"."upload_batches" to "authenticated";

grant trigger on table "public"."upload_batches" to "authenticated";

grant truncate on table "public"."upload_batches" to "authenticated";

grant update on table "public"."upload_batches" to "authenticated";

grant delete on table "public"."upload_batches" to "service_role";

grant insert on table "public"."upload_batches" to "service_role";

grant references on table "public"."upload_batches" to "service_role";

grant select on table "public"."upload_batches" to "service_role";

grant trigger on table "public"."upload_batches" to "service_role";

grant truncate on table "public"."upload_batches" to "service_role";

grant update on table "public"."upload_batches" to "service_role";

grant delete on table "public"."upload_objects" to "anon";

grant insert on table "public"."upload_objects" to "anon";

grant references on table "public"."upload_objects" to "anon";

grant select on table "public"."upload_objects" to "anon";

grant trigger on table "public"."upload_objects" to "anon";

grant truncate on table "public"."upload_objects" to "anon";

grant update on table "public"."upload_objects" to "anon";

grant delete on table "public"."upload_objects" to "authenticated";

grant insert on table "public"."upload_objects" to "authenticated";

grant references on table "public"."upload_objects" to "authenticated";

grant select on table "public"."upload_objects" to "authenticated";

grant trigger on table "public"."upload_objects" to "authenticated";

grant truncate on table "public"."upload_objects" to "authenticated";

grant update on table "public"."upload_objects" to "authenticated";

grant delete on table "public"."upload_objects" to "service_role";

grant insert on table "public"."upload_objects" to "service_role";

grant references on table "public"."upload_objects" to "service_role";

grant select on table "public"."upload_objects" to "service_role";

grant trigger on table "public"."upload_objects" to "service_role";

grant truncate on table "public"."upload_objects" to "service_role";

grant update on table "public"."upload_objects" to "service_role";


  create policy "own_rows_mutate"
  on "public"."events"
  as permissive
  for all
  to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));



  create policy "own_rows_select"
  on "public"."events"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "own_embeddings"
  on "public"."photo_embeddings"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.photos p
  WHERE ((p.id = photo_embeddings.photo_id) AND (p.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.photos p
  WHERE ((p.id = photo_embeddings.photo_id) AND (p.user_id = auth.uid())))));



  create policy "own_photos_mutate"
  on "public"."photos"
  as permissive
  for all
  to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));



  create policy "own_photos_select"
  on "public"."photos"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "profile_self_select"
  on "public"."profiles"
  as permissive
  for select
  to public
using ((id = auth.uid()));



  create policy "profile_self_update"
  on "public"."profiles"
  as permissive
  for update
  to public
using ((id = auth.uid()));



  create policy "Photographer can manage own time sync tokens"
  on "public"."time_sync_tokens"
  as permissive
  for all
  to public
using ((event_id IN ( SELECT events.id
   FROM public.events
  WHERE (events.user_id = auth.uid()))));



  create policy "own_batches_mutate"
  on "public"."upload_batches"
  as permissive
  for all
  to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));



  create policy "own_batches_select"
  on "public"."upload_batches"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "own_objects_mutate"
  on "public"."upload_objects"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.upload_batches b
  WHERE ((b.id = upload_objects.batch_id) AND (b.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.upload_batches b
  WHERE ((b.id = upload_objects.batch_id) AND (b.user_id = auth.uid())))));



  create policy "own_objects_select"
  on "public"."upload_objects"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.upload_batches b
  WHERE ((b.id = upload_objects.batch_id) AND (b.user_id = auth.uid())))));



  create policy "Users can insert own role"
  on "public"."user_roles"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = user_id));



  create policy "Users can read own role"
  on "public"."user_roles"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));


drop trigger if exists "trg_sync_profile_avatar_url" on "auth"."users";


  create policy "Allow users to delete their own objects 1io9m69_0"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));



  create policy "Allow users to update their own objects 1io9m69_0"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));



  create policy "Allow users to upload only into userId/... 1io9m69_0"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text)) AND (name ~* '\.(jpg|jpeg|png|heic|heif)$'::text) AND ((metadata ->> 'mimetype'::text) = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/heic'::text, 'image/heif'::text])) AND (COALESCE(((metadata ->> 'size'::text))::bigint, (0)::bigint) <= ((20 * 1024) * 1024))));



  create policy "allow users to list/view their own objects 1io9m69_0"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));



  create policy "photos_delete_own"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));



  create policy "photos_insert_own"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));



  create policy "photos_select_own"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));



  create policy "photos_update_own"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))))
with check (((bucket_id = 'photos'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));



