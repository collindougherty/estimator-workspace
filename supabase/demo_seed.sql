do $$
declare
  demo_email text := 'demo@estimator-workspace.app';
  demo_name text := 'Estimator Workspace Demo';
  demo_org_slug text := 'estimator-workspace-demo';
  demo_org_name text := 'Estimator Workspace Demo';
  demo_user_id uuid;
  demo_org_id uuid;
  system_preset_id uuid;
  maple_project_id uuid;
  cedar_project_id uuid;
  pine_project_id uuid;
  oak_project_id uuid;
begin
  select id
  into demo_user_id
  from auth.users
  where email = demo_email;

  if demo_user_id is null then
    raise exception 'Demo user with email % was not found in auth.users', demo_email;
  end if;

  insert into public.profiles (id, email, full_name)
  values (demo_user_id, demo_email, demo_name)
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      updated_at = now();

  select id
  into demo_org_id
  from public.organizations
  where lower(slug) = lower(demo_org_slug);

  if demo_org_id is null then
    insert into public.organizations (name, slug, created_by)
    values (demo_org_name, demo_org_slug, demo_user_id)
    returning id into demo_org_id;
  else
    update public.organizations
    set name = demo_org_name,
        created_by = coalesce(created_by, demo_user_id),
        updated_at = now()
    where id = demo_org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (demo_org_id, demo_user_id, 'owner')
  on conflict (organization_id, user_id) do update
  set role = excluded.role;

  delete from public.organization_employee_library
  where organization_id = demo_org_id;

  delete from public.organization_equipment_library
  where organization_id = demo_org_id;

  delete from public.organization_material_library
  where organization_id = demo_org_id;

  insert into public.organization_employee_library (
    organization_id,
    name,
    role,
    hourly_rate
  )
  values
    (demo_org_id, 'Roof crew blend', 'Production blend', 34),
    (demo_org_id, 'Roofing foreman', 'Install crew lead', 38),
    (demo_org_id, 'Roofing technician', 'Shingle crew', 31),
    (demo_org_id, 'Roof laborer', 'Tear-off crew', 26),
    (demo_org_id, 'Gutter installer', 'Exterior crew', 29),
    (demo_org_id, 'Estimator / project manager', 'Sales + PM', 42);

  insert into public.organization_equipment_library (
    organization_id,
    name,
    daily_rate
  )
  values
    (demo_org_id, 'Dump trailer', 165),
    (demo_org_id, 'Boom lift', 325),
    (demo_org_id, 'Telehandler', 360),
    (demo_org_id, 'Magnetic sweeper', 55),
    (demo_org_id, 'Shingle conveyor', 180),
    (demo_org_id, 'Material lift', 95);

  insert into public.organization_material_library (
    organization_id,
    name,
    unit,
    cost_per_unit
  )
  values
    (demo_org_id, 'Architectural shingles', 'SF', 1.95),
    (demo_org_id, 'Ice and water shield', 'SF', 1.12),
    (demo_org_id, 'Synthetic underlayment', 'SF', 0.34),
    (demo_org_id, 'Starter strip', 'LF', 1.35),
    (demo_org_id, 'Ridge cap', 'LF', 2.85),
    (demo_org_id, 'Ridge vent', 'LF', 4.75),
    (demo_org_id, 'Drip edge', 'LF', 3.65),
    (demo_org_id, 'Pipe flashing', 'EA', 24),
    (demo_org_id, 'Step flashing', 'EA', 3.9),
    (demo_org_id, 'Roofing nails', 'LB', 2.2);

  select id
  into system_preset_id
  from public.contractor_presets
  where key = 'roofing_gutters_siding'
  limit 1;

  if system_preset_id is null then
    raise exception 'System preset roofing_gutters_siding was not found';
  end if;

  delete from public.projects
  where organization_id = demo_org_id;

  insert into public.projects (
    organization_id,
    preset_id,
    name,
    customer_name,
    location,
    status,
    bid_due_date,
    notes,
    created_by
  )
  values (
    demo_org_id,
    system_preset_id,
    'Maple Street Roof Replacement',
    'Holland Family',
    'Omaha, NE',
    'bidding',
    date '2026-04-18',
    'Fresh bid with the full roofing scope included.',
    demo_user_id
  )
  returning id into maple_project_id;

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
      maple_project_id,
      preset_item.id,
      preset_item.section_code,
      preset_item.section_name,
      preset_item.item_code,
      preset_item.item_name,
      preset_item.unit,
      preset_item.sort_order,
      preset_item.active_default,
      preset_item.default_quantity,
      preset_item.default_labor_hours,
      preset_item.default_labor_rate,
      preset_item.default_material_cost,
      preset_item.default_equipment_days,
      preset_item.default_equipment_rate,
      preset_item.default_subcontract_cost,
      preset_item.default_overhead_percent,
      preset_item.default_profit_percent
    from public.preset_wbs_items preset_item
    where preset_item.preset_id = system_preset_id
    order by preset_item.sort_order
    returning id
  )
  insert into public.project_item_actuals (project_estimate_item_id)
  select id
  from cloned_rows;

  update public.project_estimate_items estimate_item
  set quantity = data.quantity,
      labor_hours = data.labor_hours,
      labor_rate = data.labor_rate,
      material_cost = data.material_cost,
      equipment_days = data.equipment_days,
      equipment_rate = data.equipment_rate,
      subcontract_cost = data.subcontract_cost,
      overhead_percent = data.overhead_percent,
      profit_percent = data.profit_percent,
      is_included = data.is_included
  from (
    values
      ('1.1.1', 2400, 36, 42, 650, 1.0, 275, 0, 10, 10, true),
      ('1.1.2', 180, 10, 42, 760, 0.5, 275, 0, 10, 10, true),
      ('1.2.1', 360, 9, 42, 540, 0, 275, 0, 10, 10, true),
      ('1.2.2', 2040, 8, 42, 640, 0, 275, 0, 10, 10, true),
      ('1.2.3', 2040, 52, 42, 6200, 0.5, 275, 0, 10, 10, true),
      ('1.2.4', 36, 8, 42, 410, 0, 275, 0, 10, 10, true),
      ('1.2.5', 180, 10, 42, 780, 0, 275, 0, 10, 10, true),
      ('1.3.1', 140, 18, 42, 1320, 0, 275, 0, 10, 10, true),
      ('1.3.2', 85, 4, 42, 0, 0, 275, 1900, 10, 10, true)
  ) as data (
    item_code,
    quantity,
    labor_hours,
    labor_rate,
    material_cost,
    equipment_days,
    equipment_rate,
    subcontract_cost,
    overhead_percent,
    profit_percent,
    is_included
  )
  where estimate_item.project_id = maple_project_id
    and estimate_item.item_code = data.item_code;

  insert into public.projects (
    organization_id,
    preset_id,
    name,
    customer_name,
    location,
    status,
    bid_due_date,
    notes,
    created_by
  )
  values (
    demo_org_id,
    system_preset_id,
    'Cedar Lane Roof + Gutters',
    'Mercer Rentals',
    'Lincoln, NE',
    'submitted',
    date '2026-04-22',
    'Submitted bid with roofing and gutter scope. Siding is excluded.',
    demo_user_id
  )
  returning id into cedar_project_id;

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
      cedar_project_id,
      preset_item.id,
      preset_item.section_code,
      preset_item.section_name,
      preset_item.item_code,
      preset_item.item_name,
      preset_item.unit,
      preset_item.sort_order,
      preset_item.active_default,
      preset_item.default_quantity,
      preset_item.default_labor_hours,
      preset_item.default_labor_rate,
      preset_item.default_material_cost,
      preset_item.default_equipment_days,
      preset_item.default_equipment_rate,
      preset_item.default_subcontract_cost,
      preset_item.default_overhead_percent,
      preset_item.default_profit_percent
    from public.preset_wbs_items preset_item
    where preset_item.preset_id = system_preset_id
    order by preset_item.sort_order
    returning id
  )
  insert into public.project_item_actuals (project_estimate_item_id)
  select id
  from cloned_rows;

  update public.project_estimate_items estimate_item
  set quantity = data.quantity,
      labor_hours = data.labor_hours,
      labor_rate = data.labor_rate,
      material_cost = data.material_cost,
      equipment_days = data.equipment_days,
      equipment_rate = data.equipment_rate,
      subcontract_cost = data.subcontract_cost,
      overhead_percent = data.overhead_percent,
      profit_percent = data.profit_percent,
      is_included = data.is_included
  from (
    values
      ('1.1.1', 3100, 42, 44, 800, 1.0, 300, 0, 10, 10, true),
      ('1.1.2', 220, 12, 44, 900, 0.5, 300, 0, 10, 10, true),
      ('1.2.1', 420, 12, 44, 620, 0, 300, 0, 10, 10, true),
      ('1.2.2', 2680, 10, 44, 840, 0, 300, 0, 10, 10, true),
      ('1.2.3', 2760, 60, 44, 7900, 1.0, 300, 0, 10, 10, true),
      ('1.2.4', 48, 9, 44, 510, 0, 300, 0, 10, 10, true),
      ('1.2.5', 220, 11, 44, 950, 0, 300, 0, 10, 10, true),
      ('1.3.1', 220, 22, 44, 2100, 0, 300, 0, 10, 10, true),
      ('1.3.2', 0, 0, 44, 0, 0, 300, 0, 10, 10, false)
  ) as data (
    item_code,
    quantity,
    labor_hours,
    labor_rate,
    material_cost,
    equipment_days,
    equipment_rate,
    subcontract_cost,
    overhead_percent,
    profit_percent,
    is_included
  )
  where estimate_item.project_id = cedar_project_id
    and estimate_item.item_code = data.item_code;

  insert into public.projects (
    organization_id,
    preset_id,
    name,
    customer_name,
    location,
    status,
    bid_due_date,
    notes,
    created_by
  )
  values (
    demo_org_id,
    system_preset_id,
    'Pine Court Storm Repair',
    'Anderson Home',
    'Elkhorn, NE',
    'active',
    date '2026-04-14',
    'Active job with partial actuals and invoice progress populated.',
    demo_user_id
  )
  returning id into pine_project_id;

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
      pine_project_id,
      preset_item.id,
      preset_item.section_code,
      preset_item.section_name,
      preset_item.item_code,
      preset_item.item_name,
      preset_item.unit,
      preset_item.sort_order,
      preset_item.active_default,
      preset_item.default_quantity,
      preset_item.default_labor_hours,
      preset_item.default_labor_rate,
      preset_item.default_material_cost,
      preset_item.default_equipment_days,
      preset_item.default_equipment_rate,
      preset_item.default_subcontract_cost,
      preset_item.default_overhead_percent,
      preset_item.default_profit_percent
    from public.preset_wbs_items preset_item
    where preset_item.preset_id = system_preset_id
    order by preset_item.sort_order
    returning id
  )
  insert into public.project_item_actuals (project_estimate_item_id)
  select id
  from cloned_rows;

  update public.project_estimate_items estimate_item
  set quantity = data.quantity,
      labor_hours = data.labor_hours,
      labor_rate = data.labor_rate,
      material_cost = data.material_cost,
      equipment_days = data.equipment_days,
      equipment_rate = data.equipment_rate,
      subcontract_cost = data.subcontract_cost,
      overhead_percent = data.overhead_percent,
      profit_percent = data.profit_percent,
      is_included = data.is_included
  from (
    values
      ('1.1.1', 1800, 30, 42, 500, 1.0, 275, 0, 10, 10, true),
      ('1.1.2', 320, 18, 42, 1280, 0.5, 275, 0, 10, 10, true),
      ('1.2.1', 260, 8, 42, 390, 0, 275, 0, 10, 10, true),
      ('1.2.2', 1520, 6, 42, 490, 0, 275, 0, 10, 10, true),
      ('1.2.3', 1620, 42, 42, 5100, 0.5, 275, 0, 10, 10, true),
      ('1.2.4', 30, 6, 42, 330, 0, 275, 0, 10, 10, true),
      ('1.2.5', 150, 9, 42, 680, 0, 275, 0, 10, 10, true),
      ('1.3.1', 95, 12, 42, 860, 0, 275, 0, 10, 10, true),
      ('1.3.2', 160, 6, 42, 0, 0, 275, 3400, 10, 10, true)
  ) as data (
    item_code,
    quantity,
    labor_hours,
    labor_rate,
    material_cost,
    equipment_days,
    equipment_rate,
    subcontract_cost,
    overhead_percent,
    profit_percent,
    is_included
  )
  where estimate_item.project_id = pine_project_id
    and estimate_item.item_code = data.item_code;

  update public.project_item_actuals actual_item
  set percent_complete = data.percent_complete,
      actual_quantity = data.actual_quantity,
      actual_labor_hours = data.actual_labor_hours,
      actual_labor_cost = data.actual_labor_cost,
      actual_material_cost = data.actual_material_cost,
      actual_equipment_days = data.actual_equipment_days,
      actual_equipment_cost = data.actual_equipment_cost,
      actual_subcontract_cost = data.actual_subcontract_cost,
      actual_overhead_cost = data.actual_overhead_cost,
      actual_profit_amount = data.actual_profit_amount,
      invoice_percent_complete = data.invoice_percent_complete,
      invoice_amount = data.invoice_amount,
      planned_start_date = data.planned_start_date,
      planned_finish_date = data.planned_finish_date,
      actual_start_date = data.actual_start_date,
      actual_finish_date = data.actual_finish_date
  from public.project_estimate_items estimate_item,
  (
    values
      ('1.1.1', 100, 1800, 34, 1428, 540, 1.0, 300, 0, 227, 0, 100, 2495, date '2026-04-08', date '2026-04-09', date '2026-04-08', date '2026-04-09'),
      ('1.1.2', 100, 320, 19, 798, 1340, 0.5, 138, 0, 228, 0, 100, 2504, date '2026-04-09', date '2026-04-10', date '2026-04-09', date '2026-04-10'),
      ('1.2.1', 100, 260, 7, 294, 405, 0, 0, 0, 70, 0, 100, 769, date '2026-04-10', date '2026-04-10', date '2026-04-10', date '2026-04-10'),
      ('1.2.2', 65, 980, 5, 210, 340, 0, 0, 0, 55, 0, 60, 605, date '2026-04-11', date '2026-04-11', date '2026-04-11', null),
      ('1.2.3', 35, 560, 18, 756, 2100, 0.3, 90, 0, 295, 0, 35, 3241, date '2026-04-11', date '2026-04-14', date '2026-04-11', null),
      ('1.2.4', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, date '2026-04-14', date '2026-04-14', null, null),
      ('1.2.5', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, date '2026-04-14', date '2026-04-15', null, null),
      ('1.3.1', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, date '2026-04-15', date '2026-04-15', null, null),
      ('1.3.2', 15, 20, 1, 42, 0, 0, 0, 500, 54, 0, 15, 596, date '2026-04-15', date '2026-04-16', date '2026-04-15', null)
  ) as data (
    item_code,
    percent_complete,
    actual_quantity,
    actual_labor_hours,
    actual_labor_cost,
    actual_material_cost,
    actual_equipment_days,
    actual_equipment_cost,
    actual_subcontract_cost,
    actual_overhead_cost,
    actual_profit_amount,
    invoice_percent_complete,
    invoice_amount,
    planned_start_date,
    planned_finish_date,
    actual_start_date,
    actual_finish_date
  )
  where estimate_item.project_id = pine_project_id
    and estimate_item.item_code = data.item_code
    and actual_item.project_estimate_item_id = estimate_item.id;

  insert into public.projects (
    organization_id,
    preset_id,
    name,
    customer_name,
    location,
    status,
    bid_due_date,
    notes,
    created_by
  )
  values (
    demo_org_id,
    system_preset_id,
    'Oak Avenue Exterior Refresh',
    'Oak Avenue Apartments',
    'Papillion, NE',
    'completed',
    date '2026-03-25',
    'Completed project with all actuals and invoice values filled in.',
    demo_user_id
  )
  returning id into oak_project_id;

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
      oak_project_id,
      preset_item.id,
      preset_item.section_code,
      preset_item.section_name,
      preset_item.item_code,
      preset_item.item_name,
      preset_item.unit,
      preset_item.sort_order,
      preset_item.active_default,
      preset_item.default_quantity,
      preset_item.default_labor_hours,
      preset_item.default_labor_rate,
      preset_item.default_material_cost,
      preset_item.default_equipment_days,
      preset_item.default_equipment_rate,
      preset_item.default_subcontract_cost,
      preset_item.default_overhead_percent,
      preset_item.default_profit_percent
    from public.preset_wbs_items preset_item
    where preset_item.preset_id = system_preset_id
    order by preset_item.sort_order
    returning id
  )
  insert into public.project_item_actuals (project_estimate_item_id)
  select id
  from cloned_rows;

  update public.project_estimate_items estimate_item
  set quantity = data.quantity,
      labor_hours = data.labor_hours,
      labor_rate = data.labor_rate,
      material_cost = data.material_cost,
      equipment_days = data.equipment_days,
      equipment_rate = data.equipment_rate,
      subcontract_cost = data.subcontract_cost,
      overhead_percent = data.overhead_percent,
      profit_percent = data.profit_percent,
      is_included = data.is_included
  from (
    values
      ('1.1.1', 2600, 38, 43, 720, 1.0, 300, 0, 10, 10, true),
      ('1.1.2', 260, 14, 43, 1040, 0.5, 300, 0, 10, 10, true),
      ('1.2.1', 400, 11, 43, 580, 0, 300, 0, 10, 10, true),
      ('1.2.2', 2200, 9, 43, 710, 0, 300, 0, 10, 10, true),
      ('1.2.3', 2200, 54, 43, 6780, 0.5, 300, 0, 10, 10, true),
      ('1.2.4', 42, 8, 43, 450, 0, 300, 0, 10, 10, true),
      ('1.2.5', 200, 10, 43, 860, 0, 300, 0, 10, 10, true),
      ('1.3.1', 150, 16, 43, 1400, 0, 300, 0, 10, 10, true),
      ('1.3.2', 120, 5, 43, 0, 0, 300, 2500, 10, 10, true)
  ) as data (
    item_code,
    quantity,
    labor_hours,
    labor_rate,
    material_cost,
    equipment_days,
    equipment_rate,
    subcontract_cost,
    overhead_percent,
    profit_percent,
    is_included
  )
  where estimate_item.project_id = oak_project_id
    and estimate_item.item_code = data.item_code;

  update public.project_item_actuals actual_item
  set percent_complete = data.percent_complete,
      actual_quantity = data.actual_quantity,
      actual_labor_hours = data.actual_labor_hours,
      actual_labor_cost = data.actual_labor_cost,
      actual_material_cost = data.actual_material_cost,
      actual_equipment_days = data.actual_equipment_days,
      actual_equipment_cost = data.actual_equipment_cost,
      actual_subcontract_cost = data.actual_subcontract_cost,
      actual_overhead_cost = data.actual_overhead_cost,
      actual_profit_amount = data.actual_profit_amount,
      invoice_percent_complete = data.invoice_percent_complete,
      invoice_amount = data.invoice_amount,
      planned_start_date = data.planned_start_date,
      planned_finish_date = data.planned_finish_date,
      actual_start_date = data.actual_start_date,
      actual_finish_date = data.actual_finish_date
  from public.project_estimate_items estimate_item,
  (
    values
      ('1.1.1', 100, 2600, 40, 1720, 760, 1.0, 300, 0, 278, 0, 100, 3058, date '2026-03-05', date '2026-03-06', date '2026-03-05', date '2026-03-06'),
      ('1.1.2', 100, 260, 15, 645, 1110, 0.5, 150, 0, 191, 0, 100, 2096, date '2026-03-06', date '2026-03-07', date '2026-03-06', date '2026-03-07'),
      ('1.2.1', 100, 400, 10, 430, 610, 0, 0, 0, 104, 0, 100, 1144, date '2026-03-07', date '2026-03-07', date '2026-03-07', date '2026-03-07'),
      ('1.2.2', 100, 2200, 9, 387, 760, 0, 0, 0, 115, 0, 100, 1262, date '2026-03-08', date '2026-03-08', date '2026-03-08', date '2026-03-08'),
      ('1.2.3', 100, 2200, 56, 2408, 6900, 0.5, 150, 0, 946, 0, 100, 10404, date '2026-03-08', date '2026-03-11', date '2026-03-08', date '2026-03-11'),
      ('1.2.4', 100, 42, 8, 344, 460, 0, 0, 0, 80, 0, 100, 884, date '2026-03-11', date '2026-03-11', date '2026-03-11', date '2026-03-11'),
      ('1.2.5', 100, 200, 11, 473, 900, 0, 0, 0, 137, 0, 100, 1510, date '2026-03-11', date '2026-03-12', date '2026-03-11', date '2026-03-12'),
      ('1.3.1', 100, 150, 17, 731, 1460, 0, 0, 0, 219, 0, 100, 2410, date '2026-03-12', date '2026-03-12', date '2026-03-12', date '2026-03-12'),
      ('1.3.2', 100, 120, 5, 215, 0, 0, 0, 2550, 277, 0, 100, 3042, date '2026-03-13', date '2026-03-14', date '2026-03-13', date '2026-03-14')
  ) as data (
    item_code,
    percent_complete,
    actual_quantity,
    actual_labor_hours,
    actual_labor_cost,
    actual_material_cost,
    actual_equipment_days,
    actual_equipment_cost,
    actual_subcontract_cost,
    actual_overhead_cost,
    actual_profit_amount,
    invoice_percent_complete,
    invoice_amount,
    planned_start_date,
    planned_finish_date,
    actual_start_date,
    actual_finish_date
  )
  where estimate_item.project_id = oak_project_id
    and estimate_item.item_code = data.item_code
    and actual_item.project_estimate_item_id = estimate_item.id;
end
$$;
