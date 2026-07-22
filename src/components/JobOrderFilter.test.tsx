// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobOrderFilter } from './JobOrderFilter';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe('JobOrderFilter', () => {
  it('navigates to /candidates?job=<id> when a job order is selected', async () => {
    render(
      <JobOrderFilter
        jobOrders={[{ id: 'j1', title: 'Job One' }, { id: 'j2', title: 'Job Two' }]}
        selected={null}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/filter by job order/i), 'j1');
    expect(pushMock).toHaveBeenCalledWith('/candidates?job=j1');
  });

  it('navigates back to /candidates with no filter when "All job orders" is selected', async () => {
    render(
      <JobOrderFilter
        jobOrders={[{ id: 'j1', title: 'Job One' }]}
        selected="j1"
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/filter by job order/i), '');
    expect(pushMock).toHaveBeenCalledWith('/candidates');
  });
});
