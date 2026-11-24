import { spawnSync } from 'node:child_process'
// Read-only local operator metrics. Never print URLs, keys, names, phones or
// request/audit payloads. Hosted operators run the equivalent checks privately.
const query=`select jsonb_build_object(
 'database_bytes',pg_database_size(current_database())::text,
 'storage_bytes',(select coalesce(sum((metadata->>'size')::bigint),0)::text from storage.objects where metadata->>'size' ~ '^[0-9]+$'),
 'storage_objects',(select count(*) from storage.objects),
 'public_tables_without_rls',(select count(*) from pg_tables where schemaname='public' and not rowsecurity),
 'active_scheduler_jobs',(select count(*) from cron.job where active),
 'worker_age_seconds',(select extract(epoch from clock_timestamp()-last_completed_at)::integer from app_private.waitlist_job_health where singleton),
 'worker_failures',(select failures from app_private.waitlist_job_health where singleton),
 'recent_cron_failures',(select count(*) from cron.job_run_details where status='failed' and start_time>clock_timestamp()-interval '10 minutes'),
 'pending_receipts',(select count(*) from public.payments where status='submitted'),
 'pending_refunds',(select count(*) from public.payments where status='approved' and refund_status='pending')
);`
const r=spawnSync('docker',['exec','-i','supabase_db_bjbc','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:10000})
if(r.status!==0){console.error('Local health check unavailable; start Docker/Supabase. Provider output suppressed.');process.exit(1)}
const data=JSON.parse(r.stdout.trim());console.log(JSON.stringify(data,null,2))
if(data.public_tables_without_rls||data.active_scheduler_jobs!==1||data.worker_age_seconds===null||data.worker_age_seconds>180||data.worker_failures||data.recent_cron_failures)process.exit(1)
