#!/usr/bin/env node
/**
 * Posts CI Healer results to Linear as comments on a daily sweep issue.
 * Used by the reactive ci-healer GitHub Actions workflow after greencheck runs.
 */

const LINEAR_API = 'https://api.linear.app/graphql';

const requiredEnv = ['LINEAR_API_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(0);
  }
}

const teamName = process.env.LINEAR_TEAM || 'opsAI';
const projectName = process.env.LINEAR_PROJECT || 'Toggly';
const epicIdentifier = process.env.LINEAR_CI_HEALER_EPIC || process.env.LINEAR_EPIC || 'OPS-274';

const workflowRunUrl = process.env.WORKFLOW_RUN_URL || '';
const workflowRunId = process.env.WORKFLOW_RUN_ID || '';
const workflowName = process.env.WORKFLOW_RUN_NAME || 'unknown workflow';
const headBranch = process.env.HEAD_BRANCH || 'unknown branch';
const greencheckFixed = process.env.GREENCHECK_FIXED || 'false';
const greencheckPasses = process.env.GREENCHECK_PASSES || '0';
const greencheckCommits = process.env.GREENCHECK_COMMITS || '';
const greencheckCost = process.env.GREENCHECK_COST || '';
const greencheckFailuresFound = process.env.GREENCHECK_FAILURES_FOUND || '0';
const greencheckFailuresFixed = process.env.GREENCHECK_FAILURES_FIXED || '0';
const dryRun = process.env.CI_HEALER_DRY_RUN === 'true';

async function linearRequest(query, variables = {}) {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear API HTTP ${response.status}: ${text}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`Linear GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data;
}

async function getTeamId() {
  const data = await linearRequest(`
    query($filter: TeamFilter) {
      teams(filter: $filter, first: 1) {
        nodes { id key name }
      }
    }
  `, { filter: { name: { eq: teamName } } });

  const team = data.teams.nodes[0];
  if (!team) {
    throw new Error(`Linear team not found: ${teamName}`);
  }
  return team.id;
}

async function getProjectId(teamId) {
  const data = await linearRequest(`
    query($filter: ProjectFilter) {
      projects(filter: $filter, first: 5) {
        nodes { id name slug }
      }
    }
  `, { filter: { name: { eq: projectName } } });

  const project = data.projects.nodes.find(
    (p) => p.name === projectName || p.slug === projectName.toLowerCase()
  );
  return project?.id ?? null;
}

async function getEpicId() {
  const data = await linearRequest(`
    query($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
      }
    }
  `, { id: epicIdentifier });

  if (!data.issue) {
    throw new Error(`Linear epic not found: ${epicIdentifier}`);
  }
  return data.issue.id;
}

async function getWorkflowStates(teamId) {
  const data = await linearRequest(`
    query($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes { id name type }
        }
      }
    }
  `, { teamId });

  return data.team.states.nodes;
}

function findStateId(states, targetName) {
  const match = states.find(
    (s) => s.name.toLowerCase() === targetName.toLowerCase()
  );
  return match?.id ?? null;
}

async function findDailyIssue(teamId, title) {
  const data = await linearRequest(`
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 1) {
        nodes {
          id
          identifier
          title
          comments {
            nodes { body }
          }
        }
      }
    }
  `, {
    filter: {
      team: { id: { eq: teamId } },
      title: { eq: title },
    },
  });

  return data.issues.nodes[0] ?? null;
}

async function createDailyIssue(teamId, projectId, epicId, title) {
  const input = {
    teamId,
    title,
    parentId: epicId,
    description: `Daily CI sweep for ops-ai/Toggly.FeatureManagement.\n\nImplementation notes are posted as comments only.`,
    labelIds: [],
  };

  if (projectId) {
    input.projectId = projectId;
  }

  const data = await linearRequest(`
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title }
      }
    }
  `, { input });

  if (!data.issueCreate.success) {
    throw new Error('Failed to create daily sweep issue');
  }

  return data.issueCreate.issue;
}

async function postComment(issueId, body) {
  const data = await linearRequest(`
    mutation($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id }
      }
    }
  `, { input: { issueId, body } });

  if (!data.commentCreate.success) {
    throw new Error('Failed to create Linear comment');
  }
}

async function updateIssueState(issueId, stateId) {
  if (!stateId) {
    return;
  }

  await linearRequest(`
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
      }
    }
  `, { id: issueId, input: { stateId } });
}

function buildCommentBody() {
  const outcome = greencheckFixed === 'true' ? 'Resolved' : 'Escalated';
  const mode = dryRun ? 'Dry-run' : 'Live';

  return [
    `## Failure: ${workflowName} / ${headBranch}`,
    '',
    `**Run:** ${workflowRunUrl || 'n/a'}`,
    `**Mode:** ${mode}`,
    `**Classification:** ${greencheckFixed === 'true' ? 'Fixable (resolved)' : 'Fixable (attempted)'}`,
    '',
    '### Actions',
    `1. greencheck reactive healer invoked (${mode.toLowerCase()})`,
    `2. Passes used: ${greencheckPasses}`,
    `3. Failures found/fixed: ${greencheckFailuresFound}/${greencheckFailuresFixed}`,
    greencheckCost ? `4. Estimated cost: ${greencheckCost}` : null,
    '',
    '### Commits',
    greencheckCommits ? `- ${greencheckCommits.split(',').join('\n- ')}` : '- none',
    '',
    `### Outcome`,
    outcome,
    '',
    `<!-- ci-healer-processed run_id=${workflowRunId} -->`,
  ]
    .filter(Boolean)
    .join('\n');
}

function isDuplicate(comments, runId) {
  if (!runId) {
    return false;
  }

  const marker = `ci-healer-processed run_id=${runId}`;
  return comments.some((c) => c.body?.includes(marker));
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const dailyTitle = `CI sweep ${today} — FeatureManagement`;

  const teamId = await getTeamId();
  const projectId = await getProjectId(teamId);
  const epicId = await getEpicId();
  const states = await getWorkflowStates(teamId);

  let dailyIssue = await findDailyIssue(teamId, dailyTitle);
  if (!dailyIssue) {
    dailyIssue = await createDailyIssue(teamId, projectId, epicId, dailyTitle);
    console.log(`Created daily issue: ${dailyIssue.identifier}`);
  } else {
    console.log(`Found daily issue: ${dailyIssue.identifier}`);
  }

  const existingComments = dailyIssue.comments?.nodes ?? [];
  if (isDuplicate(existingComments, workflowRunId)) {
    console.log(`Skipping duplicate comment for run_id=${workflowRunId}`);
    return;
  }

  const body = buildCommentBody();
  await postComment(dailyIssue.id, body);
  console.log('Posted Linear comment');

  const targetState = greencheckFixed === 'true' ? 'In Review' : 'In Progress';
  const stateId = findStateId(states, targetState);
  await updateIssueState(dailyIssue.id, stateId);
  console.log(`Updated issue state to ${targetState}`);
}

main().catch((error) => {
  console.error('report-to-linear failed:', error.message);
  process.exit(1);
});
