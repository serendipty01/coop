import {
  GQLAllNcmecReportsDocument,
  GQLNcmecReportsPageDocument,
  GQLPermissionsDocument,
  GQLUserPermission,
} from '@/graphql/generated';
import { MockedProvider, MockedResponse } from '@apollo/client/testing';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router';

import NcmecReportsDashboard from './NcmecReportsDashboard';

const report = (reportId: string) => ({
  __typename: 'NCMECReport',
  ts: '2026-01-01T00:00:00.000Z',
  reportId,
  userId: `user-of-${reportId}`,
  userItemType: { __typename: 'UserItemType', name: 'User' },
  reportedMedia: [],
  additionalFiles: [],
  reviewerId: null,
  reportXml: '<report/>',
  reportedMessages: [],
  isTest: false,
});

const permissionsMock: MockedResponse = {
  request: { query: GQLPermissionsDocument },
  maxUsageCount: Infinity,
  result: {
    data: {
      me: {
        __typename: 'User',
        permissions: [GQLUserPermission.ViewChildSafetyData],
      },
    },
  },
};

const allReportsMock: MockedResponse = {
  request: { query: GQLAllNcmecReportsDocument },
  maxUsageCount: Infinity,
  result: {
    data: {
      myOrg: {
        __typename: 'Org',
        id: 'org-1',
        hasNCMECReportingEnabled: true,
        failedNcmecSubmissions: [
          {
            __typename: 'NcmecFailedSubmission',
            decisionId: 'decision-1',
            ts: '2026-01-02T00:00:00.000Z',
            reviewerId: null,
            userId: 'failed-user',
            userItemType: { __typename: 'UserItemType', name: 'User' },
            status: 'RETRYABLE_ERROR',
            retryCount: 1,
            lastError: null,
          },
        ],
        users: [],
      },
    },
  },
};

function pageMock(
  input: { cursor?: string; search?: string },
  reportIds: string[],
  nextCursor: string | null,
): MockedResponse {
  return {
    request: { query: GQLNcmecReportsPageDocument, variables: { input } },
    maxUsageCount: Infinity,
    result: {
      data: {
        myOrg: {
          __typename: 'Org',
          id: 'org-1',
          ncmecReportsPage: {
            __typename: 'NcmecReportsPage',
            reports: reportIds.map(report),
            nextCursor,
          },
        },
      },
    },
  };
}

function renderPage(mocks: MockedResponse[]) {
  return render(
    <MockedProvider mocks={[permissionsMock, allReportsMock, ...mocks]}>
      <HelmetProvider>
        <MemoryRouter>
          <NcmecReportsDashboard />
        </MemoryRouter>
      </HelmetProvider>
    </MockedProvider>,
  );
}

describe('NcmecReportsDashboard', () => {
  it('pages forward and back, showing failed submissions on the first page only', async () => {
    renderPage([
      pageMock({}, ['report-a'], 'cursor-2'),
      pageMock({ cursor: 'cursor-2' }, ['report-b'], null),
    ]);

    expect(await screen.findByText('report-a')).toBeInTheDocument();
    expect(screen.getByText('failed-user')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Previous page' }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('report-b')).toBeInTheDocument();
    expect(screen.queryByText('report-a')).not.toBeInTheDocument();
    expect(screen.queryByText('failed-user')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));

    expect(await screen.findByText('report-a')).toBeInTheDocument();
    expect(screen.getByText('failed-user')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('searches on the server from the first page and says when nothing matches', async () => {
    renderPage([
      pageMock({}, ['report-a'], 'cursor-2'),
      pageMock({ cursor: 'cursor-2' }, ['report-b'], null),
      pageMock({ search: 'old-report' }, ['old-report'], null),
      pageMock({ search: 'missing' }, [], null),
    ]);

    await screen.findByText('report-a');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('report-b');

    const searchBox = screen.getByRole('textbox', {
      name: 'Search by report or user ID',
    });
    fireEvent.change(searchBox, { target: { value: ' old-report ' } });
    fireEvent.keyDown(searchBox, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('old-report')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.queryByText('failed-user')).not.toBeInTheDocument();

    fireEvent.change(searchBox, { target: { value: 'missing' } });
    fireEvent.keyDown(searchBox, { key: 'Enter', code: 'Enter' });

    expect(
      await screen.findByText('No reports match "missing".'),
    ).toBeInTheDocument();
  });
});
