-- منظومة إدارة الوقت والمهام: مخطط مبدئي أكثر أمانًا لـ Supabase.
-- شغّل هذا الملف مرة واحدة في Supabase Dashboard > SQL Editor على مشروع جديد.
-- بيانات الدخول محفوظة في Supabase Auth؛ لا نخزّن كلمات المرور في جدول مخصص.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null default 'USER' check (role in ('ADMIN','USER')),
  preferred_language text not null default 'ar_FA' check (preferred_language in ('ar_FA','ar_EG','en_US')),
  font_size_level integer not null default 3 check (font_size_level between 1 and 6),
  theme_mode text not null default 'DARK' check (theme_mode in ('DARK','LIGHT','SYSTEM')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, role)
  values (
    new.id,
    left(coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'user'), 40) || '_' || substr(new.id::text, 1, 8),
    'USER'
  ) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users for each row execute procedure public.handle_new_auth_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.weeks (
  week_id uuid primary key default gen_random_uuid(),
  start_date date not null unique,
  end_date date not null unique,
  is_active boolean not null default true,
  friday_leisure_message text not null default 'خصص وقتًا للراحة والأسرة والعبادات.',
  created_at timestamptz not null default now(),
  constraint valid_week_dates check (end_date = start_date + 6)
);

create table if not exists public.periods (
  period_id integer primary key check (period_id in (1,2,3)),
  name_key text not null,
  start_time_default time not null,
  end_time_default time not null
);
insert into public.periods(period_id,name_key,start_time_default,end_time_default) values
  (1,'period_morning','05:00','12:00'),
  (2,'period_midday','12:00','18:00'),
  (3,'period_evening','18:00','23:59')
on conflict (period_id) do nothing;

-- السبت هو اليوم 0 والجمعة اليوم 6 في واجهة المشروع.
do $$
declare s date;
begin
  s := current_date - ((extract(dow from current_date)::integer + 1) % 7);
  insert into public.weeks(start_date,end_date,is_active)
  values(s, s + 6, true)
  on conflict (start_date) do nothing;
end $$;

create table if not exists public.tasks (
  task_id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.weeks(week_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  period_id integer not null references public.periods(period_id),
  title varchar(255) not null,
  admin_instructions text,
  start_time time not null,
  end_time time not null,
  is_time_editable boolean not null default false,
  display_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_week_day_user_idx on public.tasks(week_id,day_of_week,user_id);

-- فرض الحد الأعلى 100 مهمة في اليوم من قاعدة البيانات أيضًا (وليس من الواجهة وحدها).
create or replace function public.enforce_max_100_tasks_per_day()
returns trigger language plpgsql security definer set search_path = public
as $$
declare existing_count integer;
        lock_key text;
begin
  lock_key := new.user_id::text || ':' || new.week_id::text || ':' || new.day_of_week::text;
  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  select count(*) into existing_count
  from public.tasks t
  where t.user_id = new.user_id
    and t.week_id = new.week_id
    and t.day_of_week = new.day_of_week
    and t.task_id is distinct from new.task_id;
  if existing_count >= 100 then
    raise exception 'MAX_100_TASKS_PER_DAY' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_enforce_max_100 on public.tasks;
create trigger tasks_enforce_max_100
before insert or update of week_id,user_id,day_of_week on public.tasks
for each row execute procedure public.enforce_max_100_tasks_per_day();

-- فصل التقدم التشغيلي عن الملاحظات الخاصة كي لا يطّلع المسؤول على الملاحظات عبر API.
create table if not exists public.task_progress (
  task_id uuid primary key references public.tasks(task_id) on delete cascade,
  status text not null default 'COMPLETED' check (status in ('COMPLETED','PARTIAL','LAZY')),
  updated_at timestamptz not null default now()
);

create table if not exists public.private_task_notes (
  task_id uuid primary key references public.tasks(task_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  note_text text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.audio_notes (
  note_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_id uuid not null references public.weeks(week_id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  file_path text not null,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  mime_type varchar(100) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.weekly_reviews (
  review_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_id uuid not null references public.weeks(week_id) on delete cascade,
  accomplished_tasks_summary text,
  accomplishment_reasons text,
  unaccomplished_tasks_summary text,
  unaccomplishment_reasons text,
  improvement_points text,
  next_week_plan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_user_week_review unique (user_id,week_id)
);

create table if not exists public.communication_tickets (
  ticket_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject varchar(255) not null,
  message_body text not null,
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','RESOLVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_messages (
  message_id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.communication_tickets(ticket_id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message_body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_attachments (
  attachment_id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.communication_tickets(ticket_id) on delete cascade,
  file_path text not null,
  file_type text not null check (file_type in ('IMAGE','VIDEO','AUDIO','DOCUMENT')),
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  created_at timestamptz not null default now()
);

-- Trigger لإجبار تحديث updated_at في الجداول المحددة.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks for each row execute procedure public.set_updated_at();
drop trigger if exists progress_set_updated_at on public.task_progress;
create trigger progress_set_updated_at before update on public.task_progress for each row execute procedure public.set_updated_at();
drop trigger if exists private_notes_set_updated_at on public.private_task_notes;
create trigger private_notes_set_updated_at before update on public.private_task_notes for each row execute procedure public.set_updated_at();
drop trigger if exists reviews_set_updated_at on public.weekly_reviews;
create trigger reviews_set_updated_at before update on public.weekly_reviews for each row execute procedure public.set_updated_at();
drop trigger if exists tickets_set_updated_at on public.communication_tickets;
create trigger tickets_set_updated_at before update on public.communication_tickets for each row execute procedure public.set_updated_at();

-- RLS لكل الجداول الحساسة.
alter table public.profiles enable row level security;
alter table public.weeks enable row level security;
alter table public.periods enable row level security;
alter table public.tasks enable row level security;
alter table public.task_progress enable row level security;
alter table public.private_task_notes enable row level security;
alter table public.audio_notes enable row level security;
alter table public.weekly_reviews enable row level security;
alter table public.communication_tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_attachments enable row level security;

-- Profiles: role غير قابل للتعديل بواسطة المستخدم من التطبيق.
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (preferred_language,font_size_level,theme_mode) on public.profiles to authenticated;

drop policy if exists weeks_select_authenticated on public.weeks;
create policy weeks_select_authenticated on public.weeks for select to authenticated using (true);
drop policy if exists weeks_admin_insert on public.weeks;
create policy weeks_admin_insert on public.weeks for insert to authenticated with check (public.is_admin());
drop policy if exists weeks_admin_update on public.weeks;
create policy weeks_admin_update on public.weeks for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists weeks_admin_delete on public.weeks;
create policy weeks_admin_delete on public.weeks for delete to authenticated using (public.is_admin());
grant select,insert,update,delete on public.weeks to authenticated;

drop policy if exists periods_read_authenticated on public.periods;
create policy periods_read_authenticated on public.periods for select to authenticated using (true);
drop policy if exists periods_admin_write on public.periods;
create policy periods_admin_write on public.periods for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select,insert,update,delete on public.periods to authenticated;

drop policy if exists tasks_select_owner_or_admin on public.tasks;
create policy tasks_select_owner_or_admin on public.tasks for select to authenticated
using (user_id = auth.uid() or public.is_admin());
drop policy if exists tasks_admin_insert on public.tasks;
create policy tasks_admin_insert on public.tasks for insert to authenticated with check (public.is_admin());
drop policy if exists tasks_admin_update on public.tasks;
create policy tasks_admin_update on public.tasks for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists tasks_admin_delete on public.tasks;
create policy tasks_admin_delete on public.tasks for delete to authenticated using (public.is_admin());
grant select,insert,update,delete on public.tasks to authenticated;

drop policy if exists progress_select_owner_or_admin on public.task_progress;
create policy progress_select_owner_or_admin on public.task_progress for select to authenticated
using (exists (select 1 from public.tasks t where t.task_id = task_progress.task_id and t.user_id = auth.uid()) or public.is_admin());
drop policy if exists progress_insert_owner on public.task_progress;
create policy progress_insert_owner on public.task_progress for insert to authenticated
with check (exists (select 1 from public.tasks t where t.task_id = task_progress.task_id and t.user_id = auth.uid()));
drop policy if exists progress_update_owner on public.task_progress;
create policy progress_update_owner on public.task_progress for update to authenticated
using (exists (select 1 from public.tasks t where t.task_id = task_progress.task_id and t.user_id = auth.uid()))
with check (exists (select 1 from public.tasks t where t.task_id = task_progress.task_id and t.user_id = auth.uid()));
revoke insert,update,delete on public.task_progress from authenticated;
grant select on public.task_progress to authenticated;
grant insert (task_id,status) on public.task_progress to authenticated;
grant update (status) on public.task_progress to authenticated;

drop policy if exists notes_owner_all on public.private_task_notes;
create policy notes_owner_all on public.private_task_notes for all to authenticated
using (user_id = auth.uid() and exists (select 1 from public.tasks t where t.task_id = private_task_notes.task_id and t.user_id = auth.uid()))
with check (user_id = auth.uid() and exists (select 1 from public.tasks t where t.task_id = private_task_notes.task_id and t.user_id = auth.uid()));
grant select,insert,update,delete on public.private_task_notes to authenticated;

drop policy if exists audio_notes_owner_all on public.audio_notes;
create policy audio_notes_owner_all on public.audio_notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select,insert,update,delete on public.audio_notes to authenticated;

drop policy if exists weekly_reviews_owner_all on public.weekly_reviews;
create policy weekly_reviews_owner_all on public.weekly_reviews for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select,insert,update,delete on public.weekly_reviews to authenticated;

drop policy if exists tickets_select_owner_or_admin on public.communication_tickets;
create policy tickets_select_owner_or_admin on public.communication_tickets for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists tickets_insert_owner on public.communication_tickets;
create policy tickets_insert_owner on public.communication_tickets for insert to authenticated with check (user_id = auth.uid());
drop policy if exists tickets_update_admin on public.communication_tickets;
create policy tickets_update_admin on public.communication_tickets for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select,insert on public.communication_tickets to authenticated;
revoke update on public.communication_tickets from authenticated;
grant update (status) on public.communication_tickets to authenticated;

drop policy if exists ticket_messages_select_access on public.ticket_messages;
create policy ticket_messages_select_access on public.ticket_messages for select to authenticated
using (public.is_admin() or exists (select 1 from public.communication_tickets t where t.ticket_id = ticket_messages.ticket_id and t.user_id = auth.uid()));
drop policy if exists ticket_messages_insert_access on public.ticket_messages;
create policy ticket_messages_insert_access on public.ticket_messages for insert to authenticated
with check (sender_id = auth.uid() and (public.is_admin() or exists (select 1 from public.communication_tickets t where t.ticket_id = ticket_messages.ticket_id and t.user_id = auth.uid())));
grant select,insert on public.ticket_messages to authenticated;

drop policy if exists ticket_attachments_select_access on public.ticket_attachments;
create policy ticket_attachments_select_access on public.ticket_attachments for select to authenticated
using (public.is_admin() or exists (select 1 from public.communication_tickets t where t.ticket_id = ticket_attachments.ticket_id and t.user_id = auth.uid()));
drop policy if exists ticket_attachments_insert_owner on public.ticket_attachments;
create policy ticket_attachments_insert_owner on public.ticket_attachments for insert to authenticated
with check (exists (select 1 from public.communication_tickets t where t.ticket_id = ticket_attachments.ticket_id and t.user_id = auth.uid()));
grant select,insert on public.ticket_attachments to authenticated;

-- لا يستطيع العميل تغيير role أو إنشاء مستخدم إداري. أنشئ الحساب في Auth ثم رقِّه يدويًا من SQL Editor.
-- RLS وحدها لا تخفي عمودًا واحدًا من صف يحق للمسؤول قراءته؛ لذلك الملاحظات الخاصة مفصولة في جدول منفصل.

-- مساحة تخزين خاصة للتسجيلات الصوتية ومرفقات التواصل.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
 ('audio-notes','audio-notes',false,10485760,array['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav']),
 ('ticket-attachments','ticket-attachments',false,20971520,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','audio/webm','audio/mp4','audio/ogg','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Storage key format: <auth.uid()>/<ticket-id>/<unique-file-name> for tickets; <auth.uid()>/<week-id>/<day>/<file> for audio.
drop policy if exists audio_objects_owner_select on storage.objects;
create policy audio_objects_owner_select on storage.objects for select to authenticated
using (bucket_id = 'audio-notes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists audio_objects_owner_insert on storage.objects;
create policy audio_objects_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'audio-notes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists audio_objects_owner_delete on storage.objects;
create policy audio_objects_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'audio-notes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists ticket_objects_select_owner_admin on storage.objects;
create policy ticket_objects_select_owner_admin on storage.objects for select to authenticated
using (bucket_id = 'ticket-attachments' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists ticket_objects_insert_owner on storage.objects;
create policy ticket_objects_insert_owner on storage.objects for insert to authenticated
with check (bucket_id = 'ticket-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists ticket_objects_delete_owner_admin on storage.objects;
create policy ticket_objects_delete_owner_admin on storage.objects for delete to authenticated
using (bucket_id = 'ticket-attachments' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Health ping اختياري، لا يضمن منع إيقاف المشروع الخامل؛ اقرأ دليل التشغيل.
create or replace function public.healthcheck()
returns text language sql stable as $$ select 'ok'::text; $$;
grant execute on function public.healthcheck() to anon, authenticated;
