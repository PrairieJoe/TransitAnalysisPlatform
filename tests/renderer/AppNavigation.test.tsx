import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ProjectCard from '../../src/renderer/ProjectCard';
import type { ProjectManifest } from '../../src/shared/types';

const project = { id: 'project-1', name: '테스트 프로젝트', records: [], sourceFiles: ['sample.csv'] } as unknown as ProjectManifest;

describe('project navigation', () => {
  it('does not expose Synthetic GTFS from the project list card', () => {
    const markup = renderToStaticMarkup(
      <ProjectCard project={project} onOpen={() => {}} onDelete={() => {}} />
    );

    expect(markup).toContain('테스트 프로젝트');
    expect(markup).not.toContain('Synthetic GTFS');
  });
});
