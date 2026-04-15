alter table public.project_estimate_items
  add column labor_breakdown jsonb not null default '[]'::jsonb,
  add column material_breakdown jsonb not null default '[]'::jsonb,
  add column equipment_breakdown jsonb not null default '[]'::jsonb,
  add constraint project_estimate_items_labor_breakdown_is_array
    check (jsonb_typeof(labor_breakdown) = 'array'),
  add constraint project_estimate_items_material_breakdown_is_array
    check (jsonb_typeof(material_breakdown) = 'array'),
  add constraint project_estimate_items_equipment_breakdown_is_array
    check (jsonb_typeof(equipment_breakdown) = 'array');

alter table public.project_item_actuals
  add column actual_labor_breakdown jsonb not null default '[]'::jsonb,
  add column actual_material_breakdown jsonb not null default '[]'::jsonb,
  add column actual_equipment_breakdown jsonb not null default '[]'::jsonb,
  add constraint project_item_actuals_labor_breakdown_is_array
    check (jsonb_typeof(actual_labor_breakdown) = 'array'),
  add constraint project_item_actuals_material_breakdown_is_array
    check (jsonb_typeof(actual_material_breakdown) = 'array'),
  add constraint project_item_actuals_equipment_breakdown_is_array
    check (jsonb_typeof(actual_equipment_breakdown) = 'array');

create or replace view public.project_item_metrics
with (security_invoker = true)
as
select
  calculated.project_estimate_item_id,
  calculated.project_id,
  calculated.section_code,
  calculated.section_name,
  calculated.item_code,
  calculated.item_name,
  calculated.unit,
  calculated.sort_order,
  calculated.is_included,
  calculated.quantity,
  calculated.labor_hours,
  calculated.labor_rate,
  calculated.material_cost,
  calculated.equipment_days,
  calculated.equipment_rate,
  calculated.subcontract_cost,
  calculated.overhead_percent,
  calculated.profit_percent,
  calculated.estimated_labor_cost,
  calculated.estimated_equipment_cost,
  calculated.estimated_direct_cost,
  calculated.estimated_overhead_cost,
  calculated.estimated_profit_cost,
  calculated.estimated_total_cost,
  calculated.percent_complete,
  calculated.actual_quantity,
  calculated.actual_labor_hours,
  calculated.actual_labor_cost,
  calculated.actual_material_cost,
  calculated.actual_equipment_days,
  calculated.actual_equipment_cost,
  calculated.actual_subcontract_cost,
  calculated.actual_overhead_cost,
  calculated.actual_profit_amount,
  calculated.actual_direct_cost,
  calculated.actual_total_cost,
  calculated.planned_start_date,
  calculated.planned_finish_date,
  calculated.actual_start_date,
  calculated.actual_finish_date,
  calculated.invoice_percent_complete,
  calculated.invoice_amount,
  calculated.estimated_total_cost * (calculated.percent_complete / 100.0) as earned_value_amount,
  (calculated.estimated_total_cost * (calculated.percent_complete / 100.0)) - calculated.actual_total_cost as cost_variance,
  calculated.actual_labor_hours - calculated.labor_hours as labor_hour_variance,
  calculated.labor_breakdown,
  calculated.material_breakdown,
  calculated.equipment_breakdown,
  calculated.actual_labor_breakdown,
  calculated.actual_material_breakdown,
  calculated.actual_equipment_breakdown
from (
  select
    project_estimate_item.id as project_estimate_item_id,
    project_estimate_item.project_id,
    project_estimate_item.section_code,
    project_estimate_item.section_name,
    project_estimate_item.item_code,
    project_estimate_item.item_name,
    project_estimate_item.unit,
    project_estimate_item.sort_order,
    project_estimate_item.is_included,
    project_estimate_item.quantity,
    project_estimate_item.labor_hours,
    project_estimate_item.labor_rate,
    project_estimate_item.material_cost,
    project_estimate_item.equipment_days,
    project_estimate_item.equipment_rate,
    project_estimate_item.subcontract_cost,
    project_estimate_item.overhead_percent,
    project_estimate_item.profit_percent,
    project_item_actual.percent_complete,
    project_item_actual.actual_quantity,
    project_item_actual.actual_labor_hours,
    project_item_actual.actual_labor_cost,
    project_item_actual.actual_material_cost,
    project_item_actual.actual_equipment_days,
    project_item_actual.actual_equipment_cost,
    project_item_actual.actual_subcontract_cost,
    project_item_actual.actual_overhead_cost,
    project_item_actual.actual_profit_amount,
    project_item_actual.planned_start_date,
    project_item_actual.planned_finish_date,
    project_item_actual.actual_start_date,
    project_item_actual.actual_finish_date,
    project_item_actual.invoice_percent_complete,
    project_item_actual.invoice_amount,
    (project_estimate_item.labor_hours * project_estimate_item.labor_rate) as estimated_labor_cost,
    (project_estimate_item.equipment_days * project_estimate_item.equipment_rate) as estimated_equipment_cost,
    (
      (project_estimate_item.labor_hours * project_estimate_item.labor_rate)
      + project_estimate_item.material_cost
      + (project_estimate_item.equipment_days * project_estimate_item.equipment_rate)
      + project_estimate_item.subcontract_cost
    ) as estimated_direct_cost,
    (
      (
        (project_estimate_item.labor_hours * project_estimate_item.labor_rate)
        + project_estimate_item.material_cost
        + (project_estimate_item.equipment_days * project_estimate_item.equipment_rate)
        + project_estimate_item.subcontract_cost
      ) * (project_estimate_item.overhead_percent / 100.0)
    ) as estimated_overhead_cost,
    (
      (
        (project_estimate_item.labor_hours * project_estimate_item.labor_rate)
        + project_estimate_item.material_cost
        + (project_estimate_item.equipment_days * project_estimate_item.equipment_rate)
        + project_estimate_item.subcontract_cost
      ) * (project_estimate_item.profit_percent / 100.0)
    ) as estimated_profit_cost,
    (
      (
        (project_estimate_item.labor_hours * project_estimate_item.labor_rate)
        + project_estimate_item.material_cost
        + (project_estimate_item.equipment_days * project_estimate_item.equipment_rate)
        + project_estimate_item.subcontract_cost
      )
      + (
        (
          (project_estimate_item.labor_hours * project_estimate_item.labor_rate)
          + project_estimate_item.material_cost
          + (project_estimate_item.equipment_days * project_estimate_item.equipment_rate)
          + project_estimate_item.subcontract_cost
        ) * (project_estimate_item.overhead_percent / 100.0)
      )
      + (
        (
          (project_estimate_item.labor_hours * project_estimate_item.labor_rate)
          + project_estimate_item.material_cost
          + (project_estimate_item.equipment_days * project_estimate_item.equipment_rate)
          + project_estimate_item.subcontract_cost
        ) * (project_estimate_item.profit_percent / 100.0)
      )
    ) as estimated_total_cost,
    (
      project_item_actual.actual_labor_cost
      + project_item_actual.actual_material_cost
      + project_item_actual.actual_equipment_cost
      + project_item_actual.actual_subcontract_cost
    ) as actual_direct_cost,
    (
      project_item_actual.actual_labor_cost
      + project_item_actual.actual_material_cost
      + project_item_actual.actual_equipment_cost
      + project_item_actual.actual_subcontract_cost
      + project_item_actual.actual_overhead_cost
      + project_item_actual.actual_profit_amount
    ) as actual_total_cost,
    project_estimate_item.labor_breakdown,
    project_estimate_item.material_breakdown,
    project_estimate_item.equipment_breakdown,
    project_item_actual.actual_labor_breakdown,
    project_item_actual.actual_material_breakdown,
    project_item_actual.actual_equipment_breakdown
  from public.project_estimate_items project_estimate_item
  left join public.project_item_actuals project_item_actual
    on project_item_actual.project_estimate_item_id = project_estimate_item.id
) as calculated;
