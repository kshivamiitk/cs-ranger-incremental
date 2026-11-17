-- Learner-owned study tools. Compare-and-swap prevents lost updates across
-- concurrent tabs and service instances. Never overwrite a newer snapshot.
begin;

create table if not exists public.study_workspaces (
  user_id uuid primary key references public.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  data jsonb not null check (
    jsonb_typeof(data) = 'object'
    and octet_length(data::text) <= 3145728
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.study_workspaces enable row level security;
-- The app uses custom JWTs and a service-role client, not Supabase Auth. No
-- anon/authenticated policies: private workspace access stays in the API.
revoke all on public.study_workspaces from anon, authenticated;
grant select, insert, update, delete on public.study_workspaces to service_role;

create or replace function public.save_study_workspace(
  p_user_id uuid,
  p_expected_version integer,
  p_data jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_version integer;
begin
  if p_expected_version < 0 then
    raise exception 'Invalid workspace version';
  end if;
  if p_expected_version = 0 then
    insert into study_workspaces(user_id, version, data)
    values (p_user_id, 1, p_data)
    on conflict (user_id) do nothing
    returning version into next_version;
  else
    update study_workspaces
    set data = p_data, version = version + 1, updated_at = now()
    where user_id = p_user_id and version = p_expected_version
    returning version into next_version;
  end if;
  -- NULL signals a conflict. The caller reloads before retrying the command.
  return next_version;
end;
$$;

revoke all on function public.save_study_workspace(uuid, integer, jsonb)
from public, anon, authenticated;
grant execute on function public.save_study_workspace(uuid, integer, jsonb)
to service_role;

comment on table public.study_workspaces is
'Private study planner, focus sessions and flashcards; versioned atomic snapshots.';

commit;
