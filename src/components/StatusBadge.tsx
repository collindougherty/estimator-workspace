import type { ProjectStatus } from '../lib/models'
import { getProjectStatusTone, projectStatusLabelMap } from '../lib/project-status'

export const StatusBadge = ({ status }: { status: ProjectStatus }) => (
  <span className={`status-badge status-${getProjectStatusTone(status)}`}>
    {projectStatusLabelMap[status]}
  </span>
)
