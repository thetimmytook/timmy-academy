import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { BrowserRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Dropdown } from './Dropdown';
import { Field } from './Field';

import type { SyntheticEvent } from 'react';

afterEach(cleanup);

describe('shared elements', () => {
  it('keeps action buttons from submitting a form and supports explicit submission', () => {
    const submit = vi.fn((event: SyntheticEvent) => event.preventDefault());
    const action = vi.fn();
    render(
      <form onSubmit={submit}>
        <Button onClick={action}>Preview</Button>
        <Button type="submit">Save</Button>
        <Button disabled onClick={action}>
          Unavailable
        </Button>
      </form>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(action).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unavailable' }));
    expect(action).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('renders navigation as an anchor and navigates through the router', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render(
      <BrowserRouter>
        <Button href="/bench/?limit=2">Browse</Button>
      </BrowserRouter>,
    );

    const link = screen.getByRole('link', { name: 'Browse' });
    expect(link.getAttribute('href')).toBe('/bench/?limit=2');
    fireEvent.click(link);
    expect(push).toHaveBeenCalledOnce();
    expect(window.location.pathname + window.location.search).toBe('/bench/?limit=2');
    push.mockRestore();
  });

  it('preserves browser handling for modified clicks and honors cancellation', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render(
      <BrowserRouter>
        <Button href="/bench/" onClick={event => event.preventDefault()}>
          Stay
        </Button>
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Stay' }));
    expect(push).not.toHaveBeenCalled();

    cleanup();
    render(
      <BrowserRouter>
        <Button href="/bench/">Open</Button>
      </BrowserRouter>,
    );
    const link = screen.getByRole('link', { name: 'Open' });

    // Observe whether React prevented the event, then suppress jsdom's navigation.
    const prevented: boolean[] = [];

    const intercept = (event: MouseEvent): void => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };

    document.addEventListener('click', intercept);
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { shiftKey: true });
    fireEvent.click(link, { altKey: true });
    expect(prevented).toEqual([false, false, false, false]);
    expect(push).not.toHaveBeenCalled();
    document.removeEventListener('click', intercept);
    push.mockRestore();
  });

  it('preserves native external, target and download links and their refs', () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <BrowserRouter>
        <Button href="https://example.com">External</Button>
        <Button href="//example.com">Protocol relative</Button>
        <Button href="/bench/" target="_blank">
          New tab
        </Button>
        <Button href="/export" download="runs.json" ref={ref}>
          Download
        </Button>
      </BrowserRouter>,
    );
    const prevented: boolean[] = [];

    const intercept = (event: MouseEvent): void => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };

    document.addEventListener('click', intercept);

    for (const link of screen.getAllByRole('link')) {
      fireEvent.click(link);
    }

    document.removeEventListener('click', intercept);
    expect(prevented).toEqual([false, false, false, false]);
    expect(ref.current).toBe(screen.getByRole('link', { name: 'Download' }));
    expect(ref.current?.download).toBe('runs.json');
  });

  it('keeps Dropdown labelled, controlled, and accessible through its native ref', () => {
    const ref = createRef<HTMLSelectElement>();
    const change = vi.fn();
    const view = render(
      <Field label="Map">
        <Dropdown ref={ref} value="woods" onChange={change}>
          <option value="woods">Woods</option>
          <option value="customs">Customs</option>
        </Dropdown>
      </Field>,
    );

    const dropdown = screen.getByRole('combobox', { name: 'Map' });
    expect(ref.current).toBe(dropdown);
    fireEvent.change(dropdown, { target: { value: 'customs' } });
    expect(change).toHaveBeenCalledOnce();
    view.rerender(
      <Field label="Map">
        <Dropdown ref={ref} value="customs" disabled onChange={change}>
          <option value="customs">Customs</option>
        </Dropdown>
      </Field>,
    );
    expect(ref.current?.value).toBe('customs');
    expect(ref.current?.disabled).toBe(true);
  });
});
