import type { ProjectStatus } from './models'

export type ProjectWorkflowStatus = 'bidding' | 'active' | 'completed' | 'lost'
export type ProjectStatusTone = ProjectWorkflowStatus | 'archived'

export const projectStatusLabelMap: Record<ProjectStatus, string> = {
  draft: 'Bidding',
  bidding: 'Bidding',
  submitted: 'Bidding',
  won: 'Bidding',
  active: 'Active',
  completed: 'Completed',
  lost: 'Not awarded',
  archived: 'Archived',
}

export const projectWorkflowStatusOptions: ProjectWorkflowStatus[] = [
  'bidding',
  'active',
  'completed',
  'lost',
]

export const normalizeProjectWorkflowStatus = (
  status: ProjectStatus | null | undefined,
): ProjectWorkflowStatus => {
  if (status === 'active') {
    return 'active'
  }

  if (status === 'completed') {
    return 'completed'
  }

  if (status === 'lost') {
    return 'lost'
  }

  return 'bidding'
}

export const getProjectStatusTone = (
  status: ProjectStatus | null | undefined,
): ProjectStatusTone => {
  if (status === 'archived') {
    return 'archived'
  }

  return normalizeProjectWorkflowStatus(status)
}
