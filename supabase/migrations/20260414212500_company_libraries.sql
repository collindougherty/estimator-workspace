create table public.organization_employee_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  role text,
  hourly_rate numeric not null default 0 check (hourly_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_employee_library_name_not_blank check (name <> '')
);

create table public.organization_equipment_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  daily_rate numeric not null default 0 check (daily_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_equipment_library_name_not_blank check (name <> '')
);

create table public.organization_material_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  unit text not null,
  cost_per_unit numeric not null default 0 check (cost_per_unit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_material_library_name_not_blank check (name <> ''),
  constraint organization_material_library_unit_not_blank check (unit <> '')
);

create unique index organization_employee_library_org_name_role_idx
  on public.organization_employee_library (
    organization_id,
    lower(name),
    lower(coalesce(role, ''))
  );

create unique index organization_equipment_library_org_name_idx
  on public.organization_equipment_library (organization_id, lower(name));

create unique index organization_material_library_org_name_unit_idx
  on public.organization_material_library (organization_id, lower(name), upper(unit));

create trigger set_organization_employee_library_updated_at
  before update on public.organization_employee_library
  for each row execute procedure public.touch_updated_at();

create trigger set_organization_equipment_library_updated_at
  before update on public.organization_equipment_library
  for each row execute procedure public.touch_updated_at();

create trigger set_organization_material_library_updated_at
  before update on public.organization_material_library
  for each row execute procedure public.touch_updated_at();

alter table public.organization_employee_library enable row level security;
alter table public.organization_equipment_library enable row level security;
alter table public.organization_material_library enable row level security;

create policy organization_employee_library_select_member
  on public.organization_employee_library
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy organization_employee_library_insert_member
  on public.organization_employee_library
  for insert
  to authenticated
  with check (public.is_org_member(organization_id));

create policy organization_employee_library_update_member
  on public.organization_employee_library
  for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy organization_employee_library_delete_member
  on public.organization_employee_library
  for delete
  to authenticated
  using (public.is_org_member(organization_id));

create policy organization_equipment_library_select_member
  on public.organization_equipment_library
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy organization_equipment_library_insert_member
  on public.organization_equipment_library
  for insert
  to authenticated
  with check (public.is_org_member(organization_id));

create policy organization_equipment_library_update_member
  on public.organization_equipment_library
  for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy organization_equipment_library_delete_member
  on public.organization_equipment_library
  for delete
  to authenticated
  using (public.is_org_member(organization_id));

create policy organization_material_library_select_member
  on public.organization_material_library
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy organization_material_library_insert_member
  on public.organization_material_library
  for insert
  to authenticated
  with check (public.is_org_member(organization_id));

create policy organization_material_library_update_member
  on public.organization_material_library
  for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy organization_material_library_delete_member
  on public.organization_material_library
  for delete
  to authenticated
  using (public.is_org_member(organization_id));

grant select, insert, update, delete on public.organization_employee_library to authenticated;
grant select, insert, update, delete on public.organization_equipment_library to authenticated;
grant select, insert, update, delete on public.organization_material_library to authenticated;
