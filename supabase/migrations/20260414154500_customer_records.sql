create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  address text,
  email text,
  phone text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (btrim(name) <> '')
);

create index customers_org_name_idx
  on public.customers (organization_id, lower(name));

alter table public.projects
  add column customer_id uuid references public.customers (id) on delete set null;

create index projects_customer_id_idx
  on public.projects (customer_id);

drop function if exists public.create_project_from_preset(uuid, uuid, text, text, text, date, text);

create or replace function public.create_project_from_preset(
  p_organization_id uuid,
  p_preset_id uuid,
  p_name text,
  p_customer_name text default null,
  p_location text default null,
  p_bid_due_date date default null,
  p_notes text default null,
  p_customer_address text default null,
  p_customer_email text default null,
  p_customer_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_project_id uuid;
  new_customer_id uuid;
  normalized_customer_name text;
  normalized_customer_address text;
  normalized_customer_email text;
  normalized_customer_phone text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_org_member(p_organization_id) then
    raise exception 'You are not a member of this organization';
  end if;

  if not exists (
    select 1
    from public.contractor_presets contractor_preset
    where contractor_preset.id = p_preset_id
      and (
        contractor_preset.scope = 'system'
        or contractor_preset.organization_id = p_organization_id
      )
  ) then
    raise exception 'Preset is not visible to this organization';
  end if;

  normalized_customer_name := nullif(btrim(coalesce(p_customer_name, '')), '');
  normalized_customer_address := nullif(btrim(coalesce(p_customer_address, '')), '');
  normalized_customer_email := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
  normalized_customer_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');

  if normalized_customer_name is null
     and (
       normalized_customer_address is not null
       or normalized_customer_email is not null
       or normalized_customer_phone is not null
     ) then
    raise exception 'Customer name is required when contact details are provided';
  end if;

  if normalized_customer_name is not null then
    insert into public.customers (
      organization_id,
      name,
      address,
      email,
      phone,
      created_by
    )
    values (
      p_organization_id,
      normalized_customer_name,
      normalized_customer_address,
      normalized_customer_email,
      normalized_customer_phone,
      auth.uid()
    )
    returning id into new_customer_id;
  end if;

  insert into public.projects (
    organization_id,
    preset_id,
    customer_id,
    name,
    customer_name,
    location,
    status,
    bid_due_date,
    notes,
    created_by
  )
  values (
    p_organization_id,
    p_preset_id,
    new_customer_id,
    p_name,
    normalized_customer_name,
    p_location,
    'bidding',
    p_bid_due_date,
    p_notes,
    auth.uid()
  )
  returning id into new_project_id;

  with cloned_rows as (
    insert into public.project_estimate_items (
      project_id,
      preset_item_id,
      section_code,
      section_name,
      item_code,
      item_name,
      unit,
      sort_order,
      is_included,
      quantity,
      labor_hours,
      labor_rate,
      material_cost,
      equipment_days,
      equipment_rate,
      subcontract_cost,
      overhead_percent,
      profit_percent
    )
    select
      new_project_id,
      preset_wbs_item.id,
      preset_wbs_item.section_code,
      preset_wbs_item.section_name,
      preset_wbs_item.item_code,
      preset_wbs_item.item_name,
      preset_wbs_item.unit,
      preset_wbs_item.sort_order,
      preset_wbs_item.active_default,
      preset_wbs_item.default_quantity,
      preset_wbs_item.default_labor_hours,
      preset_wbs_item.default_labor_rate,
      preset_wbs_item.default_material_cost,
      preset_wbs_item.default_equipment_days,
      preset_wbs_item.default_equipment_rate,
      preset_wbs_item.default_subcontract_cost,
      preset_wbs_item.default_overhead_percent,
      preset_wbs_item.default_profit_percent
    from public.preset_wbs_items preset_wbs_item
    where preset_wbs_item.preset_id = p_preset_id
    returning id
  )
  insert into public.project_item_actuals (project_estimate_item_id)
  select cloned_row.id
  from cloned_rows cloned_row;

  return new_project_id;
end;
$$;

create or replace view public.project_summary
with (security_invoker = true)
as
select
  project.id as project_id,
  project.organization_id,
  project.preset_id,
  project.customer_id,
  project.name,
  coalesce(customer.name, project.customer_name) as customer_name,
  customer.address as customer_address,
  customer.email as customer_email,
  customer.phone as customer_phone,
  project.location,
  project.status,
  project.bid_due_date,
  project.notes,
  project.created_by,
  project.created_at,
  project.updated_at,
  count(project_item_metric.project_estimate_item_id) filter (where project_item_metric.is_included) as included_item_count,
  coalesce(sum(project_item_metric.estimated_direct_cost) filter (where project_item_metric.is_included), 0) as estimated_direct_cost,
  coalesce(sum(project_item_metric.estimated_overhead_cost) filter (where project_item_metric.is_included), 0) as estimated_overhead_cost,
  coalesce(sum(project_item_metric.estimated_profit_cost) filter (where project_item_metric.is_included), 0) as estimated_profit_cost,
  coalesce(sum(project_item_metric.estimated_total_cost) filter (where project_item_metric.is_included), 0) as estimated_total_cost,
  coalesce(sum(project_item_metric.actual_total_cost) filter (where project_item_metric.is_included), 0) as actual_total_cost,
  coalesce(sum(project_item_metric.earned_value_amount) filter (where project_item_metric.is_included), 0) as earned_value_amount,
  coalesce(sum(project_item_metric.invoice_amount) filter (where project_item_metric.is_included), 0) as invoice_amount,
  coalesce(sum(project_item_metric.labor_hours) filter (where project_item_metric.is_included), 0) as estimated_labor_hours,
  coalesce(sum(project_item_metric.actual_labor_hours) filter (where project_item_metric.is_included), 0) as actual_labor_hours
from public.projects project
left join public.customers customer
  on customer.id = project.customer_id
left join public.project_item_metrics project_item_metric
  on project_item_metric.project_id = project.id
group by
  project.id,
  project.organization_id,
  project.preset_id,
  project.customer_id,
  project.name,
  customer.name,
  customer.address,
  customer.email,
  customer.phone,
  project.customer_name,
  project.location,
  project.status,
  project.bid_due_date,
  project.notes,
  project.created_by,
  project.created_at,
  project.updated_at;

create trigger set_customers_updated_at
  before update on public.customers
  for each row execute procedure public.touch_updated_at();

alter table public.customers enable row level security;

create policy customers_select_member
  on public.customers
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy customers_insert_member
  on public.customers
  for insert
  to authenticated
  with check (public.is_org_member(organization_id));

create policy customers_update_member
  on public.customers
  for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy customers_delete_member
  on public.customers
  for delete
  to authenticated
  using (public.is_org_member(organization_id));

grant select, insert, update, delete on public.customers to authenticated;
grant execute on function public.create_project_from_preset(uuid, uuid, text, text, text, date, text, text, text, text) to authenticated;
