-- Privilege seal: admin_list_mcq_bank_folders must not grant PUBLIC EXECUTE.
begin;
select plan(4);

select ok(
  not has_function_privilege(
    'public',
    'public.admin_list_mcq_bank_folders(uuid)',
    'execute'
  ),
  'PUBLIC cannot EXECUTE admin_list_mcq_bank_folders(uuid)'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_list_mcq_bank_folders(uuid)',
    'execute'
  ),
  'anon cannot EXECUTE admin_list_mcq_bank_folders(uuid)'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_list_mcq_bank_folders(uuid)',
    'execute'
  ),
  'authenticated can EXECUTE admin_list_mcq_bank_folders(uuid)'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_list_mcq_bank_folders(uuid)',
    'execute'
  ),
  'service_role can EXECUTE admin_list_mcq_bank_folders(uuid)'
);

select * from finish();
rollback;
