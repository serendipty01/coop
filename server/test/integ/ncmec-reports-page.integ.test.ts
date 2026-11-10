import { sql } from 'kysely';
import { uid } from 'uid';

import createOrg from '../fixtureHelpers/createOrg.js';
import { makeTransactionalTestWithFixture } from '../harness/transactionalTest.js';

describe('NcmecService.getNcmecReportsPage (integration)', () => {
  const testWithFixture = makeTransactionalTestWithFixture(async ({ deps }) => {
    const orgId = uid();
    const otherOrgId = uid();
    const orgFixture = await createOrg(
      {
        KyselyPg: deps.KyselyPg,
        ModerationConfigService: deps.ModerationConfigService,
        ApiKeyService: deps.ApiKeyService,
      },
      orgId,
    );
    const userItemTypeId = orgFixture.defaultUserItemType.id;
    const insertReport = async (report: {
      reportId: string;
      createdAt: string;
      userId?: string;
      isTest?: boolean;
      reviewerId?: string;
      orgId?: string;
    }) =>
      deps.KyselyPg.insertInto('ncmec_reporting.ncmec_reports')
        .values({
          org_id: report.orgId ?? orgId,
          report_id: report.reportId,
          user_id: report.userId ?? uid(),
          user_item_type_id: userItemTypeId,
          created_at: sql<Date>`${report.createdAt}::timestamptz`,
          reported_media: [
            { id: uid(), typeId: userItemTypeId, xml: '<file/>' },
          ],
          report_xml: '<report/>',
          is_test: report.isTest ?? false,
          reviewer_id: report.reviewerId ?? 'reviewer-1',
        })
        .execute();
    const readAllPages = async (
      opts: { limit: number; search?: string },
      afterReportId?: string,
    ): Promise<string[][]> => {
      const page = await deps.NcmecService.getNcmecReportsPage({
        orgId,
        reviewerId: 'reviewer-1',
        afterReportId,
        search: opts.search,
        limit: opts.limit,
      });
      const ids = page.reports.map((r) => r.reportId);
      return page.nextAfterReportId === null
        ? [ids]
        : [ids, ...(await readAllPages(opts, page.nextAfterReportId))];
    };
    return { orgId, otherOrgId, insertReport, readAllPages, deps };
  });

  testWithFixture(
    'pages through every report once, newest first, including microsecond and exact ties',
    async ({ insertReport, readAllPages }) => {
      // r3 and r2 differ only in microseconds; r2 and r1 share a timestamp.
      await insertReport({
        reportId: 'r4',
        createdAt: '2026-01-02T00:00:00.000000Z',
      });
      await insertReport({
        reportId: 'r3',
        createdAt: '2026-01-01T00:00:00.000002Z',
      });
      await insertReport({
        reportId: 'r2',
        createdAt: '2026-01-01T00:00:00.000001Z',
      });
      await insertReport({
        reportId: 'r1',
        createdAt: '2026-01-01T00:00:00.000001Z',
      });
      await insertReport({
        reportId: 'r0',
        createdAt: '2025-12-31T00:00:00.000000Z',
      });

      expect(await readAllPages({ limit: 2 })).toEqual([
        ['r4', 'r3'],
        ['r2', 'r1'],
        ['r0'],
      ]);
    },
  );

  testWithFixture(
    'returns no next page when the last page is exactly full',
    async ({ insertReport, readAllPages }) => {
      await insertReport({ reportId: 'a', createdAt: '2026-01-02T00:00:00Z' });
      await insertReport({ reportId: 'b', createdAt: '2026-01-01T00:00:00Z' });

      expect(await readAllPages({ limit: 2 })).toEqual([['a', 'b']]);
    },
  );

  testWithFixture(
    'searches report IDs and user IDs beyond the first page',
    async ({ insertReport, readAllPages }) => {
      await insertReport({
        reportId: '900001',
        createdAt: '2026-01-03T00:00:00Z',
      });
      await insertReport({
        reportId: '900002',
        createdAt: '2026-01-02T00:00:00Z',
      });
      await insertReport({
        reportId: '123456',
        createdAt: '2025-01-01T00:00:00Z',
      });
      await insertReport({
        reportId: '900003',
        createdAt: '2024-01-01T00:00:00Z',
        userId: 'user-x2345y',
      });

      expect(await readAllPages({ limit: 1, search: '2345' })).toEqual([
        ['123456'],
        ['900003'],
      ]);
    },
  );

  testWithFixture(
    "hides other reviewers' test reports and other orgs' reports",
    async ({ insertReport, readAllPages, otherOrgId }) => {
      await insertReport({ reportId: 'prod', createdAt: '2026-01-04T00:00Z' });
      await insertReport({
        reportId: 'mine-test',
        createdAt: '2026-01-03T00:00Z',
        isTest: true,
      });
      await insertReport({
        reportId: 'their-test',
        createdAt: '2026-01-02T00:00Z',
        isTest: true,
        reviewerId: 'reviewer-2',
      });
      await insertReport({
        reportId: 'other-org',
        createdAt: '2026-01-01T00:00Z',
        orgId: otherOrgId,
      });

      expect((await readAllPages({ limit: 10 })).flat()).toEqual([
        'prod',
        'mine-test',
      ]);
    },
  );

  testWithFixture(
    "returns nothing for a cursor that names another org's report",
    async ({ deps, insertReport, orgId, otherOrgId }) => {
      await insertReport({ reportId: 'own', createdAt: '2026-01-01T00:00Z' });
      await insertReport({
        reportId: 'foreign',
        createdAt: '2026-02-01T00:00Z',
        orgId: otherOrgId,
      });

      const page = await deps.NcmecService.getNcmecReportsPage({
        orgId,
        reviewerId: 'reviewer-1',
        afterReportId: 'foreign',
        search: undefined,
        limit: 10,
      });
      expect(page).toEqual({ reports: [], nextAfterReportId: null });
    },
  );
});
