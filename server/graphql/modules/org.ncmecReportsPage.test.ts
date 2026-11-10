import { vi } from 'vitest';

import { UserPermission } from '../../services/userManagementService/index.js';
import { resolvers } from './org.js';

const Org = resolvers.Org as {
  ncmecReportsPage: (
    parent: { id: string },
    args: { input?: Record<string, unknown> | null },
    ctx: unknown,
  ) => Promise<{ reports: unknown[]; nextCursor: unknown }>;
};

function makeCtx(nextAfterReportId: string | null = null) {
  const getNcmecReportsPage = vi.fn(async () => ({
    reports: [],
    nextAfterReportId,
  }));
  const ctx = {
    getUser: () => ({
      id: 'reviewer-1',
      orgId: 'org-1',
      getPermissions: () => [UserPermission.VIEW_CHILD_SAFETY_DATA],
    }),
    services: { NcmecService: { getNcmecReportsPage } },
  };
  return { ctx, getNcmecReportsPage };
}

describe('Org.ncmecReportsPage', () => {
  it('passes the cursor back as the report to continue after', async () => {
    const { ctx, getNcmecReportsPage } = makeCtx('r9');
    const page = await Org.ncmecReportsPage({ id: 'org-1' }, {}, ctx);
    expect(page.nextCursor).toEqual({ reportId: 'r9' });

    await Org.ncmecReportsPage(
      { id: 'org-1' },
      { input: { cursor: page.nextCursor, search: '  123 ' } },
      ctx,
    );
    expect(getNcmecReportsPage).toHaveBeenLastCalledWith({
      orgId: 'org-1',
      reviewerId: 'reviewer-1',
      afterReportId: 'r9',
      search: '123',
      limit: 50,
    });
  });

  it('caps the page size', async () => {
    const { ctx, getNcmecReportsPage } = makeCtx();
    await Org.ncmecReportsPage(
      { id: 'org-1' },
      { input: { limit: 10_000 } },
      ctx,
    );
    expect(getNcmecReportsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });

  it.each([['r9'], [{ id: 'r9' }], [['r9']]])(
    'rejects a malformed cursor %j',
    async (cursor) => {
      const { ctx, getNcmecReportsPage } = makeCtx();
      await expect(
        Org.ncmecReportsPage({ id: 'org-1' }, { input: { cursor } }, ctx),
      ).rejects.toThrow('Invalid NCMEC reports cursor.');
      expect(getNcmecReportsPage).not.toHaveBeenCalled();
    },
  );
});
