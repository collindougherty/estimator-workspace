import type { ProjectStatus } from './models'

export const projectStatusLabelMap: Record<ProjectStatus, string> = {
  draft: 'Bidding',
  bidding: 'Bidding',
  submitted: 'Bidding',
  won: 'Bidding',
  active: 'Active',
  completed: 'Closed',
  lost: 'Closed',
  archived: 'Closed',
}

export const visibleProjectStatusOptions: ProjectStatus[] = ['bidding', 'active', 'completed']

export const normalizeProjectStatus = (status?: ProjectStatus | null): ProjectStatus => {
  if (status === 'active') {
    return 'active'
  }

  if (status === 'completed' || status === 'lost' || status === 'archived') {
    return 'completed'
  }

  return 'bidding'
}
