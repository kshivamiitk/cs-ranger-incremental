-- Run only against the isolated database created by test-study-db.mjs.
insert into public.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Check public access before switching to the service role.
do $$
begin
  assert not has_table_privilege('anon', 'public.study_workspaces', 'select');
  assert not has_table_privilege('authenticated', 'public.study_workspaces', 'select');
  assert not has_function_privilege('anon', 'public.save_study_workspace(uuid,integer,jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.save_study_workspace(uuid,integer,jsonb)', 'execute');
  assert (select relrowsecurity from pg_class where oid = 'public.study_workspaces'::regclass);
end;
$$;

set role service_role;
do $$
declare
  v integer;
begin
  v := public.save_study_workspace('11111111-1111-4111-8111-111111111111', 0, '{"schema_version":1,"tasks":[]}');
  assert v = 1, 'Initial save must create version 1';
  v := public.save_study_workspace('11111111-1111-4111-8111-111111111111', 0, '{"tasks":["wrong"]}');
  assert v is null, 'Duplicate initial save must not overwrite';
  assert (select data -> 'tasks' = '[]'::jsonb from public.study_workspaces where user_id = '11111111-1111-4111-8111-111111111111');
  v := public.save_study_workspace('11111111-1111-4111-8111-111111111111', 1, '{"schema_version":1,"tasks":["saved"]}');
  assert v = 2, 'A matching version must advance by one';
  v := public.save_study_workspace('11111111-1111-4111-8111-111111111111', 1, '{"tasks":["stale"]}');
  assert v is null, 'A stale version must not overwrite';
  assert (select data -> 'tasks' = '["saved"]'::jsonb from public.study_workspaces where user_id = '11111111-1111-4111-8111-111111111111');
  v := public.save_study_workspace('22222222-2222-4222-8222-222222222222', 0, '{"schema_version":1,"tasks":[]}');
  assert v = 1, 'Users must have independent versions';
  assert (select count(*) = 2 from public.study_workspaces);
  begin
    perform public.save_study_workspace('11111111-1111-4111-8111-111111111111', 2, '[]');
    raise exception 'An array document was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.save_study_workspace('11111111-1111-4111-8111-111111111111', 2, jsonb_build_object('notes', repeat('x', 3145729)));
    raise exception 'An oversized document was accepted';
  exception when check_violation then null;
  end;
end;
$$;
reset role;
delete from public.users where id = '11111111-1111-4111-8111-111111111111';
do $$
begin
  assert (select count(*) = 1 from public.study_workspaces), 'User deletion must remove their private workspace';
end;
$$;
