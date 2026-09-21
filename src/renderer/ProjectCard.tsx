import type { JSX } from 'react';
import type { ProjectManifest, ProjectSummary } from '../shared/types';

export type ProjectListItem = ProjectManifest | ProjectSummary;

const DEFAULT_PROJECT_TITLE = '교통카드 요일별 분석';

function projectTitle(project: Pick<ProjectManifest, 'name'>): string {
  return project.name.trim().toLowerCase() === 'reference' ? DEFAULT_PROJECT_TITLE : project.name;
}

function projectRecordCount(project: ProjectListItem): number {
  return 'recordCount' in project ? project.recordCount : project.records.length;
}

export interface ProjectCardProps {
  project: ProjectListItem;
  onOpen: () => void;
  onDelete: () => void;
}

export default function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps): JSX.Element {
  return <article className="project-card">
    <button className="project-open" onClick={onOpen}><span className="project-icon">▦</span><span><strong>{projectTitle(project)}</strong><small>{project.sourceFiles.join(', ')} · {projectRecordCount(project).toLocaleString('ko-KR')}개 분석 행</small></span></button>
    <div className="project-card-actions"><button className="icon-button danger" onClick={onDelete} aria-label="프로젝트 삭제">×</button></div>
  </article>;
}
